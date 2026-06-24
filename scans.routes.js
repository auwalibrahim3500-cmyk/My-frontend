const express = require('express');
const Joi = require('joi');
const path = require('path');
const fs = require('fs/promises');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { upload, uploadDir } = require('../middleware/upload');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const claude = require('../utils/claude');

const router = express.Router();
router.use(requireAuth);

// ── POST /scans — upload a photo, run AI diagnosis, persist + return result ──
router.post(
  '/',
  upload.single('image'),
  validate({
    body: Joi.object({
      cropLabel: Joi.string().max(80).optional(),
      farmId: Joi.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('An image file ("image" field) is required.');

    const imageUrl = `/uploads/scans/${req.file.filename}`;
    const { rows: pendingRows } = await query(
      `INSERT INTO scans (user_id, farm_id, image_url, crop_label, status)
       VALUES ($1,$2,$3,$4,'processing') RETURNING *`,
      [req.user.id, req.body.farmId || null, imageUrl, req.body.cropLabel || null]
    );
    const scan = pendingRows[0];

    try {
      const imageBuffer = await fs.readFile(path.join(uploadDir, req.file.filename));
      const diagnosis = await claude.diagnoseCropImage(imageBuffer, req.file.mimetype, { cropLabel: req.body.cropLabel });

      // Try to match a known crop/disease for richer linked data (non-fatal if no match).
      let cropId = null, diseaseId = null;
      if (diagnosis.crop_label) {
        const c = await query('SELECT id FROM crops WHERE LOWER(name_en) = LOWER($1) LIMIT 1', [diagnosis.crop_label]);
        cropId = c.rows[0]?.id || null;
      }
      if (diagnosis.disease_label && diagnosis.disease_label.toLowerCase() !== 'healthy') {
        const d = await query('SELECT id FROM diseases WHERE LOWER(name_en) = LOWER($1) LIMIT 1', [diagnosis.disease_label]);
        diseaseId = d.rows[0]?.id || null;
      }

      const { rows: updatedRows } = await query(
        `UPDATE scans SET crop_id=$1, disease_id=$2, crop_label=$3, disease_label=$4, confidence=$5,
                severity=$6, hectares_affected=$7, ai_raw_response=$8, status='completed'
         WHERE id = $9 RETURNING *`,
        [
          cropId, diseaseId, diagnosis.crop_label || req.body.cropLabel || null, diagnosis.disease_label || null,
          diagnosis.confidence ?? null, diagnosis.severity || 'none', diagnosis.hectares_affected_estimate ?? null,
          JSON.stringify(diagnosis), scan.id,
        ]
      );

      // Attach disease detail (treatment/prevention) if matched in library; else use AI-generated content.
      let diseaseDetail = null;
      if (diseaseId) {
        const d = await query('SELECT * FROM diseases WHERE id = $1', [diseaseId]);
        diseaseDetail = serializeDisease(d.rows[0]);
      }

      res.status(201).json({
        success: true,
        data: {
          scan: serializeScan(updatedRows[0]),
          diagnosis: {
            description: diagnosis.description,
            treatmentSteps: diseaseDetail?.treatmentSteps || (diagnosis.treatment_steps || []).map((t, i) => ({ step: i + 1, text: t })),
            preventionTips: diseaseDetail?.preventionTips || diagnosis.prevention_tips || [],
          },
        },
      });
    } catch (err) {
      await query(`UPDATE scans SET status='failed', error_message=$1 WHERE id=$2`, [err.message, scan.id]);
      throw ApiError.internal('AI diagnosis failed. Please try again with a clearer photo.');
    }
  })
);

// ── GET /scans — scan history ────────────────────────────────────────────
router.get(
  '/',
  validate({ query: Joi.object({ limit: Joi.number().integer().min(1).max(100).default(20), offset: Joi.number().integer().min(0).default(0) }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, req.query.limit, req.query.offset]
    );
    res.json({ success: true, data: rows.map(serializeScan) });
  })
);

// ── GET /scans/:id ────────────────────────────────────────────────────────
router.get(
  '/:id',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM scans WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rows.length) throw ApiError.notFound('Scan not found.');

    let diseaseDetail = null;
    if (rows[0].disease_id) {
      const d = await query('SELECT * FROM diseases WHERE id = $1', [rows[0].disease_id]);
      diseaseDetail = serializeDisease(d.rows[0]);
    }
    res.json({ success: true, data: { scan: serializeScan(rows[0]), diseaseDetail } });
  })
);

function serializeScan(s) {
  return {
    id: s.id, farmId: s.farm_id, cropId: s.crop_id, diseaseId: s.disease_id,
    imageUrl: s.image_url, cropLabel: s.crop_label, diseaseLabel: s.disease_label,
    confidence: s.confidence !== null ? Number(s.confidence) : null, severity: s.severity,
    hectaresAffected: s.hectares_affected !== null ? Number(s.hectares_affected) : null,
    status: s.status, createdAt: s.created_at,
  };
}

function serializeDisease(d) {
  return {
    id: d.id, slug: d.slug, nameEn: d.name_en, nameHa: d.name_ha, pathogen: d.pathogen,
    defaultSeverity: d.default_severity, descriptionEn: d.description_en, descriptionHa: d.description_ha,
    symptoms: d.symptoms, treatmentSteps: d.treatment_steps, preventionTips: d.prevention_tips,
  };
}

module.exports = router;

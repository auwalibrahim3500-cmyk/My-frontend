const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const router = express.Router();

// ── GET /library/crops?search=&category= ────────────────────────────────
router.get(
  '/crops',
  validate({ query: Joi.object({ search: Joi.string().max(80).optional(), category: Joi.string().max(40).optional() }) }),
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];
    let i = 1;

    if (req.query.search) {
      conditions.push(`(name_en ILIKE $${i} OR name_ha ILIKE $${i} OR name_yo ILIKE $${i} OR name_ig ILIKE $${i})`);
      params.push(`%${req.query.search}%`); i++;
    }
    if (req.query.category) {
      conditions.push(`category = $${i}`); params.push(req.query.category); i++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(`SELECT * FROM crops ${where} ORDER BY name_en`, params);
    res.json({ success: true, data: rows.map(serializeCrop) });
  })
);

// ── GET /library/crops/:slug ──────────────────────────────────────────────
router.get(
  '/crops/:slug',
  validate({ params: Joi.object({ slug: Joi.string().required() }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM crops WHERE slug = $1', [req.params.slug]);
    if (!rows.length) throw ApiError.notFound('Crop not found.');
    const diseases = await query('SELECT * FROM diseases WHERE crop_id = $1 ORDER BY name_en', [rows[0].id]);
    res.json({ success: true, data: { ...serializeCrop(rows[0]), diseases: diseases.rows.map(serializeDisease) } });
  })
);

// ── GET /library/diseases?search=&crop= ──────────────────────────────────
router.get(
  '/diseases',
  validate({ query: Joi.object({ search: Joi.string().max(80).optional(), crop: Joi.string().max(60).optional() }) }),
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];
    let i = 1;

    if (req.query.search) {
      conditions.push(`(d.name_en ILIKE $${i} OR d.name_ha ILIKE $${i})`); params.push(`%${req.query.search}%`); i++;
    }
    if (req.query.crop) {
      conditions.push(`c.slug = $${i}`); params.push(req.query.crop); i++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT d.*, c.name_en AS crop_name, c.emoji AS crop_emoji
       FROM diseases d LEFT JOIN crops c ON c.id = d.crop_id ${where} ORDER BY d.name_en`,
      params
    );
    res.json({ success: true, data: rows.map((d) => ({ ...serializeDisease(d), cropName: d.crop_name, cropEmoji: d.crop_emoji })) });
  })
);

// ── GET /library/diseases/:slug ───────────────────────────────────────────
router.get(
  '/diseases/:slug',
  validate({ params: Joi.object({ slug: Joi.string().required() }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT d.*, c.name_en AS crop_name, c.emoji AS crop_emoji FROM diseases d
       LEFT JOIN crops c ON c.id = d.crop_id WHERE d.slug = $1`,
      [req.params.slug]
    );
    if (!rows.length) throw ApiError.notFound('Disease not found.');
    res.json({ success: true, data: { ...serializeDisease(rows[0]), cropName: rows[0].crop_name, cropEmoji: rows[0].crop_emoji } });
  })
);

function serializeCrop(c) {
  return {
    id: c.id, slug: c.slug, nameEn: c.name_en, nameHa: c.name_ha, nameYo: c.name_yo, nameIg: c.name_ig,
    emoji: c.emoji, category: c.category, growingSeason: c.growing_season, descriptionEn: c.description_en, imageUrl: c.image_url,
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

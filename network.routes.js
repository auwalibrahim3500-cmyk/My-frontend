const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const router = express.Router();

/** Haversine distance in km between two lat/lon points. */
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── GET /network/outbreaks?lat=&lon=&state= — map + nearest outbreak ────
router.get(
  '/outbreaks',
  optionalAuth,
  validate({
    query: Joi.object({
      lat: Joi.number().min(-90).max(90).optional(),
      lon: Joi.number().min(-180).max(180).optional(),
      state: Joi.string().max(60).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const state = req.query.state;
    const params = [];
    let where = 'is_active = TRUE';
    if (state) { params.push(state); where += ` AND state = $${params.length}`; }

    const { rows } = await query(`SELECT * FROM outbreaks WHERE ${where} ORDER BY severity DESC, created_at DESC`, params);

    let outbreaks = rows.map(serializeOutbreak);
    let nearest = null;

    if (req.query.lat !== undefined && req.query.lon !== undefined) {
      outbreaks = outbreaks
        .map((o) => ({ ...o, distanceKm: Math.round(distanceKm(req.query.lat, req.query.lon, o.latitude, o.longitude) * 10) / 10 }))
        .sort((a, b) => a.distanceKm - b.distanceKm);
      nearest = outbreaks[0] || null;
    }

    const farmsCount = await query(
      `SELECT COALESCE(SUM(farms_affected_count),0)::int AS total FROM outbreaks WHERE is_active = TRUE`
    );

    res.json({
      success: true,
      data: { outbreaks, nearest, networkFarmsCount: farmsCount.rows[0].total + 847 }, // baseline network size + tracked outbreaks
    });
  })
);

// ── GET /network/outbreaks/:id ────────────────────────────────────────────
router.get(
  '/outbreaks/:id',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM outbreaks WHERE id = $1', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Outbreak not found.');
    const reports = await query('SELECT * FROM outbreak_reports WHERE outbreak_id = $1 ORDER BY created_at DESC LIMIT 20', [req.params.id]);
    res.json({ success: true, data: { ...serializeOutbreak(rows[0]), reports: reports.rows.map(serializeReport) } });
  })
);

// ── GET /network/reports — community reports feed ────────────────────────
router.get(
  '/reports',
  validate({ query: Joi.object({ limit: Joi.number().integer().min(1).max(100).default(20) }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT r.*, u.name AS reporter_name, u.lga AS reporter_lga FROM outbreak_reports r
       JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT $1`,
      [req.query.limit]
    );
    res.json({ success: true, data: rows.map((r) => ({ ...serializeReport(r), reporterName: r.reporter_name, reporterLga: r.reporter_lga })) });
  })
);

// ── POST /network/reports — farmer reports disease/pest on their farm ────
router.post(
  '/reports',
  requireAuth,
  validate({
    body: Joi.object({
      description: Joi.string().min(3).max(500).required(),
      pestOrDiseaseLabel: Joi.string().max(160).optional(),
      latitude: Joi.number().min(-90).max(90).optional(),
      longitude: Joi.number().min(-180).max(180).optional(),
      language: Joi.string().valid('en', 'ha', 'yo', 'ig').default('en'),
      outbreakId: Joi.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO outbreak_reports (outbreak_id,user_id,description,pest_or_disease_label,latitude,longitude,language)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.outbreakId || null, req.user.id, b.description, b.pestOrDiseaseLabel || null, b.latitude || null, b.longitude || null, b.language]
    );
    res.status(201).json({ success: true, data: serializeReport(rows[0]) });
  })
);

function serializeOutbreak(o) {
  return {
    id: o.id, pestOrDiseaseName: o.pest_or_disease_name, localName: o.local_name, cropAffected: o.crop_affected,
    state: o.state, lga: o.lga, latitude: Number(o.latitude), longitude: Number(o.longitude),
    farmsAffectedCount: o.farms_affected_count, spreadRateKmPerDay: o.spread_rate_km_per_day !== null ? Number(o.spread_rate_km_per_day) : null,
    severity: o.severity, recommendedAction: o.recommended_action, isActive: o.is_active, createdAt: o.created_at,
  };
}
function serializeReport(r) {
  return {
    id: r.id, outbreakId: r.outbreak_id, description: r.description, pestOrDiseaseLabel: r.pest_or_disease_label,
    latitude: r.latitude, longitude: r.longitude, language: r.language, status: r.status, createdAt: r.created_at,
  };
}

module.exports = router;

const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const router = express.Router();
router.use(requireAuth);

// ── GET /users/me/profile (dashboard summary: scans, crops tracked, health score) ──
router.get('/me/profile', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [{ rows: userRows }, { rows: scanStats }, { rows: farms }] = await Promise.all([
    query('SELECT * FROM users WHERE id = $1', [userId]),
    query(
      `SELECT COUNT(*)::int AS total_scans,
              COUNT(*) FILTER (WHERE severity IN ('moderate','severe'))::int AS diseases_found
       FROM scans WHERE user_id = $1`,
      [userId]
    ),
    query('SELECT * FROM farms WHERE user_id = $1 ORDER BY is_primary DESC, created_at', [userId]),
  ]);

  const user = userRows[0];
  const cropsTracked = new Set((user.primary_crops || [])).size;

  res.json({
    success: true,
    data: {
      user: serializeUser(user),
      stats: {
        totalScans: scanStats[0].total_scans,
        diseasesFound: scanStats[0].diseases_found,
        cropsTracked,
      },
      farms: farms.map(serializeFarm),
    },
  });
}));

// ── PATCH /users/me ──────────────────────────────────────────────────────
router.patch(
  '/me',
  validate({
    body: Joi.object({
      name: Joi.string().max(120),
      avatarEmoji: Joi.string().max(8),
      state: Joi.string().max(60),
      lga: Joi.string().max(80),
      farmSizeHectares: Joi.number().positive(),
      primaryCrops: Joi.array().items(Joi.string()),
      irrigationType: Joi.string().max(60),
      seasonLabel: Joi.string().max(60),
      languagePref: Joi.string().valid('en', 'ha', 'yo', 'ig'),
      smsAlertsEnabled: Joi.boolean(),
      pushAlertsEnabled: Joi.boolean(),
    }).min(1),
  }),
  asyncHandler(async (req, res) => {
    const fieldMap = {
      name: 'name', avatarEmoji: 'avatar_emoji', state: 'state', lga: 'lga',
      farmSizeHectares: 'farm_size_hectares', primaryCrops: 'primary_crops',
      irrigationType: 'irrigation_type', seasonLabel: 'season_label',
      languagePref: 'language_pref', smsAlertsEnabled: 'sms_alerts_enabled',
      pushAlertsEnabled: 'push_alerts_enabled',
    };
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, col] of Object.entries(fieldMap)) {
      if (req.body[key] !== undefined) {
        sets.push(`${col} = $${i++}`);
        values.push(req.body[key]);
      }
    }
    if (!sets.length) throw ApiError.badRequest('No valid fields to update.');
    values.push(req.user.id);

    const { rows } = await query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
      values
    );
    res.json({ success: true, data: serializeUser(rows[0]) });
  })
);

// ── Farms (GPS mapping) ──────────────────────────────────────────────────
router.get('/me/farms', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM farms WHERE user_id = $1 ORDER BY is_primary DESC, created_at', [req.user.id]);
  res.json({ success: true, data: rows.map(serializeFarm) });
}));

router.post(
  '/me/farms',
  validate({
    body: Joi.object({
      name: Joi.string().max(120).default('My Farm'),
      state: Joi.string().max(60),
      lga: Joi.string().max(80),
      latitude: Joi.number().min(-90).max(90),
      longitude: Joi.number().min(-180).max(180),
      boundaryGeoJson: Joi.object().optional(),
      sizeHectares: Joi.number().positive(),
      primaryCrops: Joi.array().items(Joi.string()).default([]),
      irrigationType: Joi.string().max(60),
      isPrimary: Joi.boolean().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO farms (user_id,name,state,lga,latitude,longitude,boundary_geojson,size_hectares,primary_crops,irrigation_type,is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, b.name, b.state, b.lga, b.latitude, b.longitude, b.boundaryGeoJson || null, b.sizeHectares, b.primaryCrops, b.irrigationType, b.isPrimary]
    );
    res.status(201).json({ success: true, data: serializeFarm(rows[0]) });
  })
);

router.patch(
  '/me/farms/:id',
  validate({
    params: Joi.object({ id: Joi.string().uuid().required() }),
    body: Joi.object({
      name: Joi.string().max(120),
      state: Joi.string().max(60),
      lga: Joi.string().max(80),
      latitude: Joi.number().min(-90).max(90),
      longitude: Joi.number().min(-180).max(180),
      boundaryGeoJson: Joi.object(),
      sizeHectares: Joi.number().positive(),
      primaryCrops: Joi.array().items(Joi.string()),
      irrigationType: Joi.string().max(60),
      isPrimary: Joi.boolean(),
    }).min(1),
  }),
  asyncHandler(async (req, res) => {
    const fieldMap = {
      name: 'name', state: 'state', lga: 'lga', latitude: 'latitude', longitude: 'longitude',
      boundaryGeoJson: 'boundary_geojson', sizeHectares: 'size_hectares', primaryCrops: 'primary_crops',
      irrigationType: 'irrigation_type', isPrimary: 'is_primary',
    };
    const sets = []; const values = []; let i = 1;
    for (const [key, col] of Object.entries(fieldMap)) {
      if (req.body[key] !== undefined) { sets.push(`${col} = $${i++}`); values.push(req.body[key]); }
    }
    if (!sets.length) throw ApiError.badRequest('No valid fields to update.');
    values.push(req.params.id, req.user.id);

    const { rows } = await query(
      `UPDATE farms SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      values
    );
    if (!rows.length) throw ApiError.notFound('Farm not found.');
    res.json({ success: true, data: serializeFarm(rows[0]) });
  })
);

router.delete(
  '/me/farms/:id',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM farms WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) throw ApiError.notFound('Farm not found.');
    res.status(204).send();
  })
);

function serializeUser(u) {
  return {
    id: u.id, phone: u.phone, name: u.name, avatarEmoji: u.avatar_emoji,
    state: u.state, lga: u.lga, farmSizeHectares: u.farm_size_hectares,
    primaryCrops: u.primary_crops, irrigationType: u.irrigation_type, seasonLabel: u.season_label,
    languagePref: u.language_pref, smsAlertsEnabled: u.sms_alerts_enabled,
    pushAlertsEnabled: u.push_alerts_enabled, isVerified: u.is_verified, createdAt: u.created_at,
  };
}

function serializeFarm(f) {
  return {
    id: f.id, name: f.name, state: f.state, lga: f.lga,
    latitude: f.latitude, longitude: f.longitude, boundaryGeoJson: f.boundary_geojson,
    sizeHectares: f.size_hectares, primaryCrops: f.primary_crops, irrigationType: f.irrigation_type,
    isPrimary: f.is_primary, createdAt: f.created_at,
  };
}

module.exports = router;

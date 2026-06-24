const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// ── GET /alerts?state=Kano — regional alerts feed ────────────────────────
router.get(
  '/',
  optionalAuth,
  validate({ query: Joi.object({ state: Joi.string().max(60).optional(), limit: Joi.number().integer().min(1).max(100).default(20) }) }),
  asyncHandler(async (req, res) => {
    const state = req.query.state || req.user?.state;
    const params = [];
    let where = '(expires_at IS NULL OR expires_at > now())';
    if (state) { params.push(state); where += ` AND (state = $${params.length} OR state IS NULL)`; }
    params.push(req.query.limit);

    const { rows } = await query(
      `SELECT * FROM alerts WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: rows.map(serializeAlert) });
  })
);

// ── GET /alerts/subscriptions ─────────────────────────────────────────────
router.get('/subscriptions', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM alert_subscriptions WHERE user_id = $1', [req.user.id]);
  res.json({ success: true, data: rows.map(serializeSub) });
}));

// ── PUT /alerts/subscriptions — upsert SMS/push subscription for a channel ──
router.put(
  '/subscriptions',
  requireAuth,
  validate({
    body: Joi.object({
      channel: Joi.string().valid('sms', 'push', 'email').required(),
      regionState: Joi.string().max(60).optional(),
      enabled: Joi.boolean().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { channel, regionState, enabled } = req.body;
    const { rows } = await query(
      `INSERT INTO alert_subscriptions (user_id, channel, region_state, enabled)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, channel) DO UPDATE SET region_state = $3, enabled = $4
       RETURNING *`,
      [req.user.id, channel, regionState || null, enabled]
    );
    res.json({ success: true, data: serializeSub(rows[0]) });
  })
);

// ── GET /alerts/notifications — in-app notification bell ─────────────────
router.get(
  '/notifications',
  requireAuth,
  validate({ query: Joi.object({ unreadOnly: Joi.boolean().default(false), limit: Joi.number().integer().min(1).max(100).default(30) }) }),
  asyncHandler(async (req, res) => {
    const cond = req.query.unreadOnly ? 'AND read_at IS NULL' : '';
    const { rows } = await query(
      `SELECT * FROM notifications WHERE user_id = $1 ${cond} ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, req.query.limit]
    );
    res.json({ success: true, data: rows.map(serializeNotification) });
  })
);

// ── PATCH /alerts/notifications/:id/read ──────────────────────────────────
router.patch(
  '/notifications/:id/read',
  requireAuth,
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true, data: rows[0] ? serializeNotification(rows[0]) : null });
  })
);

function serializeAlert(a) {
  return {
    id: a.id, type: a.type, severity: a.severity, title: a.title, body: a.body,
    state: a.state, lga: a.lga, latitude: a.latitude, longitude: a.longitude,
    source: a.source, createdAt: a.created_at, expiresAt: a.expires_at,
  };
}
function serializeSub(s) {
  return { id: s.id, channel: s.channel, regionState: s.region_state, enabled: s.enabled };
}
function serializeNotification(n) {
  return { id: n.id, title: n.title, body: n.body, type: n.type, readAt: n.read_at, createdAt: n.created_at };
}

module.exports = router;

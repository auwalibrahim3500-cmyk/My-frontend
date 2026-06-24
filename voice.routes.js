const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const claude = require('../utils/claude');

const router = express.Router();
router.use(requireAuth);

// ── POST /voice/query — submit a transcript (from on-device speech-to-text), get spoken-style reply ──
router.post(
  '/query',
  validate({
    body: Joi.object({
      transcript: Joi.string().min(1).max(1000).required(),
      language: Joi.string().valid('ha', 'en').default('ha'),
      audioUrl: Joi.string().uri().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { transcript, language, audioUrl } = req.body;

    let responseText;
    try {
      responseText = await claude.getVoiceReply(transcript, language);
    } catch (err) {
      throw ApiError.internal('Muryar AI is currently unavailable. Please try again shortly.');
    }

    const { rows } = await query(
      `INSERT INTO voice_queries (user_id, language, transcript, response_text, audio_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, language, transcript, responseText, audioUrl || null]
    );

    res.status(201).json({ success: true, data: serializeVoiceQuery(rows[0]) });
  })
);

// ── GET /voice/history ────────────────────────────────────────────────────
router.get(
  '/history',
  validate({ query: Joi.object({ limit: Joi.number().integer().min(1).max(50).default(20) }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM voice_queries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, req.query.limit]
    );
    res.json({ success: true, data: rows.map(serializeVoiceQuery) });
  })
);

function serializeVoiceQuery(v) {
  return {
    id: v.id, language: v.language, transcript: v.transcript,
    responseText: v.response_text, audioUrl: v.audio_url, createdAt: v.created_at,
  };
}

module.exports = router;

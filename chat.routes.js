const express = require('express');
const Joi = require('joi');
const { query, withTransaction } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const claude = require('../utils/claude');

const router = express.Router();
router.use(requireAuth);

// ── GET /chat/conversations — list conversations ─────────────────────────
router.get('/conversations', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM chat_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({ success: true, data: rows.map(serializeConversation) });
}));

// ── GET /chat/conversations/:id/messages ─────────────────────────────────
router.get(
  '/conversations/:id/messages',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  asyncHandler(async (req, res) => {
    await assertOwnsConversation(req.params.id, req.user.id);
    const { rows } = await query(
      `SELECT * FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows.map(serializeMessage) });
  })
);

// ── POST /chat/conversations/:id/messages — send a message, get AI reply ──
// Pass id = "new" to start a fresh conversation.
router.post(
  '/conversations/:id/messages',
  validate({
    params: Joi.object({ id: Joi.string().required() }),
    body: Joi.object({
      content: Joi.string().min(1).max(2000).required(),
      language: Joi.string().valid('en', 'ha', 'yo', 'ig').default('en'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { content, language } = req.body;
    let conversationId = req.params.id;

    if (conversationId === 'new') {
      const { rows } = await query(
        `INSERT INTO chat_conversations (user_id, title, language) VALUES ($1,$2,$3) RETURNING *`,
        [req.user.id, content.slice(0, 60), language]
      );
      conversationId = rows[0].id;
    } else {
      await assertOwnsConversation(conversationId, req.user.id);
    }

    const userMsg = await query(
      `INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1,'user',$2) RETURNING *`,
      [conversationId, content]
    );

    const { rows: historyRows } = await query(
      `SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 30`,
      [conversationId]
    );

    let replyText;
    try {
      replyText = await claude.getChatReply(historyRows, language);
    } catch (err) {
      throw ApiError.internal('AI assistant is currently unavailable. Please try again shortly.');
    }

    const assistantMsg = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1,'assistant',$2) RETURNING *`,
        [conversationId, replyText]
      );
      await client.query(`UPDATE chat_conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
      return inserted.rows[0];
    });

    res.status(201).json({
      success: true,
      data: {
        conversationId,
        userMessage: serializeMessage(userMsg.rows[0]),
        assistantMessage: serializeMessage(assistantMsg),
      },
    });
  })
);

// ── DELETE /chat/conversations/:id ───────────────────────────────────────
router.delete(
  '/conversations/:id',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      `DELETE FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) throw ApiError.notFound('Conversation not found.');
    res.status(204).send();
  })
);

async function assertOwnsConversation(id, userId) {
  const { rows } = await query('SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows.length) throw ApiError.notFound('Conversation not found.');
}

function serializeConversation(c) {
  return { id: c.id, title: c.title, language: c.language, createdAt: c.created_at, updatedAt: c.updated_at };
}
function serializeMessage(m) {
  return { id: m.id, role: m.role, content: m.content, contentHausa: m.content_hausa, createdAt: m.created_at };
}

module.exports = router;

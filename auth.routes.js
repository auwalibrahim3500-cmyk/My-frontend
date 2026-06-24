const express = require('express');
const Joi = require('joi');
const { query, withTransaction } = require('../config/database');
const validate = require('../middleware/validate');
const { otpRequestLimiter } = require('../middleware/rateLimiter');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const otpUtil = require('../utils/otp');
const { sendSms } = require('../utils/sms');
const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');
const env = require('../config/env');

const router = express.Router();

// ── POST /auth/otp/request ───────────────────────────────────────────────
router.post(
  '/otp/request',
  otpRequestLimiter,
  validate({
    body: Joi.object({
      phone: Joi.string().required(),
      purpose: Joi.string().valid('login', 'register', 'reset').default('login'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const phone = otpUtil.normalizePhone(req.body.phone);
    if (!otpUtil.isValidPhone(phone)) {
      throw ApiError.badRequest('Please provide a valid phone number, e.g. 08031234567.');
    }

    const code = otpUtil.generateCode();
    const codeHash = await otpUtil.hashCode(code);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_IN_MINUTES * 60 * 1000);

    await query(
      `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at) VALUES ($1,$2,$3,$4)`,
      [phone, codeHash, req.body.purpose, expiresAt]
    );

    if (env.OTP_DEV_BYPASS) {
      // eslint-disable-next-line no-console
      console.log(`🔑 DEV OTP for ${phone}: ${code} (also accepts 000000)`);
    } else {
      await sendSms(phone, `Your AgriGuard AI verification code is ${code}. It expires in ${env.OTP_EXPIRES_IN_MINUTES} minutes.`);
    }

    res.json({
      success: true,
      data: {
        phone,
        expiresInMinutes: env.OTP_EXPIRES_IN_MINUTES,
        ...(env.OTP_DEV_BYPASS ? { devCode: code } : {}),
      },
    });
  })
);

// ── POST /auth/otp/verify ────────────────────────────────────────────────
router.post(
  '/otp/verify',
  validate({
    body: Joi.object({
      phone: Joi.string().required(),
      code: Joi.string().length(env.OTP_LENGTH).required(),
      name: Joi.string().max(120).optional(), // optional profile bootstrap on first signup
    }),
  }),
  asyncHandler(async (req, res) => {
    const phone = otpUtil.normalizePhone(req.body.phone);
    const { code, name } = req.body;

    const { rows } = await query(
      `SELECT * FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    const record = rows[0];

    const devBypass = env.OTP_DEV_BYPASS && code === '000000';

    if (!devBypass) {
      if (!record) throw ApiError.badRequest('No pending verification code for this phone number.');
      if (new Date(record.expires_at) < new Date()) throw ApiError.badRequest('Code has expired. Please request a new one.');
      if (record.attempts >= record.max_attempts) throw ApiError.tooMany('Too many incorrect attempts. Please request a new code.');

      const valid = await otpUtil.compareCode(code, record.code_hash);
      if (!valid) {
        await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
        throw ApiError.badRequest('Incorrect code.');
      }
      await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [record.id]);
    }

    const result = await withTransaction(async (client) => {
      let { rows: userRows } = await client.query('SELECT * FROM users WHERE phone = $1', [phone]);
      let user = userRows[0];
      let isNewUser = false;

      if (!user) {
        isNewUser = true;
        const inserted = await client.query(
          `INSERT INTO users (phone, name, is_verified, last_login_at) VALUES ($1,$2,TRUE, now()) RETURNING *`,
          [phone, name || null]
        );
        user = inserted.rows[0];
        await client.query(
          `INSERT INTO user_credit (user_id, credit_limit, credit_used, credit_score_label, monthly_rate_pct, max_term_months, disbursement_hours)
           VALUES ($1, 0, 0, 'C', 4.0, 3, 48)`,
          [user.id]
        );
      } else {
        const updated = await client.query(
          `UPDATE users SET is_verified = TRUE, last_login_at = now() WHERE id = $1 RETURNING *`,
          [user.id]
        );
        user = updated.rows[0];
      }

      return { user, isNewUser };
    });

    const { user, isNewUser } = result;
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    const refreshExpiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_IN_DAYS * 86400 * 1000);

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, expires_at) VALUES ($1,$2,$3,$4)`,
      [user.id, hashToken(refreshToken), req.headers['user-agent'] || null, refreshExpiresAt]
    );

    res.json({
      success: true,
      data: {
        isNewUser,
        user: serializeUser(user),
        accessToken,
        refreshToken,
      },
    });
  })
);

// ── POST /auth/refresh ───────────────────────────────────────────────────
router.post(
  '/refresh',
  validate({ body: Joi.object({ refreshToken: Joi.string().required() }) }),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (err) {
      throw ApiError.unauthorized('Invalid or expired refresh token.');
    }

    const tokenHash = hashToken(refreshToken);
    const { rows } = await query(
      `SELECT * FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [payload.sub, tokenHash]
    );
    if (!rows.length) throw ApiError.unauthorized('Refresh token not recognized or already revoked.');

    const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    if (!userRows.length) throw ApiError.unauthorized('User no longer exists.');

    const user = userRows[0];
    const newAccessToken = signAccessToken(user);

    res.json({ success: true, data: { accessToken: newAccessToken } });
  })
);

// ── POST /auth/logout ────────────────────────────────────────────────────
router.post(
  '/logout',
  requireAuth,
  validate({ body: Joi.object({ refreshToken: Joi.string().optional() }) }),
  asyncHandler(async (req, res) => {
    if (req.body.refreshToken) {
      await query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND token_hash = $2`,
        [req.user.id, hashToken(req.body.refreshToken)]
      );
    } else {
      await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.user.id]);
    }
    res.json({ success: true, data: { message: 'Logged out.' } });
  })
);

// ── GET /auth/me ─────────────────────────────────────────────────────────
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json({ success: true, data: serializeUser(rows[0]) });
  })
);

function serializeUser(u) {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    avatarEmoji: u.avatar_emoji,
    state: u.state,
    lga: u.lga,
    farmSizeHectares: u.farm_size_hectares,
    primaryCrops: u.primary_crops,
    irrigationType: u.irrigation_type,
    seasonLabel: u.season_label,
    languagePref: u.language_pref,
    smsAlertsEnabled: u.sms_alerts_enabled,
    pushAlertsEnabled: u.push_alerts_enabled,
    isVerified: u.is_verified,
    createdAt: u.created_at,
  };
}

module.exports = router;

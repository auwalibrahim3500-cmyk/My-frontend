const { verifyAccessToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { query } = require('../config/database');

/** Requires a valid Bearer access token; attaches req.user = { id, phone }. */
const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Missing or malformed Authorization header.');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired access token.');
  }

  const { rows } = await query('SELECT id, phone, name, is_verified FROM users WHERE id = $1', [payload.sub]);
  if (!rows.length) {
    throw ApiError.unauthorized('User no longer exists.');
  }

  req.user = rows[0];
  next();
});

/** Optional auth: attaches req.user if a valid token is present, otherwise continues anonymously. */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const payload = verifyAccessToken(token);
      const { rows } = await query('SELECT id, phone, name FROM users WHERE id = $1', [payload.sub]);
      if (rows.length) req.user = rows[0];
    } catch (_) {
      /* ignore invalid token for optional auth */
    }
  }
  next();
});

module.exports = { requireAuth, optionalAuth };

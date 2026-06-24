const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

/** Generates a numeric OTP code of configured length, e.g. "483920". */
function generateCode() {
  const max = 10 ** env.OTP_LENGTH;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(env.OTP_LENGTH, '0');
}

async function hashCode(code) {
  return bcrypt.hash(code, 10);
}

async function compareCode(code, hash) {
  return bcrypt.compare(code, hash);
}

/** Basic E.164-ish normalizer for Nigerian numbers: accepts 080..., 234..., +234... */
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[\s-]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('234')) return `+${p}`;
  if (p.startsWith('0')) return `+234${p.slice(1)}`;
  return `+${p}`;
}

const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

function isValidPhone(phone) {
  return PHONE_REGEX.test(phone);
}

module.exports = { generateCode, hashCode, compareCode, normalizePhone, isValidPhone };

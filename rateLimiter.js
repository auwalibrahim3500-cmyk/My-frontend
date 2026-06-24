const rateLimit = require('express-rate-limit');
const env = require('../config/env');

/** General API limiter. */
const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests, please try again later.' } },
});

/** Tighter limiter specifically for OTP request endpoints to prevent SMS abuse. */
const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.phone || req.ip,
  message: { success: false, error: { message: 'Too many OTP requests. Please wait before trying again.' } },
});

module.exports = { apiLimiter, otpRequestLimiter };

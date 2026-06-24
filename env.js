require('dotenv').config();

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),

  DATABASE_URL: process.env.DATABASE_URL || null, // if set, takes priority
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_NAME: process.env.DB_NAME || 'agriguard',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
  DB_SSL: process.env.DB_SSL === 'true',

  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN_DAYS: parseInt(process.env.JWT_REFRESH_EXPIRES_IN_DAYS || '30', 10),

  OTP_EXPIRES_IN_MINUTES: parseInt(process.env.OTP_EXPIRES_IN_MINUTES || '10', 10),
  OTP_LENGTH: parseInt(process.env.OTP_LENGTH || '6', 10),
  OTP_DEV_BYPASS: process.env.OTP_DEV_BYPASS === 'true', // logs OTP instead of sending SMS, always accepts 000000

  SMS_PROVIDER: process.env.SMS_PROVIDER || 'console', // console | termii | twilio
  TERMII_API_KEY: process.env.TERMII_API_KEY || '',
  TERMII_SENDER_ID: process.env.TERMII_SENDER_ID || 'AgriGuard',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER || '',

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',

  WEATHER_API_KEY: process.env.WEATHER_API_KEY || '',
  WEATHER_PROVIDER_URL: process.env.WEATHER_PROVIDER_URL || 'https://api.open-meteo.com/v1/forecast',

  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads/scans',
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '8', 10),

  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  RATE_LIMIT_WINDOW_MIN: parseInt(process.env.RATE_LIMIT_WINDOW_MIN || '15', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
};

module.exports = env;

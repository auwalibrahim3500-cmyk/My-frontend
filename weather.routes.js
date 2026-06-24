const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

const STATE_COORDS = {
  Kano: { lat: 12.0022, lon: 8.5920 }, Lagos: { lat: 6.5244, lon: 3.3792 },
  Kaduna: { lat: 10.5105, lon: 7.4165 }, Ogun: { lat: 7.1608, lon: 3.3475 },
  Abuja: { lat: 9.0765, lon: 7.3986 },
};

// ── GET /weather?state=Kano&lga=... ─────────────────────────────────────
router.get(
  '/',
  optionalAuth,
  validate({ query: Joi.object({ state: Joi.string().max(60).optional(), lga: Joi.string().max(80).optional() }) }),
  asyncHandler(async (req, res) => {
    const state = req.query.state || req.user?.state || 'Kano';
    const lga = req.query.lga || req.user?.lga || null;

    const cached = await query(
      `SELECT * FROM weather_cache WHERE state = $1 AND (lga = $2 OR ($2 IS NULL AND lga IS NULL))
       AND expires_at > now() ORDER BY fetched_at DESC LIMIT 1`,
      [state, lga]
    );
    if (cached.rows.length) {
      return res.json({ success: true, data: serializeWeather(cached.rows[0]), cached: true });
    }

    const fresh = await fetchAndCacheWeather(state, lga);
    res.json({ success: true, data: serializeWeather(fresh), cached: false });
  })
);

// ── GET /weather/calendar?state=Kano&month=6 ─────────────────────────────
router.get(
  '/calendar',
  validate({
    query: Joi.object({
      state: Joi.string().max(60).default('Kano'),
      month: Joi.number().integer().min(1).max(12).default(() => new Date().getMonth() + 1),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM farming_calendar_tasks WHERE (state = $1 OR state IS NULL) AND month = $2 ORDER BY created_at`,
      [req.query.state, req.query.month]
    );
    res.json({
      success: true,
      data: rows.map((t) => ({ id: t.id, task: t.task, statusLabel: t.status_label, statusKind: t.status_kind })),
    });
  })
);

async function fetchAndCacheWeather(state, lga) {
  const coords = STATE_COORDS[state] || STATE_COORDS.Kano;
  let current, forecast, recommendation;

  try {
    if (env.WEATHER_API_KEY || env.WEATHER_PROVIDER_URL.includes('open-meteo')) {
      const url = `${env.WEATHER_PROVIDER_URL}?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,apparent_temperature&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=5`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Weather provider responded ${resp.status}`);
      const json = await resp.json();

      current = {
        temp: Math.round(json.current.temperature_2m),
        feelsLike: Math.round(json.current.apparent_temperature),
        condition: weatherCodeToLabel(json.current.weather_code ?? 0),
        humidity: json.current.relative_humidity_2m,
        rainfallMm: json.current.precipitation,
        windKmh: Math.round(json.current.wind_speed_10m),
        icon: weatherCodeToIcon(json.current.weather_code ?? 0),
      };

      const days = ['TODAY', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
      forecast = json.daily.time.slice(0, 5).map((d, i) => ({
        day: i === 0 ? 'TODAY' : new Date(d).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        icon: weatherCodeToIcon(json.daily.weather_code[i]),
        hi: Math.round(json.daily.temperature_2m_max[i]),
        lo: Math.round(json.daily.temperature_2m_min[i]),
        rainPct: json.daily.precipitation_probability_max[i],
      }));

      recommendation = buildRecommendation(forecast);
    } else {
      throw new Error('No weather provider configured');
    }
  } catch (err) {
    logger.warn('Weather provider unavailable, using fallback estimate:', err.message);
    current = { temp: 34, feelsLike: 37, condition: 'Partly Cloudy', humidity: 58, rainfallMm: 12, windKmh: 14, icon: '⛅' };
    forecast = [
      { day: 'TODAY', icon: '⛅', hi: 34, lo: 22, rainPct: 10 },
      { day: 'TUE', icon: '🌧️', hi: 29, lo: 21, rainPct: 75 },
      { day: 'WED', icon: '⛈️', hi: 27, lo: 20, rainPct: 90 },
      { day: 'THU', icon: '🌤️', hi: 32, lo: 22, rainPct: 20 },
      { day: 'FRI', icon: '☀️', hi: 36, lo: 24, rainPct: 5 },
    ];
    recommendation = buildRecommendation(forecast);
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1hr cache
  const { rows } = await query(
    `INSERT INTO weather_cache (state, lga, current, forecast, recommendation, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [state, lga, JSON.stringify(current), JSON.stringify(forecast), recommendation, expiresAt]
  );
  return rows[0];
}

function buildRecommendation(forecast) {
  const rainSoon = forecast.slice(0, 2).some((f) => f.rainPct >= 60);
  return rainSoon
    ? 'Avoid spraying pesticides today. Rain expected soon — ideal time for transplanting seedlings.'
    : 'Good conditions for spraying and field work. Monitor soil moisture for irrigation needs.';
}

function weatherCodeToIcon(code) {
  if (code === 0) return '☀️';
  if ([1, 2].includes(code)) return '🌤️';
  if (code === 3) return '⛅';
  if ([45, 48].includes(code)) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code >= 95) return '⛈️';
  return '⛅';
}
function weatherCodeToLabel(code) {
  if (code === 0) return 'Clear';
  if ([1, 2].includes(code)) return 'Mostly Clear';
  if (code === 3) return 'Partly Cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  if (code >= 51 && code <= 67) return 'Rainy';
  if (code >= 95) return 'Thunderstorms';
  return 'Partly Cloudy';
}

function serializeWeather(w) {
  return {
    state: w.state, lga: w.lga,
    current: w.current, forecast: w.forecast,
    recommendation: w.recommendation, fetchedAt: w.fetched_at,
  };
}

module.exports = router;

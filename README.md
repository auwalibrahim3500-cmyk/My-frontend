# AgriGuard AI — Backend API

Production-grade Node.js/Express/PostgreSQL backend for the AgriGuard AI frontend
(crop disease diagnosis, AI chat assistant, weather, crop library, alerts, the
Early Warning Network, Muryar AI voice assistant, and Market & Finance).

## Stack

- **Node.js + Express** — REST API
- **PostgreSQL** (`pg`) — relational data store
- **JWT** access/refresh tokens + **OTP phone authentication** (SMS-based, no passwords)
- **Anthropic Claude API** (`@anthropic-ai/sdk`) — crop image diagnosis (vision), chat assistant, voice assistant
- **Open-Meteo** — free weather data (no key required), with DB caching
- **Multer** — crop photo uploads
- Helmet, CORS, rate-limiting, Joi validation, structured error handling

## 1. Setup

```bash
cp .env.example .env      # fill in secrets (see below)
npm install
createdb agriguard        # or use your own Postgres instance
npm run db:setup          # runs schema migration + seeds reference data
npm run dev                # starts on http://localhost:4000
```

### Required `.env` values

| Variable | Notes |
|---|---|
| `DB_*` or `DATABASE_URL` | Postgres connection |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | any long random strings |
| `ANTHROPIC_API_KEY` | needed for `/scans`, `/chat`, `/voice` to work |
| `OTP_DEV_BYPASS=true` | for local dev — OTP is logged to console and `000000` always works, no real SMS sent |
| `SMS_PROVIDER` | `console` (dev), `termii` (popular in Nigeria) or `twilio` |

In production, set `OTP_DEV_BYPASS=false` and configure a real `SMS_PROVIDER`.

## 2. Authentication flow

Phone-based OTP, no passwords:

1. `POST /api/v1/auth/otp/request` `{ phone }` → SMS sent (or logged in dev)
2. `POST /api/v1/auth/otp/verify` `{ phone, code, name? }` → creates user on first verify, returns `{ accessToken, refreshToken, user }`
3. Send `Authorization: Bearer <accessToken>` on subsequent requests
4. `POST /api/v1/auth/refresh` `{ refreshToken }` → new access token when the old one expires
5. `POST /api/v1/auth/logout` → revokes the refresh token

## 3. API Reference (base path `/api/v1`)

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | – | Request an OTP code |
| POST | `/auth/otp/verify` | – | Verify code, get tokens |
| POST | `/auth/refresh` | – | Exchange refresh token for new access token |
| POST | `/auth/logout` | ✓ | Revoke refresh token(s) |
| GET | `/auth/me` | ✓ | Current user |

### Users / Profile / Farms (GPS mapping)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me/profile` | ✓ | Dashboard summary: stats + farms |
| PATCH | `/users/me` | ✓ | Update profile fields |
| GET | `/users/me/farms` | ✓ | List farms |
| POST | `/users/me/farms` | ✓ | Add a farm (with lat/lon, GeoJSON boundary) |
| PATCH | `/users/me/farms/:id` | ✓ | Update a farm |
| DELETE | `/users/me/farms/:id` | ✓ | Remove a farm |

### Scans (AI crop disease diagnosis)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/scans` | ✓ | `multipart/form-data` field `image`; runs Claude vision diagnosis, persists result |
| GET | `/scans` | ✓ | Scan history |
| GET | `/scans/:id` | ✓ | Scan detail incl. linked disease treatment/prevention |

### Chat (AI Farm Assistant)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/chat/conversations` | ✓ | List conversations |
| GET | `/chat/conversations/:id/messages` | ✓ | Message history |
| POST | `/chat/conversations/:id/messages` | ✓ | Send message (use `:id = new` to start). Body: `{ content, language }` |
| DELETE | `/chat/conversations/:id` | ✓ | Delete a conversation |

### Voice (Muryar AI)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/voice/query` | ✓ | `{ transcript, language: 'ha'|'en' }` → spoken-style AI reply |
| GET | `/voice/history` | ✓ | Past voice queries |

### Weather
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/weather?state=&lga=` | optional | Current + 5-day forecast + farming recommendation (cached 1hr) |
| GET | `/weather/calendar?state=&month=` | – | Farming calendar tasks |

### Crop Library
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/library/crops?search=&category=` | – | Browse/search crops |
| GET | `/library/crops/:slug` | – | Crop detail + its diseases |
| GET | `/library/diseases?search=&crop=` | – | Browse/search diseases |
| GET | `/library/diseases/:slug` | – | Disease detail |

### Alerts
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/alerts?state=` | optional | Regional alert feed |
| GET | `/alerts/subscriptions` | ✓ | Current subscriptions |
| PUT | `/alerts/subscriptions` | ✓ | Enable/disable SMS/push alerts |
| GET | `/alerts/notifications?unreadOnly=` | ✓ | In-app notification bell |
| PATCH | `/alerts/notifications/:id/read` | ✓ | Mark read |

### Early Warning Network
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/network/outbreaks?lat=&lon=&state=` | optional | Outbreak map data + nearest outbreak distance |
| GET | `/network/outbreaks/:id` | – | Outbreak detail + reports |
| GET | `/network/reports` | – | Community reports feed |
| POST | `/network/reports` | ✓ | Farmer reports disease/pest on their farm |

### Market & Finance
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/market/products?category=&dealerId=&forDisease=` | – | Shop listings |
| GET | `/market/prices?state=` | – | Live market price ticker |
| GET | `/market/dealers?lat=&lon=` | – | Nearby agro-dealers |
| POST | `/market/orders` | ✓ | Buy a product (decrements stock) |
| GET | `/market/orders` | ✓ | Order history |
| GET | `/market/credit` | ✓ | Credit limit/used/score |
| GET | `/market/loans/packages` | – | Available loan packages |
| POST | `/market/loans/apply` | ✓ | Apply for a loan (auto-approves within available credit) |
| GET | `/market/loans/applications` | ✓ | Loan application history |

All responses follow `{ success: boolean, data?: any, error?: { message, details? } }`.

## 4. Database

Full schema in `db/schema.sql` — 20+ tables covering users, farms, crops,
diseases, scans, chat, voice, weather cache, alerts, outbreaks, community
reports, market prices, dealers, products, orders, credit and loans.

`db/seed.js` populates crops/diseases/dealers/products/prices/outbreaks/alerts/loan
packages with data matching the frontend mockups (Maize Leaf Blight, Armyworm
outbreak near Zaria, Kano Agro Supply dealer, etc.) so the API returns
realistic results immediately after setup.

## 5. Connecting the frontend

Replace the frontend's direct `fetch('https://api.anthropic.com/v1/messages', ...)`
call in the AI Assistant page with a call to this backend instead:

```js
const res = await fetch(`${API_BASE_URL}/api/v1/chat/conversations/${conversationId}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ content: userMessage, language: currentLang }),
});
```

This keeps the Anthropic API key server-side instead of exposed in client JS,
and persists conversation history per user.

## 6. Notes & next steps

- Image uploads are stored on local disk under `uploads/scans/`; swap
  `src/middleware/upload.js` for an S3/Cloudinary adapter for real production deployment.
- Weather uses free Open-Meteo by default; set `WEATHER_API_KEY` and adjust
  `weather.routes.js` if you prefer a paid provider with more granular Nigerian data.
- Loan auto-approval logic is intentionally simple (`amount <= available credit
  && amount <= ₦100,000`); replace with real underwriting/BVN verification before production use.
- SMS defaults to console logging in dev; configure Termii (popular for Nigerian numbers) or Twilio for production.

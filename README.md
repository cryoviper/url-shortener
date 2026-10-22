# Snip · URL Shortener

A URL shortener with custom aliases, QR codes and click analytics. Backend in Node.js + Express with SQLite, plain HTML/CSS/JS frontend, and a full API test suite.

**Live:** _deploy on Render in 2 minutes, see below_

## Features

- Shorten any http(s) link, with an optional custom alias (`/my-link`)
- QR code for every link (SVG, generated on the server)
- Click analytics: total, last 7 days, 14-day chart, top referrers and device types
- Delete a link with a private **manage token** (shown once, only its SHA-256 hash is stored)
- "Your links" list saved in the browser
- Styled 404 page for unknown links

## API

| Method | Route | What it does |
|---|---|---|
| `POST` | `/api/links` | Create a link. Body: `{ "url": "...", "slug": "optional" }` |
| `GET` | `/:slug` | Redirects (302) and records a click |
| `GET` | `/api/links/:slug` | Stats for a link |
| `GET` | `/api/links/:slug/qr.svg` | QR code |
| `DELETE` | `/api/links/:slug` | Delete. Header: `Authorization: Bearer <token>` |
| `GET` | `/health` | Health check |

## Security

- Only `http`/`https` links allowed (blocks `javascript:`, `data:`, `file:`), and links to the shortener itself are rejected (no redirect loops)
- Prepared SQL statements everywhere (no SQL injection)
- `helmet` security headers, JSON body size limit, rate limit on link creation
- Manage tokens stored as hashes and compared with `crypto.timingSafeEqual`
- Random slugs use `crypto.randomBytes` with an alphabet that skips look-alike characters (`l`, `1`, `O`, `0`)

## Tech

Node.js, Express, better-sqlite3, helmet, express-rate-limit, qrcode. Tests use the built-in `node:test` runner with Supertest. GitHub Actions runs the tests on every push.

## Run locally

```bash
git clone https://github.com/cryoviper/url-shortener.git
cd url-shortener
npm install
npm test        # 11 API and unit tests
npm run dev     # http://localhost:3000
```

Or with Docker:

```bash
docker build -t snip .
docker run -p 3000:3000 -v snip-data:/app/data snip
```

## Deploy (free)

1. Go to [Render](https://render.com) → **New → Blueprint** and pick this repo (it reads `render.yaml`)
2. Done. Note: the free plan has no persistent disk, so links reset when the service redeploys. For permanent data, add a Render disk mounted at `/opt/render/project/src/data` or switch to PostgreSQL.

## What I learned

- Designing a small REST API and testing every route
- Thinking about abuse: rate limits, dangerous URL schemes, token handling
- SQL aggregation queries for analytics (`GROUP BY date(at)`)

---

Built by [Praveen Sinwar](https://github.com/cryoviper).

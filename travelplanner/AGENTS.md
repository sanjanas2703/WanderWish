# WanderWish — notes for coding agents (and humans)

Group trip planner: Express + MongoDB (Mongoose) on the server, Vue 3 (global build from a CDN, no bundler) in `public/`.

## Layout
- `server.js` — Express app: auth, REST routes, SSE live updates. Connects to MongoDB and listens only when run directly. Async route handlers are wrapped in `h()` so errors reach the error handler.
- `server/store.js` — the Mongoose models (collections keep the old table and field names; integer ids come from the `counters` collection) and the queries. `MONGODB_URI` picks the database (an in-memory MongoDB in tests). Coerce request values to strings/numbers before they reach a filter, so `{"$ne": …}` can't act as an operator.
- `server/services/` — third-party calls (Geoapify, Open-Meteo, Wikipedia) and itinerary generation. Server-only: API keys never reach the browser.
- `server/trips/operations.js` — **the only code that changes trip data.** Every operation validates input (`schemas.js`, zod), checks the caller's role, applies the change with an optimistic version check (`saveTripIfVersion`, re-read and retry on conflict), logs an activity row and broadcasts over SSE (`server/live.js`). Stops are addressed by uuid, never by array index.
- `server/trips/activity.js` — the per-trip activity feed.
- `server/config.js` — validates environment variables at startup (fails fast). `server/env.js` loads `.env` (skipped in tests).
- `server/security.js` — security headers/CSP, same-origin check for API writes, request logs with invite codes redacted.
- `server/ratelimit.js` — per-user/IP rate limiting middleware (IP comes from `req.ip`; only a loopback proxy is trusted).
- `scripts/share.js` (`npm run share`) — backup, start in production, open a Cloudflare quick tunnel. `scripts/backup.js` (`npm run backup`, `npm run restore -- <file>`: Extended JSON of every collection).
Code is split by where it runs: **`server.js` + `server/`** run only on the server, **`public/`** runs only in the browser, and **`shared/`** holds the few pure pieces both use. Put new code on the side that uses it; move it to `shared/` only once both do.
- `server/data.js`, `server/geo.js` — server-only data and helpers for itinerary generation and weather.
- `shared/` — data and helpers used by both sides (country coordinates and currencies, activity durations and costs, distance). No network. Imported by the server; served to the browser at `/shared/`.
- `public/` — the single-page app: `index.html` (templates), `app.js` (Vue app), `style.css`, `data.js` + `geo.js` (browser-only data and helpers: region pickers, flags, budget estimate, "Surprise me"), `services/globals.js` (exposes `shared/` and those two to `app.js` as globals), `services/api.js` (calls our `/api/geo/*` routes), `visual/icons.js`.
- `test/` — `node:test` suites. `test/helpers.js` starts an in-memory MongoDB (mongodb-memory-server) and the real app on a random port.
- `docs/` — `costs.md` (every external service and its free limits).

## Run and test
```
brew services start mongodb-community   # a local MongoDB (or set MONGODB_URI)
cp .env.example .env   # then fill in GEOAPIFY_API_KEY
npm install
npm start              # http://localhost:3000
npm test               # node:test, in-memory MongoDB
npm run lint           # ESLint
npm run share          # share via a free Cloudflare quick tunnel (needs cloudflared)
npm run backup         # export the database to backups/ (npm run restore -- <file> to load one back)
npm run dev            # NODE_ENV=development, restarts on file changes
```
CI (`.github/workflows/ci.yml` at the repo root) runs lint + tests on pushes that touch `travelplanner/`.

## Rules
- **Zero cost.** Never add a service that needs payment, a card, or a trial that converts to paid. Record every external service in `docs/costs.md` with its free limit and what the app does when it's hit.
- **All trip changes go through `server/trips/operations.js`.** Routes call it and never touch trip documents directly. Roles: owner > editor (itinerary edits) > viewer (comments and expenses only).
- **Tests run offline**: `NODE_ENV=test` skips `.env` and `server/services/http.js` returns null instead of calling the network.
- **Secrets** live only in environment variables. Never commit, log, or send them to the browser. Keep `.env.example` current (names only).
- Every change ships with tests; run `npm test` and `npm run lint` before committing.

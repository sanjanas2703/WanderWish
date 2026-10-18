# WanderWish

Plan trips with friends: a generated day-by-day itinerary on a live map, invites by link or one-time code,
comments, shared costs and live updates. Express + MongoDB (Mongoose) on the server, Vue 3 in the browser.
Everything runs at zero cost — see [docs/costs.md](docs/costs.md).

## Setup
```bash
brew tap mongodb/brew && brew install mongodb-community   # once (macOS). Others: https://www.mongodb.com/docs/manual/installation/
brew services start mongodb-community                     # MongoDB on mongodb://127.0.0.1:27017
cp .env.example .env     # add your free Geoapify key  https://myprojects.geoapify.com/
npm install
npm start                # http://localhost:3000
npm test && npm run lint # tests start their own throwaway MongoDB (downloaded once by mongodb-memory-server)
```
The app uses the `wanderwish` database on the local MongoDB unless `MONGODB_URI` says otherwise.

## Run and share
WanderWish runs on your own computer with a local MongoDB. To let friends use it, run:

```bash
brew install cloudflared   # once (macOS; free, no account). Other systems: see the link below.
npm run share
```

`npm run share` backs up the database, starts the app in production mode, waits for `/healthz`, then opens a
free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
and prints a `https://…trycloudflare.com` link. Press Ctrl+C to stop.

Know the limits (checked 2026-10-17):
- **The link changes every run.** Send the new one each time.
- **It only works while your computer is on and awake.** On macOS: `caffeinate -i npm run share`.
- **No uptime guarantee; 200 requests in flight at once** (more get "429 Too Many Requests"). Fine for a group of friends.
- **Quick tunnels don't support Server-Sent Events**, so live updates fall back to refreshing every ~10 seconds over the tunnel. On `localhost` they are instant.
- Anyone with the link can reach the sign-in page; trips themselves still need an account and an invite.

Behind the tunnel the app trusts `X-Forwarded-*` only from `localhost`, marks the session cookie `Secure`,
sends security headers, rejects cross-site writes, caps request bodies at 100 kB and rate-limits sign-up,
sign-in and invites.

### Backups and restore
- `npm run backup` writes every collection to one JSON file in `backups/` (the newest 14 are kept). `npm run share` does this automatically.
- **Restore:** stop the app, then (this replaces everything in the database)
  ```bash
  npm run restore -- backups/wanderwish-<timestamp>.json
  npm start
  ```
- Your data lives only on this computer. Copy `backups/` somewhere else (an external drive or a private cloud folder you already have) now and then.

### Health and shutdown
- `GET /healthz` → `{"ok":true}` when the app and database are up.
- Ctrl+C / SIGTERM shuts down gracefully (live connections closed, database closed cleanly).
- Startup fails fast with a clear message if configuration is invalid (e.g. no `GEOAPIFY_API_KEY` in production) or MongoDB can't be reached.

## Keep your keys safe
- The key is used **only by the server** now (the browser never sees it), so the usual "restrict to my website's domain"
  (HTTP referrer) setting would block it. If your home internet has a fixed IP address, restrict the key to that IP in
  the Geoapify dashboard; otherwise keep it unrestricted but secret, and rotate it if it ever leaks.
- Secrets go in `.env` only (it's git-ignored). `.env.example` lists the variable names.

## Project layout
See [AGENTS.md](AGENTS.md).

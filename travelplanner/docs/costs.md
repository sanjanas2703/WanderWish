# External services and costs

WanderWish must run at zero cost. Every external service is listed here with its free limits.
No service below needs a payment card. Terms were checked on 2026-10-17; re-check before relying on them.

| Service | Used for | Free limit | Card? | Sleeps / expires? | When the limit is hit |
|---|---|---|---|---|---|
| [Geoapify](https://www.geoapify.com/pricing/) (free plan, called from the server only) | Place search, routing between stops, geocoding pinned places | 3,000 credits/day, 5 requests/s. Commercial use allowed with attribution ("Powered by Geoapify"). | No | No | Limits are "soft": no charge. Geoapify emails you if you keep going over, and may block the key if you ignore it. The app shows straight-line legs and "couldn't find places" errors when calls fail. |
| [Open-Meteo](https://open-meteo.com/en/terms) | Weather forecast per day | Under 10,000 calls/day, 5,000/hour, 600/minute, 300,000/month. **Non-commercial only** (no ads or subscriptions). Data is CC BY 4.0. | No, and no key | No | They may block abusive IPs without notice. The trip still works; weather is simply not shown. |
| [Frankfurter](https://frankfurter.dev/) | Currency conversion for the budget estimate | No quotas; abuse rate limiting only. No key. | No | No | Budget falls back to "approx." figures. |
| [Wikipedia / Wikidata](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) | Place descriptions, English names, country cover photos | Free; must send a descriptive User-Agent and keep request rates modest. Photos need attribution (shown on the trip page). | No | No | Descriptions and photos fall back to plain text and colour covers. |
| [OpenFreeMap](https://openfreemap.org/) | Map tiles | No limits on views or requests; no key, no registration. Attribution required: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". | No | No | n/a (no limit). If the service is down, the map is blank but the itinerary still works. |
| [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) (`npm run share`) | Lets friends reach the app running on your computer | No account. 200 in-flight requests per tunnel; no SSE; no uptime guarantee; "for testing and development". | No | The URL changes every run and stops when you stop `npm run share` or your computer sleeps. | Extra requests get HTTP 429. Live updates already fall back to 10-second polling. |
| [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) (CI) | Lint + tests on push | Public repos: free. Private repos on GitHub Free: 2,000 minutes/month, 10 GB cache per repo. Each CI run uses ~1 minute. | No | Monthly allowance resets | With no payment method on file, Actions are **blocked** (not billed) until next month. |
| unpkg CDN, Google Fonts | Vue, Leaflet, MapLibre GL, fonts | Free public CDNs | No | No | The page would not load its scripts or fonts. |

## Removed
- **AI co-planner** (Ollama, a local model) was removed from the app, along with its Wikivoyage guide search.
- **MCP server and personal access tokens**, and **outbound webhooks** (with the optional self-hosted n8n guide), were removed: neither was used.
- **Google Gemini API free tier** (AI co-planner) was the first choice, but creating an API key failed with "permission denied" for this Google account — a common, unexplained Google-side block. Its free tier also may use prompts to improve Google's products. Replaced by Ollama; still usable by changing the `LLM_` settings if a key can be created.
- **Esri World Street Map tiles** were used briefly. Esri staff state the service needs an ArcGIS Online/Enterprise licence and is not for commercial use, so it is not genuinely free. Replaced by OpenFreeMap (vector tiles, labels switched to English in the browser).

## Tools that cost nothing and call no service
- **MongoDB Community Server** runs on your computer (the default `MONGODB_URI`). Free, no account.
- **npm packages** (Express, Mongoose, zod, ESLint, mongodb-memory-server) are open source and free.
  mongodb-memory-server downloads a MongoDB binary from MongoDB's site the first time tests run (and in CI), then reuses it from its cache.

## Hosted database (MongoDB Atlas)
This install points `MONGODB_URI` at a MongoDB Atlas cluster instead of a local MongoDB. The free-tier terms (card, storage
limit, pausing when idle) were not checked here; check them in Atlas before relying on it, and keep `npm run backup` copies.

import "./server/env.js";
import { config, assertConfig } from "./server/config.js";
import express from "express";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createUser, findUserByEmail, findUserByLogin, findUserById,
  isUsernameTaken, setUsername,
  createSession, getSession, deleteSession,
  getTrip, getUserTrips, getMembers, getUserRole, getTripOwner, isMember,
  getActiveInvite, listInvites, revokeInvite, redeemInvite,
  listComments, listExpenses, getCover, setCover,
  connect, close as closeDb, ping,
} from "./server/store.js";
import { getPlaces, geocodePlace, reverseGeocode, getLegRoute, TRAVEL_MODES } from "./server/services/geoapify.js";
import { limit } from "./server/ratelimit.js";
import { fetchJson } from "./server/services/http.js";
import {
  OpError, runOperation, getTripForUser, createTrip, regenerateTrip, deleteTrip as deleteTripOp,
  addTripComment, deleteTripComment, addTripExpense, deleteTripExpense,
  changeMemberRole, removeTripMember, createTripInvite, memberJoined
} from "./server/trips/operations.js";
import { listActivity } from "./server/trips/activity.js";
import { addClient, closeAll as closeLiveStreams } from "./server/live.js";
import { securityHeaders, sameOriginWrites, requestLog } from "./server/security.js";

assertConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable("x-powered-by");
// Only a proxy on this machine (the share tunnel) may set X-Forwarded-*: req.ip / req.secure come from it.
app.set("trust proxy", "loopback");
app.use(requestLog);
app.use(securityHeaders);
app.use(express.json({ limit: "100kb" }));
app.use("/api", sameOriginWrites);

// Express 4 doesn't catch rejected promises: pass them to the error handler at the bottom.
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Liveness/readiness check: no auth, no secrets.
app.get("/healthz", async (req, res) => {
  try { await ping(); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});
app.use(express.static(path.join(__dirname, "public")));
// Pure data/helpers shared with the server, loaded by the browser as ES modules.
app.use("/shared", express.static(path.join(__dirname, "shared")));

// Serve index.html for SPA routes
const indexHtml = readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
app.get(["/login", "/signup", "/plan", "/my-trips", "/trip/:id", "/join/:code"], (req, res) => {
  res.type("html").send(indexHtml);
});

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
function setSessionCookie(req, res, id) {
  res.cookie("session", id, { httpOnly: true, sameSite: "lax", secure: req.secure || config.isProd, maxAge: SESSION_MS, path: "/" });
}

async function getSessionUser(req) {
  const cookie = req.headers.cookie || "";
  // Match exactly "session=<value>" (not just "session" anywhere)
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return null;
  return getSession(match[1]);
}

async function requireAuth(req, res) {
  const user = await getSessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return null; }
  if (user.needs_username) { res.status(403).json({ error: "Username required", needsUsername: true }); return null; }
  return user;
}

// ── Auth ──
const strings = (...vs) => vs.every(v => typeof v === "string" && v);

app.post("/api/auth/register", limit("register", 10, 60 * 60_000), h(async (req, res) => {
  const { username, email, password, name } = req.body || {};
  if (!strings(username, email, password, name)) return res.status(400).json({ error: "Username, email, password and name required" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username must be 3-20 characters: letters, numbers, underscores only" });
  if (await findUserByEmail(email)) return res.status(409).json({ error: "Email already registered" });
  if (await isUsernameTaken(username)) return res.status(409).json({ error: "Username already taken" });

  const hash = await bcrypt.hash(password, 10);
  const userId = await createUser(username, email, name, hash);
  const sessionId = await createSession(userId);
  setSessionCookie(req, res, sessionId);
  res.json({ user: { id: userId, username, email, name } });
}));

app.post("/api/auth/login", limit("login", 10, 15 * 60_000), h(async (req, res) => {
  const { login, password } = req.body || {};
  if (!strings(login, password)) return res.status(400).json({ error: "Username/email and password required" });

  const user = await findUserByLogin(login);
  if (!user) return res.status(401).json({ error: "Invalid username/email or password" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid username/email or password" });

  const sessionId = await createSession(user.id);
  setSessionCookie(req, res, sessionId);
  res.json({ user: { id: user.id, username: user.username, email: user.email, name: user.name, needsUsername: user.needs_username } });
}));

app.post("/api/auth/logout", h(async (req, res) => {
  const sessionCookie = (req.headers.cookie || "").match(/session=([^;]+)/);
  if (sessionCookie) await deleteSession(sessionCookie[1]);
  res.clearCookie("session", { path: "/" });
  res.json({ ok: true });
}));

app.get("/api/auth/me", h(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.json({ user: null });
  res.json({ user: { id: user.user_id, username: user.username, email: user.email, name: user.name, needsUsername: user.needs_username } });
}));

// ── Username ──
app.post("/api/auth/set-username", limit("set-username", 20, 60 * 60_000), h(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { username } = req.body || {};
  if (typeof username !== "string" || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username must be 3-20 characters: letters, numbers, underscores only" });
  if (await isUsernameTaken(username)) return res.status(409).json({ error: "Username already taken" });
  await setUsername(user.user_id, username);
  res.json({ ok: true, username });
}));

app.get("/api/auth/check-username", limit("check-username", 60, 60_000), h(async (req, res) => {
  const u = String(req.query.username || "");
  if (u.length < 2) return res.json({ available: false });
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return res.json({ available: false, error: "Letters, numbers and underscores only" });
  res.json({ available: !await isUsernameTaken(u) });
}));

// ── Maps & places (server-side so the Geoapify key stays secret) ──
const authed = h(async (req, res, next) => { const u = await requireAuth(req, res); if (u) { req.user = u; next(); } });
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const latLon = s => { const [a, b] = String(s || "").split(",").map(Number); return num(a, -90, 90) !== null && num(b, -180, 180) !== null ? { lat: a, lon: b } : null; };
const geoLimit = limit("geo", 300, 60_000);

app.get("/api/geo/places", authed, geoLimit, h(async (req, res) => {
  const lat = num(req.query.lat, -90, 90), lon = num(req.query.lon, -180, 180);
  const cats = String(req.query.categories || "");
  if (lat === null || lon === null || !/^[a-z_.,]{1,300}$/.test(cats)) return res.status(400).json({ error: "Invalid search" });
  res.json({ places: await getPlaces(lat, lon, cats.split(","), Math.min(60, parseInt(req.query.limit) || 20)) });
}));

app.get("/api/geo/route", authed, geoLimit, h(async (req, res) => {
  const from = latLon(req.query.from), to = latLon(req.query.to), mode = String(req.query.mode || "");
  if (!from || !to || !TRAVEL_MODES.includes(mode)) return res.status(400).json({ error: "Invalid route" });
  res.json({ route: await getLegRoute(from, to, mode) });
}));

app.get("/api/geo/geocode", authed, geoLimit, h(async (req, res) => {
  const text = String(req.query.text || "").trim().slice(0, 120);
  if (!text) return res.status(400).json({ error: "Text required" });
  res.json({ place: await geocodePlace(text, String(req.query.country || "").slice(0, 60), latLon(req.query.near)) });
}));

app.get("/api/geo/reverse", authed, geoLimit, h(async (req, res) => {
  const lat = num(req.query.lat, -90, 90), lon = num(req.query.lon, -180, 180);
  if (lat === null || lon === null) return res.status(400).json({ error: "Invalid point" });
  res.json({ address: await reverseGeocode(lat, lon) });
}));

// ── Trips: every change goes through server/trips/operations.js ──
// The acting user as the operations layer sees it.
const actor = u => ({ id: u.user_id, name: u.username || u.name });
// Wrap a route: require sign-in, run the handler, and turn OpErrors into JSON responses.
const op = fn => async (req, res) => {
  try {
    const u = await requireAuth(req, res);
    if (!u) return;
    req.user = u;
    res.json(await fn(actor(u), req));
  }
  catch (e) {
    if (e instanceof OpError) return res.status(e.status).json({ error: e.message });
    console.error("route error:", e.message);
    res.status(500).json({ error: "Something went wrong" });
  }
};

app.get("/api/trips", h(async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  res.json({ trips: (await getUserTrips(user.user_id)).map(({ result, public_token, public_view, ...t }) => t) });
}));

app.post("/api/trips", limit("generate", 10, 60 * 60_000), op((u, req) => createTrip(u, req.body)));
app.get("/api/trips/:id", op((u, req) => getTripForUser(u, req.params.id)));
app.delete("/api/trips/:id", op((u, req) => deleteTripOp(u, req.params.id)));
// One endpoint for all itinerary edits: { op: "add_stop" | "move_stop" | ..., args: {...} }
app.post("/api/trips/:id/ops", limit("ops", 120, 60_000), op((u, req) => runOperation(u, req.params.id, req.body?.op, req.body?.args)));
app.post("/api/trips/:id/regenerate", limit("generate", 10, 60 * 60_000), op((u, req) => regenerateTrip(u, req.params.id)));
app.get("/api/trips/:id/activity", op(async (u, req) => { await getTripForUser(u, req.params.id); return { activity: await listActivity(req.params.id) }; }));

// ── Members ──
app.get("/api/trips/:id/members", op(async (u, req) => {
  await getTripForUser(u, req.params.id);
  return { members: (await getMembers(req.params.id)).map(m => ({ id: m.id, username: m.username, name: m.name, role: m.role })) };
}));
app.put("/api/trips/:id/members/:userId", op((u, req) => changeMemberRole(u, req.params.id, req.params.userId, req.body?.role)));
app.delete("/api/trips/:id/members/:userId", op((u, req) => removeTripMember(u, req.params.id, req.params.userId)));

// ── Invites (link or one-time code) ──
app.get("/api/trips/:id/invites", h(async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (await getUserRole(req.params.id, user.user_id) !== "owner") return res.status(403).json({ error: "Only owner can manage invites" });
  res.json({ invites: await listInvites(req.params.id) });
}));

app.post("/api/trips/:id/invites", limit("invites", 30, 60 * 60_000), op((u, req) => createTripInvite(u, req.params.id, req.body || {})));

app.delete("/api/trips/:id/invites/:code", h(async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (await getUserRole(req.params.id, user.user_id) !== "owner") return res.status(403).json({ error: "Only owner can manage invites" });
  await revokeInvite(req.params.id, req.params.code);
  res.json({ ok: true });
}));

function normalizeCode(c) { return String(c || "").trim().replace(/[\s-]/g, ""); }
function inviteKey(c) { return /^[a-zA-Z0-9]{6}$/.test(c) ? c.toUpperCase() : c; }

// Preview so the invitee can see what they're joining before accepting.
const inviteLimit = limit("invite-redeem", 20, 10 * 60_000);
app.get("/api/invites/:code", inviteLimit, h(async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const inv = await getActiveInvite(inviteKey(normalizeCode(req.params.code)));
  const trip = inv && await getTrip(inv.trip_id);
  if (!trip) return res.status(404).json({ error: "This invite is invalid or has expired." });
  const owner = await findUserById(await getTripOwner(inv.trip_id));
  res.json({ trip: { id: trip.id, title: trip.title, country: trip.country, days: trip.days },
    role: inv.role, kind: inv.kind, owner: owner ? (owner.username || owner.name) : "",
    alreadyMember: await isMember(inv.trip_id, user.user_id) });
}));

app.post("/api/invites/:code/join", inviteLimit, h(async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const result = await redeemInvite(inviteKey(normalizeCode(req.params.code)), user.user_id);
  if (result.error) return res.status(404).json({ error: result.error });
  if (!result.already) await memberJoined(actor(user), result.tripId);
  res.json({ tripId: result.tripId });
}));

// ── Comments (every member, viewers too, adds their own) and shared expenses ──
const membersOnly = (u, req) => getTripForUser(u, req.params.id);
app.get("/api/trips/:id/comments", op(async (u, req) => { await membersOnly(u, req); return { comments: await listComments(req.params.id) }; }));
app.post("/api/trips/:id/comments", limit("comments", 60, 60_000), op((u, req) => addTripComment(u, req.params.id, req.body)));
app.delete("/api/trips/:id/comments/:cid", op((u, req) => deleteTripComment(u, req.params.id, req.params.cid)));
app.get("/api/trips/:id/expenses", op(async (u, req) => { await membersOnly(u, req); return { expenses: await listExpenses(req.params.id) }; }));
app.post("/api/trips/:id/expenses", limit("expenses", 60, 60_000), op((u, req) => addTripExpense(u, req.params.id, req.body)));
app.delete("/api/trips/:id/expenses/:eid", op((u, req) => deleteTripExpense(u, req.params.id, req.params.eid)));

// ── Country cover photos: an iconic landmark's Wikipedia image, looked up once and cached ──
const COVER_LANDMARKS = {
  Thailand: "Wat Arun", Vietnam: "Ha Long Bay", Indonesia: "Borobudur", Philippines: "Chocolate Hills", Malaysia: "Petronas Towers",
  Singapore: "Marina Bay Sands", Cambodia: "Angkor Wat", Laos: "Kuang Si Falls", Japan: "Mount Fuji", "South Korea": "Gyeongbokgung",
  China: "Great Wall of China", Taiwan: "Taipei 101", India: "Taj Mahal", "Sri Lanka": "Sigiriya", Nepal: "Annapurna Massif", Maldives: "Malé",
  Italy: "Colosseum", France: "Eiffel Tower", Spain: "Sagrada Família", Greece: "Santorini", Portugal: "Belém Tower", "United Kingdom": "Tower Bridge",
  Switzerland: "Matterhorn", Netherlands: "Kinderdijk", USA: "Statue of Liberty", Canada: "Moraine Lake", Mexico: "Chichen Itza",
  "Costa Rica": "Arenal Volcano", Brazil: "Christ the Redeemer (statue)", Peru: "Machu Picchu", Colombia: "Cartagena, Colombia",
  Argentina: "Perito Moreno Glacier", UAE: "Burj Khalifa", Turkey: "Hagia Sophia", Jordan: "Petra", Israel: "Old City of Jerusalem",
  "South Africa": "Table Mountain", Kenya: "Maasai Mara", Morocco: "Chefchaouen", Egypt: "Giza pyramid complex", Tanzania: "Mount Kilimanjaro",
  Australia: "Sydney Opera House", "New Zealand": "Milford Sound", Fiji: "Mamanuca Islands"
};
const coverFailures = new Map();
app.get("/api/covers/:country", h(async (req, res) => {
  const country = req.params.country;
  const landmark = COVER_LANDMARKS[country];
  if (!landmark) return res.status(404).json({ error: "Unknown country" });
  const hit = await getCover(country);
  if (hit) return res.json({ url: hit.url, pageUrl: hit.page_url, landmark });
  if (Date.now() - (coverFailures.get(country) || 0) < 10 * 60 * 1000) return res.status(404).json({ error: "No photo" });
  try {
    const d = await fetchJson("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(landmark.replace(/ /g, "_")));
    const thumb = d?.thumbnail?.source;
    if (!thumb) throw new Error("no image");
    const url = thumb.replace(/\/\d+px-/, "/960px-"); // larger rendition of the same image
    await setCover(country, url, d.content_urls?.desktop?.page);
    res.json({ url, pageUrl: d.content_urls?.desktop?.page, landmark });
  } catch {
    coverFailures.set(country, Date.now());
    res.status(404).json({ error: "No photo" });
  }
}));

// ── Live updates (SSE): members only ──
app.get("/api/trips/:id/sse", h(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  if (!await getUserRole(req.params.id, user.user_id)) return res.status(403).json({ error: "Access denied" });
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("data: {}\n\n");
  const remove = addClient(req.params.id, user.user_id, res);
  req.on("close", remove);
}));

// Malformed or oversized JSON bodies → clean JSON errors (never a stack trace).
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request too large" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
  console.error("unhandled:", err?.message);
  res.status(500).json({ error: "Something went wrong" });
});

// Only listen when run directly (tests import the app without starting a server).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await connect(config.mongodbUri); }
  catch (e) {
    // The URI may hold a password, so it is never printed.
    console.error(`[db] Can't reach MongoDB (${e.message}). Start MongoDB or check MONGODB_URI in .env.`);
    process.exit(1);
  }
  const server = app.listen(config.port, () => console.log(`WanderWish → http://localhost:${config.port} (${config.env})`));
  // Graceful shutdown: stop accepting, end live streams, let requests finish, close the database.
  let stopping = false;
  const shutdown = sig => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig} received, shutting down…`);
    closeLiveStreams();
    server.close(() => { closeDb().catch(() => {}).finally(() => process.exit(0)); });
    setTimeout(() => { console.error("Forced exit after 10s"); process.exit(1); }, 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

export { app };
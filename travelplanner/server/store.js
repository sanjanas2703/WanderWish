import mongoose from "mongoose";
import crypto from "crypto";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

// MONGODB_URI picks the server and database; tests point it at an in-memory MongoDB.
export const DEFAULT_URI = "mongodb://127.0.0.1:27017/wanderwish";

// Rows keep the snake_case field names (and numeric ids) the API has always returned.
// Collections that had integer ids keep them, handed out by the `counters` collection.
const opts = { versionKey: false };
const now = () => new Date();
const ts = { type: Date, default: now };
const model = (name, collection, fields, indexes = []) => {
  const s = new Schema(fields, opts);
  for (const [spec, o] of indexes) s.index(spec, o);
  return mongoose.model(name, s, collection);
};

const Counter = model("Counter", "counters", { _id: String, seq: Number });
const User = model("User", "users", {
  _id: Number,
  username: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  password: { type: String, required: true }, // a bcrypt hash, never the password itself
  needs_username: { type: Number, default: 0 },
  created_at: ts
});
const Session = model("Session", "sessions", {
  _id: String,
  user_id: { type: Number, required: true },
  created_at: ts,
  expires_at: { type: Date, expires: 0 } // MongoDB's TTL monitor removes expired sessions
});
const Trip = model("Trip", "trips", {
  _id: String,
  owner_id: { type: Number, required: true },
  title: { type: String, default: "" },
  country: { type: String, required: true },
  days: { type: Number, default: 5 },
  budget: { type: String, default: "midrange" },
  pace: { type: String, default: "balanced" },
  types: { type: [String], default: ["cultural"] },
  result: { type: Mixed, default: null },
  version: { type: Number, default: 1 },
  last_edited_by: Number,
  last_edited_by_name: String,
  start_date: { type: String, default: null },
  created_at: ts,
  updated_at: ts
});
const TripMember = model("TripMember", "trip_members", {
  trip_id: { type: String, required: true },
  user_id: { type: Number, required: true },
  role: { type: String, enum: ["owner", "editor", "viewer"], required: true },
  invited_by: Number
}, [[{ trip_id: 1, user_id: 1 }, { unique: true }], [{ user_id: 1 }]]);
const TripInvite = model("TripInvite", "trip_invites", {
  _id: String, // the code
  trip_id: { type: String, required: true, index: true },
  kind: { type: String, enum: ["link", "code"], required: true },
  role: { type: String, enum: ["editor", "viewer"], required: true },
  created_by: { type: Number, required: true },
  created_at: ts,
  expires_at: { type: Date, default: null },
  used_at: { type: Date, default: null }
});
const TripComment = model("TripComment", "trip_comments", {
  _id: Number,
  trip_id: { type: String, required: true, index: true },
  act_key: { type: String, required: true },
  user_id: { type: Number, required: true },
  text: { type: String, required: true },
  created_at: ts
});
const TripExpense = model("TripExpense", "trip_expenses", {
  _id: Number,
  trip_id: { type: String, required: true, index: true },
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  paid_by: { type: Number, required: true },
  split_among: { type: [Number], default: [] },
  created_by: { type: Number, required: true },
  created_at: ts
});
const TripActivity = model("TripActivity", "trip_activity", {
  _id: Number,
  trip_id: { type: String, required: true },
  user_id: { type: Number, default: null },
  type: { type: String, required: true },
  summary: { type: String, required: true },
  data: { type: Mixed, default: null },
  created_at: ts
}, [[{ trip_id: 1, _id: -1 }]]);
const CountryCover = model("CountryCover", "country_covers", {
  _id: String, // the country
  url: { type: String, required: true },
  page_url: { type: String, default: null },
  fetched_at: ts
});

export const models = { Counter, User, Session, Trip, TripMember, TripInvite, TripComment, TripExpense, TripActivity, CountryCover };

export async function connect(uri = process.env.MONGODB_URI || DEFAULT_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await Promise.all(Object.values(models).map(m => m.init())); // build indexes (unique constraints) before use
}
export const ping = () => mongoose.connection.db.admin().ping();
export function close() { return mongoose.disconnect(); }

// ── Helpers ──
// Request values are coerced before they reach a filter, so an object like {"$ne": null} can never act as an operator.
const str = v => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const int = v => { const n = Number(v); return Number.isSafeInteger(n) ? n : null; };
// MongoDB keys the document by _id; callers get `id`, as the API always has. `key` renames it (e.g. invites → code).
export function row(doc, key = "id") {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { [key]: _id, ...rest };
}
export async function nextId(name) {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }).lean();
  return c.seq;
}
export const isDuplicate = e => e?.code === 11000;
const days = n => new Date(Date.now() + n * 86400_000);
// Adds username and name from users to each row (rows whose user is gone keep null, like a LEFT JOIN).
async function withUsers(rows, key = "user_id") {
  const users = await User.find({ _id: { $in: [...new Set(rows.map(r => r[key]))] } }, { username: 1, name: 1 }).lean();
  const byId = new Map(users.map(u => [u._id, u]));
  return rows.map(r => ({ ...r, username: byId.get(r[key])?.username ?? null, name: byId.get(r[key])?.name ?? null }));
}

// ── Users and sessions ──
export async function createUser(username, email, name, passwordHash) {
  const id = await nextId("users");
  await User.create({ _id: id, username, email, name, password: passwordHash });
  return id;
}

export async function findUserByEmail(email) {
  return row(await User.findOne({ email: str(email) }).lean());
}

export async function findUserByLogin(login) {
  const l = str(login);
  return row(await User.findOne({ $or: [{ email: l }, { username: l }] }).lean());
}

export async function findUserById(id) {
  return row(await User.findById(int(id)).lean());
}

export async function isUsernameTaken(username) {
  return !!(await User.exists({ username: str(username) }));
}

export async function setUsername(userId, username) {
  await User.updateOne({ _id: userId }, { username, needs_username: 0 });
}

export async function createSession(userId) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  await Session.create({ _id: sessionId, user_id: userId, expires_at: days(30) });
  return sessionId;
}

// The session plus its user's fields, or null when it's missing or expired.
export async function getSession(sessionId) {
  const id = str(sessionId);
  if (!id) return null;
  const s = await Session.findOne({ _id: id, expires_at: { $gt: now() } }).lean();
  const u = s && await User.findById(s.user_id).lean();
  if (!u) return null;
  return { ...row(s), username: u.username, email: u.email, name: u.name, needs_username: u.needs_username };
}

export async function deleteSession(sessionId) {
  await Session.deleteOne({ _id: str(sessionId) });
}

// ── Trips ──
export async function getTrip(id) {
  return row(await Trip.findById(str(id)).lean());
}

// Saves a new itinerary only if the trip is still at `version` (optimistic concurrency). Returns true when saved.
export async function saveTripIfVersion(id, version, fields) {
  const r = await Trip.updateOne({ _id: id, version }, { $set: { ...fields, updated_at: now() }, $inc: { version: 1 } });
  return r.matchedCount > 0;
}

export async function insertTrip(fields) {
  await Trip.create(fields);
}

export async function getUserTrips(userId) {
  const memberships = await TripMember.find({ user_id: userId }).lean();
  const roles = new Map(memberships.map(m => [m.trip_id, m.role]));
  const trips = await Trip.find({ _id: { $in: [...roles.keys()] } }).sort({ updated_at: -1 }).lean();
  return trips.map(t => ({ ...row(t), role: roles.get(t._id) }));
}

// Removes the trip and everything that belongs to it.
export async function deleteTripCascade(tripId) {
  await Promise.all([TripMember, TripInvite, TripComment, TripExpense, TripActivity].map(m => m.deleteMany({ trip_id: tripId })));
  await Trip.deleteOne({ _id: tripId });
}

// ── Members ──
export async function getMembers(tripId) {
  const ms = await TripMember.find({ trip_id: str(tripId) }).sort({ _id: 1 }).lean();
  const users = new Map((await User.find({ _id: { $in: ms.map(m => m.user_id) } }).lean()).map(u => [u._id, u]));
  return ms.filter(m => users.has(m.user_id)).map(m => {
    const u = users.get(m.user_id);
    return { id: u._id, username: u.username, email: u.email, name: u.name, role: m.role };
  });
}

// Adds the member unless they're already on the trip.
export async function addMember(tripId, userId, role, invitedBy) {
  try {
    await TripMember.updateOne({ trip_id: tripId, user_id: userId }, { $setOnInsert: { role, invited_by: invitedBy ?? null } }, { upsert: true });
  } catch (e) { if (!isDuplicate(e)) throw e; } // two concurrent upserts: the other one won
}

export async function isMember(tripId, userId) {
  return !!(await TripMember.exists({ trip_id: str(tripId), user_id: int(userId) }));
}

export async function removeMember(tripId, userId) {
  await TripMember.deleteOne({ trip_id: tripId, user_id: int(userId), role: { $ne: "owner" } });
}

export async function updateMemberRole(tripId, userId, role) {
  if (role !== "editor" && role !== "viewer") return false;
  const r = await TripMember.updateOne({ trip_id: tripId, user_id: int(userId), role: { $ne: "owner" } }, { role });
  return r.matchedCount > 0;
}

export async function getUserRole(tripId, userId) {
  const m = await TripMember.findOne({ trip_id: str(tripId), user_id: int(userId) }, { role: 1 }).lean();
  return m ? m.role : null;
}

export async function getTripOwner(tripId) {
  const m = await TripMember.findOne({ trip_id: str(tripId), role: "owner" }, { user_id: 1 }).lean();
  return m ? m.user_id : null;
}

// ── Invites ──
// "link" invites are reusable until revoked; "code" invites are one-time and expire after 24h.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
const activeInvite = () => ({ used_at: null, $or: [{ expires_at: null }, { expires_at: { $gt: now() } }] });

export async function createInvite(tripId, kind, role, createdBy) {
  const code = kind === "code" ? randomCode(6) : crypto.randomBytes(16).toString("hex");
  await TripInvite.create({ _id: code, trip_id: tripId, kind, role, created_by: createdBy, expires_at: kind === "code" ? days(1) : null });
  return code;
}

export async function getActiveInvite(code) {
  return row(await TripInvite.findOne({ _id: str(code), ...activeInvite() }).lean(), "code");
}

export async function listInvites(tripId) {
  const rows = await TripInvite.find({ trip_id: str(tripId), ...activeInvite() }, { kind: 1, role: 1, created_at: 1, expires_at: 1 })
    .sort({ created_at: -1 }).lean();
  return rows.map(r => row(r, "code"));
}

export async function revokeInvite(tripId, code) {
  await TripInvite.deleteOne({ trip_id: str(tripId), _id: str(code) });
}

// Adds the user to the trip; one-time codes are consumed atomically so they can't be redeemed twice.
export async function redeemInvite(code, userId) {
  const invalid = { error: "This invite is invalid or has expired." };
  const inv = await getActiveInvite(code);
  if (!inv) return invalid;
  if (await isMember(inv.trip_id, userId)) return { tripId: inv.trip_id, already: true };
  if (inv.kind === "code") {
    const r = await TripInvite.updateOne({ _id: inv.code, ...activeInvite() }, { used_at: now() });
    if (!r.modifiedCount) return invalid; // someone else redeemed it first
  }
  await addMember(inv.trip_id, userId, inv.role, inv.created_by);
  return { tripId: inv.trip_id };
}

// ── Comments (one row per user comment on an activity) ──
export async function listComments(tripId) {
  const rows = await TripComment.find({ trip_id: str(tripId) }).sort({ _id: 1 }).lean();
  return withUsers(rows.map(r => row(r)));
}
export async function addComment(tripId, actKey, userId, text) {
  const id = await nextId("trip_comments");
  await TripComment.create({ _id: id, trip_id: tripId, act_key: actKey, user_id: userId, text });
  return id;
}
export async function getComment(id) { return row(await TripComment.findById(int(id)).lean()); }
export async function deleteComment(id) { await TripComment.deleteOne({ _id: id }); }

// ── Shared expenses ──
export async function listExpenses(tripId) {
  return (await TripExpense.find({ trip_id: str(tripId) }).sort({ _id: -1 }).lean()).map(r => row(r));
}
export async function addExpense(tripId, e, createdBy) {
  const id = await nextId("trip_expenses");
  await TripExpense.create({ _id: id, trip_id: tripId, description: e.description, amount: e.amount, currency: e.currency,
    paid_by: e.paidBy, split_among: e.splitAmong, created_by: createdBy });
  return id;
}
export async function getExpense(id) { return row(await TripExpense.findById(int(id)).lean()); }
export async function deleteExpense(id) { await TripExpense.deleteOne({ _id: id }); }

// ── Activity feed ──
export async function insertActivity(tripId, userId, type, summary, data) {
  await TripActivity.create({ _id: await nextId("trip_activity"), trip_id: tripId, user_id: userId ?? null, type, summary, data: data ?? null });
}
export async function listActivityRows(tripId, limit) {
  const rows = await TripActivity.find({ trip_id: str(tripId) }, { type: 1, summary: 1, created_at: 1, user_id: 1 }).sort({ _id: -1 }).limit(limit).lean();
  return withUsers(rows.map(r => row(r)));
}

// ── Country cover photos (cached lookups) ──
export async function getCover(country) {
  const c = await CountryCover.findById(str(country)).lean();
  return c && { url: c.url, page_url: c.page_url };
}
export async function setCover(country, url, pageUrl) {
  await CountryCover.updateOne({ _id: country }, { url, page_url: pageUrl || null, fetched_at: now() }, { upsert: true });
}

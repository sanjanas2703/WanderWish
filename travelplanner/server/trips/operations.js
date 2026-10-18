// The one place trip data changes. Every website route that edits a trip goes through here.
// Each operation: validate input → check the caller's role → apply the change with an optimistic version
// check (version bump, retried on conflict) and log an activity row → broadcast over SSE.
import crypto from "node:crypto";
import {
  getTrip, getUserRole, getMembers, isMember, removeMember as storeRemoveMember, updateMemberRole,
  addComment, getComment, deleteComment, addExpense, getExpense, deleteExpense, createInvite as storeCreateInvite,
  saveTripIfVersion, insertTrip, addMember, deleteTripCascade
} from "../store.js";
import { ops as opSchemas, tripPrefs, commentInput, expenseInput, SLOTS } from "./schemas.js";
import { logActivity } from "./activity.js";
import { broadcast } from "../live.js";
import { generateItinerary } from "../services/generate.js";
import { getWeather } from "../services/weather.js";
import { COUNTRY_COORDS } from "../../shared/data.js";
import { getTripDates } from "../geo.js";

export class OpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const EDIT = ["owner", "editor"];
const ANY_MEMBER = ["owner", "editor", "viewer"];

function validate(schema, args) {
  const r = schema.safeParse(args ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    throw new OpError(400, `Invalid input${i.path.length ? " (" + i.path.join(".") + ")" : ""}: ${i.message}`);
  }
  return r.data;
}

// user = { id, name } of the signed-in caller. Returns the caller's role or throws.
async function requireRole(user, tripId, allowed) {
  if (!user?.id) throw new OpError(401, "Not signed in");
  if (!await getTrip(tripId)) throw new OpError(404, "Trip not found");
  const role = await getUserRole(tripId, user.id);
  if (!role) throw new OpError(403, "You are not a member of this trip");
  if (!allowed.includes(role)) throw new OpError(403, role === "viewer" ? "Viewers can't change this trip" : "Only the trip owner can do that");
  return role;
}

function parseTrip(row) {
  const t = { ...row, types: row.types?.length ? row.types : ["cultural"], result: row.result ?? null };
  delete t.public_token; delete t.public_view; // left on some trips by the removed public-sharing feature
  return t;
}

// Strip browser-only fields and make sure every stop has a uuid.
const STOP_FIELDS = ["uid", "title", "name", "localName", "desc", "loc", "dur", "cost", "lat", "lon", "categories", "placeId", "travelMode", "custom", "note", "noteBy", "isIndoor", "source", "descUrl"];
function cleanStop(a) {
  const s = {};
  for (const k of STOP_FIELDS) if (a[k] !== undefined && a[k] !== null && a[k] !== "") s[k] = a[k];
  if (!s.uid) s.uid = crypto.randomUUID();
  if (!s.name) s.name = s.title;
  return s;
}
function cleanResult(result) {
  for (const d of result?.plans || []) {
    delete d.open; delete d.weatherIconSvg;
    d.slots = d.slots || {};
    for (const slot of SLOTS) d.slots[slot] = (d.slots[slot] || []).map(cleanStop);
  }
  return result;
}

function findStop(result, stopId) {
  for (const d of result?.plans || []) for (const slot of SLOTS) {
    const i = (d.slots[slot] || []).findIndex(a => a.uid === stopId);
    if (i >= 0) return { day: d, slot, index: i, stop: d.slots[slot][i] };
  }
  throw new OpError(404, "Stop not found");
}
function getDay(result, n) {
  const d = (result?.plans || []).find(p => p.day === n);
  if (!d) throw new OpError(400, `Day ${n} doesn't exist in this trip`);
  return d;
}

// Read the latest saved trip, apply `mutate` and save it only if nobody saved in between; otherwise
// re-read and apply again. So concurrent edits never overwrite each other.
const MAX_RETRIES = 20;
async function mutateTrip(user, tripId, type, mutate) {
  let out;
  for (let attempt = 0; !out; attempt++) {
    if (attempt === MAX_RETRIES) throw new OpError(409, "This trip is busy with other edits. Please try again.");
    const row = await getTrip(tripId);
    if (!row) throw new OpError(404, "Trip not found");
    const trip = parseTrip(row);
    if (!trip.result) trip.result = { plans: [] };
    const summary = mutate(trip);
    cleanResult(trip.result);
    const saved = await saveTripIfVersion(tripId, trip.version, {
      result: trip.result, title: trip.title, start_date: trip.start_date || null, last_edited_by: user.id, last_edited_by_name: user.name || null
    });
    if (saved) out = { version: trip.version + 1, summary };
  }
  await logActivity(tripId, user.id, type, out.summary);
  broadcast(tripId, { type: "trip", op: type, version: out.version, by: user.id });
  return { ...out, trip: (await getTripForUser(user, tripId)).trip };
}

const q = s => `“${s}”`;

// ── Itinerary operations (owner and editors) ──
const handlers = {
  add_stop(trip, a) {
    const day = getDay(trip.result, a.day);
    const stop = cleanStop({ ...a.stop, note: "" });
    stop.uid = crypto.randomUUID(); // never trust a caller-supplied id
    const list = day.slots[a.slot] = day.slots[a.slot] || [];
    list.splice(Math.min(a.index ?? list.length, list.length), 0, stop);
    this.result = { stopId: stop.uid };
    return `added ${q(stop.title)} to day ${a.day}`;
  },
  move_stop(trip, a) {
    const from = findStop(trip.result, a.stopId);
    const toDay = getDay(trip.result, a.toDay);
    const toSlot = a.toSlot || from.slot;
    from.day.slots[from.slot].splice(from.index, 1);
    const list = toDay.slots[toSlot] = toDay.slots[toSlot] || [];
    list.splice(Math.min(a.toIndex ?? list.length, list.length), 0, from.stop);
    return from.day.day === a.toDay ? `reordered ${q(from.stop.title)} on day ${a.toDay}` : `moved ${q(from.stop.title)} from day ${from.day.day} to day ${a.toDay}`;
  },
  remove_stop(trip, a) {
    const f = findStop(trip.result, a.stopId);
    f.day.slots[f.slot].splice(f.index, 1);
    return `removed ${q(f.stop.title)} from day ${f.day.day}`;
  },
  set_note(trip, a) {
    const f = findStop(trip.result, a.stopId);
    f.stop.note = a.note;
    f.stop.noteBy = a.note ? this.user.id : undefined; // for citations ("from Sam's note on day 2")
    return a.note ? `updated the note on ${q(f.stop.title)}` : `cleared the note on ${q(f.stop.title)}`;
  },
  rename_trip(trip, a) {
    const old = trip.title;
    trip.title = a.title;
    return `renamed the trip from ${q(old)} to ${q(a.title)}`;
  },
  set_dates(trip, a) {
    trip.start_date = a.startDate;
    const dates = getTripDates(trip.result.plans.length, a.startDate);
    trip.result.dates = dates;
    trip.result.plans.forEach((d, i) => { d.date = dates[i]; d.weather = this.weather?.[i] || null; });
    return `set the start date to ${a.startDate}`;
  },
  set_stop_details(trip, a) {
    const f = findStop(trip.result, a.stopId);
    Object.assign(f.stop, a.details);
    if (a.details.title) f.stop.name = a.details.title;
    const what = Object.keys(a.details).filter(k => k !== "lon").map(k => k === "lat" ? "location" : k === "travelMode" ? "travel mode" : k);
    return `changed the ${what.join(", ")} of ${q(f.stop.title)}`;
  }
};

// Run one itinerary operation as `user`. Returns { version, summary, trip, ...extra }.
export async function runOperation(user, tripId, name, args) {
  if (!handlers[name]) throw new OpError(400, `Unknown operation: ${name}`);
  const input = validate(opSchemas[name], args);
  await requireRole(user, tripId, EDIT);
  const ctx = { user };
  if (name === "set_dates") {
    // Fetch the new forecast first, so a retried save doesn't call the network again.
    const t = parseTrip(await getTrip(tripId));
    const coords = COUNTRY_COORDS[t.country];
    const dates = getTripDates(t.result?.plans?.length || t.days, input.startDate);
    if (coords) ctx.weather = await getWeather(coords[0], coords[1], dates[0], dates[dates.length - 1]).catch(() => null);
  }
  const out = await mutateTrip(user, tripId, name, trip => handlers[name].call(ctx, trip, input));
  return { ...out, ...(ctx.result || {}) };
}

// ── Reading ──
export async function getTripForUser(user, tripId) {
  const row = await getTrip(tripId);
  if (!row) throw new OpError(404, "Trip not found");
  const role = user?.id ? await getUserRole(tripId, user.id) : null;
  if (!role) throw new OpError(403, "Access denied");
  return { trip: parseTrip(row), role };
}

// ── Creating, regenerating, deleting ──
// generate: injectable for tests; defaults to the real generator.
export async function createTrip(user, prefs, { generate = generateItinerary } = {}) {
  if (!user?.id) throw new OpError(401, "Not signed in");
  const p = validate(tripPrefs, prefs);
  const result = cleanResult(await generate(p.types, p.country, p.budget, p.pace, p.days, p.startDate));
  if (!result?.plans?.length) throw new OpError(502, "Couldn't find places for this destination. Try another country or interest.");
  const id = crypto.randomBytes(12).toString("hex");
  const title = p.title || `${p.days} days in ${p.country}`;
  await insertTrip({ _id: id, owner_id: user.id, title, country: p.country, days: p.days, budget: p.budget, pace: p.pace, types: p.types, result,
    version: 1, last_edited_by: user.id, last_edited_by_name: user.name || null, start_date: p.startDate || result.dates?.[0] || null });
  await addMember(id, user.id, "owner");
  await logActivity(id, user.id, "create_trip", `created the trip ${q(title)}`);
  return { id, ...await getTripForUser(user, id) };
}

export async function regenerateTrip(user, tripId, { generate = generateItinerary } = {}) {
  await requireRole(user, tripId, EDIT);
  const t = parseTrip(await getTrip(tripId));
  const result = cleanResult(await generate(t.types, t.country, t.budget, t.pace, t.days, t.start_date || undefined));
  if (!result?.plans?.length) throw new OpError(502, "Couldn't regenerate right now. Please try again.");
  return mutateTrip(user, tripId, "regenerate", trip => { trip.result = result; return "regenerated the itinerary"; });
}

export async function deleteTrip(user, tripId) {
  await requireRole(user, tripId, ["owner"]);
  await deleteTripCascade(tripId);
  broadcast(tripId, { type: "deleted" });
  return { ok: true };
}

// ── Comments and expenses (any member, including viewers) ──
async function social(user, tripId, type, summary) {
  await logActivity(tripId, user.id, type, summary);
  broadcast(tripId, { type: "social", op: type, by: user.id });
}

export async function addTripComment(user, tripId, args) {
  const a = validate(commentInput, args);
  await requireRole(user, tripId, ANY_MEMBER);
  const id = await addComment(tripId, a.stopId, user.id, a.text);
  await social(user, tripId, "add_comment", "commented on a stop");
  return { id };
}

export async function deleteTripComment(user, tripId, commentId) {
  const role = await requireRole(user, tripId, ANY_MEMBER);
  const c = await getComment(Number(commentId));
  if (!c || c.trip_id !== tripId) throw new OpError(404, "Comment not found");
  if (c.user_id !== user.id && role !== "owner") throw new OpError(403, "You can only delete your own comments");
  await deleteComment(c.id);
  await social(user, tripId, "delete_comment", "deleted a comment");
  return { ok: true };
}

export async function addTripExpense(user, tripId, args) {
  const a = validate(expenseInput, args);
  await requireRole(user, tripId, ANY_MEMBER);
  const ids = new Set((await getMembers(tripId)).map(m => m.id));
  if (!ids.has(a.paidBy)) throw new OpError(400, "Payer must be a trip member");
  const split = [...new Set(a.splitAmong)];
  if (!split.every(id => ids.has(id))) throw new OpError(400, "Split between trip members only");
  const id = await addExpense(tripId, { ...a, amount: Math.round(a.amount * 100) / 100, splitAmong: split }, user.id);
  await social(user, tripId, "add_expense", `added an expense ${q(a.description)}`);
  return { id };
}

export async function deleteTripExpense(user, tripId, expenseId) {
  const role = await requireRole(user, tripId, ANY_MEMBER);
  const e = await getExpense(Number(expenseId));
  if (!e || e.trip_id !== tripId) throw new OpError(404, "Expense not found");
  if (![e.created_by, e.paid_by].includes(user.id) && role !== "owner") throw new OpError(403, "Only the payer, who added it, or the owner can delete this");
  await deleteExpense(e.id);
  await social(user, tripId, "delete_expense", `deleted the expense ${q(e.description)}`);
  return { ok: true };
}

// ── Members and invites (owner only) ──
export async function changeMemberRole(user, tripId, memberId, role) {
  await requireRole(user, tripId, ["owner"]);
  if (role !== "editor" && role !== "viewer") throw new OpError(400, "Role must be editor or viewer");
  if (Number(memberId) === user.id) throw new OpError(400, "You can't change your own role");
  if (!await updateMemberRole(tripId, Number(memberId), role)) throw new OpError(400, "Can't change that member's role");
  await social(user, tripId, "member_role", `made a member ${role === "editor" ? "an editor" : "a viewer"}`);
  return { ok: true };
}

export async function removeTripMember(user, tripId, memberId) {
  await requireRole(user, tripId, ["owner"]);
  if (Number(memberId) === user.id) throw new OpError(400, "You can't remove yourself");
  if (!await isMember(tripId, Number(memberId))) throw new OpError(404, "Not a member");
  await storeRemoveMember(tripId, Number(memberId));
  await social(user, tripId, "member_removed", "removed a member");
  return { ok: true };
}

export async function createTripInvite(user, tripId, { kind, role } = {}) {
  await requireRole(user, tripId, ["owner"]);
  if (kind !== "link" && kind !== "code") throw new OpError(400, "Kind must be link or code");
  if (role !== "editor" && role !== "viewer") throw new OpError(400, "Role must be editor or viewer");
  const code = await storeCreateInvite(tripId, kind, role, user.id);
  await logActivity(tripId, user.id, "invite_created", `created ${kind === "code" ? "a one-time code" : "an invite link"} for ${role}s`);
  return { code, kind, role };
}

// Called after an invite is redeemed (the redeem itself is in store.js, atomic for one-time codes).
export async function memberJoined(user, tripId) {
  await logActivity(tripId, user.id, "member_joined", "joined the trip");
  broadcast(tripId, { type: "social", op: "member_joined", by: user.id });
}

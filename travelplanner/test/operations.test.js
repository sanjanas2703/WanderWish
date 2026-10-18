// Part 1: the trip-operations layer, exercised through the website's REST routes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signUp } from "./helpers.js";

let srv, owner, editor, viewer, outsider, tripId;
const stop = (title, lat = 35.68, lon = 139.76) => ({ title, lat, lon, loc: "Tokyo" });
const ops = (who, op, args) => who.post(`/api/trips/${tripId}/ops`, { op, args });
const stops = trip => trip.result.plans.flatMap(d => ["morning", "afternoon", "evening"].flatMap(s => d.slots[s].map(a => ({ ...a, day: d.day, slot: s }))));

before(async () => {
  srv = await startServer();
  [owner, editor, viewer, outsider] = await Promise.all(["own", "edi", "vie", "out"].map(n => signUp(srv.base, n)));
  // No Geoapify key in tests, so generation uses the offline fallback itinerary.
  tripId = (await owner.post("/api/trips", { country: "Japan", days: 3 })).body.id;
  for (const [who, role] of [[editor, "editor"], [viewer, "viewer"]]) {
    const code = (await owner.post(`/api/trips/${tripId}/invites`, { kind: "code", role })).body.code;
    assert.equal((await who.post(`/api/invites/${code}/join`)).status, 200);
  }
});
after(async () => { await srv.close(); });

test("an editor can add a stop; it gets a server-generated uuid and bumps the version", async () => {
  const before = (await editor.get(`/api/trips/${tripId}`)).body.trip.version;
  const r = await ops(editor, "add_stop", { day: 1, stop: stop("Senso-ji") });
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.stopId, /^[0-9a-f-]{36}$/);
  assert.equal(r.body.version, before + 1);
  assert.ok(stops(r.body.trip).some(s => s.uid === r.body.stopId && s.title === "Senso-ji"));
});

test("a viewer is rejected for every itinerary operation", async () => {
  const any = stops((await viewer.get(`/api/trips/${tripId}`)).body.trip).find(s => s.lat);
  for (const [op, args] of [["add_stop", { day: 1, stop: stop("X") }], ["remove_stop", { stopId: any.uid }], ["rename_trip", { title: "Mine now" }], ["set_note", { stopId: any.uid, note: "hi" }]]) {
    const r = await ops(viewer, op, args);
    assert.equal(r.status, 403, `${op} should be forbidden for viewers`);
  }
  assert.equal((await viewer.post(`/api/trips/${tripId}/regenerate`)).status, 403);
});

test("an outsider is rejected, signed-out callers get 401", async () => {
  assert.equal((await ops(outsider, "add_stop", { day: 1, stop: stop("X") })).status, 403);
  assert.equal((await outsider.get(`/api/trips/${tripId}/activity`)).status, 403);
  const anon = (await import("./helpers.js")).client(srv.base);
  assert.equal((await anon.post(`/api/trips/${tripId}/ops`, { op: "add_stop", args: {} })).status, 401);
});

test("invalid input is rejected with 400 and changes nothing", async () => {
  const v = (await owner.get(`/api/trips/${tripId}`)).body.trip.version;
  const bad = [
    ["add_stop", { day: 1, stop: { title: "X", lat: 123, lon: 0 } }],   // latitude out of range
    ["add_stop", { day: 9, stop: stop("X") }],                           // day doesn't exist
    ["add_stop", { day: 1, stop: { ...stop("X"), uid: "evil" } }],       // unknown field
    ["move_stop", { stopId: "not-a-uuid", toDay: 1 }],
    ["set_dates", { startDate: "next tuesday" }],
    ["rename_trip", { title: "" }],
    ["set_stop_details", { stopId: "00000000-0000-4000-8000-000000000000", details: {} }],
    ["drop_table", {}]
  ];
  for (const [op, args] of bad) assert.equal((await ops(owner, op, args)).status, 400, `${op} ${JSON.stringify(args)}`);
  assert.equal((await owner.get(`/api/trips/${tripId}`)).body.trip.version, v);
});

test("two simultaneous edits both survive", async () => {
  const v = (await owner.get(`/api/trips/${tripId}`)).body.trip.version;
  const [a, b] = await Promise.all([ops(owner, "add_stop", { day: 2, stop: stop("Ueno Park") }), ops(editor, "add_stop", { day: 2, stop: stop("Ameyoko") })]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const trip = (await owner.get(`/api/trips/${tripId}`)).body.trip;
  const titles = stops(trip).map(s => s.title);
  assert.ok(titles.includes("Ueno Park") && titles.includes("Ameyoko"));
  assert.equal(trip.version, v + 2);
});

test("move, note, details, rename and dates all work by uuid", async () => {
  const id = (await ops(owner, "add_stop", { day: 1, slot: "morning", stop: stop("Tokyo Tower") })).body.stopId;
  let r = await ops(editor, "move_stop", { stopId: id, toDay: 3, toSlot: "afternoon", toIndex: 0 });
  assert.equal(r.status, 200, r.text);
  let s = stops(r.body.trip).find(x => x.uid === id);
  assert.deepEqual([s.day, s.slot], [3, "afternoon"]);
  r = await ops(editor, "set_note", { stopId: id, note: "Go at sunset" });
  assert.equal(stops(r.body.trip).find(x => x.uid === id).note, "Go at sunset");
  r = await ops(editor, "set_stop_details", { stopId: id, details: { travelMode: "transit", dur: "2h" } });
  s = stops(r.body.trip).find(x => x.uid === id);
  assert.deepEqual([s.travelMode, s.dur], ["transit", "2h"]);
  r = await ops(editor, "rename_trip", { title: "Tokyo with friends" });
  assert.equal(r.body.trip.title, "Tokyo with friends");
  r = await ops(owner, "set_dates", { startDate: "2027-03-10" });
  assert.deepEqual(r.body.trip.result.plans.map(d => d.date), ["2027-03-10", "2027-03-11", "2027-03-12"]);
  assert.equal(r.body.trip.start_date, "2027-03-10");
  r = await ops(editor, "remove_stop", { stopId: id });
  assert.ok(!stops(r.body.trip).some(x => x.uid === id));
  assert.equal((await ops(editor, "remove_stop", { stopId: id })).status, 404);
});

test("every change is in the activity feed", async () => {
  await ops(editor, "add_stop", { day: 1, stop: stop("Meiji Shrine") });
  const feed = (await viewer.get(`/api/trips/${tripId}/activity`)).body.activity;
  assert.match(feed[0].summary, /added “Meiji Shrine” to day 1/);
  assert.ok(feed.some(a => a.type === "member_joined"));
});

test("viewers can still comment and log expenses (social actions)", async () => {
  const any = stops((await viewer.get(`/api/trips/${tripId}`)).body.trip)[0];
  assert.equal((await viewer.post(`/api/trips/${tripId}/comments`, { stopId: any.uid, text: "Looks fun!" })).status, 200);
  const me = viewer.user.id;
  assert.equal((await viewer.post(`/api/trips/${tripId}/expenses`, { description: "Taxi", amount: 30, currency: "JPY", paidBy: me, splitAmong: [me, owner.user.id] })).status, 200);
  assert.equal((await viewer.post(`/api/trips/${tripId}/expenses`, { description: "Taxi", amount: 30, currency: "JPY", paidBy: outsider.user.id, splitAmong: [me] })).status, 400);
});

test("the whole-trip PUT is gone: no route edits trip data directly", async () => {
  const r = await owner.put(`/api/trips/${tripId}`, { title: "hacked", result: { plans: [] } });
  assert.equal(r.status, 404);
});

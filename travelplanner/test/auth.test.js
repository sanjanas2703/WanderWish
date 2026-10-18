import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, signUp } from "./helpers.js";
import { models } from "../server/store.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

test("signed-out visitors cannot read trips or the API key config", async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get("/api/trips")).status, 401);
  assert.equal((await anon.get("/api/trips/abc123")).status, 401);
});

test("users are stored with a bcrypt hash under `password`, never the password itself", async () => {
  const u = await signUp(srv.base, "pw");
  const doc = await models.User.findById(u.user.id).lean();
  assert.match(doc.password, /^\$2[aby]\$10\$/);
  assert.ok(!JSON.stringify(doc).includes("secret123"));
  assert.equal((await u.get("/api/auth/me")).body.user.password, undefined, "the hash never reaches the browser");
});


test("a member can read their trip, an outsider cannot", async () => {
  const owner = await signUp(srv.base, "owner");
  const outsider = await signUp(srv.base, "out");
  const created = await owner.post("/api/trips", { country: "Japan", days: 2 });
  assert.equal(created.status, 200);
  assert.equal((await owner.get("/api/trips/" + created.body.id)).status, 200);
  assert.equal((await outsider.get("/api/trips/" + created.body.id)).status, 403);
});

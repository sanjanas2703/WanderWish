import { test, before, after } from "node:test";
import assert from "node:assert/strict";
process.env.GEOAPIFY_API_KEY = "SENTINEL_KEY_should_never_leak";
const { startServer, client, signUp } = await import("./helpers.js");

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

test("the Geoapify key is never sent to the browser", async () => {
  const anon = client(srv.base);
  for (const url of ["/", "/app.js", "/services/api.js", "/shared/data.js", "/shared/geo.js", "/data.js", "/geo.js", "/api/config"]) {
    const r = await anon.get(url);
    assert.ok(!r.text.includes("SENTINEL_KEY"), `${url} leaked the key`);
  }
  assert.notEqual((await anon.get("/api/config")).body?.geoapifyKey, process.env.GEOAPIFY_API_KEY);
});

test("map and generation routes require sign-in", async () => {
  const anon = client(srv.base);
  for (const url of ["/api/geo/places?lat=1&lon=1&categories=tourism.sights", "/api/geo/reverse?lat=1&lon=1", "/api/geo/geocode?text=x", "/api/geo/route?from=1,1&to=2,2&mode=walk"]) {
    assert.equal((await anon.get(url)).status, 401, url);
  }
  assert.equal((await anon.post("/api/trips", { country: "Japan", days: 2 })).status, 401);
});

test("bad input is rejected before any outside call", async () => {
  const u = await signUp(srv.base, "geo");
  assert.equal((await u.get("/api/geo/places?lat=999&lon=1&categories=tourism.sights")).status, 400);
  assert.equal((await u.get("/api/geo/places?lat=1&lon=1&categories=DROP%20TABLE")).status, 400);
  assert.equal((await u.get("/api/geo/route?from=1,1&to=2,2&mode=teleport")).status, 400);
  assert.equal((await u.post("/api/trips", { country: "Atlantis", days: 2 })).status, 400);
  assert.equal((await u.post("/api/trips", { country: "Japan", days: 99 })).status, 400);
});

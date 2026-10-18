// Part 2: running and sharing safely.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, client, signUp } from "./helpers.js";
import { redactPath } from "../server/security.js";
import { runBackup, runRestore } from "../scripts/backup.js";
import { models } from "../server/store.js";
import { resetLimits } from "../server/ratelimit.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });
const reg = (c, n) => c.post("/api/auth/register", { username: "rl" + n, email: `rl${n}@example.test`, name: "x", password: "secret123" });

test("GET /healthz reports ok without auth", async () => {
  const r = await client(srv.base).get("/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
});

test("security headers are set and X-Powered-By is hidden", async () => {
  const r = await fetch(srv.base + "/");
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
});

test("cross-origin writes are blocked, same-origin writes allowed", async () => {
  const post = origin => fetch(srv.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ login: "nobody", password: "x" }) });
  assert.equal((await post("https://evil.example")).status, 403);
  assert.equal((await post(srv.base)).status, 401); // reached the route
});

test("oversized and malformed bodies get clean JSON errors", async () => {
  const big = await fetch(srv.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "x".repeat(200_000) }) });
  assert.equal(big.status, 413);
  const bad = await fetch(srv.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "Invalid JSON" });
});

test("behind the tunnel (HTTPS via a local proxy) the session cookie is Secure", async () => {
  const viaTunnel = await fetch(srv.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" }, body: JSON.stringify({ username: "tunnel1", email: "t1@example.test", name: "t", password: "secret123" }) });
  assert.match(viaTunnel.headers.get("set-cookie"), /; Secure/i);
  assert.match(viaTunnel.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(viaTunnel.headers.get("set-cookie"), /SameSite=Lax/i);
  const local = await fetch(srv.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "local1", email: "l1@example.test", name: "l", password: "secret123" }) });
  assert.doesNotMatch(local.headers.get("set-cookie"), /; Secure/i);
});

test("sign-up and sign-in are rate limited, and X-Forwarded-For can't be spoofed to dodge it", async () => {
  const c = client(srv.base);
  let last;
  for (let i = 0; i < 12; i++) {
    // Through the tunnel, Cloudflare appends the visitor's real IP after whatever they sent, so faking
    // the left part of X-Forwarded-For must not give them a fresh rate-limit bucket.
    last = await fetch(srv.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.0.${i}, 203.0.113.5` }, body: JSON.stringify({ login: "nobody", password: "wrong" }) });
  }
  assert.equal(last.status, 429);
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await reg(c, i)).status);
  assert.ok(statuses.includes(429), "registration should eventually be limited: " + statuses);
});

test("query operators in request bodies can't bypass sign-in or match other users", async () => {
  resetLimits();
  await signUp(srv.base, "inj");
  const c = client(srv.base);
  for (const login of [{ $ne: null }, { $gt: "" }, ["x"]]) {
    const r = await c.post("/api/auth/login", { login, password: "secret123" });
    assert.equal(r.status, 400, JSON.stringify(login));
  }
  const r = await c.post("/api/auth/register", { username: "inj_x", email: { $ne: null }, name: "x", password: "secret123" });
  assert.equal(r.status, 400);
  assert.equal((await client(srv.base).get("/api/auth/check-username?username[$ne]=x")).body.available, false);
});

test("invite codes are redacted from request logs", () => {
  assert.equal(redactPath("/join/K7PQ2X"), "/join/[code]");
  assert.equal(redactPath("/api/invites/abcdef0123/join"), "/api/invites/[code]/join");
  assert.equal(redactPath("/api/trips/abc/invites/SECRET1"), "/api/trips/abc/invites/[code]");
  assert.equal(redactPath("/api/trips/abc/ops?x=1"), "/api/trips/abc/ops");
});

function runServer(env) {
  return spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { PATH: process.env.PATH, MONGODB_URI: process.env.MONGODB_URI, DOTENV_PATH: "/nonexistent/.env", ...env }, stdio: ["ignore", "pipe", "pipe"] });
}
const exited = p => new Promise(r => p.on("exit", code => r(code)));
const output = p => { let s = ""; p.stdout.on("data", d => s += d); p.stderr.on("data", d => s += d); return () => s; };

test("startup fails fast on a bad or missing configuration", async () => {
  let p = runServer({ NODE_ENV: "production", PORT: "0" });
  let out = output(p);
  assert.equal(await exited(p), 1);
  assert.match(out(), /GEOAPIFY_API_KEY is required/);
  p = runServer({ NODE_ENV: "development", PORT: "not-a-port" });
  out = output(p);
  assert.equal(await exited(p), 1);
  assert.match(out(), /PORT must be an integer/);
  p = runServer({ NODE_ENV: "development", PORT: "3999", MONGODB_URI: "postgres://example" });
  out = output(p);
  assert.equal(await exited(p), 1);
  assert.match(out(), /MONGODB_URI must start with mongodb:\/\//);
});

test("startup fails with a clear message (and no URI) when MongoDB is unreachable", async () => {
  const p = runServer({ NODE_ENV: "development", PORT: "3999", GEOAPIFY_API_KEY: "k", MONGODB_URI: "mongodb://user:hunter2@127.0.0.1:1/x?serverSelectionTimeoutMS=500" });
  const out = output(p);
  assert.equal(await exited(p), 1);
  assert.match(out(), /Can't reach MongoDB/);
  assert.doesNotMatch(out(), /hunter2/);
});

test("SIGTERM shuts the server down gracefully", async () => {
  const port = String(40000 + Math.floor(Math.random() * 20000));
  const p = runServer({ NODE_ENV: "development", PORT: port, GEOAPIFY_API_KEY: "k" });
  const out = output(p);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  p.kill("SIGTERM");
  assert.equal(await exited(p), 0);
  assert.match(out(), /SIGTERM received, shutting down/);
  assert.doesNotMatch(out(), /GEOAPIFY_API_KEY=|\bk\b.*key/i);
});

test("backups are complete copies that restore exactly, and old ones are pruned", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-backup-"));
  resetLimits();
  const u = await signUp(srv.base, "bak");
  const before = await models.User.findById(u.user.id).lean();
  for (let i = 0; i < 3; i++) { await runBackup({ dir, keep: 2 }); await new Promise(r => setTimeout(r, 1100)); }
  const files = fs.readdirSync(dir).sort();
  assert.equal(files.length, 2);
  await models.User.deleteOne({ _id: u.user.id });
  assert.ok(await runRestore(path.join(dir, files[1])) > 0);
  assert.deepEqual(await models.User.findById(u.user.id).lean(), before, "same document, dates and number types included");
  assert.equal((await u.get("/api/auth/me")).body.user.id, u.user.id, "the session survived the restore");
  fs.rmSync(dir, { recursive: true, force: true });
});

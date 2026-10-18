#!/usr/bin/env node
// npm run share — run WanderWish on this computer and share it through a free Cloudflare quick tunnel.
// No Cloudflare account is needed. The URL changes every run and only works while this computer is on and awake.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBackup } from "./backup.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || "3000";

if (spawnSync("cloudflared", ["--version"]).error) {
  console.error(`cloudflared is not installed. Install it (free, no account needed), then run this again:
  macOS:   brew install cloudflared
  Others:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
  process.exit(1);
}

try { console.log("Backing up the database first…"); console.log("  →", path.relative(root, await runBackup())); }
catch (e) { console.log("  (skipped: " + e.message + ")"); }

const server = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, NODE_ENV: "production", PORT }, stdio: "inherit" });
let tunnel = null;
let stopping = false;
const stop = code => {
  if (stopping) return;
  stopping = true;
  tunnel?.kill("SIGTERM");
  server.kill("SIGTERM"); // the app shuts down gracefully on SIGTERM
  setTimeout(() => process.exit(code), 1500).unref();
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
server.on("exit", code => { if (!stopping) { console.error(`The app exited (code ${code}).`); stop(code || 1); } });

// Wait for /healthz before opening the tunnel.
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 250));
  if (i === 39) { console.error("The app didn't start in time."); stop(1); }
}

tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
let announced = false;
const watch = buf => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !announced) {
    announced = true;
    console.log(`
  ┌──────────────────────────────────────────────────────────────
  │  WanderWish is live at:  ${m[0]}
  │
  │  • Send this link to friends. They sign in, then join with an invite.
  │  • The link changes every time you run npm run share.
  │  • It works only while this computer is on and awake
  │    (tip: run "caffeinate -i npm run share" on macOS).
  │  • Live updates refresh every ~10s through the tunnel.
  │  • Press Ctrl+C to stop sharing.
  └──────────────────────────────────────────────────────────────
`);
  }
};
tunnel.stdout.on("data", watch);
tunnel.stderr.on("data", watch);
tunnel.on("exit", code => { if (!stopping) { console.error(`The tunnel closed (code ${code}).`); stop(code || 1); } });

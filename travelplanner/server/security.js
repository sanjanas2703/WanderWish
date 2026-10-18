// HTTP hardening: security headers, same-origin enforcement for API writes, and redacted request logs.
import { config } from "./config.js";

const CSP = [
  "default-src 'self'",
  // Vue's in-browser template compiler needs 'unsafe-eval'. Scripts only from us and unpkg (pinned versions).
  "script-src 'self' https://unpkg.com 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://unpkg.com https://upload.wikimedia.org https://thumb.wikimedia.org https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org https://api.frankfurter.dev",
  "worker-src 'self' blob:",
  "child-src blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

export function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()"
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000");
  next();
}

// Strict CORS: we never send Access-Control-Allow-* headers, so browsers block cross-origin reads.
// For writes, reject any request whose Origin isn't this site (or an explicitly allowed origin).
export function sameOriginWrites(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next(); // non-browser clients (curl, tests) don't send Origin; they still need a session
  let host;
  try { host = new URL(origin).host; } catch { return res.status(403).json({ error: "Cross-origin request blocked" }); }
  // Behind the tunnel the public hostname may arrive as Host or X-Forwarded-Host (only trusted from loopback).
  const selves = [req.get("host"), req.ip === "127.0.0.1" || req.ip === "::1" ? req.get("x-forwarded-host") : null].filter(Boolean);
  if (selves.includes(host) || config.allowedOrigins.includes(origin)) return next();
  res.status(403).json({ error: "Cross-origin request blocked" });
}

// Invite codes are secrets: never write them to logs.
export function redactPath(p) {
  return p.split("?")[0]
    .replace(/^\/join\/[^/]+/, "/join/[code]")
    .replace(/^\/api\/invites\/[^/]+/, "/api/invites/[code]")
    .replace(/^(\/api\/trips\/[^/]+\/invites\/)[^/]+/, "$1[code]");
}

export function requestLog(req, res, next) {
  if (config.isTest) return next();
  const start = Date.now();
  res.on("finish", () => console.log(`${new Date().toISOString()} ${req.method} ${redactPath(req.originalUrl)} ${res.statusCode} ${Date.now() - start}ms`));
  next();
}

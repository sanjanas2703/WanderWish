// In-memory fixed-window rate limiter. Good enough for a single-process app.
const windows = new Map();

export function hit(key, max, windowMs) {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) { windows.set(key, { start: now, count: 1 }); return true; }
  w.count++;
  return w.count <= max;
}

// Express middleware: keyed by signed-in user (req.user) or IP.
export function limit(name, max, windowMs) {
  return (req, res, next) => {
    const who = req.user?.user_id ? "u" + req.user.user_id : "ip" + req.ip;
    if (hit(`${name}|${who}`, max, windowMs)) return next();
    res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
  };
}

export function resetLimits() { windows.clear(); }
setInterval(() => { const now = Date.now(); for (const [k, w] of windows) if (now - w.start > 3600_000) windows.delete(k); }, 600_000).unref();

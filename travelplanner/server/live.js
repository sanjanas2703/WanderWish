// Server-sent events: one stream per open trip page. Messages are tiny "something changed" pings;
// clients refetch through the normal (permission-checked) routes.
const clients = new Set();

export function addClient(tripId, userId, res) {
  const c = { tripId, userId, res };
  clients.add(c);
  return () => clients.delete(c);
}

export function broadcast(tripId, payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) if (c.tripId === tripId) { try { c.res.write(msg); } catch {} }
}

export function closeAll() { for (const c of clients) { try { c.res.end(); } catch {} } clients.clear(); }

// Heartbeat every 20s: keeps idle connections open through proxies, and lets the browser notice
// when a proxy buffers the stream (it then falls back to polling).
setInterval(() => { for (const c of clients) { try { c.res.write('data: {"type":"ping"}\n\n'); } catch {} } }, 20_000).unref();

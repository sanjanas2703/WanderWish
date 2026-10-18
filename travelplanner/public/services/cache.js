const __apiCache = {};

async function cached(key, ttlMs, fetcher) {
  const now = Date.now();
  const entry = __apiCache[key];
  if (entry && now - entry.time < ttlMs) {
    return entry.data;
  }
  const data = await fetcher();
  __apiCache[key] = { data, time: now };
  return data;
}

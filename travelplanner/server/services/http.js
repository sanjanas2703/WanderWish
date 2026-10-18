// Small helpers for calling third-party APIs from the server: timeouts, a polite User-Agent, and an in-memory cache.
// Wikimedia asks for contact details in the User-Agent and limits anonymous clients more strictly.
// Set WIKIMEDIA_CONTACT (an email address or URL) to be a good citizen and get fewer 429s.
const UA = () => `WanderWish/1.0 (${process.env.WIKIMEDIA_CONTACT || "self-hosted trip planner"})`;
const cache = new Map();
const MAX_ENTRIES = 5000;

export async function cached(key, ttlMs, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.data;
  const data = await fetcher();
  // Only cache real answers: a failure (e.g. a temporary rate limit) should be retried next time.
  if (data === null || data === undefined) return data;
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { data, time: Date.now() });
  return data;
}

// Returns parsed JSON, or null on any network/HTTP/parse failure. Never throws.
export async function fetchJson(url, { timeoutMs = 8000 } = {}) {
  if (process.env.NODE_ENV === "test") return null; // tests run offline
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA(), Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}


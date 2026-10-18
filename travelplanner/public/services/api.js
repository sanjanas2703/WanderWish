// Browser-side wrappers for the server's map/place routes. The Geoapify key stays on the server.
async function getJson(url) {
  try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
}

async function getPlaces(lat, lon, categories, limit) {
  const cats = (Array.isArray(categories) ? categories : [categories]).join(",");
  return (await getJson(`/api/geo/places?lat=${lat}&lon=${lon}&categories=${encodeURIComponent(cats)}&limit=${limit || 20}`))?.places || [];
}

async function reverseGeocode(lat, lon) {
  return (await getJson(`/api/geo/reverse?lat=${lat}&lon=${lon}`))?.address || "";
}

async function geocodePlace(text, country, near) {
  let url = `/api/geo/geocode?text=${encodeURIComponent(text)}&country=${encodeURIComponent(country || "")}`;
  if (near) url += `&near=${near.lat},${near.lon}`;
  return (await getJson(url))?.place || null;
}

// Cached per page load: the map re-renders on every edit.
const _legCache = new Map();
async function getLegRoute(from, to, mode) {
  const k = `${from.lat},${from.lon}|${to.lat},${to.lon}|${mode}`;
  if (!_legCache.has(k)) _legCache.set(k, getJson(`/api/geo/route?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}&mode=${mode}`).then(d => d?.route || null));
  return _legCache.get(k);
}

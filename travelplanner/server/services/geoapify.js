// Geoapify (free plan, see docs/costs.md). The API key never leaves the server.
import { cached, fetchJson } from "./http.js";
import { isLatinScript } from "../../shared/geo.js";

const BASE = "https://api.geoapify.com";
const key = () => process.env.GEOAPIFY_API_KEY || process.env.VITE_GEOAPIFY_API_KEY || "";
export const geoapifyConfigured = () => !!key();

function englishName(p) {
  const intl = p.name_international?.en;
  if (typeof intl === "string" && intl.trim()) return intl.trim();
  const raw = p.datasource?.raw?.["name:en"];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function englishAddress(p) {
  const parts = [];
  if (p.district) parts.push(p.district);
  if (p.city) parts.push(p.city);
  if (p.county && !p.city) parts.push(p.county);
  if (!parts.length && p.state) parts.push(p.state);
  return parts.join(", ");
}

const TAG_KEYS = ["wikidata", "wikipedia", "historic", "heritage", "religion", "amenity", "start_date"];
function pickTags(raw) {
  const t = {};
  for (const k of TAG_KEYS) if (typeof raw[k] === "string" || typeof raw[k] === "number") t[k] = String(raw[k]).slice(0, 200);
  return t;
}

export async function getPlaces(lat, lon, categories, limit = 20) {
  if (!key()) return [];
  const cats = (Array.isArray(categories) ? categories : [categories]).join(",");
  // bias=proximity: nearest the destination's centre first, where the well-known sights tend to be.
  const url = `${BASE}/v2/places?categories=${encodeURIComponent(cats)}&filter=circle:${lon},${lat},30000&bias=proximity:${lon},${lat}&limit=${limit}&lang=en&apiKey=${key()}`;
  return cached(`places2|${cats}|${lat}|${lon}|${limit}`, 3600_000, async () => {
    const d = await fetchJson(url);
    return (d?.features || []).map(f => {
      const p = f.properties || {};
      let name = String(englishName(p) || p.name || ""); // OSM names can be numbers (e.g. "1")
      if (!name.trim()) {
        const cat = (p.categories || []).map(c => c.split(".").pop()).find(Boolean) || "place";
        const loc = englishAddress(p) || p.city || p.county || p.country || "";
        name = loc ? `${cat} in ${loc}` : `local ${cat}`;
        name = name.charAt(0).toUpperCase() + name.slice(1);
      }
      return {
        name, localName: p.name ? String(p.name) : "",
        lat: p.lat ?? f.geometry?.coordinates?.[1] ?? lat,
        lon: p.lon ?? f.geometry?.coordinates?.[0] ?? lon,
        address: englishAddress(p) || [p.address_line1, p.address_line2].filter(Boolean).join(", "),
        city: p.city || p.county || "",
        categories: p.categories || [],
        placeId: p.place_id || "",
        country: p.country || "",
        // OpenStreetMap tags used for descriptions (server/services/describe.js)
        tags: pickTags(p.datasource?.raw || {})
      };
    });
  });
}

// Short English address for a point; non-Latin parts are dropped.
export async function reverseGeocode(lat, lon) {
  if (!key()) return "";
  return cached(`rev|${(+lat).toFixed(5)}|${(+lon).toFixed(5)}`, 86400_000, async () => {
    const d = await fetchJson(`${BASE}/v1/geocode/reverse?lat=${lat}&lon=${lon}&lang=en&apiKey=${key()}`, { timeoutMs: 5000 });
    const p = d?.features?.[0]?.properties;
    if (!p) return "";
    const parts = [p.name, p.street, p.suburb || p.district, p.city || p.county].filter(v => v && isLatinScript(v));
    return [...new Set(parts)].slice(0, 3).join(", ") || p.formatted || "";
  });
}

// Best guess for a typed place name in a country; null if it only matches something vague (a whole country/state).
export async function geocodePlace(text, country, near) {
  if (!key() || !text) return null;
  let url = `${BASE}/v1/geocode/search?text=${encodeURIComponent(text + (country ? ", " + country : ""))}&lang=en&limit=1&apiKey=${key()}`;
  if (near) url += `&bias=proximity:${near.lon},${near.lat}`;
  return cached("geo|" + url, 86400_000, async () => {
    const p = (await fetchJson(url, { timeoutMs: 6000 }))?.features?.[0]?.properties;
    if (!p || ["country", "state"].includes(p.result_type)) return null;
    return { lat: p.lat, lon: p.lon, name: p.name || p.address_line1 || text, address: p.formatted || "" };
  });
}

// Geoapify returns a MultiLineString (one line per leg); flatten every part so the drawn path is continuous.
function flattenRouteCoords(geometry) {
  if (!geometry?.coordinates) return [];
  const parts = geometry.type === "MultiLineString" ? geometry.coordinates : [geometry.coordinates];
  return parts.flat().map(([lon, lat]) => [lat, lon]);
}

// "Take the C3 toward Tiburtina. (4 stops)" → "C3 · 4 stops"
function transitSummary(props) {
  const out = [];
  for (const leg of props.legs || []) for (const step of leg.steps || []) {
    const t = step.instruction?.type === "Transit" ? step.instruction.text || "" : "";
    const m = t.match(/^Take the (.+?) toward .*?(?:\((\d+) stops?\))?\.?$/);
    if (m) out.push(m[1] + (m[2] ? ` · ${m[2]} stop${m[2] === "1" ? "" : "s"}` : ""));
  }
  return out.join(" → ");
}

async function routeOnce(from, to, apiMode) {
  const url = `${BASE}/v1/routing?waypoints=${from.lat},${from.lon}|${to.lat},${to.lon}&mode=${apiMode}&lang=en&apiKey=${key()}`;
  return cached(`route|${apiMode}|${from.lat},${from.lon}|${to.lat},${to.lon}`, 86400_000, async () => {
    const f = (await fetchJson(url, { timeoutMs: 10000 }))?.features?.[0];
    if (!f) return null;
    const coords = flattenRouteCoords(f.geometry);
    if (coords.length < 2) return null;
    return { coords, min: Math.max(1, Math.round((f.properties.time || 0) / 60)), km: Math.round((f.properties.distance || 0) / 100) / 10, line: transitSummary(f.properties) };
  });
}

export const TRAVEL_MODES = ["walk", "transit", "drive", "bicycle"];

// Transit falls back to a road route where Geoapify has no public-transport data.
export async function getLegRoute(from, to, mode) {
  if (!key()) return null;
  const tries = mode === "transit" ? [["approximated_transit", "transit"], ["transit", "transit"], ["drive", "drive"]] : [[mode, mode]];
  for (const [apiMode, used] of tries) {
    const r = await routeOnce(from, to, apiMode);
    if (r) return { ...r, mode: used, fallback: used !== mode };
  }
  return null;
}

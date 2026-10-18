// Descriptions for itinerary stops. Significant places (historic, religious, cultural) get a real description;
// everything else keeps "Visit X." Sources, best first:
//   1. the place's Wikidata id (from OpenStreetMap) → its English Wikipedia article, else Wikidata's English description
//   2. the place's Wikipedia tag in another language → the English article it links to
//   3. an English Wikipedia article with the same name — only if its coordinates are within 1.5 km (no wrong matches)
//   4. the place's own OpenStreetMap tags (e.g. "A Shinto shrine, built in 1764.") — facts only
// Wikipedia text is CC BY-SA, so stops described from it keep a link to the article (descUrl).
import { cached, fetchJson } from "./http.js";
import { haversineDist, isLatinScript } from "../../shared/geo.js";

// Network access is swappable so tests run offline with fixed data.
export const sources = {
  // Wikidata entities by id → { Q123: { label, description, enwiki } }
  async entities(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const d = await cached("wd-ent|" + batch.join("|"), 86400_000, () =>
        fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=labels|descriptions|sitelinks&languages=en&sitefilter=enwiki&format=json`));
      for (const [id, e] of Object.entries(d?.entities || {})) {
        out[id] = { label: e.labels?.en?.value || null, description: e.descriptions?.en?.value || null, enwiki: e.sitelinks?.enwiki?.title || null };
      }
    }
    return out;
  },
  // English Wikipedia summary → { extract, url, type, coords }
  async summary(title) {
    return cached("wp-sum|" + title, 86400_000, async () => {
      const d = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
      if (!d?.extract) return null;
      return { extract: d.extract, url: d.content_urls?.desktop?.page || null, type: d.type, coords: d.coordinates ? { lat: d.coordinates.lat, lon: d.coordinates.lon } : null };
    });
  },
  // A page on another-language Wikipedia → { enTitle, wikidata }
  async foreign(lang, title) {
    if (!/^[a-z-]{2,12}$/.test(lang)) return null;
    return cached(`wp-ll|${lang}|${title}`, 86400_000, async () => {
      const d = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=langlinks|pageprops&lllang=en&ppprop=wikibase_item&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(title)}`);
      const p = d?.query?.pages?.[0];
      return p ? { enTitle: p.langlinks?.[0]?.title || null, wikidata: p.pageprops?.wikibase_item || null } : null;
    });
  }
};

// First one or two sentences, at most ~260 characters, ending on a sentence boundary.
export function firstSentences(text, max = 260) {
  const clean = String(text || "").replace(/\s+/g, " ").replace(/\s*\([^()]*\)/g, "").trim(); // drop parentheticals (pronunciations, dates in other calendars)
  // A sentence ends at . ! or ? followed by a space and a new sentence — so "2.8 million" or "St. Peter's" don't split.
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/);
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    if (out && (out + " " + s).length > max) break;
    out = out ? out + " " + s : s;
  }
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return out;
}

const RELIGIOUS = { buddhist: "Buddhist temple", shinto: "Shinto shrine", christian: "church", muslim: "mosque", hindu: "Hindu temple", jewish: "synagogue", sikh: "gurdwara", taoist: "Taoist temple", jain: "Jain temple" };
const HISTORIC = {
  castle: "historic castle", fort: "historic fort", palace: "historic palace", ruins: "set of historic ruins",
  archaeological_site: "archaeological site", monument: "monument", city_gate: "historic city gate", city_wall: "historic city wall",
  manor: "historic manor house", monastery: "historic monastery", church: "historic church", temple: "historic temple",
  tomb: "historic tomb", aqueduct: "historic aqueduct", citywalls: "historic city wall", building: "historic building",
  ship: "historic ship", battlefield: "historic battlefield", bridge: "historic bridge", house: "historic house"
}; // deliberately not: memorial plaques, boundary stones, milestones, wayside crosses

// A short factual description from OpenStreetMap tags, or null if nothing significant is known.
export function describeFromTags(tags = {}) {
  let what = null;
  if (tags.amenity === "place_of_worship" && RELIGIOUS[tags.religion]) what = RELIGIOUS[tags.religion];
  else if (HISTORIC[tags.historic]) what = HISTORIC[tags.historic];
  else if (tags.heritage) what = "listed heritage site";
  if (!what) return null;
  const year = String(tags.start_date || "").match(/^(?:c\.?\s*)?(\d{3,4})/)?.[1];
  const article = /^[aeiou]/i.test(what) ? "An" : "A";
  let s = `${article} ${what}`;
  if (year) s += `, built in ${year}`;
  if (tags.heritage && what !== "listed heritage site") s += ", listed as a heritage site";
  return s + ".";
}

// Wikidata descriptions sometimes end in a code, e.g. "protected area in Italy (EUAP1083)" — drop it.
const sentence = s => { const t = s.replace(/\s*\([^()]*\d[^()]*\)\s*$/, "").trim(); return t.charAt(0).toUpperCase() + t.slice(1).replace(/\.?$/, "."); };

// Adds desc (and, for Wikipedia text, descUrl) to each stop in place. Stops: { name, title, lat, lon, tags, fallbackName }.
export async function describeStops(stops) {
  // Follow foreign-language Wikipedia tags to their Wikidata id / English title first.
  await Promise.all(stops.map(async s => {
    const wp = s.tags?.wikipedia?.match(/^([a-z-]{2,12}):(.+)$/);
    if (!wp || s.tags.wikidata) return;
    if (wp[1] === "en") { s._enTitle = wp[2]; return; }
    const f = await sources.foreign(wp[1], wp[2]).catch(() => null);
    if (f?.wikidata) s.tags.wikidata = f.wikidata;
    if (f?.enTitle) s._enTitle = f.enTitle;
  }));
  const ids = [...new Set(stops.map(s => s.tags?.wikidata).filter(id => /^Q\d+$/.test(id || "")))];
  const ents = ids.length ? await sources.entities(ids).catch(() => ({})) : {};

  for (let i = 0; i < stops.length; i += 4) {
    await Promise.all(stops.slice(i, i + 4).map(async s => {
      const ent = ents[s.tags?.wikidata];
      // A proper English name beats a placeholder like "Tourism in Yokohama" or a non-English name.
      if (ent?.label && (s.fallbackName || !isLatinScript(s.title || ""))) { s.title = s.name = ent.label; s.fallbackName = false; }
      const title = ent?.enwiki || s._enTitle;
      if (title) {
        const sum = await sources.summary(title).catch(() => null);
        if (sum && sum.type !== "disambiguation") { s.desc = firstSentences(sum.extract); s.descUrl = sum.url; return; }
      }
      if (ent?.description && ent.description.length > 8) { s.desc = sentence(ent.description); return; }
      if (!s.fallbackName && s.title && s.title.length > 3 && Number.isFinite(s.lat)) {
        const sum = await sources.summary(s.title).catch(() => null);
        if (sum && sum.type !== "disambiguation" && sum.coords && haversineDist(s.lat, s.lon, sum.coords.lat, sum.coords.lon) <= 1.5) {
          s.desc = firstSentences(sum.extract); s.descUrl = sum.url; return;
        }
      }
      const fromTags = describeFromTags(s.tags);
      if (fromTags) s.desc = fromTags;
    }));
  }
  for (const s of stops) delete s._enTitle;
  return stops;
}

// How worth visiting a candidate place looks, from its data alone (higher is better). Used to choose stops.
const MINOR_HISTORIC = new Set(["boundary_stone", "milestone", "memorial", "wayside_cross", "wayside_shrine", "marker", "stone", "survey_point", "plaque"]);
const NOTABLE_CATEGORIES = ["tourism.sights", "tourism.attraction", "culture.museum", "building.historic", "heritage", "entertainment.museum", "national_park"];
export function significance(p) {
  const t = p.tags || {};
  let score = 0;
  if (t.wikidata || t.wikipedia) score += 4;
  if (HISTORIC[t.historic] || t.heritage || (t.amenity === "place_of_worship" && RELIGIOUS[t.religion])) score += 2;
  if ((p.categories || []).some(c => NOTABLE_CATEGORIES.some(n => c === n || c.startsWith(n + ".")))) score += 1;
  if (MINOR_HISTORIC.has(t.historic) && !t.wikidata && !t.wikipedia) score -= 3;
  const name = String(p.name || "").trim();
  if (name.length <= 3 || /^[IVXLCDM]+$/i.test(name) || /^[\d\s?.-]+$/.test(name) || /^\p{L}?\d+\??$/u.test(name)) score -= 3; // "XIII", "I", "山147"
  if (!isLatinScript(name) && !t.wikidata) score -= 1;
  return score;
}

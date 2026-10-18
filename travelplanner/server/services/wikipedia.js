// Wikipedia / Wikidata (free; descriptive User-Agent required). Used for English names and short descriptions.
import { cached, fetchJson } from "./http.js";
import { isLatinScript } from "../../shared/geo.js";

async function wikidataEnglishName(localName) {
  if (!localName || localName.trim().length < 2) return null;
  return cached("wd|" + localName.trim().slice(0, 80), 86400_000, async () => {
    const s = await fetchJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(localName)}&language=en&limit=5&format=json`);
    for (const ent of s?.search || []) {
      if (!ent.id) continue;
      const e = (await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ent.id}&props=labels|sitelinks&languages=en&sitefilter=enwiki&format=json`))?.entities?.[ent.id];
      const label = e?.labels?.en?.value || "";
      if (label.length < 2) continue;
      return e.sitelinks?.enwiki?.title || label;
    }
    return null;
  });
}

// Map of local name → English name (falls back to the local name). Two lookups at a time to stay polite.
export async function resolveEnglishNames(names) {
  const out = {};
  // Only names not already in Latin script need looking up (keeps Wikidata calls, and throttling, down).
  const todo = names.filter(n => n && n.length >= 2 && !isLatinScript(n)).slice(0, 20); // cap Wikidata calls per trip
  for (const n of names) if (!todo.includes(n)) out[n] = n;
  for (let i = 0; i < todo.length; i += 2) {
    await Promise.all(todo.slice(i, i + 2).map(async n => { out[n] = (await wikidataEnglishName(n)) || n; }));
  }
  return out;
}

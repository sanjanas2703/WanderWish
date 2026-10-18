// Itinerary generation, run on the server so the Geoapify key never reaches the browser.
// Moved from public/app.js unchanged apart from imports.
import { COUNTRY_COORDS, COUNTRY_CURRENCIES, CATEGORY_DURATIONS } from "../../shared/data.js";
import { INTEREST_CATEGORIES, CATEGORY_INDOOR, TYPE_MAP, themeLabels, GENERIC_ACTIVITIES } from "../data.js";
import { haversineDist, isLatinScript, getActivitySgdCost } from "../../shared/geo.js";
import { estimateTravelTime, formatTravelTime, nearestNeighborOrder, getTripDates } from "../geo.js";
import { getPlaces } from "./geoapify.js";
import { getWeather } from "./weather.js";
import { resolveEnglishNames } from "./wikipedia.js";
import { describeStops, significance } from "./describe.js";

export async function generateItinerary(types, country, budgetTier, pace, numDays, startDate) {
  const coords = COUNTRY_COORDS[country];
  if (!coords) return buildFallbackItinerary(types, budgetTier, pace, numDays);
  const [lat, lon] = coords;
  const paceCfg = { relaxed: { min: 1, max: 2 }, balanced: { min: 2, max: 3 }, adventurous: { min: 3, max: 4 } };
  const { min: minPerDay, max: maxPerDay } = paceCfg[pace] || paceCfg.balanced;
  const primaryCats = new Set();
  for (const type of types) for (const c of (INTEREST_CATEGORIES[type] || [])) primaryCats.add(c);
  const FALLBACKS = { cultural:["tourism.sights","culture.museum","culture.historic","religion","entertainment","commercial"], nature:["leisure.park","leisure.nature_reserve","national_park","tourism.sights","beach"], food:["catering.restaurant","catering.cafe","fast_food","food_court","commercial.marketplace"], adventure:["sport","leisure","activity","tourism.sights","entertainment"], tropical:["beach","leisure.park","tourism.sights","catering.restaurant"], historical:["culture.museum","culture.historic","religion","tourism.sights","entertainment"], cold:["sport","leisure.park","tourism.sights","catering.cafe"], shopping:["commercial.shopping_mall","commercial.marketplace","commercial","catering.restaurant"], nightlife:["catering.bar","catering.pub","catering.nightclub","entertainment"], wellness:["leisure","catering.cafe","leisure.park","accommodation.spa"], family:["tourism.sights","leisure.park","catering.restaurant","entertainment"], solo:["tourism.sights","catering.cafe","culture.museum","leisure.park"], business:["catering.restaurant","commercial","accommodation"] };
  const typeKeys = [...new Set(types.map(t => TYPE_MAP[t] || "historical"))];
  async function fetchPlaces(categories, limit) { const r=[]; const b=3; for(let i=0;i<[...categories].length;i+=b){const batch=[...categories].slice(i,i+b);const p=await getPlaces(lat,lon,batch,limit||15);if(p?.length)r.push(...p)} return r; }
  function dedup(places) { const s=new Set();return places.filter(p=>{const k=p.name+"_"+p.lat+"_"+p.lon;if(s.has(k))return false;s.add(k);return true;}); }
  // A wide pool (100 per search) so the significance ranking has famous places to choose from.
  let allPlaces = dedup(await fetchPlaces(primaryCats, 100));
  const needed = Math.max(numDays * minPerDay, 6);
  if (allPlaces.length < needed) { const fc = new Set(); for (const tk of typeKeys) for (const c of (FALLBACKS[tk]||FALLBACKS.cultural)) fc.add(c); allPlaces.push(...dedup(await fetchPlaces(fc, 20))); allPlaces = dedup(allPlaces); }
  if (allPlaces.length < needed) { allPlaces.push(...dedup(await fetchPlaces(new Set(["tourism.sights","entertainment","catering.restaurant"]), 30))); allPlaces = dedup(allPlaces); }
  if (allPlaces.length === 0) return buildFallbackItinerary(types, budgetTier, pace, numDays);
  // Prefer significant places (Wikidata/Wikipedia links, historic or religious sites) over minor markers,
  // keeping a pool of the best candidates. Low scorers are only used if there aren't enough others.
  const wanted = Math.min(maxPerDay * numDays, Math.max(needed, allPlaces.length));
  allPlaces.forEach((p, i) => { p._score = significance(p); p._i = i; });
  allPlaces.sort((a, b) => b._score - a._score || a._i - b._i);
  const decent = allPlaces.filter(p => p._score >= 0);
  allPlaces = (decent.length >= wanted ? decent : allPlaces).slice(0, Math.max(wanted * 2, needed));
  // Places with a Wikidata id get their English name later (describeStops), so only look up the rest.
  const nameMap = await resolveEnglishNames([...new Set(allPlaces.filter(p => !p.tags?.wikidata).map(p=>p.name).filter(Boolean))]);
  for (const p of allPlaces) { p.localName = p.localName || p.name; if (nameMap[p.name] && nameMap[p.name] !== p.name) p.name = nameMap[p.name]; }
  const latinCount = allPlaces.filter(p => isLatinScript(p.name)).length;
  if (latinCount >= needed && latinCount < allPlaces.length) allPlaces = allPlaces.filter(p => isLatinScript(p.name));
  for (const p of allPlaces) { if (!isLatinScript(p.name) && !p.tags?.wikidata) { const cl = (p.categories.map(c=>c.split(".").pop()).filter(Boolean)[0]||"place"); const ci = p.city||""; p.name = ci ? `${cl} in ${ci}` : `local ${cl}`; p.fallbackName = true; p.name = p.name.charAt(0).toUpperCase() + p.name.slice(1); } }
  // Take the best-scoring places, then order them by distance so each day's stops are close together.
  allPlaces.sort((a, b) => b._score - a._score || a._i - b._i);
  const usable = nearestNeighborOrder(allPlaces.slice(0, Math.min(maxPerDay * numDays, Math.max(needed, allPlaces.length))));
  const dates = getTripDates(numDays, startDate);
  const weatherData = await getWeather(lat, lon, dates[0], dates[dates.length - 1]);
  const perDay = Array.from({length: numDays}, () => []);
  let idx = 0;
  for (let d = 0; d < numDays; d++) { while (perDay[d].length < minPerDay && idx < usable.length) perDay[d].push(usable[idx++]); }
  for (let d = 0; d < numDays && idx < usable.length; d++) { while (perDay[d].length < maxPerDay && idx < usable.length) perDay[d].push(usable[idx++]); }
  if (weatherData) {
    for (let d = 0; d < numDays; d++) { if (!weatherData[d]?.isBad) continue; const outdoor = perDay[d].filter(p => !p.categories.some(c => CATEGORY_INDOOR?.has(c))); if (!outdoor.length) continue; for (let fd = d+1; fd < numDays; fd++) { if (weatherData[fd]?.isBad) continue; const si = perDay[fd].filter(p => p.categories.some(c => CATEGORY_INDOOR?.has(c))); if (!si.length) continue; const sc = Math.min(outdoor.length, si.length); for(let s=0;s<sc;s++){const oi=perDay[d].indexOf(outdoor[s]);const ii=perDay[fd].indexOf(si[s]);if(oi>=0&&ii>=0){const t=perDay[d][oi];perDay[d][oi]=perDay[fd][ii];perDay[fd][ii]=t;}} break; } }
    for (let d = 0; d < numDays; d++) { if (perDay[d].length >= 2) perDay[d] = nearestNeighborOrder(perDay[d]); }
  }
  const tc = {}; for (const tk of typeKeys) tc[tk] = 0;
  const plans = []; let gai = 0;
  for (let d = 0; d < numDays; d++) {
    const fkt = typeKeys[d % typeKeys.length]; const ft = types.find(t => (TYPE_MAP[t]||"historical") === fkt) || types[0] || "cultural";
    const theme = (themeLabels[fkt]||["Explore"])[tc[fkt] % (themeLabels[fkt]||["Explore"]).length]; tc[fkt]++;
    const dayPlaces = perDay[d]; const mainArea = dayPlaces.length > 0 ? dayPlaces[0].city || dayPlaces[0].address || country : country;
    const acts = dayPlaces.map(p => { const cat = p.categories[0]||"tourism.sights"; const dur = CATEGORY_DURATIONS[p.categories.find(c=>CATEGORY_DURATIONS[c])]||CATEGORY_DURATIONS[cat]||CATEGORY_DURATIONS.default; return { name:p.name, title:p.name, localName:p.localName&&p.localName!==p.name?p.localName:null, desc:`Visit ${p.name}.`, loc:p.address||p.city||country, dur, cost:"", lat:p.lat, lon:p.lon, categories:p.categories, isIndoor:p.categories.some(c=>CATEGORY_INDOOR?.has(c)), note:"", tags:p.tags||{}, fallbackName:!!p.fallbackName }; });
    for (const a of acts) a.cost = getActivitySgdCost(a.categories).display;
    const slots = { morning:[], afternoon:[], evening:[] }; let si = 0;
    for (const a of acts) { const s = ["morning","afternoon","evening"][si % 3]; slots[s].push(a); a._globalIdx = gai++; si++; }
    for (const s of ["morning","afternoon","evening"]) { const as = slots[s]; for (let i=0;i<as.length;i++) { const a=as[i]; const prev=i>0?as[i-1]:null; if(prev?.lat&&prev?.lon&&a?.lat&&a?.lon) a.trans=formatTravelTime(estimateTravelTime(haversineDist(prev.lat,prev.lon,a.lat,a.lon)).min); } }
    const so = ["morning","afternoon","evening"];
    for (let i=1;i<so.length;i++) { const pa=slots[so[i-1]]; const ca=slots[so[i]]; if(pa.length>0&&ca.length>0&&pa[pa.length-1]?.lat&&pa[pa.length-1]?.lon&&ca[0]?.lat&&ca[0]?.lon) ca[0]._prevTrans=formatTravelTime(estimateTravelTime(haversineDist(pa[pa.length-1].lat,pa[pa.length-1].lon,ca[0].lat,ca[0].lon)).min); }
    plans.push({ day:d+1, area:mainArea, theme, typeLabel:ft, weatherTag:weatherData?.[d]?`${weatherData[d].icon} ${weatherData[d].temp}°C`:"", weather:weatherData?.[d]||null, date:dates[d], slots });
  }
  // Real descriptions for historic and culturally significant places; "Visit X." stays for the rest.
  const allStops = plans.flatMap(p => ["morning", "afternoon", "evening"].flatMap(s => p.slots[s] || []));
  await describeStops(allStops).catch(e => console.error("[describe]", e.message));
  for (const a of allStops) { delete a.tags; delete a.fallbackName; }
  return { plans, currency: COUNTRY_CURRENCIES[country]||"SGD", dates };
}

export function buildFallbackItinerary(types, budgetTier, pace, numDays) {
  const paceCfg = { relaxed: { min: 1, max: 2 }, balanced: { min: 2, max: 3 }, adventurous: { min: 3, max: 4 } };
  const { min: minPerDay, max: maxPerDay } = paceCfg[pace] || paceCfg.balanced;
  const typeKeys = [...new Set(types.map(t => TYPE_MAP[t] || "historical"))]; const tcnt = {}; for (const t of typeKeys) tcnt[t] = 0;
  const pool = {}; for (const type of types) { const tk = TYPE_MAP[type]||"historical"; const acts = GENERIC_ACTIVITIES[tk]||[]; if (acts.length) pool[tk] = acts.map(a=>({...a,area:"Local Highlights",_type:type,_typeKey:tk})); }
  const all = []; for (const acts of Object.values(pool)) all.push(...acts);
  const perDay = Array.from({length:numDays},()=>[]); let idx=0;
  for (let r=0;r<minPerDay;r++) for(let d=0;d<numDays;d++) if(idx<all.length) perDay[d].push({...all[idx++]});
  for (let d=0;d<numDays&&idx<all.length;d++) while(perDay[d].length<maxPerDay&&idx<all.length) perDay[d].push({...all[idx++]});
  for (let d=0;d<numDays&&perDay[d].length<minPerDay;d++) while(perDay[d].length<minPerDay) { const r = all[idx%all.length]; perDay[d].push({...r,title:r.title+" (explore)"}); idx++; }
  const plans = []; const sn = ["morning","afternoon","evening"];
  for (let d=0;d<numDays;d++) { const fkt=typeKeys[d%typeKeys.length]; const ft=types.find(t=>(TYPE_MAP[t]||"historical")===fkt)||types[0]||"cultural"; const tl=themeLabels[fkt]||["Explore"]; const theme=tl[tcnt[fkt]%tl.length]; tcnt[fkt]++; const slots={morning:[],afternoon:[],evening:[]}; for(let a=0;a<perDay[d].length;a++){const sn2=sn[a%3];slots[sn2].push(perDay[d][a]);} plans.push({day:d+1,area:"Local Highlights",theme,typeLabel:ft,weatherTag:"",weather:null,date:"",slots}); }
  return { plans, currency:"SGD", dates:[] };
}


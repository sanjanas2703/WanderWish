// Stop descriptions: real descriptions for significant places, "Visit X." for the rest.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { describeStops, describeFromTags, firstSentences, sources } from "../server/services/describe.js";

const stop = (title, extra = {}) => ({ title, name: title, desc: `Visit ${title}.`, lat: 41.8925, lon: 12.4853, tags: {}, ...extra });
let calls;
beforeEach(() => {
  calls = [];
  sources.entities = async ids => { calls.push(["entities", ids]); return {
    Q10285: { label: "Colosseum", description: "ancient amphitheatre in Rome, Italy", enwiki: "Colosseum" },
    Q3801606: { label: "Hypogeum of the Aurelii", description: "archaeological site in Rome", enwiki: null },
    Q999: { label: "Senso-ji", description: "Buddhist temple in Tokyo", enwiki: "Sensō-ji" },
    Q1083: { label: "Galeria", description: "protected area in Italy (EUAP1083)", enwiki: null }
  }; };
  sources.summary = async title => { calls.push(["summary", title]); return {
    "Colosseum": { extract: "The Colosseum is an elliptical amphitheatre in the centre of the city of Rome, Italy. It is the largest ancient amphitheatre ever built. Construction began under Vespasian in AD 72.", url: "https://en.wikipedia.org/wiki/Colosseum", type: "standard", coords: { lat: 41.8902, lon: 12.4922 } },
    "Sensō-ji": { extract: "Sensō-ji is an ancient Buddhist temple located in Asakusa, Tokyo.", url: "https://en.wikipedia.org/wiki/Sens%C5%8D-ji", type: "standard", coords: { lat: 35.7148, lon: 139.7967 } },
    "Trevi Fountain": { extract: "The Trevi Fountain is an 18th-century fountain in the Trevi district in Rome.", url: "https://en.wikipedia.org/wiki/Trevi_Fountain", type: "standard", coords: { lat: 41.9009, lon: 12.4833 } },
    "Central Park": { extract: "Central Park is an urban park in New York City.", url: "https://en.wikipedia.org/wiki/Central_Park", type: "standard", coords: { lat: 40.78, lon: -73.97 } },
    "Mercury": { extract: "Mercury may refer to:", url: "x", type: "disambiguation", coords: null }
  }[title] || null; };
  sources.foreign = async (lang, title) => { calls.push(["foreign", lang, title]); return lang === "it" && title === "Fontana di Trevi" ? { enTitle: "Trevi Fountain", wikidata: null } : null; };
});

test("a place with a Wikidata id gets its English Wikipedia description and a source link", async () => {
  const [s] = await describeStops([stop("Anfiteatro Flavio", { tags: { wikidata: "Q10285" } })]);
  assert.equal(s.desc, "The Colosseum is an elliptical amphitheatre in the centre of the city of Rome, Italy. It is the largest ancient amphitheatre ever built.");
  assert.equal(s.descUrl, "https://en.wikipedia.org/wiki/Colosseum");
});

test("without an English article, Wikidata's English description is used", async () => {
  const [s] = await describeStops([stop("Ipogeo degli Aureli", { tags: { wikidata: "Q3801606", historic: "archaeological_site" } })]);
  assert.equal(s.desc, "Archaeological site in Rome.");
  assert.equal(s.descUrl, undefined);
});

test("codes are dropped from Wikidata descriptions", async () => {
  const [s] = await describeStops([stop("Galeria", { tags: { wikidata: "Q1083" } })]);
  assert.equal(s.desc, "Protected area in Italy.");
});

test("a foreign-language Wikipedia tag is followed to the English article", async () => {
  const [s] = await describeStops([stop("Fontana di Trevi", { lat: 41.9009, lon: 12.4833, tags: { wikipedia: "it:Fontana di Trevi" } })]);
  assert.match(s.desc, /^The Trevi Fountain is an 18th-century fountain/);
});

test("placeholder and non-English names are replaced by the English Wikidata label", async () => {
  const [a, b] = await describeStops([
    stop("Tourism in Taito", { fallbackName: true, tags: { wikidata: "Q999" } }),
    stop("浅草寺", { tags: { wikidata: "Q999" } })
  ]);
  assert.deepEqual([a.title, b.title], ["Senso-ji", "Senso-ji"]);
  assert.match(a.desc, /ancient Buddhist temple/);
});

test("a same-name article is only used if it's within 1.5 km (no wrong matches)", async () => {
  const [near, far, disamb] = await describeStops([
    stop("Trevi Fountain", { lat: 41.9010, lon: 12.4834 }),
    stop("Central Park", { lat: 41.9, lon: 12.49 }),              // a "Central Park" in Rome is not the one in New York
    stop("Mercury")
  ]);
  assert.match(near.desc, /Trevi Fountain is an 18th-century fountain/);
  assert.equal(far.desc, "Visit Central Park.");
  assert.equal(disamb.desc, "Visit Mercury.");
});

test("historic or religious places without an article get a factual description from their tags", async () => {
  const [shrine, castle, plaque, cafe] = await describeStops([
    stop("Kanda Shrine", { tags: { amenity: "place_of_worship", religion: "shinto", start_date: "1764" } }),
    stop("Burg", { tags: { historic: "castle", heritage: "2" } }),
    stop("Plaque", { tags: { historic: "memorial" } }),
    stop("Nice Café")
  ]);
  assert.equal(shrine.desc, "A Shinto shrine, built in 1764.");
  assert.equal(castle.desc, "A historic castle, listed as a heritage site.");
  assert.equal(plaque.desc, "Visit Plaque.", "memorial plaques are not 'significant'");
  assert.equal(cafe.desc, "Visit Nice Café.", "ordinary places keep the simple description");
});

test("placeholder names never trigger a name search", async () => {
  await describeStops([stop("Tourism in Yokohama", { fallbackName: true })]);
  assert.ok(!calls.some(c => c[0] === "summary"));
});

test("helpers", () => {
  assert.equal(firstSentences("Rome (Italian: Roma) is the capital of Italy. It has 2.8 million residents. A third sentence."), "Rome is the capital of Italy. It has 2.8 million residents.");
  assert.ok(firstSentences("A ".repeat(300) + ".").length <= 261);
  assert.equal(describeFromTags({ amenity: "place_of_worship", religion: "muslim" }), "A mosque.");
  assert.equal(describeFromTags({ historic: "archaeological_site", start_date: "c. 100" }), "An archaeological site, built in 100.");
  assert.equal(describeFromTags({ historic: "boundary_stone" }), null);
});

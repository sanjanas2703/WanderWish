// "Surprise me": random country from the chosen region, preferring ones the user hasn't planned yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSurprise } from "../public/geo.js";
import { REGIONS } from "../public/data.js";
import { COUNTRY_COORDS } from "../shared/data.js";

test("picks only from the given region", () => {
  const pool = REGIONS["Southeast Asia"].countries;
  for (let i = 0; i < 50; i++) assert.ok(pool.includes(pickSurprise(pool)));
});

test("prefers countries the user hasn't planned, falls back when they've done them all", () => {
  const pool = ["Japan", "South Korea", "China", "Taiwan"];
  for (let i = 0; i < 50; i++) assert.equal(pickSurprise(pool, ["Japan", "South Korea", "China"]), "Taiwan");
  assert.ok(pool.includes(pickSurprise(pool, pool)));
  assert.equal(pickSurprise([]), null);
});

test("covers the whole region (uses the random source evenly)", () => {
  const pool = ["A", "B", "C"];
  assert.deepEqual([0, 0.34, 0.99].map(r => pickSurprise(pool, [], () => r)), ["A", "B", "C"]);
});

test("every country in every region can be generated (has coordinates)", () => {
  for (const r of Object.values(REGIONS)) for (const c of r.countries) assert.ok(COUNTRY_COORDS[c], c);
});

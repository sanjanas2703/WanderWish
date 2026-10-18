// Browser-only helpers: the budget estimate and "Surprise me".
// The relative import also resolves to /shared/data.js in the browser.

import { COUNTRY_CURRENCIES } from "../shared/data.js";
import { DAILY_BUDGET } from "./data.js";

export function getDailyBudget(country, tier) {
  const entry = DAILY_BUDGET[country];
  if (!entry) return { local: 0, currency: "SGD" };
  const amount = entry[tier] || entry.midrange || 0;
  const currency = COUNTRY_CURRENCIES[country] || "SGD";
  return { local: amount, currency };
}

// "Surprise me": a random country from `pool`, preferring ones not in `avoid` (e.g. countries the user already
// has trips for). `rand` is injectable for tests.
export function pickSurprise(pool, avoid = [], rand = Math.random) {
  if (!pool?.length) return null;
  const fresh = pool.filter(c => !avoid.includes(c));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(rand() * from.length)];
}

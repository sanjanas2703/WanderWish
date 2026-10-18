// Pure helpers used by both the server and the browser (no network access).

import { ACTIVITY_CATEGORY_COST_SGD } from "./data.js";

export function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isLatinScript(s) {
  return /^[a-zA-Z0-9\s.,\-'&/()!?":;@#$%*+=[\]{}|<>^~`]+$/.test(s);
}

export function getActivitySgdCost(categories) {
  if (!categories || categories.length === 0) return { min: 0, max: 0, display: "Free" };
  let bestScore = 0;
  let bestRange = ACTIVITY_CATEGORY_COST_SGD.default;
  for (const cat of categories) {
    for (const [key, range] of Object.entries(ACTIVITY_CATEGORY_COST_SGD)) {
      if (cat === key || cat.startsWith(key)) {
        const score = key.split(".").length;
        if (score > bestScore) {
          bestScore = score;
          bestRange = range;
        }
      }
    }
  }
  const [min, max] = bestRange;
  if (min === 0 && max === 0) return { min: 0, max: 0, display: "Free" };
  if (min === max) return { min, max, display: `~SGD ${min}` };
  return { min, max, display: `~SGD ${min}–${max}` };
}

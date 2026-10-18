// Server-only helpers for itinerary generation and weather (no network access).

import { haversineDist } from "../shared/geo.js";

export function estimateTravelTime(distKm) {
  if (distKm < 1) return { mode: "walk", min: Math.ceil(distKm / 5 * 60) };
  if (distKm < 3) return { mode: "walk", min: Math.ceil(distKm / 5 * 60) };
  if (distKm < 15) return { mode: "drive", min: Math.ceil(distKm / 35 * 60) };
  return { mode: "drive", min: Math.ceil(distKm / 60 * 60) };
}

export function formatTravelTime(min) {
  if (min < 1) return "1min";
  if (min <= 15) return `${min}min`;
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? m + "min" : ""}`;
}

export function nearestNeighborOrder(places) {
  if (!places || places.length <= 1) return places || [];
  const ordered = [];
  const remaining = [...places];
  let current = remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0];
  ordered.push(current);

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = haversineDist(current.lat, current.lon, remaining[0].lat, remaining[0].lon);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineDist(current.lat, current.lon, remaining[i].lat, remaining[i].lon);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    current = remaining.splice(nearestIdx, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

export function isRainy(code) {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

export function isSnowy(code) {
  return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
}

export function isBadWeather(code) {
  return isRainy(code) || isSnowy(code) || code === 45 || code === 48;
}

export function getTripDates(days, startStr) {
  const start = startStr ? new Date(startStr + "T12:00:00Z") : new Date();
  if (!startStr) start.setUTCDate(start.getUTCDate() + 3);
  return Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().split("T")[0]; });
}

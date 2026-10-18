// Open-Meteo daily forecast (free, non-commercial, no key; see docs/costs.md).
import { cached, fetchJson } from "./http.js";
import { WEATHER_CODES } from "../data.js";
import { isBadWeather, isRainy, isSnowy } from "../geo.js";

export async function getWeather(lat, lon, startDate, endDate) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=auto&start_date=${startDate}&end_date=${endDate}`;
  return cached(`wx|${lat}|${lon}|${startDate}|${endDate}`, 1800_000, async () => {
    const data = await fetchJson(url);
    const d = data?.daily;
    if (!d?.time) return null;
    return d.time.map((date, i) => {
      const code = d.weathercode?.[i] || 0;
      const wc = WEATHER_CODES[code] || { icon: "", label: "Unknown" };
      const tempMax = d.temperature_2m_max?.[i] || 0, tempMin = d.temperature_2m_min?.[i] || 0;
      return {
        date, tempMax, tempMin, temp: Math.round((tempMax + tempMin) / 2),
        precip: d.precipitation_sum?.[i] || 0, precipProb: d.precipitation_probability_max?.[i] || 0,
        weatherCode: code, icon: wc.icon, label: wc.label,
        isBad: isBadWeather(code), isRainy: isRainy(code), isSnowy: isSnowy(code)
      };
    });
  });
}

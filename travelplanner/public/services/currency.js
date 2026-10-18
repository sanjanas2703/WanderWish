async function getExchangeRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;
  toCurrency = toCurrency || "SGD";

  return cached("fx_" + fromCurrency + "_" + toCurrency, 3600000, async () => {
    try {
      const url = `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(fromCurrency)}/${encodeURIComponent(toCurrency)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.rate === "number" ? data.rate : null;
    } catch {
      return null;
    }
  });
}

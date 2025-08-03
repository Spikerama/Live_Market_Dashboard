const FRED_KEY = process.env.FRED_KEY;
const FMP_KEY = process.env.FMP_KEY;
const SP500_TO_TOTAL_MULTIPLIER = 1.30; // adjust later if needed

if (!FRED_KEY) {
  exports.handler = async () => ({
    statusCode: 500,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'FRED_KEY not set in environment.' }),
  });
  return;
}
if (!FMP_KEY) {
  exports.handler = async () => ({
    statusCode: 500,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'FMP_KEY not set in environment.' }),
  });
  return;
}

// Utility: get latest valid observation from FRED
async function fetchLatestValidFred(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for ${seriesId}`);
  const json = await res.json();
  const obs = json?.observations;
  if (!Array.isArray(obs) || obs.length === 0) throw new Error(`No data for ${seriesId}`);
  for (const o of obs) {
    const v = o.value;
    if (v === '.' || v === null || v === undefined) continue;
    const parsed = parseFloat(v);
    if (!isNaN(parsed)) return parsed;
  }
  throw new Error(`No valid observation for ${seriesId}`);
}

// List of large S&P500 constituents (approx top ~50 by market cap) de-duplicated
const TICKERS = Array.from(new Set([
  "AAPL","MSFT","NVDA","GOOGL","GOOG","AMZN","BRK-B","META","TSLA","UNH",
  "LLY","JPM","JNJ","V","PG","HD","MA","CVX","XOM","PFE",
  "ABT","KO","PEP","MRK","ADBE","CMCSA","CRM","AVGO","ORCL","WMT",
  "MCD","NKE","CSCO","NFLX","COST","TMO","ABNB","ACN","INTC","TXN",
  "HON","MDT","SCHW","BMY","SBUX","AMGN","QCOM","RTX","LOW"
]));

// Fetch and sum market caps of the constituents
async function fetchSP500CapTopConstituents() {
  let totalCap = 0;
  for (const symbol of TICKERS) {
    try {
      const profileUrl = `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}`;
      const res = await fetch(profileUrl);
      if (!res.ok) continue; // skip if fails
      const json = await res.json();
      if (!Array.isArray(json) || json.length === 0) continue;
      const profile = json[0];
      const mc = profile.marketCap;
      if (typeof mc === 'number' && mc > 0) {
        totalCap += mc;
      }
      // be gentle on rate limits: small delay (optional)
      await new Promise(r => setTimeout(r, 100)); // 100ms pause between calls
    } catch {
      // ignore per-symbol failure
    }
  }
  if (totalCap === 0) throw new Error('Failed to aggregate any constituent market caps');
  return totalCap / 1e9; // convert to billions
}

exports.handler = async function () {
  try {
    const sp500CapBillions = await fetchSP500CapTopConstituents(); // large-cap proxy
    const estimatedTotalMarketCapBillions = parseFloat((sp500CapBillions * SP500_TO_TOTAL_MULTIPLIER).toFixed(2));
    const gdpBillions = await fetchLatestValidFred('GDP');
    if (gdpBillions === 0) throw new Error('GDP returned zero');

    const ratio = parseFloat(((estimatedTotalMarketCapBillions / gdpBillions) * 100).toFixed(2));
    const overvalued = ratio > 120;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        ratio,
        overvalued,
        estimatedTotalMarketCapBillions,
        sp500CapBillions,
        gdpBillions,
        multiplierUsed: SP500_TO_TOTAL_MULTIPLIER,
        source: 'Top constituents (FMP) scaled / FRED GDP',
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }),
    };
  }
};

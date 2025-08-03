// NOTE: This is the trimmed version (top 15 by market cap) to reduce FMP free-tier pressure.
// Reminder: restore the fuller constituent list later to improve accuracy (you asked to keep the backup in mind).

const FRED_KEY = process.env.FRED_KEY;
const FMP_KEY = process.env.FMP_KEY;
const SPY_SHARES_OUTSTANDING = 1_024_000_000;
const SP500_TO_TOTAL_MULTIPLIER = 1.30;
const TWELVE_KEY = '26137bba624c4dcb9b5284ad1b234071';

if (!FRED_KEY) {
  exports.handler = async () => ({
    statusCode: 500,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'FRED_KEY not set in environment.' }),
  });
  return;
}

// Simple in-memory cache for constituent cap (longer: 30 minutes)
let cachedConstituent = {
  timestamp: 0,
  sp500CapBillions: null,
};

// Helper to fetch latest valid FRED observation
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

// SPY fallback
async function fetchSPYBasedCap() {
  const url = `https://api.twelvedata.com/quote?symbol=SPY&apikey=${TWELVE_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status} for SPY`);
  const json = await res.json();
  if (json.status === 'error' || typeof json.close === 'undefined') {
    throw new Error('Bad SPY data fallback: ' + JSON.stringify(json).slice(0, 200));
  }
  const price = parseFloat(json.close);
  if (isNaN(price)) throw new Error('Invalid SPY price');
  const spyMarketCap = price * SPY_SHARES_OUTSTANDING;
  return spyMarketCap / 1e9; // billions
}

// Trimmed top 15 large-cap S&P500 tickers
const TICKERS = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","BRK-B","META","TSLA","UNH","JNJ",
  "V","PG","MA","XOM","JPM"
];

// Fetch with reduced pressure and caching (30 minutes)
async function fetchSP500CapTopConstituents() {
  const now = Date.now();
  if (cachedConstituent.sp500CapBillions && (now - cachedConstituent.timestamp) < 30 * 60 * 1000) {
    return cachedConstituent.sp500CapBillions;
  }
  if (!FMP_KEY) throw new Error('No FMP_KEY for constituent fetch');

  let totalCap = 0;
  // Sequential-ish with small delay to avoid burst throttling
  for (const symbol of TICKERS) {
    try {
      const profileUrl = `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}`;
      const res = await fetch(profileUrl);
      if (!res.ok) continue;
      const json = await res.json();
      if (!Array.isArray(json) || json.length === 0) continue;
      const profile = json[0];
      const mc = profile.marketCap;
      if (typeof mc === 'number' && mc > 0) {
        totalCap += mc;
      }
      // polite pause
      await new Promise(r => setTimeout(r, 100));
    } catch {
      // ignore per-symbol failure
    }
  }

  if (totalCap === 0) throw new Error('Failed to aggregate any constituent market caps');
  const capBillions = totalCap / 1e9;
  cachedConstituent = { timestamp: now, sp500CapBillions: capBillions };
  return capBillions;
}

exports.handler = async function () {
  try {
    let sp500CapBillions;
    let sourceUsed = 'unknown';

    try {
      sp500CapBillions = await fetchSP500CapTopConstituents();
      sourceUsed = 'Top trimmed constituents (FMP)';
    } catch (e) {
      console.warn('Trimmed constituent aggregation failed:', e.message);
      sp500CapBillions = await fetchSPYBasedCap();
      sourceUsed = 'SPY-based fallback';
    }

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
        source: sourceUsed,
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

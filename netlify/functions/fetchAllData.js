const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const TWELVE_KEY = process.env.TWELVE_KEY;
const FRED_KEY = process.env.FRED_KEY;
const FMP_KEY = process.env.FMP_KEY;
const SPY_SHARES_OUTSTANDING = 1_024_000_000;
const SP500_TO_TOTAL_MULTIPLIER = 1.30;

const TICKERS = ['SPY', 'TSLA', 'LIT', 'VIXY'];

async function fetchTwelveQuote(symbol) {
  const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${TWELVE_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json || json.status === 'error' || typeof json.close === 'undefined') {
    throw new Error(`Bad TwelveData for ${symbol}`);
  }
  const close = parseFloat(json.close);
  const pct = parseFloat(json.percent_change);
  return { price: close, pct };
}

async function fetchLatestFred(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  const res = await fetch(url);
  const json = await res.json();
  const obs = json?.observations;
  for (const o of obs) {
    const v = parseFloat(o.value);
    if (!isNaN(v)) return v;
  }
  throw new Error(`No valid FRED data for ${seriesId}`);
}

async function fetchYieldSpread() {
  const [y10, y2] = await Promise.all([
    fetchLatestFred('DGS10'),
    fetchLatestFred('DGS2'),
  ]);
  return {
    spread: parseFloat((y10 - y2).toFixed(2)),
    inverted: y10 < y2,
    components: { '10Y': y10, '2Y': y2 }
  };
}

async function fetchSP500CapTopConstituents() {
  let totalCap = 0;
  for (const symbol of [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "BRK-B", "META", "TSLA", "UNH",
    "JNJ", "V", "PG", "MA", "XOM", "JPM"
  ]) {
    try {
      const url = `https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${FMP_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json[0]?.marketCap) totalCap += json[0].marketCap;
    } catch { /* ignore */ }
  }
  if (totalCap === 0) throw new Error('Total SP500 cap = 0');
  return totalCap / 1e9;
}

async function fetchBuffettRatio() {
  let sp500CapBillions;
  try {
    sp500CapBillions = await fetchSP500CapTopConstituents();
  } catch {
    const spy = await fetchTwelveQuote('SPY');
    sp500CapBillions = (spy.price * SPY_SHARES_OUTSTANDING) / 1e9;
  }
  const totalCap = sp500CapBillions * SP500_TO_TOTAL_MULTIPLIER;
  const gdp = await fetchLatestFred('GDP');
  const ratio = parseFloat(((totalCap / gdp) * 100).toFixed(2));
  return { ratio, totalCap, gdp };
}

exports.handler = async () => {
  try {
    const now = new Date().toISOString();
    const [spy, tsla, lit, vixy] = await Promise.all(TICKERS.map(fetchTwelveQuote));
    const yieldData = await fetchYieldSpread();
    const buffettData = await fetchBuffettRatio();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        spy, tsla, lit, vixy,
        yield: yieldData,
        buffett: buffettData,
        timestamp: now
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, timestamp: new Date().toISOString() })
    };
  }
};

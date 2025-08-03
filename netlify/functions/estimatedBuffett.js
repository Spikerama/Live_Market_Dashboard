const FRED_KEY = process.env.FRED_KEY;
const SPY_SHARES_OUTSTANDING = 950_000_000; // replace with the current verified number
const SPY_TO_TOTAL_MULTIPLIER = 1.30; // scaling from S&P 500 proxy to total US equity cap

if (!FRED_KEY) {
  exports.handler = async () => ({
    statusCode: 500,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'FRED_KEY not set in environment.' }),
  });
  return;
}

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

// Get SPY price from TwelveData (you already have the key baked into frontend;
// here we can call the same API or optionally have the frontend pass SPY market cap in, but for self-contained:
const TWELVE_KEY = '26137bba624c4dcb9b5284ad1b234071'; // keep synced with frontend if needed

async function fetchSPYPrice() {
  const url = `https://api.twelvedata.com/quote?symbol=SPY&apikey=${TWELVE_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status} for SPY`);
  const json = await res.json();
  if (json.status === 'error' || typeof json.close === 'undefined') {
    throw new Error(`Bad SPY data: ${JSON.stringify(json).slice(0,200)}`);
  }
  return parseFloat(json.close);
}

exports.handler = async function () {
  try {
    const spyPrice = await fetchSPYPrice(); // in USD
    const spyMarketCap = spyPrice * SPY_SHARES_OUTSTANDING; // in USD
    const spyMarketCapBillions = spyMarketCap / 1e9;

    const estimatedTotalMarketCapBillions = parseFloat((spyMarketCapBillions * SPY_TO_TOTAL_MULTIPLIER).toFixed(2));

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
        spyMarketCapBillions,
        gdpBillions,
        multiplierUsed: SPY_TO_TOTAL_MULTIPLIER,
        source: 'SPY-derived (TwelveData) / FRED GDP',
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

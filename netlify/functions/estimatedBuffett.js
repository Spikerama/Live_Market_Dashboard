const FRED_KEY = process.env.FRED_KEY;
const FMP_KEY = process.env.FMP_KEY;
const SP500_TO_TOTAL_MULTIPLIER = 1.30; // adjust later if you refine scaling

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

// Sum market caps of top N S&P 500 constituents (free tier friendly)
async function fetchSP500CapTopN(n = 50) {
  const constituentsUrl = `https://financialmodelingprep.com/api/v3/sp500_constituent?apikey=${FMP_KEY}`;
  const consRes = await fetch(constituentsUrl);
  if (!consRes.ok) throw new Error(`FMP HTTP ${consRes.status} fetching constituents`);
  const constituents = await consRes.json();
  if (!Array.isArray(constituents) || constituents.length === 0) throw new Error('No S&P500 constituents data');

  const topList = constituents.slice(0, n); // take first N; could be refined by weight if available
  let totalCap = 0;

  // sequential to be gentle on rate limits (could be parallelized with throttling)
  for (const item of topList) {
    const symbol = item.symbol || item.ticker || item;
    try {
      const profileUrl = `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}`;
      const profRes = await fetch(profileUrl);
      if (!profRes.ok) continue; // skip failures silently
      const profJson = await profRes.json();
      if (!Array.isArray(profJson) || profJson.length === 0) continue;
      const profile = profJson[0];
      const mc = profile.marketCap;
      if (typeof mc === 'number' && mc > 0) {
        totalCap += mc;
      }
    } catch {
      // ignore individual symbol errors
    }
  }

  if (totalCap === 0) throw new Error('Failed to aggregate any market cap from top constituents');

  // Convert to billions USD
  return totalCap / 1e9;
}

exports.handler = async function () {
  try {
    // Estimate S&P 500 cap from top constituents
    const sp500CapBillions = await fetchSP500CapTopN(50); // top 50
    const estimatedTotalMarketCapBillions = parseFloat((sp500CapBillions * SP500_TO_TOTAL_MULTIPLIER).toFixed(2));

    // Fetch GDP (nominal, billions USD)
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
        source: 'Top-50 S&P500 constituents (FMP) scaled / FRED GDP',
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

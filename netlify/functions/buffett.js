const FRED_KEY = process.env.FRED_KEY || 'a5d70f8bbdfae3f817b5fadc98de8e8c';

// helper to get latest valid observation (skips '.' placeholders)
async function fetchLatest(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED fetch failed for ${seriesId}: ${res.status}`);
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

exports.handler = async function () {
  try {
    // Wilshire 5000 total market cap and nominal GDP
    const [marketCap, gdp] = await Promise.all([
      fetchLatest('WILL5000INDFC'),
      fetchLatest('GDP')
    ]);

    // Buffett Indicator = (Market Cap / GDP) * 100
    const ratio = parseFloat(((marketCap / gdp) * 100).toFixed(2));
    // Simple overvaluation flag: over 120% is elevated
    const overvalued = ratio > 120;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        ratio, // percentage
        overvalued,
        marketCap,
        gdp,
        source: 'FRED',
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

const FRED_KEY = process.env.FRED_KEY;
if (!FRED_KEY) {
  exports.handler = async () => ({
    statusCode: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      error: 'FRED_KEY not set in environment. Configure FRED_KEY in Netlify env vars.',
    }),
  });
  return;
}

async function fetchLatestValid(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error fetching ${seriesId}: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`FRED HTTP ${res.status} for series ${seriesId}`);
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(`Invalid JSON from FRED for ${seriesId}: ${err.message}`);
  }
  const obs = json?.observations;
  if (!Array.isArray(obs) || obs.length === 0) {
    throw new Error(`No observations array or empty for ${seriesId}`);
  }
  for (const o of obs) {
    const v = o.value;
    if (v === '.' || v === null || v === undefined) continue;
    const parsed = parseFloat(v);
    if (!isNaN(parsed)) return parsed;
  }
  throw new Error(`No valid numeric observation found for ${seriesId}`);
}

exports.handler = async function () {
  try {
    // Try primary series (WILL5000INDFC). If that fails due to discontinuation, fallback to WILL5000PRFC.
    let marketCap;
    try {
      marketCap = await fetchLatestValid('WILL5000INDFC');
    } catch (e) {
      // fallback attempt
      console.warn('Primary Wilshire 5000 series failed, falling back to WILL5000PRFC:', e.message);
      marketCap = await fetchLatestValid('WILL5000PRFC');
    }

    const gdp = await fetchLatestValid('GDP');

    if (gdp === 0) throw new Error('GDP returned zero, cannot divide');

    const ratio = parseFloat(((marketCap / gdp) * 100).toFixed(2));
    const overvalued = ratio > 120;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        ratio,
        overvalued,
        marketCap,
        gdp,
        source: 'FRED',
        usedSeries: marketCap && marketCap === undefined ? 'unknown' : (marketCap && marketCap === undefined ? 'unknown' : undefined),
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
      body: JSON.stringify({
        error: err.message,
        debug: 'See function logs for more detail',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

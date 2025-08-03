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

async function getLatestValid(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error fetching ${seriesId}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for ${seriesId}`);
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(`Invalid JSON from FRED for ${seriesId}: ${err.message}`);
  }
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
    const [tenY, twoY] = await Promise.all([
      getLatestValid('DGS10'),
      getLatestValid('DGS2'),
    ]);

    const spread = parseFloat((tenY - twoY).toFixed(2));
    const inverted = spread < 0;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        spread,
        inverted,
        tenY,
        twoY,
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
      body: JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }),
    };
  }
};

const FRED_KEY = process.env.FRED_KEY || 'a5d70f8bbdfae3f817b5fadc98de8e8c';

async function getLatestValid(seriesId) {
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
      body: JSON.stringify({ error: err.message }),
    };
  }
};

import fetch from 'node-fetch'; // if using standard Netlify JS functions; adjust if using Edge runtime

const FRED_KEY = process.env.FRED_KEY;
if (!FRED_KEY) {
  console.warn('FRED_KEY not set in environment');
}

const fetchLatestObservation = async (series_id) => {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series_id}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for series ${series_id}`);
  const json = await res.json();
  if (!json.observations || !Array.isArray(json.observations)) {
    throw new Error(`No observations array for ${series_id}`);
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  // Find first observation with a numeric value that's not in the future
  const obs = json.observations.find(o => o.value !== '.' && o.date <= todayStr);
  if (!obs) throw new Error(`No valid recent observation for ${series_id}`);
  const val = parseFloat(obs.value);
  if (isNaN(val)) throw new Error(`Parsed NaN for ${series_id} observation`);
  return val;
};

export async function handler(event) {
  try {
    const [y10, y2] = await Promise.all([
      fetchLatestObservation('DGS10'),
      fetchLatestObservation('DGS2'),
    ]);

    const spread = y10 - y2;
    const inverted = spread < 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        spread: parseFloat(spread.toFixed(2)),
        inverted,
        source: 'FRED',
        timestamp: new Date().toISOString(),
        components: { '10Y': y10, '2Y': y2 },
      }),
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
        'Content-Type': 'application/json',
      },
    };
  } catch (err) {
    console.error('yieldSpread error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}

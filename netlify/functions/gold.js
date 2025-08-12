// netlify/functions/gold.js
// Gold PM fix (USD/oz) via FRED: GOLDPMGBD228NLBM
// Returns { price, changePercent, source, timestamp }

exports.handler = async () => {
  try {
    const key = process.env.FRED_KEY;
    if (!key) throw new Error('FRED_KEY missing');

    const url = `https://api.stlouisfed.org/fred/series/observations?` +
      `series_id=GOLDPMGBD228NLBM&api_key=${key}&file_type=json&sort_order=desc&limit=25`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
    const json = await res.json();
    const obs = (json.observations || []).filter(o => o.value !== '.');

    if (obs.length < 2) throw new Error('Not enough gold observations');
    const latest = parseFloat(obs[0].value);
    const prior  = parseFloat(obs[1].value);
    if (!Number.isFinite(latest) || !Number.isFinite(prior)) throw new Error('Gold NaN');

    const changePercent = ((latest - prior) / prior) * 100;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        price: Number(latest.toFixed(2)),
        changePercent: Number(changePercent.toFixed(2)),
        source: 'FRED GOLDPMGBD228NLBM',
        timestamp: new Date().toISOString(),
      })
    };
  } catch (err) {
    console.error('gold.js error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, timestamp: new Date().toISOString() })
    };
  }
};

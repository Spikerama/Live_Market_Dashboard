// netlify/functions/gold.js
// Source: FRED daily London gold fix (PM first, fallback to AM)

export async function handler() {
  try {
    const FRED_KEY = process.env.FRED_KEY;
    if (!FRED_KEY) throw new Error('FRED_KEY missing');

    // fetch latest non-missing obs and previous one, compute % change
    async function fetchFredSeries(series_id) {
      const params = new URLSearchParams({
        series_id,
        api_key: FRED_KEY,
        file_type: 'json',
        sort_order: 'desc',
        limit: '15',
      });
      const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`FRED HTTP ${res.status} (${series_id})`);
      const json = await res.json();
      const obs = Array.isArray(json.observations) ? json.observations : [];

      const today = new Date().toISOString().slice(0, 10);
      const valid = obs.filter(o => o.value !== '.' && o.date <= today);
      if (valid.length === 0) throw new Error(`No valid observations (${series_id})`);

      const latest = valid[0];
      const prev = valid.find(o => o.date < latest.date);
      const price = Number(latest.value);
      if (!Number.isFinite(price)) throw new Error(`Bad value (${series_id})`);

      let pct = null;
      if (prev && prev.value !== '.' && Number(prev.value) > 0) {
        pct = ((price - Number(prev.value)) / Number(prev.value)) * 100;
      }
      return {
        price: Number(price.toFixed(2)),
        pct: pct == null ? null : Number(pct.toFixed(2)),
        series_id,
      };
    }

    // Try PM fix first, then AM
    let out;
    const tried = [];
    try {
      out = await fetchFredSeries('GOLDPMGBD228NLBM'); // PM fix (USD/oz)
      tried.push({ series: 'GOLDPMGBD228NLBM', ok: true });
    } catch (e1) {
      tried.push({ series: 'GOLDPMGBD228NLBM', ok: false, err: e1.message });
      out = await fetchFredSeries('GOLDAMGBD228NLBM'); // AM fix (fallback)
      tried.push({ series: 'GOLDAMGBD228NLBM', ok: true });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, must-revalidate',
      },
      body: JSON.stringify({
        price: out.price,
        pct: out.pct,
        source: `FRED ${out.series_id}`,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('gold.js error:', err);
    return {
      statusCode: 200, // keep 200 so the aggregator won’t throw; it will show "Error" if no cache
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, must-revalidate',
      },
      body: JSON.stringify({
        error: err.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

// netlify/functions/gold.js
// Gold price from FRED: try PM fix first, fallback to AM.
// Returns: { price: number, pct: number|null, source: string, timestamp: string }

export async function handler() {
  try {
    const FRED_KEY = process.env.FRED_KEY;
    if (!FRED_KEY) throw new Error('FRED_KEY missing');

    // Build an observation_start ~180 days ago to avoid huge payloads that can trigger 400s.
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 180);
    const obsStart = startDate.toISOString().slice(0, 10); // YYYY-MM-DD

    async function fetchFredSeries(series_id) {
      const params = new URLSearchParams({
        series_id,
        api_key: FRED_KEY,
        file_type: 'json',
        observation_start: obsStart,
        sort_order: 'desc',
        limit: '60', // enough to find a prior valid point
      });
      const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`FRED HTTP ${res.status} (${series_id})`);
      const json = await res.json();

      const obs = Array.isArray(json.observations) ? json.observations : [];
      // pick latest non-missing value (<= today)
      const today = new Date().toISOString().slice(0, 10);
      const valid = obs.filter(o => o.value !== '.' && o.date <= today);
      if (!valid.length) throw new Error(`No valid observations (${series_id})`);

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

    // Try PM fix first (more widely referenced), then AM as backup
    const tried = [];
    let out;
    try {
      out = await fetchFredSeries('GOLDPMGBD228NLBM'); // PM fix (USD/oz)
      tried.push({ series: 'GOLDPMGBD228NLBM', ok: true });
    } catch (e1) {
      tried.push({ series: 'GOLDPMGBD228NLBM', ok: false, err: e1.message });
      out = await fetchFredSeries('GOLDAMGBD228NLBM'); // AM fix fallback
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
    // Keep HTTP 200 so the aggregator doesn't hard-fail; the widget will show "Error" if no cache.
    return {
      statusCode: 200,
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

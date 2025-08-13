// netlify/functions/gold.js
// Gold price via FRED. Tries PM fix first, then AM.
// Returns 200 with either { price, pct, source, timestamp } or { error, _debug, timestamp }

export async function handler() {
  try {
    const FRED_KEY = process.env.FRED_KEY;
    if (!FRED_KEY) throw new Error('FRED_KEY missing');

    async function fetchFredSeriesLatest(series_id) {
      // Keep params simple but explicit; some FRED series 400 with odd defaults
      const params = new URLSearchParams({
        series_id,
        api_key: FRED_KEY,
        file_type: 'json',
        observation_start: '1990-01-01', // trim history; avoids some edge cases
        sort_order: 'desc',
        limit: '3650', // up to ~10 years of daily obs
      });

      const url = `https://api.stlouisfed.org/fred/series/observations?${params}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`FRED HTTP ${res.status} (${series_id}) ${text ? '- ' + text.slice(0,200) : ''}`);
      }
      const json = await res.json();
      const obs = Array.isArray(json?.observations) ? json.observations : [];
      if (!obs.length) throw new Error(`No observations (${series_id})`);

      // Find latest non-missing value
      const latest = obs.find(o => o && o.value !== '.');
      if (!latest) throw new Error(`No valid (non-dot) observation (${series_id})`);

      // For % change, find the *next* valid (since we sorted desc, next is prior date)
      const idx = obs.indexOf(latest);
      const prev = obs.slice(idx + 1).find(o => o && o.value !== '.');

      const price = Number(latest.value);
      if (!Number.isFinite(price)) throw new Error(`Bad value (${series_id})`);

      let pct = null;
      if (prev && Number(prev.value) > 0) {
        pct = ((price - Number(prev.value)) / Number(prev.value)) * 100;
      }

      return {
        price: Number(price.toFixed(2)),
        pct: pct == null ? null : Number(pct.toFixed(2)),
        series_id,
      };
    }

    const tried = [];
    let out = null;

    // Try PM fix first
    try {
      out = await fetchFredSeriesLatest('GOLDPMGBD228NLBM');
      tried.push({ series: 'GOLDPMGBD228NLBM', ok: true });
    } catch (e1) {
      tried.push({ series: 'GOLDPMGBD228NLBM', ok: false, err: e1.message });
      // Fallback to AM fix
      out = await fetchFredSeriesLatest('GOLDAMGBD228NLBM');
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
      statusCode: 200, // keep aggregator happy
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, must-revalidate',
      },
      body: JSON.stringify({
        error: err.message,
        _debug: { where: 'gold.js handler' },
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

// netlify/functions/gold.js
// Gold price from FRED: try PM fix first, fallback to AM.
// Returns: { price, pct|null, source, timestamp } (HTTP 200 even on errors)

export async function handler() {
  try {
    const FRED_KEY = process.env.FRED_KEY;
    if (!FRED_KEY) throw new Error('FRED_KEY missing');

    async function getFredGold(series_id) {
      // Minimal params: some FRED series 400 out when you add filters.
      const url =
        `https://api.stlouisfed.org/fred/series/observations?` +
        `series_id=${series_id}&api_key=${FRED_KEY}&file_type=json`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`FRED HTTP ${res.status} (${series_id})`);
      const json = await res.json();

      const all = Array.isArray(json?.observations) ? json.observations : [];
      const valid = all.filter(o => o.value !== '.');
      if (!valid.length) throw new Error(`No observations (${series_id})`);

      // Latest by date
      valid.sort((a, b) => (a.date < b.date ? 1 : -1)); // desc
      const latest = valid[0];
      const prev   = valid[1];

      const price = Number(latest.value);
      if (!Number.isFinite(price)) throw new Error(`Bad value (${series_id})`);

      let pct = null;
      if (prev && prev.value !== '.' && Number(prev.value) > 0) {
        pct = ((price - Number(prev.value)) / Number(prev.value)) * 100;
      }

      return {
        price: Number(price.toFixed(2)),
        pct: pct == null ? null : Number(pct.toFixed(2)),
        series_id
      };
    }

    let out;
    const tried = [];

    try {
      // PM fix first (more common reference)
      out = await getFredGold('GOLDPMGBD228NLBM');
      tried.push({ series: 'GOLDPMGBD228NLBM', ok: true });
    } catch (e1) {
      tried.push({ series: 'GOLDPMGBD228NLBM', ok: false, err: e1.message });
      // Fallback to AM fix
      out = await getFredGold('GOLDAMGBD228NLBM');
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
    // Keep 200 so the aggregator can show “Error” or fall back to cache gracefully
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

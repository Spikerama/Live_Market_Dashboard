// netlify/functions/gold.js
// Fetch daily London gold price from FRED (PM first, then AM).
// Returns latest price (USD/oz) and 1-day percent change.
//
// No node-fetch import needed on Netlify Node 18+ (global fetch available).

function fredObsUrl(seriesId, apiKey, limit = 5) {
  const p = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: String(limit),
  });
  // We don't force realtime_*; default latest vintage is fine for daily series.
  return `https://api.stlouisfed.org/fred/series/observations?${p.toString()}`;
}

async function getFredLatestPair(seriesId, apiKey) {
  const url = fredObsUrl(seriesId, apiKey, 10);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FRED HTTP ${res.status} (${seriesId}) - ${text}`);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.observations)) {
    throw new Error(`FRED payload malformed for ${seriesId}`);
  }

  // Filter out '.' values and keep numbers only
  const vals = json.observations
    .map(o => ({ date: o.date, v: o.value === '.' ? null : Number(o.value) }))
    .filter(x => Number.isFinite(x.v));

  if (vals.length === 0) {
    throw new Error(`No numeric observations for ${seriesId}`);
  }

  // They’re sorted desc, so vals[0] is latest. Find latest and prior.
  const latest = vals[0].v;
  const prior = vals.find((_, i) => i > 0)?.v ?? null;

  return { latest, prior };
}

exports.handler = async function () {
  try {
    const FRED_KEY = process.env.FRED_KEY;
    if (!FRED_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'FRED_KEY not set' }),
      };
    }

    let source = '';
    let latest = null;
    let prior = null;
    const tried = [];

    // Try PM fix first
    try {
      const p = await getFredLatestPair('GOLDPMGBD228NLBM', FRED_KEY);
      latest = p.latest; prior = p.prior; source = 'FRED GOLDPMGBD228NLBM (PM fix)';
    } catch (e1) {
      tried.push({ src: 'PM', ok: false, err: String(e1.message || e1) });
      // Fallback to AM fix
      const p = await getFredLatestPair('GOLDAMGBD228NLBM', FRED_KEY);
      latest = p.latest; prior = p.prior; source = 'FRED GOLDAMGBD228NLBM (AM fix)';
    }

    const price = Number(latest);
    if (!Number.isFinite(price)) {
      throw new Error('Latest gold price is not finite');
    }

    let changePercent = null;
    if (Number.isFinite(prior) && prior !== 0) {
      changePercent = ((price - prior) / prior) * 100;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, must-revalidate',
      },
      body: JSON.stringify({
        price: Number(price.toFixed(2)),
        changePercent: changePercent == null ? null : Number(changePercent.toFixed(2)),
        source,
        timestamp: new Date().toISOString(),
        _debug: tried.length ? { tried } : undefined,
      }),
    };
  } catch (err) {
    console.error('gold.js handler error:', err);
    return {
      statusCode: 200, // return 200 with an error payload so frontend can cache-fallback
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, must-revalidate',
      },
      body: JSON.stringify({
        error: String(err.message || err),
        _debug: { where: 'gold.js handler' },
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

// netlify/functions/gold.js
// Daily Gold price with robust fallbacks: FRED (LBMA PM fix) → FMP XAUUSD → error
// Requires env: FRED_KEY (for FRED), FMP_KEY (optional fallback)

const FRED_KEY = process.env.FRED_KEY;
const FMP_KEY  = process.env.FMP_KEY;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// 1) FRED LBMA PM fix (series GOLDPMGBD228NLBM) — values are USD/oz, daily, some days are "."
async function getGoldFromFRED() {
  if (!FRED_KEY) throw new Error('FRED_KEY missing');
  const url = `https://api.stlouisfed.org/fred/series/observations?` +
              `series_id=GOLDPMGBD228NLBM&api_key=${encodeURIComponent(FRED_KEY)}&file_type=json&` +
              `sort_order=desc&limit=90`;
  const json = await fetchJson(url);
  const rows = Array.isArray(json?.observations) ? json.observations : [];
  // keep only numeric values
  const valid = rows
    .filter(o => o && o.value !== '.' && !isNaN(Number(o.value)))
    .map(o => ({ date: o.date, price: Number(o.value) }));
  if (valid.length === 0) throw new Error('FRED gold: no valid observations');

  const latest = valid[0];
  const prev   = valid.find(v => v.date !== latest.date); // next earlier valid
  const changePercent = prev ? ((latest.price - prev.price) / prev.price) * 100 : null;

  return {
    price: latest.price,
    changePercent: (changePercent == null ? null : Number(changePercent.toFixed(2))),
    source: 'FRED GOLDPMGBD228NLBM (LBMA PM fix)',
    timestamp: new Date().toISOString(),
  };
}

// 2) FMP fallback — XAUUSD spot (intraday). Uses your FMP key.
async function getGoldFromFMP() {
  if (!FMP_KEY) throw new Error('FMP_KEY missing');
  const url = `https://financialmodelingprep.com/api/v3/quote/XAUUSD?apikey=${encodeURIComponent(FMP_KEY)}`;
  const arr = await fetchJson(url);
  if (!Array.isArray(arr) || !arr.length) throw new Error('FMP gold: empty payload');
  const row = arr[0];
  const price = Number(row.price);
  if (!Number.isFinite(price)) throw new Error('FMP gold: bad price');
  // FMP may provide changesPercentage; if missing, leave null
  const changePercent = (row.changesPercentage == null ? null : Number(row.changesPercentage));
  return {
    price,
    changePercent: (changePercent == null ? null : Number(changePercent.toFixed(2))),
    source: 'FMP XAUUSD',
    timestamp: new Date().toISOString(),
  };
}

exports.handler = async () => {
  const tried = [];
  try {
    const r = await getGoldFromFRED();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(r),
    };
  } catch (e) {
    tried.push({ src: 'FRED', ok: false, err: String(e.message || e) });
  }

  try {
    const r = await getGoldFromFMP();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(r),
    };
  } catch (e) {
    tried.push({ src: 'FMP', ok: false, err: String(e.message || e) });
  }

  // All failed — return a soft error (front end will cache-fallback if available)
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'All sources failed', _debug: { tried }, timestamp: new Date().toISOString() }),
  };
};

// netlify/functions/gold.js
// Robust Gold price: FRED PM fix → FRED AM fix → FMP XAUUSD
// Env: FRED_KEY (required for FRED), FMP_KEY (optional fallback)

const FRED_KEY = process.env.FRED_KEY;
const FMP_KEY  = process.env.FMP_KEY;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// Generic FRED gold getter for a series (PM or AM). Returns latest *valid* daily value.
// We scan up to the last 365 observations to gracefully handle weekends/holidays/missing dots.
async function getGoldFromFREDSeries(seriesId) {
  if (!FRED_KEY) throw new Error('FRED_KEY missing');
  const url =
    `https://api.stlouisfed.org/fred/series/observations?` +
    `series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(FRED_KEY)}` +
    `&file_type=json&sort_order=desc&limit=365`;
  const json = await fetchJson(url);

  const rows = Array.isArray(json?.observations) ? json.observations : [];
  const valid = rows
    .filter(o => o && o.value !== '.' && !isNaN(Number(o.value)))
    .map(o => ({ date: o.date, price: Number(o.value) }));

  if (valid.length === 0) throw new Error(`${seriesId}: no numeric observations`);

  const latest = valid[0];
  const prev   = valid.find(v => v.date !== latest.date);
  const changePercent = prev ? Number((((latest.price - prev.price) / prev.price) * 100).toFixed(2)) : null;

  return {
    price: latest.price,
    changePercent,
    source: `FRED ${seriesId}`,
    timestamp: new Date().toISOString(),
  };
}

// FMP fallback: XAUUSD (spot). Uses changesPercentage if available.
async function getGoldFromFMP() {
  if (!FMP_KEY) throw new Error('FMP_KEY missing');
  const url = `https://financialmodelingprep.com/api/v3/quote/XAUUSD?apikey=${encodeURIComponent(FMP_KEY)}`;
  const arr = await fetchJson(url);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('FMP: empty quote payload');
  const row = arr[0];
  const price = Number(row.price);
  if (!Number.isFinite(price)) throw new Error('FMP: bad price');
  const changePercent =
    row.changesPercentage == null ? null : Number(Number(row.changesPercentage).toFixed(2));
  return {
    price,
    changePercent,
    source: 'FMP XAUUSD',
    timestamp: new Date().toISOString(),
  };
}

// Helpers to format success/error HTTP responses
function ok(bodyObj) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(bodyObj),
  };
}
function softError(tried) {
  return ok({ error: 'All sources failed', _debug: { tried }, timestamp: new Date().toISOString() });
}

exports.handler = async () => {
  const tried = [];

  // 1) FRED PM fix
  try {
    const r = await getGoldFromFREDSeries('GOLDPMGBD228NLBM');
    return ok(r);
  } catch (e) {
    tried.push({ src: 'FRED PM', ok: false, err: String(e.message || e) });
  }

  // 2) FRED AM fix
  try {
    const r = await getGoldFromFREDSeries('GOLDAMGBD228NLBM');
    return ok(r);
  } catch (e) {
    tried.push({ src: 'FRED AM', ok: false, err: String(e.message || e) });
  }

  // 3) FMP XAUUSD
  try {
    const r = await getGoldFromFMP();
    return ok(r);
  } catch (e) {
    tried.push({ src: 'FMP XAUUSD', ok: false, err: String(e.message || e) });
  }

  // All failed
  return softError(tried);
};

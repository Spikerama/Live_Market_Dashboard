// netlify/functions/vixIndex.js
// Prefer FRED (daily close, reliable) → then intraday fallbacks (FMP, CBOE, Stooq).
// Returns cached value if all sources fail.

const FRED_KEY = process.env.FRED_KEY;
const FMP_KEY  = process.env.FMP_KEY;

let cached = {
  price: null,
  changePercent: null,
  source: '',
  timestamp: 0,
};

const JSON_HDRS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, must-revalidate',
};

// ---------- Sources ----------
async function fromFRED() {
  if (!FRED_KEY) throw new Error('FRED_KEY missing');
  // Last 10 observations, newest first
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.observations)) throw new Error('FRED: bad payload');

  const vals = json.observations
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, v: Number(o.value) }));

  if (vals.length === 0) throw new Error('FRED: no numeric values');

  const latest = vals[0].v;
  let changePercent = null;
  if (vals.length > 1 && vals[1].v !== 0) {
    changePercent = ((latest - vals[1].v) / vals[1].v) * 100;
  }

  return { price: latest, changePercent, source: 'FRED VIXCLS (daily close)' };
}

async function fromFMP() {
  if (!FMP_KEY) throw new Error('FMP_KEY missing');
  const url = `https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${FMP_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr[0]) throw new Error('FMP: no rows');
  const price = Number(arr[0].price);
  const cp    = arr[0].changesPercentage == null ? null : Number(arr[0].changesPercentage);
  if (Number.isNaN(price)) throw new Error('FMP: bad price');
  return { price, changePercent: Number.isNaN(cp) ? null : cp, source: 'FMP ^VIX (intraday)' };
}

async function fromCBOE() {
  const url = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const csv = (await res.text()).trim();
  const lines = csv.split('\n').filter(Boolean);
  if (lines.length < 2) throw new Error('CBOE: no data rows');

  // Find the last two lines that have numeric close
  function parseLine(l) {
    const parts = l.split(',').map(s => s.trim());
    const close = Number(parts[parts.length - 1]); // last column is "VIX Close"
    return Number.isNaN(close) ? null : close;
  }
  let latest, prev, i = lines.length - 1;
  while (i > 0 && latest == null) { latest = parseLine(lines[i]); i--; }
  while (i > 0 && prev   == null) { prev   = parseLine(lines[i]); i--; }
  if (latest == null) throw new Error('CBOE: no usable close');

  let changePercent = null;
  if (prev != null && prev !== 0) changePercent = ((latest - prev) / prev) * 100;

  return { price: latest, changePercent, source: 'CBOE CSV (daily close)' };
}

async function fromStooq() {
  const url = 'https://stooq.com/q/d/l/?s=%5Evix&i=d';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const text = (await res.text()).trim();
  if (!text || text === 'NO DATA') throw new Error('Stooq: no usable data');
  const rows = text.split('\n').filter(Boolean);
  if (rows.length < 2) throw new Error('Stooq: no data rows');
  const last = rows[rows.length - 1].split(',');
  const prev = rows.length > 2 ? rows[rows.length - 2].split(',') : null;
  const price = Number(last[4]);
  if (Number.isNaN(price)) throw new Error('Stooq: bad close');
  let changePercent = null;
  if (prev) {
    const p = Number(prev[4]);
    if (!Number.isNaN(p) && p !== 0) changePercent = ((price - p) / p) * 100;
  }
  return { price, changePercent, source: 'Stooq CSV ^VIX (daily close)' };
}

// ---------- Handler ----------
exports.handler = async () => {
  const tried = [];

  // Prefer FRED first (reliable), then intraday-ish fallbacks.
  const sources = [fromFRED, fromFMP, fromCBOE, fromStooq];

  for (const fn of sources) {
    try {
      const { price, changePercent, source } = await fn();
      // Update in-memory cache
      cached = { price, changePercent: changePercent ?? null, source, timestamp: Date.now() };
      return {
        statusCode: 200,
        headers: JSON_HDRS,
        body: JSON.stringify({
          price,
          changePercent: changePercent == null ? null : Number(changePercent.toFixed(2)),
          source,
          timestamp: new Date().toISOString(),
        }),
      };
    } catch (e) {
      tried.push({ src: fn.name.replace('from', ''), ok: false, err: e.message });
    }
  }

  // Cache fallback (6h)
  if (cached.price != null && Date.now() - cached.timestamp < 6 * 60 * 60 * 1000) {
    return {
      statusCode: 200,
      headers: JSON_HDRS,
      body: JSON.stringify({
        price: cached.price,
        changePercent: cached.changePercent,
        source: `Cached last good VIX (${cached.source})`,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // All failed
  return {
    statusCode: 500,
    headers: JSON_HDRS,
    body: JSON.stringify({
      error: 'All sources failed and no fresh cache',
      _debug: { tried },
      timestamp: new Date().toISOString(),
    }),
  };
};

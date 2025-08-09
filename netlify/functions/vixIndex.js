// netlify/functions/vixIndex.js
// Primary: FMP (^VIX). Fallback: Stooq CSV. Final fallback: recent in-memory cache.
// Add `?debug=1` to the function URL to return error details instead of a 500.

const SYMBOL = '^VIX';
const FMP_KEY = process.env.FMP_KEY;

let cached = { price: null, changePercent: null, ts: 0 };

const jsonOk = (body, status = 200) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify(body),
});

async function fetchJSON(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { ok: res.ok, status: res.status, data, text };
}

async function fetchText(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

// ---------- Primary: FMP ----------
async function getFromFMP(debug) {
  if (!FMP_KEY) throw new Error('FMP_KEY missing');
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible)' };

  // Try encoded caret first, then raw caret (FMP usually needs %5E)
  const urls = [
    `https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${encodeURIComponent(FMP_KEY)}`,
    `https://financialmodelingprep.com/api/v3/quote/^VIX?apikey=${encodeURIComponent(FMP_KEY)}`,
  ];

  let lastErr;
  for (const url of urls) {
    const { ok, status, data, text } = await fetchJSON(url, headers);
    if (debug) console.log('[VIX FMP]', status, text?.slice(0, 300));
    if (!ok) { lastErr = new Error(`FMP HTTP ${status}`); continue; }
    if (!Array.isArray(data) || data.length === 0) { lastErr = new Error('FMP empty array'); continue; }

    const q = data[0] || {};
    const price = Number(q.price ?? q.previousClose);
    if (!Number.isFinite(price)) { lastErr = new Error('FMP missing price'); continue; }

    let changePercent = null;
    if (q.changesPercentage != null && q.changesPercentage !== '') {
      changePercent = Number(String(q.changesPercentage).replace('%', ''));
    } else if (q.change != null && q.previousClose != null) {
      const prev = Number(q.previousClose);
      const chg  = Number(q.change);
      if (Number.isFinite(prev) && prev !== 0 && Number.isFinite(chg)) {
        changePercent = (chg / prev) * 100;
      }
    }
    return { price, changePercent, source: 'FMP' };
  }
  throw lastErr || new Error('FMP failed');
}

// ---------- Fallback: Stooq CSV (^VIX daily history) ----------
function parseStooqCSV(csv) {
  const t = (csv || '').trim();
  if (!t || t === 'NO DATA') return null;
  const lines = t.split('\n').filter(Boolean);
  if (lines.length < 2) return null; // header + at least 1 row

  const last = lines[lines.length - 1].split(',');
  const prev = lines.length >= 3 ? lines[lines.length - 2].split(',') : null;

  const close = Number(last[4]);
  if (!Number.isFinite(close)) return null;

  let changePercent = null;
  if (prev) {
    const prevClose = Number(prev[4]);
    if (Number.isFinite(prevClose) && prevClose !== 0) {
      changePercent = ((close - prevClose) / prevClose) * 100;
    }
  }
  return { price: close, changePercent, source: 'Stooq CSV ^VIX' };
}

async function getFromStooq(debug) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible)' };
  const base = 'https://stooq.com/q/d/l/';
  const urls = [
    `${base}?s=${encodeURIComponent(SYMBOL.toLowerCase())}&i=d`, // encoded ^vix
    `${base}?s=${SYMBOL.toLowerCase()}&i=d`,                      // raw ^vix
  ];

  let lastErr;
  for (const url of urls) {
    const { ok, status, text } = await fetchText(url, headers);
    if (debug) console.log('[VIX Stooq]', status, String(text).slice(0, 180));
    if (!ok) { lastErr = new Error(`Stooq HTTP ${status}`); continue; }
    const parsed = parseStooqCSV(text);
    if (parsed) return parsed;
    lastErr = new Error('Stooq parsed empty');
  }
  throw lastErr || new Error('Stooq failed');
}

exports.handler = async (event) => {
  const debug = event?.queryStringParameters?.debug === '1';

  try {
    // 1) FMP first
    try {
      const { price, changePercent, source } = await getFromFMP(debug);
      cached = { price, changePercent, ts: Date.now() };
      return jsonOk({
        price,
        changePercent: Number.isFinite(changePercent) ? Number(changePercent.toFixed(2)) : null,
        source,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.log('[VIX] FMP failed →', e.message);
      if (debug) console.log(e.stack);
    }

    // 2) Stooq fallback
    try {
      const { price, changePercent, source } = await getFromStooq(debug);
      cached = { price, changePercent, ts: Date.now() };
      return jsonOk({
        price,
        changePercent: Number.isFinite(changePercent) ? Number(changePercent.toFixed(2)) : null,
        source,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.log('[VIX] Stooq failed →', e.message);
      if (debug) console.log(e.stack);
    }

    // 3) Cache ≤ 60 min
    const age = Date.now() - cached.ts;
    if (cached.price != null && age < 60 * 60 * 1000) {
      return jsonOk({
        price: cached.price,
        changePercent: Number.isFinite(cached.changePercent) ? Number(cached.changePercent.toFixed(2)) : null,
        source: 'Cached last good VIX',
        timestamp: new Date().toISOString(),
      });
    }

    const err = 'All sources failed and no fresh cache';
    if (debug) return jsonOk({ error: err }, 200);
    throw new Error(err);
  } catch (err) {
    console.error('vixIndex error:', err);
    return jsonOk({ error: err.message, timestamp: new Date().toISOString() }, 500);
  }
};

// netlify/functions/vixIndex.js
// Primary: FMP (^VIX). Fallback: Stooq CSV. Final fallback: recent in-memory cache.

const SYMBOL = '^VIX';
const FMP_KEY = process.env.FMP_KEY;

let cached = {
  price: null,
  changePercent: null,
  ts: 0, // ms
};

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchText(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ---------- Primary: FMP ----------
async function getFromFMP() {
  if (!FMP_KEY) throw new Error('FMP_KEY missing');
  const url = `https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${encodeURIComponent(FMP_KEY)}`;
  const data = await fetchJSON(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
  if (!Array.isArray(data) || data.length === 0) throw new Error('FMP empty payload');

  const q = data[0];
  const price = Number(q.price ?? q.previousClose);
  if (!Number.isFinite(price)) throw new Error('FMP missing price');

  let changePercent = null;
  if (q.changesPercentage != null && q.changesPercentage !== '') {
    // FMP returns like "1.23" or sometimes "1.23%" – handle both
    changePercent = Number(String(q.changesPercentage).replace('%', ''));
  } else if (q.change != null && q.previousClose != null) {
    const prev = Number(q.previousClose);
    const chg = Number(q.change);
    if (Number.isFinite(prev) && prev !== 0 && Number.isFinite(chg)) {
      changePercent = (chg / prev) * 100;
    }
  }

  return { price, changePercent, source: 'FMP' };
}

// ---------- Fallback: Stooq CSV (^VIX daily history) ----------
function parseStooqCSV(csvText) {
  const trimmed = (csvText || '').trim();
  if (!trimmed || trimmed === 'NO DATA') return null;

  const lines = trimmed.split('\n').filter(Boolean);
  if (lines.length < 2) return null;

  // header: date,open,high,low,close,volume
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

async function getFromStooq() {
  // Try with encoded caret first, then unencoded
  const base = 'https://stooq.com/q/d/l/';
  const url1 = `${base}?s=${encodeURIComponent(SYMBOL.toLowerCase())}&i=d`;
  const url2 = `${base}?s=${SYMBOL.toLowerCase()}&i=d`;

  try {
    const csv = await fetchText(url1, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
    const parsed = parseStooqCSV(csv);
    if (parsed) return parsed;
    throw new Error('Stooq parsed empty (encoded)');
  } catch (e1) {
    const csv = await fetchText(url2, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
    const parsed = parseStooqCSV(csv);
    if (parsed) return parsed;
    throw new Error('Stooq parsed empty (raw ^VIX)');
  }
}

exports.handler = async function () {
  try {
    // 1) FMP first
    try {
      const { price, changePercent, source } = await getFromFMP();
      cached = { price, changePercent, ts: Date.now() };
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          price,
          changePercent: Number.isFinite(changePercent) ? Number(changePercent.toFixed(2)) : null,
          source,
          timestamp: new Date().toISOString()
        })
      };
    } catch (fmpErr) {
      console.log('[VIX] FMP failed, falling back to Stooq:', fmpErr.message);
    }

    // 2) Stooq fallback
    try {
      const { price, changePercent, source } = await getFromStooq();
      cached = { price, changePercent, ts: Date.now() };
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          price,
          changePercent: Number.isFinite(changePercent) ? Number(changePercent.toFixed(2)) : null,
          source,
          timestamp: new Date().toISOString()
        })
      };
    } catch (stooqErr) {
      console.log('[VIX] Stooq failed:', stooqErr.message);
    }

    // 3) Recent cache (≤ 60 minutes)
    const age = Date.now() - cached.ts;
    if (cached.price != null && age < 60 * 60 * 1000) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          price: cached.price,
          changePercent: Number.isFinite(cached.changePercent) ? Number(cached.changePercent.toFixed(2)) : null,
          source: 'Cached last good VIX',
          timestamp: new Date().toISOString()
        })
      };
    }

    throw new Error('All sources failed and no fresh cache');
  } catch (err) {
    console.error('vixIndex error:', err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ error: err.message, timestamp: new Date().toISOString() })
    };
  }
};

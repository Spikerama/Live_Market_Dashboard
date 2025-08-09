// netlify/functions/vixIndex.js  (ESM)

const FMP_KEY = process.env.FMP_KEY;

// tiny helper
async function fetchJSON(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}
async function fetchText(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// 1) FMP source: https://financialmodelingprep.com/api/v3/quote/%5EVIX
async function getFromFMP() {
  if (!FMP_KEY) throw new Error('FMP_KEY missing');
  const url = `https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${encodeURIComponent(FMP_KEY)}`;
  const arr = await fetchJSON(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!Array.isArray(arr) || !arr[0]) throw new Error('FMP: empty array');

  const row = arr[0];
  const price = Number(row.price);
  if (!Number.isFinite(price)) throw new Error('FMP: bad price');

  let changePct = row.changesPercentage;
  if (typeof changePct === 'string') {
    // FMP sometimes returns like "1.23%"
    changePct = changePct.replace('%', '');
  }
  changePct = Number(changePct);

  if (!Number.isFinite(changePct)) {
    // compute from change / previousClose if available
    const prev = Number(row.previousClose);
    if (Number.isFinite(prev) && prev !== 0) {
      const computed = ((price - prev) / prev) * 100;
      changePct = Number(computed.toFixed(2));
    } else {
      changePct = null; // we can live without it
    }
  } else {
    changePct = Number(changePct.toFixed(2));
  }

  return { price, changePercent: changePct, source: 'FMP ^VIX' };
}

// 2) Stooq CSV fallback
const STOOQ_CSV_URL = 'https://stooq.com/q/d/l/?s=%5Evix&i=d';

function parseStooqCSV(csvText) {
  const trimmed = (csvText || '').trim();
  if (!trimmed || trimmed === 'NO DATA') return null;
  const lines = trimmed.split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const latest = lines[lines.length - 1].split(',');
  const prior  = lines.length >= 3 ? lines[lines.length - 2].split(',') : null;

  const lastClose = Number(latest[4]);
  if (!Number.isFinite(lastClose)) return null;

  let changePercent = null;
  if (prior) {
    const priorClose = Number(prior[4]);
    if (Number.isFinite(priorClose) && priorClose !== 0) {
      changePercent = Number((((lastClose - priorClose) / priorClose) * 100).toFixed(2));
    }
  }
  return { price: lastClose, changePercent, source: 'Stooq CSV ^VIX' };
}

async function getFromStooq() {
  const csv = await fetchText(STOOQ_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
  const parsed = parseStooqCSV(csv);
  if (!parsed) throw new Error('Stooq: no usable data');
  return parsed;
}

// 3) in-memory cache
let cache = { ts: 0, price: null, changePercent: null, source: null };
const CACHE_MS = 60 * 60 * 1000;

export async function handler(event) {
  const debug = event?.queryStringParameters?.debug === '1';
  const debugInfo = { tried: [] };

  try {
    // Try FMP first (if key present)
    if (FMP_KEY) {
      try {
        const fmp = await getFromFMP();
        cache = { ts: Date.now(), ...fmp };
        if (debug) debugInfo.tried.push({ src: 'FMP', ok: true });
        return ok(fmp, debug ? debugInfo : undefined);
      } catch (e) {
        if (debug) debugInfo.tried.push({ src: 'FMP', ok: false, err: String(e.message || e) });
      }
    } else if (debug) {
      debugInfo.tried.push({ src: 'FMP', ok: false, err: 'FMP_KEY missing' });
    }

    // Then Stooq
    try {
      const stooq = await getFromStooq();
      cache = { ts: Date.now(), ...stooq };
      if (debug) debugInfo.tried.push({ src: 'Stooq', ok: true });
      return ok(stooq, debug ? debugInfo : undefined);
    } catch (e) {
      if (debug) debugInfo.tried.push({ src: 'Stooq', ok: false, err: String(e.message || e) });
    }

    // Finally, fallback to cache (if fresh)
    const age = Date.now() - cache.ts;
    if (cache.price != null && age < CACHE_MS) {
      if (debug) debugInfo.tried.push({ src: 'Cache', ok: true, ageMs: age });
      return ok({ price: cache.price, changePercent: cache.changePercent, source: 'Cached ^VIX' }, debug ? debugInfo : undefined);
    }

    // Everything failed
    return fail('All sources failed and no fresh cache', debug ? debugInfo : undefined);

  } catch (err) {
    return fail(String(err?.message || err), debug ? debugInfo : undefined);
  }
}

// helpers for responses
function ok(payload, debugInfo) {
  const body = debugInfo ? { ...payload, _debug: debugInfo, timestamp: new Date().toISOString() }
                         : { ...payload, timestamp: new Date().toISOString() };
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}
function fail(message, debugInfo) {
  const body = debugInfo ? { error: message, _debug: debugInfo, timestamp: new Date().toISOString() }
                         : { error: message, timestamp: new Date().toISOString() };
  return {
    statusCode: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

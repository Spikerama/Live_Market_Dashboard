// netlify/functions/vixIndex.js  (ESM)

const FMP_KEY = process.env.FMP_KEY;

// helpers
async function fetchJSON(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
async function fetchText(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

// 1) FMP first (if key present)
async function getFromFMP() {
  if (!FMP_KEY) throw new Error('FMP_KEY missing');
  const url = `https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${encodeURIComponent(FMP_KEY)}`;
  const arr = await fetchJSON(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!Array.isArray(arr) || !arr[0]) throw new Error('FMP: empty array');

  const row = arr[0];
  const price = Number(row.price);
  if (!Number.isFinite(price)) throw new Error('FMP: bad price');

  let changePct = row.changesPercentage;
  if (typeof changePct === 'string') changePct = changePct.replace('%', '');
  changePct = Number(changePct);

  if (!Number.isFinite(changePct)) {
    const prev = Number(row.previousClose);
    if (Number.isFinite(prev) && prev !== 0) {
      changePct = Number((((price - prev) / prev) * 100).toFixed(2));
    } else {
      changePct = null;
    }
  } else {
    changePct = Number(changePct.toFixed(2));
  }

  return { price, changePercent: changePct, source: 'FMP ^VIX' };
}

// 2) Yahoo Finance fallback (no key)
async function getFromYahoo() {
  const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EVIX';
  const json = await fetchJSON(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const row = json?.quoteResponse?.result?.[0];
  if (!row) throw new Error('Yahoo: empty result');

  const price = Number(row.regularMarketPrice);
  if (!Number.isFinite(price)) throw new Error('Yahoo: bad price');

  let changePct = row.regularMarketChangePercent;
  changePct = Number(changePct);

  if (!Number.isFinite(changePct)) {
    const prev = Number(row.regularMarketPreviousClose);
    if (Number.isFinite(prev) && prev !== 0) {
      changePct = Number((((price - prev) / prev) * 100).toFixed(2));
    } else {
      changePct = null;
    }
  } else {
    changePct = Number(changePct.toFixed(2));
  }

  return { price, changePercent: changePct, source: 'Yahoo ^VIX' };
}

// 3) Stooq CSV fallback (NOTE: use literal ^vix, not encoded)
const STOOQ_CSV_URL = 'https://stooq.com/q/d/l/?s=^vix&i=d';

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

// 4) in-memory cache
let cache = { ts: 0, price: null, changePercent: null, source: null };
const CACHE_MS = 60 * 60 * 1000;

export async function handler(event) {
  const debug = event?.queryStringParameters?.debug === '1';
  const dbg = { tried: [] };

  try {
    if (FMP_KEY) {
      try {
        const f = await getFromFMP();
        cache = { ts: Date.now(), ...f };
        if (debug) dbg.tried.push({ src: 'FMP', ok: true });
        return ok(f, debug ? dbg : undefined);
      } catch (e) {
        if (debug) dbg.tried.push({ src: 'FMP', ok: false, err: String(e.message || e) });
      }
    } else if (debug) {
      dbg.tried.push({ src: 'FMP', ok: false, err: 'FMP_KEY missing' });
    }

    try {
      const y = await getFromYahoo();
      cache = { ts: Date.now(), ...y };
      if (debug) dbg.tried.push({ src: 'Yahoo', ok: true });
      return ok(y, debug ? dbg : undefined);
    } catch (e) {
      if (debug) dbg.tried.push({ src: 'Yahoo', ok: false, err: String(e.message || e) });
    }

    try {
      const s = await getFromStooq();
      cache = { ts: Date.now(), ...s };
      if (debug) dbg.tried.push({ src: 'Stooq', ok: true });
      return ok(s, debug ? dbg : undefined);
    } catch (e) {
      if (debug) dbg.tried.push({ src: 'Stooq', ok: false, err: String(e.message || e) });
    }

    const age = Date.now() - cache.ts;
    if (cache.price != null && age < CACHE_MS) {
      if (debug) dbg.tried.push({ src: 'Cache', ok: true, ageMs: age });
      return ok({ price: cache.price, changePercent: cache.changePercent, source: 'Cached ^VIX' }, debug ? dbg : undefined);
    }

    return fail('All sources failed and no fresh cache', debug ? dbg : undefined);

  } catch (err) {
    return fail(String(err?.message || err), debug ? dbg : undefined);
  }
}

// response helpers
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

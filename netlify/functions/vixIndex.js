// vixIndex.js — VIX index from Stooq CSV, fallback only to recent in-memory cache (no VIXY)
const STOOQ_CSV_URL = 'https://stooq.com/q/d/l/?s=^vix&i=d';

let cached = {
  price: null,
  changePercent: null,
  timestamp: 0,
};

async function fetchTextWithRetry(url, attempts = 3, delay = 300) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw new Error(`All retries failed fetching Stooq CSV: ${lastErr?.message || 'unknown'}`);
}

function parseStooqCSV(csvText) {
  const trimmed = csvText.trim();
  if (!trimmed || trimmed === 'NO DATA') return null;
  const lines = trimmed.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null; // no data rows
  const latest = lines[lines.length - 1].split(',');
  const prior = lines.length >= 3 ? lines[lines.length - 2].split(',') : null;
  const latestClose = parseFloat(latest[4]);
  if (isNaN(latestClose)) return null;
  let changePercent = null;
  if (prior) {
    const priorClose = parseFloat(prior[4]);
    if (!isNaN(priorClose) && priorClose !== 0) {
      changePercent = parseFloat((((latestClose - priorClose) / priorClose) * 100).toFixed(2));
    }
  }
  return { price: latestClose, changePercent };
}

exports.handler = async function () {
  try {
    let price = null;
    let changePercent = null;
    let source = '';

    // Try Stooq
    try {
      const csv = await fetchTextWithRetry(STOOQ_CSV_URL);
      const parsed = parseStooqCSV(csv);
      if (parsed) {
        price = parsed.price;
        changePercent = parsed.changePercent;
        source = 'Stooq CSV ^VIX';
        // update cache
        cached = { price, changePercent, timestamp: Date.now() };
      } else {
        throw new Error('No usable Stooq data');
      }
    } catch (stooqErr) {
      // fallback only to recent cache (within 1 hour)
      const age = Date.now() - cached.timestamp;
      if (cached.price !== null && age < 60 * 60 * 1000) {
        price = cached.price;
        changePercent = cached.changePercent;
        source = 'Cached last good VIX';
      } else {
        throw new Error(`Stooq failed and no fresh cache: ${stooqErr.message}`);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        price,
        changePercent,
        source,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('vixIndex error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }),
    };
  }
};

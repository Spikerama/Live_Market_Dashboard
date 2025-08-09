// netlify/functions/vixIndex.js — VIX index from Stooq CSV with debug logging
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
      const text = await res.text();
      // Debug: log status and a small slice of the payload so we see what we got
      console.log('[VIX] fetch status OK, length:', text.length);
      console.log('[VIX] CSV (first 5 lines):\n' + text.split(/\r?\n/).slice(0, 5).join('\n'));
      return text;
    } catch (e) {
      lastErr = e;
      console.warn(`[VIX] fetch attempt ${i + 1} failed: ${e.message}`);
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw new Error(`All retries failed fetching Stooq CSV: ${lastErr?.message || 'unknown'}`);
}

function parseStooqCSV(csvText) {
  if (!csvText) return null;

  const lines = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  // Header should be something like: Date,Open,High,Low,Close,Volume
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('date') && header.includes('close');

  // Find the last data line (skip header and any trailing blank)
  const dataLines = hasHeader ? lines.slice(1) : lines.slice(0);
  if (dataLines.length === 0) return null;

  const latestLine = dataLines[dataLines.length - 1];
  const priorLine = dataLines.length >= 2 ? dataLines[dataLines.length - 2] : null;

  const latestCols = latestLine.split(',').map(x => x.trim());
  const priorCols  = priorLine ? priorLine.split(',').map(x => x.trim()) : null;

  // Expected columns: [Date, Open, High, Low, Close, Volume]
  const latestClose = parseFloat(latestCols[4]);
  if (!isFinite(latestClose)) {
    console.warn('[VIX] latest close not parseable:', latestCols);
    return null;
  }

  let changePercent = null;
  if (priorCols && priorCols.length >= 5) {
    const priorClose = parseFloat(priorCols[4]);
    if (isFinite(priorClose) && priorClose !== 0) {
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

    // Try Stooq first
    try {
      const csv = await fetchTextWithRetry(STOOQ_CSV_URL);
      if (csv.trim() === 'NO DATA') throw new Error('Stooq returned NO DATA');
      const parsed = parseStooqCSV(csv);
      console.log('[VIX] parsed object:', parsed);

      if (parsed) {
        price = parsed.price;
        changePercent = parsed.changePercent;
        source = 'Stooq CSV ^VIX';
        cached = { price, changePercent, timestamp: Date.now() };
      } else {
        throw new Error('No usable Stooq data after parsing');
      }
    } catch (stooqErr) {
      console.warn('[VIX] Stooq branch failed:', stooqErr.message);
      // Fallback only to recent cache (within 1 hour)
      const age = Date.now() - cached.timestamp;
      if (cached.price !== null && age < 60 * 60 * 1000) {
        price = cached.price;
        changePercent = cached.changePercent;
        source = 'Cached last good VIX';
        console.log('[VIX] Using cached VIX. Age (ms):', age);
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

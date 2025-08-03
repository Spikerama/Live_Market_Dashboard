// vixIndex.js — gets VIX index, primary from Stooq CSV, fallback to Yahoo Finance
const STooq_URL = 'https://stooq.com/q/d/l/?s=^vix&i=d'; // daily CSV
const YAHOO_URL = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EVIX';

async function fetchTextWithRetry(url, attempts = 3, delay = 300) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw new Error(`All retries failed: ${lastErr?.message || 'unknown'}`);
}

async function fetchJsonWithRetry(url, attempts = 3, delay = 300) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} (${text.slice(0, 200)})`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw new Error(`All retries failed: ${lastErr?.message || 'unknown'}`);
}

function parseStooqCSV(csvText) {
  // CSV format: Date,Open,High,Low,Close,Volume
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) throw new Error('No data rows in Stooq CSV');
  // Last line is most recent (Stooq gives descending? usually ascending, so take last non-empty)
  let last;
  for (let i = lines.length - 1; i >= 1; i--) {
    if (lines[i].trim()) { last = lines[i]; break; }
  }
  if (!last) throw new Error('Could not find latest data line');
  const parts = last.split(',');
  // Close is index 4
  const close = parseFloat(parts[4]);
  if (isNaN(close)) throw new Error('Invalid close from Stooq CSV');
  return close;
}

exports.handler = async function () {
  try {
    // First try Stooq
    let price;
    let source = 'Stooq CSV ^VIX';
    try {
      const csv = await fetchTextWithRetry(STooq_URL);
      price = parseStooqCSV(csv);
    } catch (stooqErr) {
      // fallback to Yahoo
      source = 'Yahoo Finance ^VIX (fallback)';
      const json = await fetchJsonWithRetry(YAHOO_URL);
      const result = json?.quoteResponse?.result;
      if (!Array.isArray(result) || result.length === 0) {
        throw new Error(`Fallback Yahoo failed: no result. Stooq error: ${stooqErr.message}`);
      }
      const vix = result[0];
      price = vix.regularMarketPrice;
      if (typeof price !== 'number') {
        throw new Error(`Fallback Yahoo invalid price: ${JSON.stringify(vix).slice(0, 200)}`);
      }
    }

    // We don't get changePercent easily from Stooq; set null or compute externally if needed
    const payload = {
      price,
      changePercent: null,
      timestamp: new Date().toISOString(),
      source,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    console.error('vixIndex error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: `Failed to fetch VIX index: ${err.message}`, timestamp: new Date().toISOString() }),
    };
  }
};

// vixIndex.js — gets VIX index from Stooq CSV; if only one row exists, returns price with null change%
const STOOQ_CSV_URL = 'https://stooq.com/q/d/l/?s=^vix&i=d'; // daily VIX CSV

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
  throw new Error(`All retries failed fetching Stooq CSV: ${lastErr?.message || 'unknown'}`);
}

function parseStooqCSV(csvText) {
  // CSV format: Date,Open,High,Low,Close,Volume
  const lines = csvText.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('No data rows in Stooq CSV');
  // Latest is last line
  const latestParts = lines[lines.length - 1].split(',');
  const latestClose = parseFloat(latestParts[4]);
  if (isNaN(latestClose)) throw new Error('Invalid latest close from Stooq CSV');

  let changePercent = null;
  if (lines.length >= 3) {
    // have prior to compute change
    const priorParts = lines[lines.length - 2].split(',');
    const priorClose = parseFloat(priorParts[4]);
    if (!isNaN(priorClose) && priorClose !== 0) {
      changePercent = parseFloat((((latestClose - priorClose) / priorClose) * 100).toFixed(2));
    }
  }
  return { price: latestClose, changePercent };
}

exports.handler = async function () {
  try {
    const csv = await fetchTextWithRetry(STOOQ_CSV_URL);
    const { price, changePercent } = parseStooqCSV(csv);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        price,
        changePercent,
        timestamp: new Date().toISOString(),
        source: 'Stooq CSV ^VIX',
      }),
    };
  } catch (err) {
    console.error('vixIndex error (Stooq):', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: `Failed to fetch VIX index from Stooq: ${err.message}`,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

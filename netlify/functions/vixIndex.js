// vixIndex.js — proxies the real VIX index (^VIX) from Yahoo Finance with retries and clearer errors.
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 300;

async function fetchWithRetry(url, attempts = MAX_RETRIES) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible)',
          'Accept': 'application/json',
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} (${text.slice(0, 200)})`);
      }
      const json = await res.json();
      return json;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (i + 1)));
      }
    }
  }
  throw new Error(`All retries failed: ${lastErr?.message || 'unknown'}`);
}

exports.handler = async function () {
  const YAHOO_URL = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EVIX';
  try {
    const json = await fetchWithRetry(YAHOO_URL);
    const result = json?.quoteResponse?.result;
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error(`No result array in response. Raw payload: ${JSON.stringify(json).slice(0, 400)}`);
    }
    const vix = result[0];
    const price = vix.regularMarketPrice;
    const changePercent = vix.regularMarketChangePercent;
    if (typeof price !== 'number') {
      throw new Error(`Invalid price field: ${JSON.stringify(vix).slice(0, 300)}`);
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        price,
        changePercent: typeof changePercent === 'number' ? changePercent : 0,
        timestamp: new Date().toISOString(),
        source: 'Yahoo Finance ^VIX',
      }),
    };
  } catch (err) {
    console.error('vixIndex error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: `Failed to fetch VIX index: ${err.message}`,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

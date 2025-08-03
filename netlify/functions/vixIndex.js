// vixIndex.js — returns the VIX index (not VIXY) by proxying Yahoo Finance
exports.handler = async function () {
  const YAHOO_URL = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EVIX'; // ^VIX
  try {
    const res = await fetch(YAHOO_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Yahoo Finance returned HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.quoteResponse?.result;
    if (!Array.isArray(result) || result.length === 0) throw new Error('No VIX data in response');
    const vix = result[0];
    const price = vix.regularMarketPrice;
    const changePercent = vix.regularMarketChangePercent; // can be null
    if (typeof price !== 'number') throw new Error('Invalid VIX price');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        price,
        changePercent: typeof changePercent === 'number' ? changePercent : 0,
        timestamp: new Date().toISOString(),
        source: 'Yahoo Finance ^VIX',
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }),
    };
  }
};

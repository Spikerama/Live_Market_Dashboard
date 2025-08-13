// netlify/functions/gold.js
// Gold price via TwelveData XAU/USD (USD per troy ounce)
// Returns: { price: number, changePercent: number|null, source, timestamp }
// No node-fetch import needed on Netlify's Node 18+

exports.handler = async function () {
  try {
    const TWELVE_KEY = process.env.TWELVE_KEY;
    if (!TWELVE_KEY) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'TWELVE_KEY not set in environment' })
      };
    }

    const symbol = encodeURIComponent('XAU/USD');
    const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${TWELVE_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from TwelveData`);
    }
    const j = await res.json();

    if (j.status === 'error') {
      // Typical: daily credit limit exceeded -> let frontend cache-fallback handle it
      throw new Error(j.message || 'TwelveData returned error');
    }

    // TwelveData may provide either price or close (for FX they expose price)
    const priceRaw = j.price ?? j.close;
    const prevRaw  = j.previous_close ?? null;

    const price = Number(priceRaw);
    if (!Number.isFinite(price)) {
      throw new Error('Bad price from TwelveData for XAU/USD');
    }

    let changePercent = null;
    if (prevRaw != null && Number.isFinite(Number(prevRaw)) && Number(prevRaw) !== 0) {
      changePercent = ((price - Number(prevRaw)) / Number(prevRaw)) * 100;
    } else if (j.percent_change != null && !isNaN(Number(j.percent_change))) {
      // Some symbols include percent_change directly
      changePercent = Number(j.percent_change);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, must-revalidate'
      },
      body: JSON.stringify({
        price: Number(price.toFixed(2)),
        changePercent: changePercent == null ? null : Number(changePercent.toFixed(2)),
        source: 'TwelveData XAU/USD',
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('gold.js error:', err);
    // Return 200 with error payload so the frontend can fall back to cache gracefully
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, must-revalidate'
      },
      body: JSON.stringify({
        error: String(err.message || err),
        timestamp: new Date().toISOString()
      })
    };
  }
};

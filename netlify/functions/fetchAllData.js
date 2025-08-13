import fetch from 'node-fetch';

// Unified data fetch for all widgets (VIXY & Estimated Buffett removed)
export async function handler(event) {
  const bust = Date.now();
  const protocol = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host;
  const base = `${protocol}://${host}`;

  const TWELVE_KEY = process.env.TWELVE_KEY;
  const FMP_KEY = process.env.FMP_KEY;
  const results = {};

  // Helper: TwelveData
  async function fetchTwelve(symbol) {
    if (!TWELVE_KEY) throw new Error('TWELVE_KEY missing');
    const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${TWELVE_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message || 'TwelveData error');
    return { price: parseFloat(json.close ?? json.price), pct: parseFloat(json.percent_change) };
  }

  // Helper: Financial Modeling Prep (fallback)
  async function fetchFMP(symbol) {
    if (!FMP_KEY) throw new Error('FMP_KEY missing');
    const url = `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json) || !json[0]) throw new Error('Bad FMP data');
    return { price: parseFloat(json[0].price), pct: parseFloat(json[0].changesPercentage) };
  }

  // SPY
  try { results.spy = await fetchTwelve('SPY'); }
  catch (err) {
    try { results.spy = await fetchFMP('SPY'); }
    catch (ferr) { results.spy = { error: ferr.message || err.message }; }
  }

  // TSLA
  try { results.tsla = await fetchTwelve('TSLA'); }
  catch (err) {
    try { results.tsla = await fetchFMP('TSLA'); }
    catch (ferr) { results.tsla = { error: ferr.message || err.message }; }
  }

  // LIT (Lithium ETF)
  try { results.lit = await fetchTwelve('LIT'); }
  catch (err) {
    try { results.lit = await fetchFMP('LIT'); }
    catch (ferr) { results.lit = { error: ferr.message || err.message }; }
  }

  // Yield Curve Spread
  try {
    const res = await fetch(`${base}/.netlify/functions/yieldSpread?bust=${bust}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    results.yieldCurve = await res.json();
  } catch (err) {
    results.yieldCurve = { error: err.message };
  }

  // True Buffett
  try {
    const res = await fetch(`${base}/.netlify/functions/buffett?bust=${bust}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    results.buffett = await res.json();
  } catch (err) {
    results.buffett = { error: err.message };
  }

  // (Note) VIX Index and Gold are fetched by their own functions on the frontend.

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(results)
  };
}

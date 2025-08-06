import fetch from 'node-fetch';

// Unified data fetch for all widgets with fallback for TwelveData rate limits
export async function handler(event) {
  const bust = Date.now();
  const protocol = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host;
  const base = `${protocol}://${host}`;

  const TWELVE_KEY = process.env.TWELVE_KEY;
  const FMP_KEY = process.env.FMP_KEY;
  const results = {};

  // Helper: fetch from TwelveData
  async function fetchTwelve(symbol) {
    const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${TWELVE_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    return { price: parseFloat(json.close), pct: parseFloat(json.percent_change) };
  }

  // Helper: fetch from Financial Modeling Prep
  async function fetchFMP(symbol) {
    if (!FMP_KEY) throw new Error('FMP_KEY missing');
    const url = `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json) || !json[0]) throw new Error('Bad FMP data');
    return { price: parseFloat(json[0].price), pct: parseFloat(json[0].changesPercentage) };
  }

  // 1) SPY
  try {
    results.spy = await fetchTwelve('SPY');
  } catch (err) {
    if (/credits/.test(err.message) && FMP_KEY) {
      try {
        results.spy = await fetchFMP('SPY');
      } catch (ferr) {
        results.spy = { error: ferr.message };
      }
    } else {
      results.spy = { error: err.message };
    }
  }

  // 2) VIXY
  try {
    results.vixy = await fetchTwelve('VIXY');
  } catch (err) {
    if (/credits/.test(err.message) && FMP_KEY) {
      try {
        results.vixy = await fetchFMP('VIXY');
      } catch (ferr) {
        results.vixy = { error: ferr.message };
      }
    } else {
      results.vixy = { error: err.message };
    }
  }

  // 3) TSLA
  try {
    results.tsla = await fetchTwelve('TSLA');
  } catch (err) {
    if (/credits/.test(err.message) && FMP_KEY) {
      try {
        results.tsla = await fetchFMP('TSLA');
      } catch (ferr) {
        results.tsla = { error: ferr.message };
      }
    } else {
      results.tsla = { error: err.message };
    }
  }

  // 4) Lithium ETF (LIT)
  try {
    results.lithium = await fetchTwelve('LIT');
  } catch (err) {
    if (/credits/.test(err.message) && FMP_KEY) {
      try {
        results.lithium = await fetchFMP('LIT');
      } catch (ferr) {
        results.lithium = { error: ferr.message };
      }
    } else {
      results.lithium = { error: err.message };
    }
  }

  // 5) Yield Curve Spread
  try {
    const res = await fetch(`${base}/.netlify/functions/yieldSpread?bust=${bust}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    results.yieldCurve = await res.json();
  } catch (err) {
    results.yieldCurve = { error: err.message };
  }

  // 6) Estimated Buffett
  try {
    const res = await fetch(`${base}/.netlify/functions/estimatedBuffett?bust=${bust}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    results.estimatedBuffett = await res.json();
  } catch (err) {
    results.estimatedBuffett = { error: err.message };
  }

  // 7) True Buffett
  try {
    const res = await fetch(`${base}/.netlify/functions/buffett?bust=${bust}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    results.buffett = await res.json();
  } catch (err) {
    results.buffett = { error: err.message };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(results)
  };
}

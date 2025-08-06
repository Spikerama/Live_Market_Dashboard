import fetch from 'node-fetch';

// Unified data fetch for all widgets
export async function handler(event) {
  const bust = Date.now();
  const protocol = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers['host'];
  const base = `${protocol}://${host}`;
  const API_KEY = '26137bba624c4dcb9b5284ad1b234071';
  const results = {};

  // 1) SPY (TwelveData)
  try {
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=SPY&apikey=${API_KEY}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    results.spy = { price: parseFloat(json.close), pct: parseFloat(json.percent_change) };
  } catch (err) {
    results.spy = { error: err.message };
  }

  // 2) VIXY (TwelveData)
  try {
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=VIXY&apikey=${API_KEY}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    results.vixy = { price: parseFloat(json.close), pct: parseFloat(json.percent_change) };
  } catch (err) {
    results.vixy = { error: err.message };
  }

  // 3) TSLA (TwelveData)
  try {
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=TSLA&apikey=${API_KEY}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    results.tsla = { price: parseFloat(json.close), pct: parseFloat(json.percent_change) };
  } catch (err) {
    results.tsla = { error: err.message };
  }

  // 4) Lithium ETF (LIT) (TwelveData)
  try {
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=LIT&apikey=${API_KEY}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    results.lithium = { price: parseFloat(json.close), pct: parseFloat(json.percent_change) };
  } catch (err) {
    results.lithium = { error: err.message };
  }

  // 5) Yield Curve Spread
  try {
    const res = await fetch(`${base}/.netlify/functions/yieldSpread?bust=${bust}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    results.yieldCurve = json;
  } catch (err) {
    results.yieldCurve = { error: err.message };
  }

  // 6) Estimated Buffett
  try {
    const res = await fetch(`${base}/.netlify/functions/estimatedBuffett?bust=${bust}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    results.estimatedBuffett = json;
  } catch (err) {
    results.estimatedBuffett = { error: err.message };
  }

  // 7) True Buffett
  try {
    const res = await fetch(`${base}/.netlify/functions/buffett?bust=${bust}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    results.buffett = json;
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

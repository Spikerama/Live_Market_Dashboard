// netlify/functions/gold.js

// Uses global fetch on Netlify Node 18+

const FRED_KEY = process.env.FRED_KEY;
const TWELVE_KEY = process.env.TWELVE_KEY;
const FMP_KEY = process.env.FMP_KEY;

// Get last two valid observations from a FRED series and compute % change
async function fredLatestPair(seriesId) {
  if (!FRED_KEY) throw new Error('FRED_KEY missing');
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FRED HTTP ${res.status} (${seriesId})${body ? ' - ' + body : ''}`);
  }
  const json = await res.json();
  const obs = Array.isArray(json.observations) ? json.observations : [];
  const clean = obs
    .filter(o => o && o.value !== '.' && o.value != null && !Number.isNaN(Number(o.value)))
    .map(o => ({ date: o.date, value: Number(o.value) }));

  if (clean.length === 0) throw new Error(`No observations for ${seriesId}`);
  const latest = clean[clean.length - 1];
  const prior  = clean[clean.length - 2]; // may be undefined

  const price = latest.value;
  let pct = null;
  if (prior && prior.value) {
    pct = Number((((price - prior.value) / prior.value) * 100).toFixed(2));
  }
  return { price, pct, source: `FRED ${seriesId}` };
}

// TwelveData fallback: spot XAU/USD
async function tdGold() {
  if (!TWELVE_KEY) throw new Error('TWELVE_KEY missing');
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent('XAU/USD')}&apikey=${TWELVE_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
  const json = await res.json();
  if (json.status === 'error') throw new Error(json.message || 'TwelveData error');
  return {
    price: Number(json.close),
    pct: Number(json.percent_change),
    source: 'TwelveData XAU/USD'
  };
}

// FMP fallback: front-month COMEX gold futures (proxy)
async function fmpGold() {
  if (!FMP_KEY) throw new Error('FMP_KEY missing');
  const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent('GC=F')}?apikey=${FMP_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json) || !json[0]) throw new Error('Bad FMP data');
  return {
    price: Number(json[0].price),
    pct: Number(json[0].changesPercentage),
    source: 'FMP GC=F'
  };
}

exports.handler = async () => {
  // Try FRED PM, then FRED AM, then TD, then FMP
  const attempts = [
    () => fredLatestPair('GOLDPMGBD228NLBM'),
    () => fredLatestPair('GOLDAMGBD228NLBM'),
    () => tdGold(),
    () => fmpGold(),
  ];

  const tried = [];
  for (const fn of attempts) {
    try {
      const result = await fn();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ ...result, timestamp: new Date().toISOString() })
      };
    } catch (e) {
      tried.push(e.message || String(e));
    }
  }

  // If everything failed, return a JSON error (HTTP 200 to keep front-end flow)
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      error: 'All gold sources failed',
      _debug: { tried },
      timestamp: new Date().toISOString()
    })
  };
};

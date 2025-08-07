// netlify/functions/buffett.js
import fetch from 'node-fetch';

const FRED_KEY = process.env.FRED_KEY;
if (!FRED_KEY) throw new Error('FRED_KEY environment variable not set');

async function fetchFredSeries(series_id) {
  const url = `https://api.stlouisfed.org/fred/series/observations` +
              `?series_id=${series_id}` +
              `&api_key=${FRED_KEY}` +
              `&file_type=json` +
              `&limit=1&sort_order=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${series_id} HTTP ${res.status}`);
  const { observations } = await res.json();
  if (!observations || !observations[0] || observations[0].value === '.') {
    throw new Error(`No recent data for ${series_id}`);
  }
  const v = parseFloat(observations[0].value);
  if (isNaN(v)) throw new Error(`Invalid value for ${series_id}: ${observations[0].value}`);
  return v;
}

export async function handler(event) {
  try {
    // 1) Get latest total market cap and GDP
    const [marketCap, gdp] = await Promise.all([
      fetchFredSeries('WILL5000INDFC'),
      fetchFredSeries('GDP')
    ]);
    // 2) Compute Buffett %
    const ratio = (marketCap / gdp) * 100;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        ratio: parseFloat(ratio.toFixed(2)),
        marketCap,
        gdp,
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('buffett.js error:', err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: err.message })
    };
  }
}

// netlify/functions/buffett.js
import fetch from 'node-fetch';

export async function handler(event) {
  try {
    const FRED_KEY = process.env.FRED_KEY;
    if (!FRED_KEY) throw new Error('FRED_KEY missing');

    // Fetch the most recent observation for the US market-cap-to-GDP series
    const url = `https://api.stlouisfed.org/fred/series/observations` +
                `?series_id=TOTALMARKETCAPGDP` +
                `&api_key=${FRED_KEY}` +
                `&file_type=json&sort_order=desc&limit=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} from FRED`);
    const json = await res.json();

    const obs = json.observations?.[0];
    if (!obs || obs.value === '.') {
      throw new Error('No valid observation from FRED');
    }

    const ratio = parseFloat(obs.value);
    if (isNaN(ratio)) {
      throw new Error(`Invalid value from FRED: ${obs.value}`);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        ratio,             // your Buffett % 
        date: obs.date     // the date of that reading
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

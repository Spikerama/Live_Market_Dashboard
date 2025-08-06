import fetch from 'node-fetch';

exports.handler = async function(event) {
  try {
    // fetch the live Buffett Indicator JSON, faking a browser UA so we don’t get 403
    const res = await fetch(
      'https://buffettindicator.net/wp-content/themes/flashmag/data/movement.json',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json'
        }
      }
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching movement.json`);
    }

    const json = await res.json();
    const ratio = parseFloat(json.live_price);
    if (isNaN(ratio)) {
      throw new Error(`Invalid live_price in response: ${json.live_price}`);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        ratio,
        day_low:       parseFloat(json.day_low),
        day_high:      parseFloat(json.day_high),
        previous_close:parseFloat(json.previous_close),
        timestamp:     json.timestamp
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
};

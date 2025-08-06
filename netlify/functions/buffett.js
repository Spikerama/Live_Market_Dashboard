// netlify/functions/buffett.js
import fetch from "node-fetch";

export async function handler(event) {
  try {
    const res = await fetch(
      "https://buffettindicator.net/wp-content/themes/flashmag/data/movement.json"
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching movement.json`);

    const json = await res.json();
    const ratio = parseFloat(json.live_price);
    if (isNaN(ratio)) throw new Error(`Invalid live_price: ${json.live_price}`);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        ratio,
        day_low: parseFloat(json.day_low),
        day_high: parseFloat(json.day_high),
        previous_close: parseFloat(json.previous_close),
        timestamp: json.timestamp
      })
    };
  } catch (err) {
    console.error("buffett.js error:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: err.message })
    };
  }
}

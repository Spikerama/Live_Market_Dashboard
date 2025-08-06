// netlify/functions/buffett.js
import fetch from "node-fetch";

exports.handler = async function(event) {
  try {
    // 1) hit the real‐time JSON on buffettindicator.net
    const res = await fetch(
      "https://buffettindicator.net/wp-content/themes/flashmag/data/movement.json"
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching movement.json`);
    }

    // 2) parse out the live_price
    const payload = await res.json();
    const ratio   = parseFloat(payload.live_price);
    if (isNaN(ratio)) {
      throw new Error(`Invalid live_price: ${payload.live_price}`);
    }

    // 3) return just the ratio (you can add other fields if you like)
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ ratio })
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
};

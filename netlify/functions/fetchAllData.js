import fetch from 'node-fetch';

// Unified data fetch for all widgets
export async function handler() {
  const bust = Date.now();
  // Define the endpoints for each widget function
  const endpoints = {
    spy:            `/.netlify/functions/spy?bust=${bust}`,
    vixy:           `/.netlify/functions/vixy?bust=${bust}`,
    tsla:           `/.netlify/functions/tsla?bust=${bust}`,
    lithium:        `/.netlify/functions/lithium?bust=${bust}`,
    yieldCurve:     `/.netlify/functions/yieldSpread?bust=${bust}`,
    estimatedBuffett: `/.netlify/functions/estimatedBuffett?bust=${bust}`,
    buffett:        `/.netlify/functions/buffett?bust=${bust}`
  };

  const results = {};
  // Fetch each endpoint in parallel
  await Promise.all(Object.entries(endpoints).map(async ([key, url]) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      results[key] = await res.json();
    } catch (err) {
      results[key] = { error: err.message };
    }
  }));

  // Return the consolidated payload
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(results)
  };
}

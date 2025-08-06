import fetch from 'node-fetch';

// Unified data fetch for all widgets with dynamic base URL from request headers
export async function handler(event) {
  const bust = Date.now();
  // Determine protocol and host from incoming request
  const protocol = event.headers['x-forwarded-proto'] || 'https';
  const host     = event.headers['host'];
  const base     = `${protocol}://${host}`;

  // Define the endpoints for each widget function
  const endpoints = {
    spy:              `${base}/.netlify/functions/spy?bust=${bust}`,
    vixy:             `${base}/.netlify/functions/vixy?bust=${bust}`,
    tsla:             `${base}/.netlify/functions/tsla?bust=${bust}`,
    lithium:          `${base}/.netlify/functions/lithium?bust=${bust}`,
    yieldCurve:       `${base}/.netlify/functions/yieldSpread?bust=${bust}`,
    estimatedBuffett: `${base}/.netlify/functions/estimatedBuffett?bust=${bust}`,
    buffett:          `${base}/.netlify/functions/buffett?bust=${bust}`
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

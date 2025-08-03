const FRED_KEY = process.env.FRED_KEY;
const SP500_SCALING = 1.30; // multiplier to approximate total US equity market cap from S&P 500

if (!FRED_KEY) {
  exports.handler = async () => ({
    statusCode: 500,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      error: 'FRED_KEY not set in environment. Configure it in Netlify env vars.',
    }),
  });
  return;
}

async function fetchLatestValidFred(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error fetching ${seriesId}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for ${seriesId}`);
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(`Invalid JSON from FRED for ${seriesId}: ${err.message}`);
  }
  const obs = json?.observations;
  if (!Array.isArray(obs) || obs.length === 0) throw new Error(`No data for ${seriesId}`);
  for (const o of obs) {
    const v = o.value;
    if (v === '.' || v === null || v === undefined) continue;
    const parsed = parseFloat(v);
    if (!isNaN(parsed)) return parsed;
  }
  throw new Error(`No valid observation for ${seriesId}`);
}

// Improved S&P 500 cap scraper from SlickCharts with fallback diagnostics
async function fetchSP500MarketCap() {
  const url = 'https://www.slickcharts.com/sp500';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch S&P500 page: HTTP ${res.status}`);
  const html = await res.text();

  // Attempt patterns in order
  const attempts = [
    // e.g., "Total Market Cap: $40.5T" or variations
    /Total Market Cap[:\s]*\$([\d\.,]+)\s*([TtBbMm]?)/i,
    // If label comes after value: "$40.5T Total Market Cap"
    /\$([\d\.,]+)\s*([TtBbMm]?)\s*Total Market Cap/i,
    // Generic first large dollar amount followed by T or B (fallback, risky)
    /\$([\d\.,]+)\s*([TtBbMm])\b/,
  ];

  let capBillions = null;
  let usedPattern = null;

  for (const pat of attempts) {
    const match = html.match(pat);
    if (match) {
      usedPattern = pat.toString();
      let number = match[1].replace(/,/g, '');
      let unit = (match[2] || '').toUpperCase();
      const parsed = parseFloat(number);
      if (isNaN(parsed)) continue;

      if (unit === 'T') {
        capBillions = parsed * 1000;
      } else if (unit === 'B' || unit === '') {
        capBillions = parsed;
      } else if (unit === 'M') {
        capBillions = parsed / 1000;
      } else {
        capBillions = parsed; // assume billions
      }
      break;
    }
  }

  if (capBillions === null) {
    // Provide diagnostic snippet to help adjust parsing later
    const snippet = html.slice(0, 1000); // first 1k chars for context
    throw new Error(`Could not parse S&P 500 market cap from SlickCharts page. Patterns tried. Snippet: ${snippet}`);
  }

  return parseFloat(capBillions.toFixed(2));
}

exports.handler = async function () {
  try {
    const sp500CapBillions = await fetchSP500MarketCap();
    const estimatedTotalMarketCapBillions = parseFloat((sp500CapBillions * SP500_SCALING).toFixed(2));
    const gdpBillions = await fetchLatestValidFred('GDP');

    if (gdpBillions === 0) throw new Error('GDP returned zero, cannot divide');

    const ratio = parseFloat(((estimatedTotalMarketCapBillions / gdpBillions) * 100).toFixed(2));
    const overvalued = ratio > 120;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        ratio,
        overvalued,
        estimatedTotalMarketCapBillions,
        sp500CapBillions,
        gdpBillions,
        multiplierUsed: SP500_SCALING,
        source: 'S&P500-scaled / FRED GDP',
        usedScrapePattern: undefined, // intentionally left blank; front-end can infer if needed
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: err.message,
        debug: 'See function logs for more detail',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

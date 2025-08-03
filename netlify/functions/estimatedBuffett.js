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

// Fetch latest valid observation from FRED for a given series
async function fetchLatestValidFred(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=10`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error fetching ${seriesId}: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`FRED HTTP ${res.status} for ${seriesId}`);
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(`Invalid JSON from FRED for ${seriesId}: ${err.message}`);
  }
  const obs = json?.observations;
  if (!Array.isArray(obs) || obs.length === 0) {
    throw new Error(`No data for ${seriesId}`);
  }
  for (const o of obs) {
    const v = o.value;
    if (v === '.' || v === null || v === undefined) continue;
    const parsed = parseFloat(v);
    if (!isNaN(parsed)) return parsed;
  }
  throw new Error(`No valid observation for ${seriesId}`);
}

// Scrape SlickCharts S&P 500 market cap from their public page
async function fetchSP500MarketCap() {
  const url = 'https://www.slickcharts.com/sp500';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch S&P500 page: HTTP ${res.status}`);
  const html = await res.text();

  // Try to extract the "Total Market Cap" value; fallback to approximate from the header if needed.
  // Regex to catch things like "$40.5T" or "$3,500B"
  const capMatch = html.match(/Total Market Cap[:\s]*\$([\d\.,]+)\s*([TtBbMm]?)/);
  if (!capMatch) {
    // alternative: sometimes it's shown as plain number with unit nearby
    throw new Error('Could not parse S&P 500 market cap from SlickCharts page.');
  }

  let number = capMatch[1].replace(/,/g, '');
  let unit = capMatch[2].toUpperCase();

  let capBillions;
  const parsed = parseFloat(number);
  if (isNaN(parsed)) throw new Error('Parsed S&P 500 market cap is not a number.');

  // Convert to billions USD
  if (unit === 'T') {
    capBillions = parsed * 1000;
  } else if (unit === 'B' || unit === '') {
    capBillions = parsed;
  } else if (unit === 'M') {
    capBillions = parsed / 1000;
  } else {
    capBillions = parsed; // unknown, assume billions
  }

  return capBillions;
}

exports.handler = async function () {
  try {
    // Get S&P 500 market cap in billions, estimate total market cap
    const sp500CapBillions = await fetchSP500MarketCap();
    const estimatedTotalMarketCapBillions = parseFloat((sp500CapBillions * SP500_SCALING).toFixed(2));

    // Get nominal GDP in billions from FRED
    const gdpBillions = await fetchLatestValidFred('GDP');

    if (gdpBillions === 0) throw new Error('GDP returned zero, cannot divide');

    // Buffett Indicator estimate
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

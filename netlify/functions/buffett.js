// netlify/functions/buffett.js
import fetch from 'node-fetch';

/**
 * "True Buffett" (annual, revision-aware):
 *   ratio = (US total market cap, current USD, World Bank) / (US nominal GDP, current USD, FRED) * 100
 * - WB is annual + revised occasionally
 * - FRED GDP is pulled as ANNUAL (GDPCA series), avoiding quarterly conversion
 * - We align to the latest common year
 */
export async function handler() {
  try {
    const FRED_KEY = process.env.FRED_KEY;
    if (!FRED_KEY) {
      throw new Error('FRED_KEY is missing in environment.');
    }

    // --- World Bank: US total market cap (current USD), annual ---
    // Indicator: CM.MKT.LCAP.CD  (Market capitalization of listed domestic companies, current US$)
    async function getWBMarketCapLatestN(years = 70) {
      const url = `https://api.worldbank.org/v2/country/USA/indicator/CM.MKT.LCAP.CD?format=json&per_page=${years}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`World Bank HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json) || !Array.isArray(json[1])) throw new Error('Bad World Bank payload');
      // Build map year -> value (most recent first in WB payload)
      const out = new Map();
      for (const r of json[1]) {
        const y = parseInt(r.date, 10);
        const v = r.value == null ? null : Number(r.value);
        if (!Number.isNaN(y)) out.set(y, v);
      }
      return out; // Map<number, number|null>
    }

    // --- FRED: GDPCA (nominal GDP, not seasonally adjusted, annual, current USD) ---
    async function getFREDGDPAnnualMap() {
      const params = new URLSearchParams({
        series_id: 'GDPCA',                // Nominal GDP, Annual, Not SA, Current USD
        api_key: FRED_KEY,
        file_type: 'json',
        observation_start: '1980-01-01'
      });
      const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.observations)) throw new Error('Bad FRED payload');
      const map = new Map(); // year -> value (USD)
      for (const o of json.observations) {
        const d = o.date; // 'YYYY-MM-DD'
        const y = parseInt(d.slice(0, 4), 10);
        const v = o.value === '.' ? null : Number(o.value);
        if (!Number.isNaN(y)) map.set(y, v * 1e9); // Convert from billions to dollars
      }
      return map;
    }

    const [wbMap, gdpMap] = await Promise.all([
      getWBMarketCapLatestN(),
      getFREDGDPAnnualMap()
    ]);

    // Find the latest common year with non-null WB market cap and a GDP value
    const wbYears = [...wbMap.keys()].sort((a, b) => b - a);
    let chosenYear = null;
    let mcap = null;
    let gdp = null;

    for (const y of wbYears) {
      const mc = wbMap.get(y);
      const gd = gdpMap.get(y);
      if (mc != null && gd != null) {
        chosenYear = y;
        mcap = mc;   // WB is already in US dollars
        gdp = gd;    // FRED already converted to dollars above
        break;
      }
    }

    if (chosenYear == null) {
      throw new Error('No overlapping year between WB market cap and FRED GDP.');
    }

    const ratio = (mcap / gdp) * 100;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        source: { numerator: 'World Bank CM.MKT.LCAP.CD', denominator: 'FRED GDPCA (nominal, annual)' },
        vintage: 'latest revised',
        year: chosenYear,
        ratio,                 // percent, e.g. 170.23
        market_cap_usd: mcap,  // dollars
        gdp_usd: gdp,          // dollars
        note: 'Annual estimate; avoids Wilshire. Uses FRED GDPCA and latest WB data.'
      })
    };
  } catch (err) {
    console.error('buffett.js error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
}

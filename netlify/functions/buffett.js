// netlify/functions/buffett.js
import fetch from 'node-fetch';

/**
 * "True Buffett" using FRED data only:
 *   ratio = (US total market value of equities, quarterly) / (US nominal GDP, quarterly SAAR avg) * 100
 *
 * - Numerator: NCBEILQ027S (Market Value of Equities Outstanding)
 * - Denominator: GDP (nominal GDP, SAAR)
 */
export async function handler() {
  try {
    const FRED_KEY = process.env.FRED_KEY;
    if (!FRED_KEY) {
      throw new Error('FRED_KEY is missing in environment.');
    }

    // --- FRED: Market Value of Equities Outstanding (NCBEILQ027S) ---
    async function getFREDMarketCapMap() {
      const params = new URLSearchParams({
        series_id: 'NCBEILQ027S',
        api_key: FRED_KEY,
        file_type: 'json',
        observation_start: '1980-01-01',
        frequency: 'q'
      });
      const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.observations)) throw new Error('Bad FRED payload for market cap');
      const map = new Map();
      for (const o of json.observations) {
        const d = o.date; // 'YYYY-MM-DD'
        const y = parseInt(d.slice(0, 4), 10);
        const v = o.value === '.' ? null : Number(o.value) * 1e9; // billions to dollars
        if (!Number.isNaN(y)) {
          if (!map.has(y)) map.set(y, []);
          if (v !== null) map.get(y).push(v);
        }
      }
      // Average values per year
      const avgMap = new Map();
      for (const [y, arr] of map.entries()) {
        if (arr.length > 0) avgMap.set(y, arr.reduce((a,b)=>a+b,0) / arr.length);
      }
      return avgMap;
    }

    // --- FRED: nominal GDP (series_id=GDP), annual via frequency param, revision-aware ---
    async function getFREDGDPAnnualMap() {
      const params = new URLSearchParams({
        series_id: 'GDP',
        api_key: FRED_KEY,
        file_type: 'json',
        frequency: 'a',
        observation_start: '1980-01-01',
        realtime_start: '1776-01-01',
        realtime_end: '9999-12-31'
      });
      const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.observations)) throw new Error('Bad FRED payload for GDP');
      const map = new Map();
      for (const o of json.observations) {
        const d = o.date;
        const y = parseInt(d.slice(0, 4), 10);
        const v = o.value === '.' ? null : Number(o.value) * 1e9; // billions to dollars
        if (!Number.isNaN(y) && v !== null) map.set(y, v);
      }
      return map;
    }

    const [mcapMap, gdpMap] = await Promise.all([
      getFREDMarketCapMap(),
      getFREDGDPAnnualMap()
    ]);

    const years = [...mcapMap.keys()].filter(y => gdpMap.has(y)).sort((a,b) => b - a);
    if (years.length === 0) throw new Error('No overlapping year found');

    const latestYear = years[0];
    const mcap = mcapMap.get(latestYear);
    const gdp  = gdpMap.get(latestYear);
    const ratio = (mcap / gdp) * 100;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        source: {
          numerator: 'FRED NCBEILQ027S (avg of quarterly values)',
          denominator: 'FRED GDP (annual avg of SAAR)'
        },
        vintage: 'latest revised',
        year: latestYear,
        ratio,
        market_cap_usd: mcap,
        gdp_usd: gdp,
        note: 'Calculated using only FRED data. Both numerator and denominator in current USD.'
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

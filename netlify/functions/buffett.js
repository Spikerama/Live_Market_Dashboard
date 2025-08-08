// netlify/functions/buffett.js
import fetch from 'node-fetch';

/**
 * "True Buffett" using FRED data only:
 *   ratio = (US total market value of equities, quarterly) / (US nominal GDP, annual SAAR) * 100
 *
 * - Numerator: NCBEILQ027S (Market Value of Equities Outstanding)
 * - Denominator: GDP (nominal GDP, annual SAAR)
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
          if (!map.has(y)) map.set

/**
 * scripts/lib/yahoo-options.mjs
 *
 * Yahoo Finance Options P/C Ratio — 순수 ESM JS (Redis 없음, scripts 전용)
 * GET https://query1.finance.yahoo.com/v7/finance/options/{TICKER}
 */

function sumOI(contracts) {
  return contracts.reduce((s, c) => s + (c.openInterest ?? 0), 0);
}

function calcAtmIV(contracts, spotPrice) {
  if (!spotPrice || !contracts.length) return null;
  const atm = contracts.filter(c => {
    if (!c.strike) return false;
    return Math.abs(c.strike - spotPrice) / spotPrice <= 0.05;
  });
  if (!atm.length) return null;
  const ivVals = atm
    .map(c => c.impliedVolatility)
    .filter(v => typeof v === 'number' && isFinite(v));
  if (!ivVals.length) return null;
  return parseFloat((ivVals.reduce((s, v) => s + v, 0) / ivVals.length).toFixed(4));
}

/**
 * @param {string} ticker Yahoo Finance 티커 (예: AAPL, MSFT)
 * @returns {Promise<{ticker:string,putCallRatio:number|null,totalPutOI:number|null,totalCallOI:number|null,impliedVolatility:number|null}|null>}
 */
export async function fetchOptionsData(ticker) {
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[YahooOptions] HTTP ${res.status} for ${ticker}`);
      return null;
    }

    const json = await res.json();
    const result = json?.optionChain?.result?.[0];
    if (!result) {
      console.warn(`[YahooOptions] no data for ${ticker}`);
      return null;
    }

    const spotPrice = result.quote?.regularMarketPrice;
    const chain = result.options?.[0];
    const calls = chain?.calls ?? [];
    const puts = chain?.puts ?? [];

    const totalCallOI = sumOI(calls);
    const totalPutOI = sumOI(puts);
    const putCallRatio = totalCallOI > 0
      ? parseFloat((totalPutOI / totalCallOI).toFixed(3))
      : null;

    const callIV = calcAtmIV(calls, spotPrice);
    const putIV = calcAtmIV(puts, spotPrice);
    const impliedVolatility =
      callIV != null && putIV != null
        ? parseFloat(((callIV + putIV) / 2).toFixed(4))
        : callIV ?? putIV ?? null;

    return {
      ticker: ticker.toUpperCase(),
      putCallRatio,
      totalPutOI: totalPutOI || null,
      totalCallOI: totalCallOI || null,
      impliedVolatility,
    };
  } catch (err) {
    clearTimeout(timer);
    console.error('[YahooOptions] fetchOptionsData error:', err?.message ?? err);
    return null;
  }
}

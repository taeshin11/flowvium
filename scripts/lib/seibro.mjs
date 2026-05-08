/**
 * scripts/lib/seibro.mjs
 *
 * SEIBRO 공매도/대차잔고 — 순수 ESM JS (Redis 없음, scripts 전용)
 * API Key: process.env.SEIBRO_API_KEY
 */

const BASE_URL = 'https://openapi.seibro.or.kr/openapi/rest';

function parseNum(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function extractFirstItem(body) {
  if (!body || typeof body !== 'object') return null;
  const items = body?.response?.body?.items?.item;
  if (Array.isArray(items)) return items[0] ?? null;
  if (items && typeof items === 'object') return items;
  if (Array.isArray(body.items)) return body.items[0] ?? null;
  if (Array.isArray(body.data)) return body.data[0] ?? null;
  return body;
}

async function callEndpoint(path, stockCode, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // 1차 시도: serviceKey 쿼리파라미터
    const url = `${BASE_URL}${path}?serviceKey=${encodeURIComponent(apiKey)}&isinCd=${stockCode}&numOfRows=1&pageNo=1`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.ok) {
      clearTimeout(timer);
      return await res.json();
    }
  } catch { /* fall through */ }

  // 2차 시도: Bearer 헤더
  const controller2 = new AbortController();
  const timer2 = setTimeout(() => controller2.abort(), 8000);
  try {
    const url2 = `${BASE_URL}${path}?isinCd=${stockCode}&numOfRows=1&pageNo=1`;
    const res2 = await fetch(url2, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller2.signal,
    });
    clearTimeout(timer2);
    if (res2.ok) return await res2.json();
  } catch { /* ignore */ } finally { clearTimeout(timer2); }
  return null;
}

/**
 * @param {string} stockCode 6자리 종목코드
 * @returns {Promise<{stockCode:string,shortBalQty:number|null,shortBalAmt:number|null,shortBalRatio:number|null,borrowBalQty:number|null,date:string}|null>}
 */
export async function fetchSeibroShort(stockCode) {
  const apiKey = process.env.SEIBRO_API_KEY;
  if (!apiKey) {
    console.warn('[SEIBRO] SEIBRO_API_KEY 환경변수 없음');
    return null;
  }

  try {
    const [shortRaw, borrowRaw] = await Promise.all([
      callEndpoint('/shortsale/getStockSrtSelBal', stockCode, apiKey),
      callEndpoint('/shortsale/getStockBorBal', stockCode, apiKey),
    ]);

    const sd = extractFirstItem(shortRaw) ?? {};
    const bd = extractFirstItem(borrowRaw) ?? {};

    // 응답 구조 확인 (개발용)
    console.log(`[SEIBRO] ${stockCode} shortItem:`, JSON.stringify(sd)?.slice(0, 200));
    console.log(`[SEIBRO] ${stockCode} borrowItem:`, JSON.stringify(bd)?.slice(0, 200));

    return {
      stockCode,
      shortBalQty: parseNum(sd.balQty ?? sd.shortBalQty ?? sd.SHORT_BAL_QTY ?? null),
      shortBalAmt: parseNum(sd.balAmt ?? sd.shortBalAmt ?? sd.SHORT_BAL_AMT ?? null),
      shortBalRatio: parseNum(sd.balRat ?? sd.shortBalRatio ?? sd.SHORT_BAL_RAT ?? null),
      borrowBalQty: parseNum(bd.balQty ?? bd.borrowBalQty ?? bd.BORROW_BAL_QTY ?? null),
      date: String(sd.baseDd ?? sd.date ?? sd.BASE_DD ?? new Date().toISOString().slice(0, 10)),
    };
  } catch (err) {
    console.error('[SEIBRO] fetchSeibroShort error:', err?.message ?? err);
    return null;
  }
}

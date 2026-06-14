/**
 * scripts/lib/krx-market-alert.mjs — KRX 시장경보(투자주의/경고/위험) 라이브 (2026-06-14).
 *
 * 사용자 "KRX 소수계좌 거래집중 직접 API 막혔다 → 뚫어봐". data.krx getJsonData 는 anti-bot LOGOUT 이나
 *   KIND investattentwarnrisky.do 는 세션쿠키(GET)+정확폼(method=investattentwarnriskySub,
 *   forward=invstcautnisu_sub, startDate=endDate 일자필수)로 뚫림. 검증: '소수지점/계좌'(=소수계좌
 *   거래집중) 사유로 HS화성·녹십자홀딩스 포착(2026-06-14).
 *
 * src/lib/market-alerts.ts 의 scripts(ESM, Redis 없음) 버전. 스크리너/보고서 ground-truth 보강용.
 */

const KIND = 'https://kind.krx.co.kr/investwarn/investattentwarnrisky.do';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TABS = [
  { category: 'caution', mi: 1, fwd: 'invstcautnisu_sub', om: 4 },
  { category: 'warning', mi: 2, fwd: 'invstwarnisu_sub', om: 3 },
  { category: 'risk', mi: 3, fwd: 'invstriskisu_sub', om: 3 },
];

const ymd = (d) => d.toISOString().slice(0, 10);
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const mkt = (a) => !a ? null : (a.includes('유가') || a.includes('코스피')) ? 'kospi' : a.includes('코스닥') ? 'kosdaq' : a.includes('코넥스') ? 'konex' : null;

async function kindSession() {
  const g = await fetch(`${KIND}?method=investattentwarnriskyMain`, { headers: { 'User-Agent': UA, 'Referer': 'https://kind.krx.co.kr/main.do' }, signal: AbortSignal.timeout(9000) });
  await g.text();
  return (g.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

async function fetchTab(tab, cookie, sd, ed) {
  const body = new URLSearchParams({ method: 'investattentwarnriskySub', forward: tab.fwd, menuIndex: String(tab.mi), marketType: '', currentPageSize: '100', pageIndex: '1', orderMode: String(tab.om), orderStat: 'D', searchCorpName: '', searchFromDate: ed, startDate: sd, endDate: ed });
  const r = await fetch(KIND, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Referer': `${KIND}?method=investattentwarnriskyMain`, 'Origin': 'https://kind.krx.co.kr', 'X-Requested-With': 'XMLHttpRequest', 'Cookie': cookie }, body, signal: AbortSignal.timeout(11000) });
  const html = await r.text();
  if (!r.ok || html.includes('잠시 후')) return [];
  const out = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (tds.length < 3) continue;
    const nameCell = tds[1] ?? ''; const name = strip(nameCell);
    if (!name || name.includes('결과값이 없습니다')) continue;
    const alt = (nameCell.match(/alt=['"]([^'"]+)['"]/) || [])[1];
    const dates = tds.map(strip).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    const reason = tab.category === 'caution' ? (strip(tds[2] ?? '') || null) : null;
    out.push({
      category: tab.category, name, market: mkt(alt), reason,
      fewAccount: tab.category === 'caution' && /소수\s*지점|소수\s*계좌|계좌\s*집중|단일\s*계좌|관여\s*과다/.test(reason || ''),
      designatedDate: dates[0] ?? null, releaseDate: dates[dates.length - 1] ?? null,
    });
  }
  return out;
}

/** 시장경보 3탭 라이브 수집 (ticker 미해소, name 기준). @returns {Promise<Array>} */
export async function fetchMarketAlerts(lookbackDays = 10) {
  const cookie = await kindSession();
  const now = new Date(); const st = new Date(now); st.setDate(st.getDate() - lookbackDays);
  const sd = ymd(st), ed = ymd(now);
  const all = [];
  for (const tab of TABS) { try { all.push(...await fetchTab(tab, cookie, sd, ed)); } catch { /* 부분 허용 */ } }
  return all;
}

/** 회사명 → 6자리 ticker(.KS/.KQ) Naver autocomplete 해소. */
export async function resolveTickerByName(name) {
  try {
    const r = await fetch(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(name)}&target=stock`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://m.stock.naver.com/' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const items = (await r.json())?.items ?? [];
    const exact = items.find((it) => it.name === name) ?? items[0];
    if (exact?.code && /^\d{6}$/.test(exact.code)) return exact.code + ((exact.typeCode || '').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS');
  } catch { /* null */ }
  return null;
}

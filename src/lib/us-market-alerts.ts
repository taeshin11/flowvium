/**
 * src/lib/us-market-alerts.ts — US 공식 surveillance 레이어 (2026-06-14, KRX 소수계좌와 대칭).
 *
 * US 는 한국거래소 "소수계좌 거래집중" 같은 계좌단위 공개피드가 없음(FINRA CAT 내부). 대신 공개·권위
 *   surveillance 3종을 keyless 수집(전부 라이브 검증):
 *     ① Nasdaq Trade Halts RSS — LUDP(변동성정지)·T1/T2(뉴스)·T12(규제)·H10(SEC정지). 급등 직격/규제.
 *     ② FINRA Reg SHO Threshold — 결제실패(FTD) 지속 종목(naked short/조작 surveillance). nasdaqth{date}.
 *     ③ SEC Trading Suspensions — 공식 "사기·조작 의심" 거래정지. EDGAR FTS "order of suspension of trading".
 *
 * 결정론·읽기전용. manipulation-risk US 경로의 공식 cross-check + /screener 시장경보 카드(US 종목).
 */
import type { Redis } from '@upstash/redis';
import { loggedRedisSet } from '@/lib/logger';

export type UsAlertType = 'halt' | 'reg_sho_threshold' | 'sec_suspension';

export interface UsMarketAlert {
  region: 'US';
  category: 'caution' | 'warning' | 'risk';
  ticker: string;
  name: string;
  type: UsAlertType;
  reason: string;          // 한글 사유
  reasonCode?: string;     // halt ReasonCode (T1/T12/H10/LUDP …)
  date: string | null;     // YYYY-MM-DD
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// tag 내용엔 '<' 없음 → [^<]* 사용 ([\s\S] 를 new RegExp 에 넣으면 이스케이프 깨져 매칭 실패함).
const tag = (xml: string, name: string) => (xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`)) || [])[1]?.trim() || '';
const mdyToIso = (s: string) => { const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };

// ── ① Nasdaq/UTP Trade Halts RSS (Nasdaq+NYSE 통합) ──────────────────────────────
// ReasonCode → 심각도. LUDP/LUDS=변동성(급등직격), T1/T2=뉴스, T12=규제(추가정보), H10=SEC거래정지.
function haltSeverity(code: string): { category: UsMarketAlert['category']; reason: string } {
  const c = (code || '').toUpperCase();
  if (c === 'H10' || c === 'H11') return { category: 'risk', reason: `SEC/규제 거래정지(${c})` };
  if (c === 'T12' || c === 'H4' || c === 'H9' || c === 'D') return { category: 'warning', reason: `규제·결격 거래정지(${c})` };
  if (c === 'LUDP' || c === 'LUDS' || c === 'M' || c === 'MWC1' || c === 'MWC2' || c === 'MWC3') return { category: 'caution', reason: `변동성 거래정지(${c}) — 급등/급락 직격` };
  if (c === 'T1' || c === 'T2' || c === 'T6') return { category: 'caution', reason: `뉴스 대기 거래정지(${c})` };
  return { category: 'caution', reason: `거래정지(${c})` };
}

async function fetchHalts(): Promise<UsMarketAlert[]> {
  const r = await fetch('https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(11000), cache: 'no-store' });
  if (!r.ok) return [];
  const xml = await r.text();
  const out: UsMarketAlert[] = [];
  for (const m of Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))) {
    const it = m[1];
    const ticker = (tag(it, 'ndaq:IssueSymbol') || tag(it, 'title')).toUpperCase();
    if (!ticker || !/^[A-Z.\-]{1,6}$/.test(ticker)) continue;
    const code = tag(it, 'ndaq:ReasonCode');
    const sev = haltSeverity(code);
    // resumption 없는(아직 정지중) 또는 당일분만 의미 — 전부 표출하되 최근순. resumption 있으면 해제됨.
    const resumed = !!tag(it, 'ndaq:ResumptionTradeTime');
    if (resumed) continue;   // 이미 재개된 정지는 제외(현재 surveillance 만)
    out.push({ region: 'US', category: sev.category, ticker, name: tag(it, 'ndaq:IssueName') || ticker, type: 'halt', reason: sev.reason, reasonCode: code, date: mdyToIso(tag(it, 'ndaq:HaltDate')) });
  }
  return out;
}

// ── ② FINRA Reg SHO Threshold (Nasdaq-listed 결제실패 지속) ─────────────────────
async function fetchRegShoThreshold(): Promise<UsMarketAlert[]> {
  // 최근 거래일 역순 시도(주말/휴일 가드). 파일은 nasdaqth{YYYYMMDD}.txt.
  const now = new Date();
  for (let back = 0; back < 6; back++) {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - back);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    try {
      const r = await fetch(`https://www.nasdaqtrader.com/dynamic/symdir/regsho/nasdaqth${ymd}.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (!r.ok) continue;
      const txt = await r.text();
      const lines = txt.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2 || !/Symbol\|/.test(lines[0])) continue;
      const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
      const out: UsMarketAlert[] = [];
      for (const line of lines.slice(1)) {
        const [sym, name, , flag] = line.split('|');
        if (!sym || flag !== 'Y') continue;
        out.push({ region: 'US', category: 'caution', ticker: sym.toUpperCase(), name: name || sym, type: 'reg_sho_threshold', reason: 'Reg SHO 결제실패(FTD) 지속 — 공매도/조작 감시', date: iso });
      }
      return out;
    } catch { /* try previous day */ }
  }
  return [];
}

// ── ③ SEC Trading Suspensions (EDGAR FTS) ────────────────────────────────────────
async function fetchSecSuspensions(): Promise<UsMarketAlert[]> {
  const end = new Date(); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 90);
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22order+of+suspension+of+trading%22&startdt=${start.toISOString().slice(0, 10)}&enddt=${end.toISOString().slice(0, 10)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'FlowVium research contact@flowvium.net' }, signal: AbortSignal.timeout(11000), cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json();
  const hits = j?.hits?.hits ?? [];
  const out: UsMarketAlert[] = [];
  for (const h of hits) {
    const dn: string[] = h?._source?.display_names ?? [];
    for (const name of dn) {
      const tk = (name.match(/\(([A-Z][A-Z.\-]{0,5})\)/) || [])[1];
      if (!tk) continue;
      out.push({ region: 'US', category: 'risk', ticker: tk, name: name.replace(/\s*\([^)]*\)/g, '').trim() || tk, type: 'sec_suspension', reason: 'SEC 거래정지 — 사기·조작 의심(공식)', date: h?._source?.file_date ?? null });
    }
  }
  return out;
}

/** US surveillance 3종 라이브 병합 (ticker 중복은 가장 심각한 category 유지). 부분 실패 허용. */
export async function fetchUsMarketAlertsRaw(): Promise<UsMarketAlert[]> {
  const [halts, regsho, susp] = await Promise.all([
    fetchHalts().catch(() => [] as UsMarketAlert[]),
    fetchRegShoThreshold().catch(() => [] as UsMarketAlert[]),
    fetchSecSuspensions().catch(() => [] as UsMarketAlert[]),
  ]);
  // SEC정지(risk) > halt > regsho. ticker별 1건(최심각) 유지하되 type 정보 보존.
  const rank: Record<string, number> = { risk: 0, warning: 1, caution: 2 };
  const byTicker = new Map<string, UsMarketAlert>();
  for (const a of [...susp, ...halts, ...regsho]) {
    const ex = byTicker.get(a.ticker);
    if (!ex || rank[a.category] < rank[ex.category]) byTicker.set(a.ticker, a);
  }
  return Array.from(byTicker.values());
}

const CACHE_KEY = 'us-market-alerts:v1';
// 2026-06-14(ChatGPT §1-2): halt 는 장중 재개되면 빨리 stale → 2h 는 너무 김. halts 가 섞여 있어
//   통합 TTL 을 10분으로 하향(재개된 halt 가 active 처럼 보이는 창 최소화). RegSHO/SEC 는 재fetch 저렴.
const TTL = 60 * 10; // 10min

export interface UsAlertsResult { alerts: UsMarketAlert[]; source: 'live' | 'cache' | 'empty'; asOf: string }

export async function getUsMarketAlerts(redis: Redis | null): Promise<UsAlertsResult> {
  if (redis) {
    try { const c = await redis.get<UsAlertsResult>(CACHE_KEY); if (c?.alerts) return { ...c, source: 'cache' }; } catch { /* live */ }
  }
  let alerts: UsMarketAlert[] = [];
  try { alerts = await fetchUsMarketAlertsRaw(); } catch { alerts = []; }
  if (!alerts.length) return { alerts: [], source: 'empty', asOf: new Date().toISOString() };
  const result: UsAlertsResult = { alerts, source: 'live', asOf: new Date().toISOString() };
  await loggedRedisSet(redis, 'us-market-alerts', CACHE_KEY, result, { ex: TTL });
  return result;
}

/** 캐시-only peek (manipulation-risk 핫패스용). */
export async function peekUsMarketAlerts(redis: Redis | null): Promise<UsAlertsResult | null> {
  if (!redis) return null;
  try { const c = await redis.get<UsAlertsResult>(CACHE_KEY); return c?.alerts ? { ...c, source: 'cache' } : null; } catch { return null; }
}

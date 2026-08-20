/**
 * company-name.mjs — 종목명 해석의 단일 소스.
 *
 * 배경(2026-08-20 발간본 눈검증): 저녁 보고서 '조건부 진입 감시'에 회사명 자리로
 *   제품/사업부문 이름이 찍혔다 — EPYC Server CPUs(AMD) · Networking ASICs(AVGO) · Conductor Etch(LRCX).
 *   generate-report-local.mjs 의 conditionalEntryWatch 가
 *     name: tickerMeta.meta?.[c.ticker]?.name
 *   로 data/candidate-tickers.json 의 meta.name 을 그대로 썼는데, 그 필드가 오염돼 있다
 *   (같은 파일: LOGI → "PC Peripherals (Mice, Keyboards)", BRK.B → "Insurance (GEICO, Gen Re)").
 *
 *   권위 소스는 이미 있었다 — data/company-names.json (904종목,
 *   generate-report-local.mjs:123 이 "실제 회사명 (name 환각 override 권위 소스)"라고 부른다).
 *   AMD → "Advanced Micro Devices" 로 정확히 들어 있는데 쓰는 곳만 안 썼다.
 *
 * 우선순위: 권위 소스 → (KR) krNames → 적격한 meta.name → 티커
 *   meta.name 은 마지막에 두고, 회사명처럼 보일 때만 쓴다(company-name-plausible).
 *   화면에 빈칸이 뜨지 않도록 최후에는 티커를 돌려준다 — null 을 내보내지 않는다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';
import { isPlausibleCompanyName } from './company-name-plausible.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')); } catch { return null; } };

let _auth = null, _kr = null, _meta = null;
function authoritative() { return _auth ??= (readJson('data/company-names.json') ?? {}); }
function krNames()      { return _kr   ??= (readJson('data/candidate-tickers.json')?.krNames ?? {}); }
function defaultMeta()  { return _meta ??= (readJson('data/candidate-tickers.json')?.meta ?? {}); }

/**
 * @param {string} ticker
 * @param {{meta?: Record<string,{name?:string}>, krNames?: Record<string,string>}} [sources]
 *        테스트/호출부가 자체 소스를 주입할 수 있게 열어둔다. 없으면 저장소 기본을 읽는다.
 * @returns {string} 사람이 읽을 이름. 최후에는 티커(빈 문자열/null 을 내지 않는다).
 */
export function resolveCompanyName(ticker, sources = {}) {
  const t = String(ticker ?? '').trim();
  if (!t) return '';

  const auth = authoritative()[t];
  if (typeof auth === 'string' && auth.trim()) return auth.trim();

  const kr = (sources.krNames ?? krNames())[t];
  if (typeof kr === 'string' && kr.trim()) return kr.trim();

  const metaName = (sources.meta ?? defaultMeta())[t]?.name;
  if (typeof metaName === 'string' && metaName.trim() && isPlausibleCompanyName(metaName)) return metaName.trim();

  return t;
}

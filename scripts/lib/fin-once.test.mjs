#!/usr/bin/env node
/**
 * fin-once.test.mjs — 매수 고르기와 발간 전 경합심사(심판)가 **같은 재무**를 보는가. 2026-10-20 신설.
 *
 * 10/20 오후 보고서(14:35): Stage 3 매수 후보가 V 재무를 받아 '영업이익률 60.0%' 로 골랐는데(전년 65.7 → -5.7%p),
 *   20초 뒤 심판(fetchSellSignals)이 같은 주소를 **다시** 받다 실패 → safeFetch 가 null 을 삼켜 opMarginDecline=null →
 *   fund_margin_decline 이 안 걸려 '통과'. 그날 심판 후보 10개 중 9개가 재무 없음(평소 0~2, 대개 ETF).
 *   같은 주소는 05:36:12 스냅샷에서 200·0.2초·cached:true — 엔드포인트는 살아 있었다. 실패 원인은 로그가 없어 모른다.
 *   audit-coverage [5b] 가 'V: buy 가 기존 펀더멘털sell(10-17) 무시 — 정합 게이트 우회' 로 잡았다.
 * 고친 것: 한 실행 안에서 재무는 한 번 받은 것을 두 단계가 같이 쓴다(성공만 기억 — 실패는 다음 단계가 다시 받는다).
 *   그리고 끝내 못 받은 종목은 심판 로그에 남긴다 — '신호 없음' 과 '못 봄' 을 구분한다.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { finOnce } = await import('./fin-once.mjs');

// [1] 앞 단계가 받은 재무는 뒤 단계가 다시 받다 실패해도 그대로 쓴다.
{
  let calls = 0; let up = true;
  const f = finOnce(async () => { calls++; return up ? { latestAnnual: { operatingMarginPct: 60 }, annuals: [{}, { operatingMarginPct: 65.7 }] } : null; });
  const a = await f.get('/api/company-financials/V', 5000);
  up = false;                                                       // 20초 뒤 — 같은 주소가 실패하는 상황
  const b = await f.get('/api/company-financials/V', 5000);
  (b && b.annuals[1].operatingMarginPct - b.latestAnnual.operatingMarginPct > 5 && calls === 1 && a === b)
    ? ok('[1] Stage 3 이 받은 V 재무를 심판이 그대로 본다(다시 받지 않는다) → 마진 -5.7%p 가 보인다') : bad(`[1] calls=${calls} b=${JSON.stringify(b)}`);
}
// [2] 실패는 기억하지 않는다 — 다음 단계가 다시 받고, 끝내 못 받은 것만 misses 에 남는다.
{
  let n = 0;
  const f = finOnce(async () => (++n === 1 ? null : { ok: 1 }));
  const x = await f.get('/a', 5000); const missAfter1 = f.misses().join();
  const y = await f.get('/a', 5000);
  await f.get('/b', 5000).then(() => {});
  (x === null && missAfter1 === '/a' && y?.ok === 1 && n === 3 && f.misses().join() === '')
    ? ok('[2] 실패는 캐시하지 않는다 · 나중에 받으면 misses 에서 빠진다') : bad(`[2] n=${n} misses=${f.misses()}`);
}
// [3] 연결: 두 재무 함수가 같은 finOnce 로 받는다 + 심판이 못 본 종목을 로그에 남긴다.
{
  const src = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8');
  const body = (name) => { const i = src.indexOf(`async function ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i)); };
  const sell = body('fetchSellSignals'), buy = body('fetchBuyFundSignals');
  (/const FIN = finOnce\(safeFetch\)/.test(src) && /await FIN\.get\(url, 5000\)/.test(sell) && /await FIN\.get\(url, 5000\)/.test(buy) && !/safeFetch\(url, 5000\)/.test(sell + buy))
    ? ok('[3a] fetchBuyFundSignals·fetchSellSignals 가 같은 FIN 으로 재무를 받는다') : bad('[3a] 재무를 따로 받는다');
  (/재무 못 받음/.test(sell)) ? ok('[3b] 심판 신호에서 재무를 끝내 못 받은 종목을 로그에 남긴다') : bad('[3b] 못 본 종목이 로그에 안 남는다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * stop-loss-enrich.test.mjs — 손절 근거에 붙는 현재가가 그 종목의 통화로 표기되는가.
 *
 * 배경(2026-08-22): 검증기 오탐률을 추적하다 `harness_currencyMismatch` 가
 *   **최근 7일 60건 · 보고서 12개마다 5건** 으로 가장 큰 항목임을 발견했다(전체 187건/47보고서).
 *   실물을 보니 전부 KR 종목의 원화 금액에 `$` 가 붙어 있었다:
 *     005930.KS … 26만원 이탈 시 … | 현재 $281500
 *     005380.KS … 38.5만원 이탈 시 … | 현재 $415000
 *   앞 문장(만원)은 맞고 뒤에 덧붙은 부분만 틀렸다 — LLM 이 아니라 **코드가 붙인 문자열**이다.
 *
 *   generate-report-local.mjs:3190 enrichStopLoss
 *       parts.push(isEn ? `cur $${lp.price} …` : `현재 $${lp.price} …`)
 *   `isEn` 은 **언어** 분기이지 **통화** 분기가 아니다. `$` 가 하드코딩돼 있다.
 *
 * 왜 고치는가: 하네스(6j-2)가 매 보고서마다 `$`→`₩` 로 되돌리므로 **발간본은 멀쩡했다**.
 *   대신 코드가 만든 문자열을 코드가 고치고 그걸 **모델의 결함으로 적었다** —
 *   harness_currencyMismatch 187건 중 185건이 오귀인이고 진짜 모델 오류는 2건이다.
 *   결함 추세와 오탐률 분석이 그만큼 왜곡됐다. (프롬프트 주입은 아니다: db.mjs:1377 이
 *   harness_* 를 주입에서 제외한다 — 이 점은 처음에 내가 틀리게 봤다가 코드로 확인해 정정했다.)
 *   :680 주석에 2026-05-24 에 같은 증상을 보고 교정기를 붙인 기록이 있다 —
 *   증상만 덮고 생산자는 석 달간 그대로였다.
 *
 * 통화 판정은 이미 단일 출처가 있다(nativeCurrencyForTickerMjs) — 새로 만들지 않는다.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./stop-loss-enrich.mjs')
  .catch((e) => { bad(`stop-loss-enrich.mjs 없음: ${String(e.message).slice(0,50)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

const prices = new Map([
  ['005930.KS', { price: 281500 }],
  ['247540.KQ', { price: 192300 }],
  ['NVDA',      { price: 178.42 }],
]);

// [1] KR 종목은 ₩ — 실측 오탐 187건의 원인
{
  const out = M.enrichStopLoss([{ ticker: '005930.KS', rationale: '반도체 사이클, 26만원 이탈 시' }], prices, new Map(), 'ko');
  const t = out[0].rationale;
  /₩/.test(t) && !/\$/.test(t)
    ? ok(`KR 종목에 원화 기호: ${t.slice(-42)}`)
    : bad(`KR 종목에 $ 가 붙는다: ${t.slice(-52)}`);
  !/\.\d/.test(t.replace(/[\d,]+\.\d+%/g, ''))
    ? ok('원화는 소수점 없이 표기')
    : bad(`원화에 소수점: ${t.slice(-52)}`);
}

// [2] KOSDAQ(.KQ) 도 동일
{
  const t = M.enrichStopLoss([{ ticker: '247540.KQ', rationale: 'x' }], prices, new Map(), 'ko')[0].rationale;
  /₩/.test(t) && !/\$/.test(t) ? ok('KOSDAQ 도 원화') : bad(`KOSDAQ 에 $: ${t.slice(-40)}`);
}

// [3] US 종목은 $ 유지 (회귀 방지)
{
  const t = M.enrichStopLoss([{ ticker: 'NVDA', rationale: 'x' }], prices, new Map(), 'ko')[0].rationale;
  /\$/.test(t) && !/₩/.test(t) ? ok('US 종목은 달러 유지') : bad(`US 표기가 깨졌다: ${t.slice(-40)}`);
}

// [4] 통화 판정은 단일 출처 재사용
const src = readFileSync(resolve(ROOT, 'scripts/lib/stop-loss-enrich.mjs'), 'utf8');
/nativeCurrency/.test(src)
  ? ok('기존 통화 판정 단일 출처를 쓴다')
  : bad('통화 판정을 또 구현했다 — 두 곳이 갈리면 표기가 어긋난다');

// [5] 실제 배선
const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/enrichStopLoss/.test(gen) && /stop-loss-enrich\.mjs/.test(gen)
  ? ok('생성기가 이 모듈을 쓴다')
  : bad('만들었는데 생성기가 안 쓴다 — 소비처 0');
/현재 \$\$\{lp\.price\}/.test(gen)
  ? bad('하드코딩된 $ 가 남아 있다')
  : ok('하드코딩 $ 제거됨');

console.log(fail === 0 ? '\n✅ stop-loss-enrich 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

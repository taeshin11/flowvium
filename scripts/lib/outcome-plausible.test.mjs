#!/usr/bin/env node
/**
 * outcome-plausible.test.mjs — 실현 손익이 '그 기간 실제로 가능한 값' 인가. 2026-10-02 신설.
 *
 * 실측(10/2, 1,732건 중 269건): 'stop_loss' 인데 +149.8%(NVDA 진입 200 · 손절 500 — 손절가가 진입가 위) ·
 *   'sold' +54%(MSFT 진입 330 — 그 기간 최고가 492, 판 값 509 는 불가능). 대부분 초기 추천의 엉뚱한 진입가 탓.
 *   그런 줄이 평균·알파·광고 카드("실제 최고 수익")에 섞인다. 빼면 오히려 나아진다(+1.70 → +1.86%p, 이김 67 → 71%).
 * 규칙(enforce-outcome-invariants 와 같은 원칙 — 라벨은 남기고 '얼마 벌었다' 는 주장만 거둔다):
 *   · 손절가가 진입가 이상이면 그 추천의 손익은 믿을 수 없다
 *   · 닫힌 결과(손절·목표·매도)의 청산가 = 진입가×(1+손익%) 가 그 기간 최저~최고가(±1%) 밖이면 불가능
 */
import { implausibleReason } from './realized-pnl.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const cases = [
  [{ outcome: 'stop_loss', entry: 200.14, stop: 500, pnl: 149.83, lowSeen: 180, highSeen: 237 }, /손절가/, 'NVDA: 손절가가 진입가 위'],
  [{ outcome: 'sold', entry: 330, stop: 300, pnl: 54.31, lowSeen: 320, highSeen: 492 }, /범위/, 'MSFT: 판 값이 기간 최고가 위'],
  [{ outcome: 'sold', entry: 100, stop: 90, pnl: -30, lowSeen: 85, highSeen: 110 }, /범위/, '판 값이 기간 최저가 아래'],
  [{ outcome: 'hit_target', entry: 100, stop: 90, pnl: 18, lowSeen: 95, highSeen: 119 }, null, '정상 목표 도달'],
  [{ outcome: 'stop_loss', entry: 100, stop: 92, pnl: -8, lowSeen: 91, highSeen: 104 }, null, '정상 손절'],
  [{ outcome: 'still_holding', entry: 100, stop: 90, pnl: 5, lowSeen: 97, highSeen: 103 }, null, '보유 중은 현재가 기준 — 범위 검사 안 함'],
  [{ outcome: 'sold', entry: 100, stop: 90, pnl: 5, lowSeen: null, highSeen: null }, null, '범위를 모르면 막지 않는다(별도 규칙이 다룬다)'],
];
for (const [c, want, d] of cases) {
  const r = implausibleReason(c);
  (want ? want.test(r ?? '') : r === null) ? ok(`${d} → ${r ?? '정상'}`) : bad(`${d} → ${r}`);
}
// 저장하는 곳(saveOutcome)이 같은 판정을 쓴다 — 새 줄이 다시 섞이지 않게(검출만 하고 예방이 없으면 계속 샌다)
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('./db.mjs', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export function saveOutcome('), src.indexOf('export function saveOutcome(') + 2500);
  /implausibleReason\(/.test(fn) ? ok('saveOutcome 이 저장 전에 같은 판정을 쓴다') : bad('saveOutcome 에 판정이 없다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

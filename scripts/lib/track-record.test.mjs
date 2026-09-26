#!/usr/bin/env node
/**
 * track-record.test.mjs — 최근에 계속 진 종목은 새로 사지 않는다(종목 자체 성적 veto). 2026-09-26 신설.
 *
 * 사장님 "우리가 놓친 요소가 없는지 항상 확인해야되" → "제일 좋은 방법으로".
 * 실측(전향 평가, (종목,추천일) 단위, 추천일 **이전에 결과가 난** 것만 써서 미래 정보 없음):
 *   직전 30일 결과 3건+ 중 수익 34% 미만인 종목의 다음 추천 41건 → 수익 34% · 평균 -1.33%
 *   그 밖 242건 → 62% · +1.76% / 기록 부족 607건 → 67% · +1.68%   (z ≈ -4, 우연 아님)
 *   엔진은 종목 **자신의** 최근 성적을 전혀 보지 않았다 — 214450.KQ·003230.KS 가 계속 추천됐다.
 * 같은 날 여러 보고서가 같은 판단을 반복하므로 **(종목, 추천일) 하나로** 센다(아니면 한 판단이 22건이 된다).
 */
import { trackRecordVeto, summarizeTrack } from './track-record.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 같은 날 반복은 하나로 센다
{
  const s = summarizeTrack([
    { day: '2026-09-01', pnl: -5 }, { day: '2026-09-01', pnl: -5 }, { day: '2026-09-01', pnl: -5 },
    { day: '2026-09-02', pnl: -5 }, { day: '2026-09-03', pnl: 2 },
  ]);
  (s.n === 3 && s.wins === 1) ? ok('[1] 5행 → (종목,날) 3건, 이긴 것 1') : bad(`[1] ${JSON.stringify(s)}`);
}
// [2] 3건 이상 · 수익 34% 미만 → veto (사유 문자열)
{
  const v = trackRecordVeto([{ day: '2026-09-01', pnl: -5 }, { day: '2026-09-02', pnl: -4 }, { day: '2026-09-03', pnl: 1 }]);
  (typeof v === 'string' && /최근 30일/.test(v) && /1\/3/.test(v)) ? ok(`[2] 1/3 → veto: ${v.slice(0, 60)}`) : bad(`[2] ${v}`);
}
// [3] 표본이 모자라면 판단하지 않는다(2건)
trackRecordVeto([{ day: '2026-09-01', pnl: -5 }, { day: '2026-09-02', pnl: -4 }]) === null ? ok('[3] 2건뿐 → 판단 안 함') : bad('[3]');
// [4] 34% 이상이면 통과 (2/5 = 40%)
trackRecordVeto([1, -1, -1, 1, -1].map((p, i) => ({ day: `2026-09-0${i + 1}`, pnl: p }))) === null ? ok('[4] 2/5=40% → 통과') : bad('[4]');
// [5] 빈 기록 → 판단 안 함
trackRecordVeto([]) === null && trackRecordVeto(undefined) === null ? ok('[5] 기록 없음 → 판단 안 함') : bad('[5]');
// [6] 보고서 두 경로 모두에 걸려 있다 — funnel(Stage2) 과 최종 심판(LLM 이 밖에서 고른 종목). 한 곳만이면 다른 쪽으로 샌다.
{
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const { ROOT } = await import('./project-root.mjs');
  const src = readFileSync(join(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
  const n = (src.match(/trackRecordVeto\(buyTrackMap\(\)\.get\(/g) ?? []).length;
  n >= 2 ? ok(`[6] generate-report-local 두 경로에 걸림(${n}곳)`) : bad(`[6] ${n}곳 — 두 경로 모두여야 한다`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

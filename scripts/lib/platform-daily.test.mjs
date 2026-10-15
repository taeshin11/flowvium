#!/usr/bin/env node
/**
 * platform-daily.test.mjs — 플랫폼별 일일 기록(scripts/platform-daily.mjs)의 계산. 2026-10-15 신설.
 *
 * 왜(사장님 10/14 "구독 전환율, 시청률, 노출수, 조회수 다 챙겨라 … 플랫폼마다 다른 전략"):
 *   숫자를 매일 같은 자리에 쌓아야 7일 뒤 '적용한 것' 의 효과를 잰다.
 * 지켜야 할 것:
 *   - 모르는 값은 0 이 아니라 null(unknown). 쇼츠 노출수·CTR 은 YouTube API 가 주지 않는다 — 0 으로 적으면
 *     '노출 0' 이라는 거짓 기록이 된다(메모리 gate-that-can-never-fire: 모르면 ok 가 아니라 unknown).
 *   - 분석 데이터는 2~3일 늦게 찬다. 아직 안 찬 날(조회 0)을 기록하면 '조회 0인 날' 이 된다 → 찬 날만 쓴다.
 *   - 같은 날·같은 플랫폼은 한 줄. 하루 여러 번 돌아도 덮어쓴다.
 *   - 블로그 하루 조회는 누적(all-time) 차이. 이전 기록이 없으면 null.
 */
import { ytRecord, lastFilledDay, upsertDaily, blogRecord } from './platform-daily.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

{
  const r = ytRecord({ day: '2026-10-11', views: 9102, engagedViews: 3900, averageViewPercentage: 63.1, subscribersGained: 17, subscribersLost: 1, shares: 12 });
  r.impressions === null && r.ctr === null ? ok('[1] 노출·CTR 은 unknown(null) — 0 이 아니다') : bad(`[1] ${r.impressions} ${r.ctr}`);
  r.subsPer1k === 1.87 ? ok('[2] 1천회당 구독 = 17/9102×1000 → 1.87') : bad(`[2] ${r.subsPer1k}`);
  r.netSubs === 16 && r.viewedRate === 0.428 ? ok('[3] 순증 16 · 본 비율 0.428') : bad(`[3] ${r.netSubs} ${r.viewedRate}`);
  r.platform === 'youtube' && r.date === '2026-10-11' ? ok('[4] 플랫폼·날짜') : bad(`[4] ${r.platform} ${r.date}`);
}
{
  const rows = [['2026-10-10', 7707], ['2026-10-11', 9102], ['2026-10-12', 0], ['2026-10-13', 0]];
  lastFilledDay(rows) === '2026-10-11' ? ok('[5] 아직 안 찬 날(조회 0)은 건너뛴다') : bad(`[5] ${lastFilledDay(rows)}`);
  lastFilledDay([['2026-10-12', 0]]) === null ? ok('[6] 찬 날이 없으면 null') : bad('[6]');
}
{
  const lines = [{ date: '2026-10-10', platform: 'youtube', views: 1 }, { date: '2026-10-10', platform: 'blogger', views: 2 }];
  const out = upsertDaily(lines, { date: '2026-10-10', platform: 'youtube', views: 5 });
  out.length === 2 && out.find((x) => x.platform === 'youtube').views === 5 ? ok('[7] 같은 날·플랫폼은 덮어쓴다') : bad(`[7] ${JSON.stringify(out)}`);
  upsertDaily(out, { date: '2026-10-11', platform: 'youtube', views: 7 }).length === 3 ? ok('[8] 새 날은 추가') : bad('[8]');
}
{
  const first = blogRecord({ date: '2026-10-15', counts: { ALL_TIME: 20, THIRTY_DAYS: 20, SEVEN_DAYS: 15 }, posts: 71, prev: null });
  first.viewsDay === null && first.views7d === 15 && first.posts === 71 ? ok('[9] 블로그 첫 기록: 하루 조회 unknown, 7일 15') : bad(`[9] ${JSON.stringify(first)}`);
  const next = blogRecord({ date: '2026-10-16', counts: { ALL_TIME: 26, THIRTY_DAYS: 26, SEVEN_DAYS: 18 }, posts: 72, prev: first });
  next.viewsDay === 6 ? ok('[10] 다음 날: 누적 차이 26−20 = 6') : bad(`[10] ${next.viewsDay}`);
  next.subsPer1k === null && next.impressions === null ? ok('[11] 블로그에 없는 지표는 unknown') : bad('[11]');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

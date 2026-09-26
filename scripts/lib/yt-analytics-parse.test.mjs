#!/usr/bin/env node
/**
 * yt-analytics-parse.test.mjs — 영상별 '안 넘기고 본 비율'(engagedViews/views)을 모은다. 2026-09-26 신설.
 * 실측(9/1~9/26, 156편): 조회수와의 상관 — engaged 비율 0.56 · 시청% 0.05 · 길이 -0.10.
 *   쇼츠는 첫 1~2초에 63% 가 넘긴다(engaged 중앙 0.37). 조회수 천장의 손잡이가 이것인데 DB 에 없었다.
 */
import { parseAnalyticsRows } from './yt-analytics-parse.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const headers = ['video', 'views', 'engagedViews', 'averageViewPercentage', 'subscribersGained'].map((name) => ({ name }));
const m = parseAnalyticsRows(headers, [['a', 1000, 370, 68.2, 2], ['b', 0, 0, 0, 0], ['c', 500, null, 50, 1]]);
const a = m.get('a');
(a && Math.abs(a.engagedRatio - 0.37) < 1e-9 && a.avgViewPct === 68.2 && a.subs === 2) ? ok('[1] 비율·시청%·구독 파싱') : bad(`[1] ${JSON.stringify(a)}`);
(m.get('b').engagedRatio === null) ? ok('[2] 조회 0 → 비율 null(0 으로 적지 않는다)') : bad(`[2] ${JSON.stringify(m.get('b'))}`);
(m.get('c').engagedRatio === null && m.get('c').subs === 1) ? ok('[3] engagedViews 없음 → null, 나머지는 산다') : bad(`[3] ${JSON.stringify(m.get('c'))}`);
// 열 순서가 바뀌어도(헤더 이름으로 찾는다)
const m2 = parseAnalyticsRows(['subscribersGained', 'video', 'engagedViews', 'views'].map((name) => ({ name })), [[3, 'x', 50, 100]]);
(m2.get('x')?.engagedRatio === 0.5 && m2.get('x').subs === 3) ? ok('[4] 열 순서와 무관(헤더 이름으로)') : bad(`[4] ${JSON.stringify(m2.get('x'))}`);
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

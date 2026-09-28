#!/usr/bin/env node
/**
 * footage-archival.test.mjs — 오늘 뉴스 장면에 수십 년 전 기록사진을 깔지 않는다. 2026-09-29 신설.
 *
 * 9/29 00:50 예비(외교부·우크라 포로 송환 허위공보)의 넷째 장면이 Wikimedia
 *   "North Korean Prisoners, 18 September 195x"(한국전쟁 사진)였다. 시청자는 이번 송환 장면으로 읽는다.
 *   원인: footageYear 가 1980~2049 만 읽어 1950 을 "연도 모름" 으로 두었고, preferRecent 는 순서만 바꿀 뿐 거르지 않는다.
 * → archivalYear: 제목에 **떨어져 쓰인** 4자리 연도(1850~2049)를 읽는다(IMG_1987 같은 파일 번호는 아님).
 *   dropArchival: 그 연도가 지금보다 maxAgeY(기본 20)년 넘게 옛날이면 뺀다. 연도를 모르면 **남긴다**(모름 ≠ 옛날).
 */
import { archivalYear, dropArchival } from './footage.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const cases = [
  ['North Korean Prisoners, 18 September 1950', 1950], ['Seoul 1988 Olympics', 1988], ['외교부 청사 2021', 2021],
  ['IMG_1987.jpg', null], ['DSC01950.JPG', null], ['File:Ministry of Foreign Affairs.jpg', null], ['photo-1953x1200', null],
];
const got = cases.map(([t]) => archivalYear(t));
cases.every(([, y], i) => got[i] === y) ? ok(`[1] 연도 읽기: ${cases.map(([t], i) => `${t.slice(0, 18)}→${got[i]}`).join(' · ')}`) : bad(`[1] ${JSON.stringify(got)}`);
const now = 2026;
const c = [{ title: 'North Korean Prisoners, 18 September 1950' }, { title: '외교부 청사 2021' }, { title: '외교부 청사' }, { title: 'Seoul 2005 rally' }];
const kept = dropArchival(c, { now }).map((x) => x.title);
(kept.length === 2 && kept.includes('외교부 청사 2021') && kept.includes('외교부 청사'))
  ? ok(`[2] 20년 넘은 기록사진은 뺀다 · 연도 모르는 건 남긴다: ${kept.join(' | ')}`) : bad(`[2] ${JSON.stringify(kept)}`);
// [3] make-shorts 가 세 곳의 고르기 모두에서 거른다(소스)
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  const n = (src.match(/preferRecent\(dropArchival\(/g) ?? []).length;
  const all = (src.match(/preferRecent\(/g) ?? []).length;
  (n >= 3 && n === all) ? ok(`[3] make-shorts 고르기 ${n}곳 모두 기록사진을 거른다`) : bad(`[3] ${n}/${all}곳`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

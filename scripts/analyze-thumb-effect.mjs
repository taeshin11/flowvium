#!/usr/bin/env node
/**
 * analyze-thumb-effect.mjs — 세로 썸네일을 붙인 뒤 조회수가 달라졌는가. (2026-09-18 신설)
 *
 * 경계: 2026-09-18T09:22:40Z (d3Dq9JtQAG4) 부터 **사진이 제대로 붙은** 썸네일이 올라간다.
 *   그 직전 회차(6xK91VKWR5Q)는 썸네일이 붙긴 했으나 새까맸다 — 어느 쪽으로도 세지 않는다.
 *
 * ⚠ 이건 통제된 A/B 가 아니다. 회차마다 소재가 다르고, 쇼츠 피드 노출은 썸네일이 아니라
 *   초반 이탈률이 좌우한다. 썸네일이 보이는 자리는 검색·채널·추천이다.
 *   그러므로 **큰 차이만** 의미가 있다. 작은 차이는 소재 운으로 설명된다.
 *
 * 성숙도: 이 채널 쇼츠는 48시간이면 최종의 94%가 찬다(실측). 그래서 48시간 지난 편만 센다.
 *
 * 사용: node scripts/analyze-thumb-effect.mjs [--mature-hours 48] [--before-days 14]
 */
import { openDb } from './lib/db.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const MATURE = arg('mature-hours', 48);
const BEFORE_DAYS = arg('before-days', 14);
const CUTOFF = '2026-09-18T09:22:40Z';
const BLACK = '6xK91VKWR5Q';   // 썸네일이 새까맸던 회차 — 양쪽 어디에도 안 넣는다

const db = openDb();
const rows = db.prepare(`
  SELECT p.video_id, p.published_at, p.headline,
         (SELECT MAX(s.views) FROM shorts_stats s WHERE s.video_id = p.video_id) AS views
    FROM shorts_published p
   WHERE p.retracted_at IS NULL
     AND datetime(p.published_at) >= datetime(?, ?)
   ORDER BY p.published_at`).all(CUTOFF, `-${BEFORE_DAYS} days`);

const now = Date.now();
const mature = rows.filter((r) => {
  if (r.video_id === BLACK) return false;
  if (r.views == null) return false;
  return (now - Date.parse(r.published_at)) / 3600000 >= MATURE;
});

const before = mature.filter((r) => r.published_at < CUTOFF).map((r) => r.views);
const after = mature.filter((r) => r.published_at >= CUTOFF).map((r) => r.views);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const fmt = (n) => (n == null ? '—' : n.toLocaleString('ko-KR'));

console.log(`세로 썸네일 전후 비교 (${MATURE}시간 이상 묵은 편만, 최근 ${BEFORE_DAYS}일)`);
console.log(`  경계: ${CUTOFF}  ·  제외: ${BLACK}(썸네일이 검게 나간 회차)\n`);
console.log('  구분      편수   조회수 중앙값');
console.log(`  이전      ${String(before.length).padStart(4)}   ${fmt(med(before))}`);
console.log(`  이후      ${String(after.length).padStart(4)}   ${fmt(med(after))}`);

if (!after.length) {
  console.log('\n아직 이후 표본이 없다 — 48시간 묵은 새 회차가 생기면 다시 돌려라.');
  process.exit(0);
}
const b = med(before); const a = med(after);
if (b && a) {
  const pct = ((a - b) / b) * 100;
  console.log(`\n  차이: ${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`);
}
// 표본이 적으면 무슨 숫자가 나와도 소재 운과 구분되지 않는다. 그 사실을 숫자와 같은 자리에 적는다.
const small = Math.min(before.length, after.length);
if (small < 20) {
  console.log(`\n⚠ 표본이 적다(적은 쪽 ${small}편). 이 채널은 회차별 조회수가 36~1367 로 흩어져 있어,`);
  console.log('  20편 미만에서는 ±50% 안쪽의 차이를 소재 운과 구분할 수 없다. 판정 보류.');
} else {
  console.log('\n표본은 충분하다. 다만 통제된 A/B 가 아니므로 소재 구성이 바뀌었는지 같이 본다.');
}

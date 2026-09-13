#!/usr/bin/env node
/**
 * analyze-shorts-views.mjs — 조회수가 낮았던 편은 왜 낮았나. (2026-09-13 신설)
 *
 * 왜 따로 재는가: "낮은 편" 을 그냥 줄 세우면 **거의 다 특정 날짜에 몰린다.**
 *   실측 — 09-05~07 은 평균 1,000 대, 09-08~09 은 200~380 대다. 그 차이는 영상이 아니라
 *   그날 배분의 차이다. 내용 탓으로 읽으면 엉뚱한 데를 고친다.
 *
 * 그래서 두 층으로 나눈다:
 *   ① 날짜 효과  — 같은 날 안에서는 다 같이 낮았나 (배분 문제)
 *   ② 날짜 안 변동 — 같은 날 안에서 갈린 이유는 무엇인가 (편 자체 문제)
 *   ②는 **그날 순위(백분위)** 로 본다. 날짜 효과를 빼야 편의 특성이 보인다.
 *
 * 나이를 맞춘다: 하루 지난 편과 방금 올린 편을 같이 세면 그건 조회수가 아니라 나이다.
 *
 *   **몇 시간에 맞출 것인가가 결론을 바꾼다.** 종전에는 9시간에 맞춰 봤는데 실측하니
 *   53편 중 14편(26%)이 9시간→48시간 사이에 두 배 넘게 늘었고, 9시간 값은 48시간 값의
 *   평균 69%밖에 안 된다. 극단은 5회 → 1,208회(241배)다. 쇼츠 피드는 하루 뒤에도 집어 올린다.
 *   그래서 **48시간을 기본으로 본다.** 9시간은 아직 48시간이 안 된 편에만 참고로 쓴다.
 */
import { openDb } from './lib/db.mjs';
import { direction, describe } from './lib/edge-significance.mjs';

const db = openDb();
const rows = db.prepare(`
  WITH w AS (
    SELECT s.video_id, p.published_at, p.headline, p.issue_key, p.duration_sec,
           s.views, s.likes, s.age_hours, s.title,
           CASE WHEN s.age_hours BETWEEN 40 AND 60 THEN 0 ELSE 1 END AS tier,
           ROW_NUMBER() OVER (
             PARTITION BY s.video_id, CASE WHEN s.age_hours BETWEEN 40 AND 60 THEN 0 ELSE 1 END
             ORDER BY ABS(s.age_hours - CASE WHEN s.age_hours BETWEEN 40 AND 60 THEN 48 ELSE 9 END)
           ) rn
    FROM shorts_stats s
    JOIN shorts_published p ON p.video_id = s.video_id
    WHERE p.retracted_at IS NULL AND s.views IS NOT NULL
      AND (s.age_hours BETWEEN 40 AND 60 OR s.age_hours BETWEEN 5 AND 14)
  ),
  best AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY tier) pick FROM w WHERE rn = 1)
  SELECT * FROM best WHERE pick = 1 ORDER BY published_at
`).all();

if (rows.length < 10) { console.log(`표본 ${rows.length}건 — 분석에 부족하다`); process.exit(0); }

// KST 로 본다. 사람이 보는 시각이 그쪽이다.
const kstHour = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).getUTCHours();
const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

for (const r of rows) {
  const t = r.title ?? '';
  r.day = kstDay(r.published_at);
  r.hour = kstHour(r.published_at);
  r.titleLen = t.replace(/#Shorts\s*$/i, '').trim().length;
  r.gukppong = /🇰🇷/.test(t);                       // "또 해냈습니다" 류 고정 템플릿
  r.breaking = /^\[속보\]/.test(t);
  r.quoted = /^["'"']/.test(t.trim());              // 따옴표 인용으로 시작
  r.hasNumber = /\d/.test(t);
  r.topic = /대통령|여야|국힘|민주당|검찰|국회|의원|장관/.test(t) ? '정치'
    : /이란|미군|트럼프|中|美|유가|전쟁|공습|관세/.test(t) ? '국제'
    : /급등|급락|증시|코스피|주가|금리|환율|실적|수출/.test(t) ? '증시'
    : '기타';
}

// ── 날짜 효과 ────────────────────────────────────────────────────────────────
const byDay = new Map();
for (const r of rows) { if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push(r); }
const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };

const n48 = rows.filter((r) => r.tier === 0).length;
console.log(`① 날짜 효과 — 48시간 기준 ${n48}편 · 아직 48시간이 안 돼 9시간으로 본 편 ${rows.length - n48}편\n`);
console.log('   날짜         편수  중앙값   최저   최고   좋아요/1천회');
for (const [d, list] of [...byDay].sort()) {
  const vs = list.map((r) => r.views);
  const lk = list.reduce((s, r) => s + (r.likes ?? 0), 0);
  const tv = list.reduce((s, r) => s + r.views, 0);
  console.log(`   ${d}  ${String(list.length).padStart(4)}  ${String(med(vs)).padStart(6)}  ${String(Math.min(...vs)).padStart(5)}  ${String(Math.max(...vs)).padStart(5)}  ${(tv ? lk / tv * 1000 : 0).toFixed(1).padStart(8)}`);
}

// ── 날짜 안 백분위 ───────────────────────────────────────────────────────────
for (const list of byDay.values()) {
  const sorted = [...list].sort((a, b) => a.views - b.views);
  sorted.forEach((r, i) => { r.pct = list.length > 1 ? i / (list.length - 1) * 100 : 50; });
}

/**
 * 한 특성이 그날 순위를 가르는가.
 *
 * 중앙값 차이만 보면 표본 4~6건짜리도 커 보인다. 그래서 **동전과 구별되는지** 를 같이 묻는다 —
 * 그 특성을 가진 편이 '그날 중간 위'에 앉는 비율이 0.5 와 유의하게 다른가(Wilson 90%).
 * 룰 튜닝에서 쓰는 같은 잣대다(edge-significance.mjs). 감으로 문턱을 정하지 않는다.
 */
const cmp = (label, pick) => {
  const yes = g.filter(pick), no = g.filter((r) => !pick(r));
  if (yes.length < 3 || no.length < 3) return console.log(`   ${label.padEnd(18)} 표본 부족 (${yes.length} vs ${no.length})`);
  const py = med(yes.map((r) => r.pct)), pn = med(no.map((r) => r.pct));
  const vy = med(yes.map((r) => r.views)), vn = med(no.map((r) => r.views));
  const above = yes.filter((r) => r.pct > 50).length;
  const dir = direction({ wins: above, losses: yes.length - above });
  const verdict = dir > 0 ? '↑ 유리' : dir < 0 ? '↓ 불리' : '· 판정 보류';
  console.log(`   ${label.padEnd(18)} n=${String(yes.length).padStart(3)}  그날 순위 ${py.toFixed(0).padStart(3)}%ile vs ${pn.toFixed(0)}%ile  (조회 ${vy} vs ${vn})  `
    + `${verdict}  [중간 위 ${describe({ wins: above, losses: yes.length - above })}]`);
};

// ②는 **48시간 자료만** 쓴다. 9시간 표본을 섞으면 안 된다 —
//   9시간 값은 48시간 값의 69%라 아직 이틀이 안 된 편이 조직적으로 낮게 앉는다.
//   최근 편은 발행 시간대가 한쪽에 몰려 있어서, 섞으면 **없는 시간대 효과가 생긴다.**
//   실제로 섞은 자료에서는 "오전 6~12시 불리(6/20, 16~48%)"가 나왔는데
//   48시간 자료만 보면 5/14(19~57%)로 판정이 서지 않는다. 그 차이가 전부 이 오염이었다.
const g = rows.filter((r) => r.tier === 0);
for (const list of Object.values(Object.fromEntries([...new Set(g.map((r) => r.day))].map((d) => [d, g.filter((r) => r.day === d)])))) {
  const sorted = [...list].sort((a, b) => a.views - b.views);
  sorted.forEach((r, i) => { r.pct = list.length > 1 ? i / (list.length - 1) * 100 : 50; });
}
console.log(`\n② 날짜 안에서 갈린 이유 — 48시간 자료 ${g.length}편만 (9시간 표본을 섞으면 없는 효과가 생긴다)\n`);
cmp('🇰🇷 국뽕 제목', (r) => r.gukppong);
cmp('[속보] 로 시작', (r) => r.breaking);
cmp('따옴표로 시작', (r) => r.quoted);
cmp('숫자 포함', (r) => r.hasNumber);
cmp('제목 30자 이상', (r) => r.titleLen >= 30);
cmp('제목 20자 미만', (r) => r.titleLen < 20);

console.log('\n   — 주제별');
for (const t of ['정치', '국제', '증시', '기타']) cmp(t, (r) => r.topic === t);

console.log('\n   — 발행 시각(KST)');
cmp('새벽 0~6시', (r) => r.hour < 6);
cmp('오전 6~12시', (r) => r.hour >= 6 && r.hour < 12);
cmp('오후 12~18시', (r) => r.hour >= 12 && r.hour < 18);
cmp('저녁 18~24시', (r) => r.hour >= 18);

// ── 바닥권은 정말 '내용' 때문인가 ────────────────────────────────────────────
console.log('\n③ 바닥권 — 그날 하위 20% 안에 든 편\n');
const bottom = rows.filter((r) => r.pct <= 20).sort((a, b) => a.views - b.views);
console.log(`   ${bottom.length}건. 날짜 분포: ${[...new Set(bottom.map((r) => r.day))].sort().map((d) => `${d}(${bottom.filter((r) => r.day === d).length})`).join(' ')}`);
for (const r of bottom.slice(0, 12)) {
  console.log(`   ${String(r.views).padStart(5)}회 ${String(r.likes ?? 0).padStart(2)}♥ ${r.day} ${String(r.hour).padStart(2)}시 [${r.topic}] ${String(r.title ?? '').replace(/#Shorts\s*$/i, '').slice(0, 40)}`);
}

// ── 거의 0인 편은 다른 종류의 문제다 ─────────────────────────────────────────
const dead = rows.filter((r) => r.views < 60 && r.tier === 0);   // 48시간이 지나고도 60회 미만
if (dead.length) {
  console.log(`\n④ 48시간이 지나도 안 뜬 편 (60회 미만) — ${dead.length}건\n`);
  console.log('   같은 날 다른 편이 수백~천 회인데 이것만 한 자릿수면 내용 문제가 아니다.');
  for (const r of dead) {
    const sameDay = byDay.get(r.day).filter((x) => x.video_id !== r.video_id).map((x) => x.views);
    console.log(`   ${String(r.views).padStart(4)}회 · ${r.day} ${String(r.hour).padStart(2)}시 · 같은 날 나머지 중앙값 ${med(sameDay) ?? '-'}회 · ${String(r.title ?? '').replace(/#Shorts\s*$/i, '').slice(0, 40)}`);
  }
}

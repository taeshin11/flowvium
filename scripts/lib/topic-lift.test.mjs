#!/usr/bin/env node
/**
 * topic-lift.test.mjs — 주제별 조회수 성적을 **공정하게** 재는가. 2026-09-24 신설.
 *
 * 사장님 "다음 주제를 정할 때는 조회수 분석해서 해라".
 * 기존 weakByViews 는 신호를 못 냈다(지금 데이터로 약한 갈래·강한 갈래 둘 다 빈 값). 원인 둘:
 *   (1) **나이를 안 맞췄다** — 8시간 된 영상과 300시간 된 영상을 원시 조회수로 비교했다.
 *   (2) **날짜를 안 가렸다** — 9/3~7 은 채널 전체가 1,300대, 9/9 는 477. 주제 효과보다 크다.
 * 그래서 영상마다 48시간 무렵 조회수를 쓰고, **같은 날 올린 영상들의 중앙값으로 나눈다.**
 */
import { topicLift, pickNear, topicTier } from './topic-lift.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 나이 맞추기 — 한 영상의 여러 관측 중 48h 에 가장 가까운 것을 쓴다(24~72h 창 밖은 버린다)
{
  const obs = [{ age_hours: 10, views: 100 }, { age_hours: 46, views: 900 }, { age_hours: 120, views: 2000 }];
  pickNear(obs, 48)?.views === 900 ? ok('[1] 48h 근처 관측을 고른다') : bad(`[1] ${JSON.stringify(pickNear(obs, 48))}`);
  pickNear([{ age_hours: 10, views: 1 }], 48) === null ? ok('[1b] 창 밖(10h)만 있으면 쓰지 않는다') : bad('[1b]');
}

// [2] ★ 날짜 효과를 뺀다 — 잘 되던 날 올린 주제가 이긴 것처럼 보이면 안 된다
//     A 주제는 채널이 뜨던 날(모두 1,500)에만, B 주제는 가라앉던 날(모두 500)에만 올렸다.
//     원시 조회수로는 A 가 3배지만, 같은 날 또래 대비로는 둘 다 1.0 이다.
{
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ video_id: `a${i}`, views: 1500, age_hours: 48, published_at: '2026-09-05T03:00Z', topic: 'A' });
  for (let i = 0; i < 6; i++) rows.push({ video_id: `b${i}`, views: 500, age_hours: 48, published_at: '2026-09-15T03:00Z', topic: 'B' });
  const L = topicLift(rows, { minSamples: 3 });
  Math.abs(L.get('A').lift - 1) < 1e-9 && Math.abs(L.get('B').lift - 1) < 1e-9
    ? ok('[2] 날짜만 달랐던 두 주제는 둘 다 1.0x (원시로는 3배 차이)') : bad(`[2] A=${L.get('A')?.lift} B=${L.get('B')?.lift}`);
}

// [3] 같은 날 안에서의 차이는 잡는다 — 그게 주제 효과다
{
  const rows = [];
  for (let d = 1; d <= 4; d++) {
    rows.push({ video_id: `p${d}`, views: 1200, age_hours: 48, published_at: `2026-09-0${d}T03:00Z`, topic: '정치' });
    rows.push({ video_id: `q${d}`, views: 800, age_hours: 48, published_at: `2026-09-0${d}T05:00Z`, topic: '기업' });
    rows.push({ video_id: `r${d}`, views: 1000, age_hours: 48, published_at: `2026-09-0${d}T07:00Z`, topic: '증시' });
  }
  const L = topicLift(rows, { minSamples: 3 });
  L.get('정치').lift > 1 && L.get('기업').lift < 1 && L.get('정치').beat === 1 && L.get('기업').beat === 0
    ? ok(`[3] 같은 날 안 차이를 잡는다 (정치 ${L.get('정치').lift.toFixed(2)}x · 기업 ${L.get('기업').lift.toFixed(2)}x)`)
    : bad(`[3] ${JSON.stringify([...L])}`);
}

// [4] 표본이 적은 주제는 **판단하지 않는다** — 6편으로 1.47x 는 우연일 수 있다
{
  const rows = [];
  for (let d = 1; d <= 5; d++) {
    rows.push({ video_id: `x${d}`, views: 1000, age_hours: 48, published_at: `2026-09-0${d}T03:00Z`, topic: '다수' });
    rows.push({ video_id: `y${d}`, views: 1000, age_hours: 48, published_at: `2026-09-0${d}T04:00Z`, topic: '다수' });
  }
  rows.push({ video_id: 'z1', views: 3000, age_hours: 48, published_at: '2026-09-01T05:00Z', topic: '희귀' });
  const L = topicLift(rows, { minSamples: 5 });
  !L.has('희귀') ? ok('[4] 표본 부족 주제는 결과에 넣지 않는다') : bad('[4] 1편짜리 주제를 판단했다');
}

// [5] 주제가 없는 행(분류 전 과거 영상)은 조용히 뺀다 — '기타' 로 몰면 기타가 오염된다
{
  const rows = [{ video_id: 'n1', views: 900, age_hours: 48, published_at: '2026-09-01T03:00Z', topic: null }];
  topicLift(rows).size === 0 ? ok('[5] 주제 없는 행은 뺀다') : bad('[5]');
}

// ── 강·약 판정 ──────────────────────────────────────────────────────────
// 손으로 정한 문턱(예: 1.03x)을 쓰지 않는다 — '또래보다 잘 된 비율' 이 50% 에서
//   **통계적으로** 벗어난 주제만 강·약으로 본다(단측 p<0.05, 정규근사).
//   실측(2026-09-24): 국내정치 26/38 → 강 · 기업·산업 6/21 → 약 · 증시 12/32·국제 20/49 → 우연 범위.
{
  const lift = new Map([
    ['국내정치', { lift: 1.07, beat: 26 / 38, n: 38 }],
    ['기업·산업', { lift: 0.78, beat: 6 / 21, n: 21 }],
    ['증시·금리·환율', { lift: 0.99, beat: 12 / 32, n: 32 }],
    ['국제·외교·전쟁', { lift: 0.98, beat: 20 / 49, n: 49 }],
    ['사회·사건사고', { lift: 1.02, beat: 6 / 9, n: 9 }],
  ]);
  const t = topicTier(lift);
  t.get('국내정치') === 'strong' && t.get('기업·산업') === 'weak'
    ? ok('[6] 실측에서 유의한 둘만 강·약') : bad(`[6] ${JSON.stringify([...t])}`);
  !t.has('증시·금리·환율') && !t.has('국제·외교·전쟁') && !t.has('사회·사건사고')
    ? ok('[6b] 우연 범위는 판정하지 않는다(증시 38% 도 약으로 보지 않음)') : bad(`[6b] ${JSON.stringify([...t])}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);

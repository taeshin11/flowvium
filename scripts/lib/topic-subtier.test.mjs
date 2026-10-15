#!/usr/bin/env node
/**
 * topic-subtier.test.mjs — 편성 등급에 '1천 조회당 구독' 을 같이 건다. 2026-10-15 신설.
 *
 * 왜(사장님 10/14 "구독자가 늘지 않는 채널은 원인을 찾아 늘려라"):
 *   종전 등급(topicTier)은 조회수(같은 날 또래를 이긴 비율)만 봤다. 경제(증시·금리·환율)는 조회수로는
 *   우연 범위라 '약' 이 아니었지만, 구독은 국내정치의 1/3 이었다(DB 10/15: 국내정치 83편 1.93 · 증시 23편 0.71 ·
 *   기업·산업 14편 0.43 /1천회). 주간 정치 비중 61%→39% 와 구독 1.90→0.87 이 같이 움직였다(10/14 측정).
 *   ChatGPT·agy(Opus 5.5) 둘 다 1순위로 '정치 비중을 올리고 경제를 줄여라' 를 냈다.
 * 방법: 손으로 정한 주제 목록·문턱을 쓰지 않는다. 주제마다 구독 수가 채널 평균 비율로 기대되는 수에서
 *   우연으로 보기 어려울 만큼 벗어났을 때만(포아송 근사, 단측 |z|>1.645) 강·약. 표본 minSamples 편 미만은 판단 안 함.
 * 합치기: 조회수·구독 중 하나라도 '약' 이면 약(뒤로). 약이 없고 하나라도 '강' 이면 강.
 * 실험 칸(explore)은 건드리지 않는다 — 약한 주제에도 새 표본이 쌓여야 판정이 바뀔 수 있다(explore-slot.test 머리말).
 */
import { topicSubTier, combineTiers } from './topic-lift.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// 영상 하나에 관측 여러 줄(가장 늦은 subs 관측을 쓴다). views·subs 를 주제별로 만든다.
const mk = (topic, n, views, subs, id0) => Array.from({ length: n }, (_, i) => [
  { video_id: `${id0}${i}`, topic, views: Math.round(views / 2), subs_gained: 0, checked_at: '2026-10-01T00:00:00Z' },
  { video_id: `${id0}${i}`, topic, views, subs_gained: subs, checked_at: '2026-10-02T00:00:00Z' },
]).flat();

{
  // 실측과 같은 크기: 정치 1.93, 국제 1.09, 증시 0.71, 기업 0.43 /1천회 · 영상당 조회 1,000
  const rows = [
    ...mk('국내정치', 83, 1000, 2, 'p'),        // 166/83,000 = 2.0
    ...mk('국제·외교·전쟁', 44, 1000, 1, 'i'),   // 44/44,000 = 1.0
    ...mk('증시·금리·환율', 23, 1000, 0, 's'),   // 아래에서 일부만 1
    ...mk('기업·산업', 14, 1000, 0, 'b'),
    ...mk('부동산', 4, 1000, 2, 'r'),            // 표본 4편 — 판단 안 함
    { video_id: 'nosubs', topic: '국내정치', views: 5000, subs_gained: null, checked_at: '2026-10-02T00:00:00Z' },
  ];
  for (let i = 0; i < 16; i++) rows.find((r) => r.video_id === `s${i}` && r.subs_gained === 0 && r.views === 1000).subs_gained = 1;   // 16/23,000 = 0.70
  for (let i = 0; i < 6; i++) rows.find((r) => r.video_id === `b${i}` && r.views === 1000).subs_gained = 1;                           // 6/14,000 = 0.43
  const t = topicSubTier(rows);
  t.get('국내정치') === 'strong' ? ok('[1] 국내정치(2.0/1천) → 강') : bad(`[1] 국내정치 ${t.get('국내정치')}`);
  t.get('증시·금리·환율') === 'weak' ? ok('[2] 증시(0.70/1천) → 약') : bad(`[2] 증시 ${t.get('증시·금리·환율')}`);
  t.get('기업·산업') === 'weak' ? ok('[3] 기업·산업(0.43/1천) → 약') : bad(`[3] 기업 ${t.get('기업·산업')}`);
  !t.has('부동산') ? ok('[4] 표본 4편은 판단하지 않는다') : bad(`[4] 부동산 ${t.get('부동산')}`);
  !t.has('null') && !t.has(null) ? ok('[5] 주제 없는 영상은 등급이 없다') : bad('[5] null 주제가 등급을 받았다');
}
{
  // 평균 근처는 판정하지 않는다(우연 범위)
  const rows = [...mk('A', 20, 1000, 1, 'a'), ...mk('B', 20, 1000, 1, 'b')];
  rows.find((r) => r.video_id === 'a0' && r.views === 1000).subs_gained = 2;
  topicSubTier(rows).size === 0 ? ok('[6] 차이가 우연 범위면 강·약 없음') : bad(`[6] ${[...topicSubTier(rows)]}`);
}
{
  const views = new Map([['국내정치', 'strong'], ['기업·산업', 'weak'], ['사회', 'strong']]);
  const subs = new Map([['국내정치', 'strong'], ['증시·금리·환율', 'weak'], ['사회', 'weak'], ['국제', 'strong']]);
  const c = combineTiers(views, subs);
  c.get('국내정치') === 'strong' ? ok('[7] 둘 다 강 → 강') : bad(`[7] ${c.get('국내정치')}`);
  c.get('증시·금리·환율') === 'weak' ? ok('[8] 구독만 약 → 약') : bad(`[8] ${c.get('증시·금리·환율')}`);
  c.get('기업·산업') === 'weak' ? ok('[9] 조회수만 약 → 약') : bad(`[9] ${c.get('기업·산업')}`);
  c.get('사회') === 'weak' ? ok('[10] 조회수 강·구독 약 → 약(구독이 목표)') : bad(`[10] ${c.get('사회')}`);
  c.get('국제') === 'strong' ? ok('[11] 구독만 강 → 강') : bad(`[11] ${c.get('국제')}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

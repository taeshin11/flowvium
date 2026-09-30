#!/usr/bin/env node
/**
 * explore-slot.test.mjs — 여섯 편에 한 편은 '검증 안 된 주제' 로(실험 칸). 2026-09-30 신설.
 *
 * 사장님이 준 영상(Aprilynne Alter "Why No One Makes 'Original' Videos Anymore", 2026-07)에서 차용:
 *   잘 된 것만 따라 하면 **국소 최대**(local maximum)에 갇힌다 — 더 높은 봉우리는 한 번 내려가야 찾는다.
 *   권고: 검증된 편 5~6편마다 실험 한 편, 망해도 그건 **내 데이터**.
 * 우리 실측(9/30): 주제를 조회수 성적으로 고르자 최근 7일 53편 중 국내정치 25편 · 기업·산업 1편.
 *   기업·산업은 9월 초 21편으로 '약' 판정을 받은 뒤 뒤로 밀려 **새 표본이 안 쌓인다** — 판정이 다시 바뀔 길이 없다.
 * → 실험 칸: 조회수 등급 대신 **최근 14일에 적게 다룬 주제**를 앞으로(위험 썸네일 규칙은 그대로 먼저).
 *   누적 편수를 섞은 값 % 6 — 제목(짝홀)·구독(n%4)·광고(⌊n/4⌋) 실험과 박자가 겹치지 않게. 실험 편은 기록해 따로 잰다.
 */
import { exploreFor, exploreOrder } from './explore-slot.mjs';
import { subCtaFor } from './sub-cta.mjs';
import { promoFor } from './promo-card.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
{
  const N = 600;
  const ex = Array.from({ length: N }, (_, n) => exploreFor(n));
  const rate = ex.filter(Boolean).length / N;
  const share = (f) => { const e = ex.map((x, n) => [x, f(n)]).filter(([x]) => x); return e.filter(([, v]) => v).length / e.length; };
  const t = share((n) => n % 2 === 0), s = share((n) => subCtaFor(n)), p = share((n) => promoFor(n) === 'flowvium');
  (rate > 0.13 && rate < 0.21 && [t, s, p].every((v) => v > 0.38 && v < 0.62))
    ? ok(`[1] 약 1/6(${(rate * 100).toFixed(1)}%) · 실험 편 안에서 제목 ${(t * 100).toFixed(0)}% · 구독 ${(s * 100).toFixed(0)}% · 광고 ${(p * 100).toFixed(0)}% — 다른 실험과 안 겹친다`)
    : bad(`[1] rate=${rate} t=${t} s=${s} p=${p}`);
  let run = 0, maxRun = 0; for (const x of ex) { run = x ? 0 : run + 1; maxRun = Math.max(maxRun, run); }
  maxRun <= 24 ? ok(`[1b] 실험 없이 가장 오래 간 구간 ${maxRun}편(하루 7편 기준 약 ${(maxRun / 7).toFixed(1)}일)`) : bad(`[1b] ${maxRun}`);
}
{
  const cands = [{ k: 'a', __topic: '국내정치' }, { k: 'b', __topic: '기업·산업' }, { k: 'c', __topic: '국제·외교·전쟁' }, { k: 'd', __topic: '사회·사건사고' }, { k: 'e', __topic: '국내정치' }];
  const counts = new Map([['국내정치', 25], ['국제·외교·전쟁', 8], ['사회·사건사고', 3], ['기업·산업', 1]]);
  const o = exploreOrder(cands, counts).map((c) => c.k).join('');
  o === 'bdcae' ? ok(`[2] 적게 다룬 주제부터(${o}) — 같은 수면 원래 순서`) : bad(`[2] ${o}`);
  const unsafe = (c) => c.k === 'b';
  const o2 = exploreOrder(cands, counts, { unsafe }).map((c) => c.k).join('');
  o2 === 'dcaeb' ? ok(`[3] 위험 썸네일 규칙이 먼저 — 실험이라도 위험한 건 뒤(${o2})`) : bad(`[3] ${o2}`);
  const o3 = exploreOrder([{ k: 'x' }, { k: 'y', __topic: '기업·산업' }], counts).map((c) => c.k).join('');
  o3 === 'yx' ? ok('[4] 주제를 모르는 후보는 뒤(무엇을 실험하는지 모르면 실험이 아니다)') : bad(`[4] ${o3}`);
}
// [5] '기타' 는 주제가 아니라 분류기의 나머지 칸이다 — 9/30 실측: 실험 칸이 "연합뉴스(기타)" 를 1순위로 올렸다(14일 0편이라서).
//   모르는 것과 같이 뒤로 둔다.
{
  const counts = new Map([['국내정치', 37], ['기업·산업', 7]]);
  const o = exploreOrder([{ k: 'y', __topic: '기타' }, { k: 'p', __topic: '국내정치' }, { k: 'b', __topic: '기업·산업' }], counts).map((c) => c.k).join('');
  o === 'bpy' ? ok(`[5] '기타' 는 실험 대상이 아니다(${o})`) : bad(`[5] ${o}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

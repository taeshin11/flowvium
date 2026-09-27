#!/usr/bin/env node
/**
 * load-wait.test.mjs — 부하가 높으면 회차를 버리지 말고 잠깐 기다린다. 2026-09-28 신설.
 *
 * 9/27 21:45 회차가 "부하 14.8 > 한계 10.8" 로 **즉시** 건너뛰어졌다(한 달에 세 번: 9/6 22:01 · 9/15 10:15 · 9/27 21:45).
 *   그 시각 예비가 있었는데도 안 썼다 — 예비는 렌더가 필요 없어 부하와 무관하다.
 * → ① 부하가 내려가길 잠깐(기본 15분) 기다리고 ② 그래도 높으면 렌더 없이 예비만 올린다(video-publish).
 * 여기서는 ① 의 판단만 잰다(가짜 시계·가짜 부하).
 */
import { waitForLoad } from './load-wait.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const fake = (seq) => { let i = 0, t = 0; return { read: () => seq[Math.min(i++, seq.length - 1)], sleep: async (ms) => { t += ms; }, now: () => t }; };

{ const f = fake([5]); const r = await waitForLoad({ limit: 10, waitMs: 900_000, pollMs: 60_000, ...f });
  (r.ok && r.waitedMs === 0) ? ok('[1] 낮으면 바로 통과') : bad(`[1] ${JSON.stringify(r)}`); }
{ const f = fake([14.8, 13, 9.5]); const r = await waitForLoad({ limit: 10.8, waitMs: 900_000, pollMs: 60_000, ...f });
  (r.ok && r.waitedMs === 120_000 && r.load === 9.5) ? ok(`[2] 2분 뒤 내려가면 진행(${r.waitedMs / 1000}초 기다림)`) : bad(`[2] ${JSON.stringify(r)}`); }
{ const f = fake([15]); const r = await waitForLoad({ limit: 10.8, waitMs: 900_000, pollMs: 60_000, ...f });
  (!r.ok && r.waitedMs >= 900_000 && r.waitedMs < 960_000 && r.load === 15) ? ok('[3] 15분 내내 높으면 ok:false(→ 예비만)') : bad(`[3] ${JSON.stringify(r)}`); }
{ const f = fake([15]); const r = await waitForLoad({ limit: 10.8, waitMs: 0, pollMs: 60_000, ...f });
  (!r.ok && r.waitedMs === 0) ? ok('[4] 대기 0 이면 기다리지 않는다') : bad(`[4] ${JSON.stringify(r)}`); }
// [5] video-publish 가 부하 초과 때 exit 하지 않고 예비로 간다(소스)
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../video-publish.mjs', import.meta.url), 'utf8');
  (/waitForLoad\(/.test(src) && /LOAD_SPARE_ONLY/.test(src) && !/건너뜀 — 부하[^\n]*\n\s*process\.exit\(0\)/.test(src))
    ? ok('[5] video-publish: 부하 초과 → 기다렸다가 예비') : bad('[5] video-publish 가 아직 부하 초과에서 바로 나간다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

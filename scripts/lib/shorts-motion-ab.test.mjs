#!/usr/bin/env node
/**
 * shorts-motion-ab.test.mjs — 첫 장면 사진에 천천히 다가가기(push) vs 그대로(still) A/B. 2026-10-17 신설.
 *
 * 사장님 성장 지표 점검 지시(Mac mini2 경유 10/17 20:5x). 실측(28일 177편, 첫 3일):
 *   잔존 곡선의 가장 큰 이탈은 상위·중간·하위 모두 약 5.2초(어떤 속성으로 나눠도 4.9~5.5초).
 *   눈검증(상위 3·하위 3편): 첫 장면은 사진 1장이 7초 넘게 그대로 — 상위 1위만 5.5초에 바뀜.
 * 교차검증: agy(gemini-4-argon-medium, 그림 첨부) "5.2초 전 3.5초에 사진 전환(줌인) A/B" ·
 *   새 Claude "정지 화면은 상하위를 못 가른다 — 확대·이동 효과 A/B 는 비용이 적으니 하라". 둘 다 A/B 로 찬성.
 * → push 칸: 1번 장면 사진(정지 그림일 때만 — 영상 클립은 이미 움직인다)을 4초 동안 12% 천천히 키운다.
 *   still 과 반반, 다른 실험(제목·광고·배분·첫 문장)과 독립. 48h·7일 3초·10초 잔존·평균 시청 비율·조회를 비교.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { motionFor, layoutFor } = await import('./explore-slot.mjs');
const { promoFor } = await import('./promo-card.mjs');
const N = 600, M = Array.from({ length: N }, (_, n) => motionFor(n));
const pr = M.filter((x) => x === 'push').length / N;
(M.every((x) => x === 'push' || x === 'still') && pr > 0.42 && pr < 0.58) ? ok(`[1] push|still 반반(${(pr * 100).toFixed(0)}%)`) : bad(`[1] pr=${pr}`);
const share = (f) => { const e = M.map((x, n) => [x === 'push', f(n)]).filter(([x]) => x); return e.filter(([, v]) => v).length / e.length; };
const t = share((n) => n % 2 === 0), p = share((n) => promoFor(n) === 'flowvium'), l = share((n) => layoutFor(n) === 'zoom');   // 첫 문장은 10/20 전 편 question — 독립성 대상 아님
[t, p, l].every((v) => v > 0.38 && v < 0.62) ? ok(`[2] 다른 실험과 독립 — push 안에서 제목 ${(t * 100).toFixed(0)}% · 광고 ${(p * 100).toFixed(0)}% · 배분 ${(l * 100).toFixed(0)}% `) : bad(`[2] t=${t} p=${p} l=${l}`);

// [3] 실제로 그려 본다 — push 는 0초와 3.9초 그림이 다르고, still 은 같다.
{
  const { mediaFilter, SHORTS } = await import('./shorts-layout.mjs');
  const FF = createRequire(import.meta.url)('ffmpeg-static');
  const dir = mkdtempSync(join(tmpdir(), 'motion-test-'));
  const img = join(dir, 'in.png');
  spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=1', '-frames:v', '1', img]);
  const frame = (motion, at) => {
    const out = join(dir, `${motion}-${at}.rgb`);
    const r = spawnSync(FF, ['-v', 'error', '-y', '-loop', '1', '-t', '4.5', '-i', img, '-filter_complex', `${mediaFilter('0:v', 'v0', { motion: motion === 'push' })};[v0]scale=108:192[s]`,
      '-map', '[s]', '-ss', String(at), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', out]);
    if (r.status !== 0) console.log(String(r.stderr).slice(0, 300));
    return r.status === 0 ? readFileSync(out) : null;
  };
  const diff = (a, b) => (a && b ? a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length : -1);
  const dp = diff(frame('push', 0), frame('push', 3.9)), ds = diff(frame('still', 0), frame('still', 3.9));
  (dp > 2 && ds >= 0 && ds < 0.5 && SHORTS.W > 0) ? ok(`[3] 실제 렌더 — push 0→3.9초 화소 차 ${dp.toFixed(1)} · still ${ds.toFixed(2)}`) : bad(`[3] push=${dp} still=${ds}`);
  rmSync(dir, { recursive: true, force: true });
}
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const pub = src('video-publish.mjs'), ms = src('video/make-shorts.mjs');
(/SHORTS_MOTION: MOTION_ENV/.test(pub) && /motion: last\.motion/.test(pub)) ? ok('[4a] 발행이 칸을 정하고 기록') : bad('[4a]');
(/MOTION === 'push'/.test(ms) && /motion: MOTION/.test(ms) && /mediaFilter\('0:v', 'v0', \{ motion:/.test(ms)) ? ok('[4b] make-shorts 가 1번 정지 사진에만 push · meta.motion') : bad('[4b]');
(/ADD COLUMN motion TEXT/.test(src('lib/db.mjs')) && /'shorts_published\.motion'/.test(src('audit-coverage.mjs'))) ? ok('[4c] DB 열·감사') : bad('[4c]');
/motion/.test(src('channel-performance.mjs').match(/SELECT topic[^`]*FROM shorts_published/)?.[0] ?? '') ? ok('[4d] 성적표가 motion 칸을 읽는다') : bad('[4d]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

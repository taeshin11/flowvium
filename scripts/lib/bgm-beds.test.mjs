#!/usr/bin/env node
/**
 * bgm-beds.test.mjs — 출처가 적힌 곡만 돌린다. 2026-10-18 신설.
 *
 * 왜: make-shorts·주간 해설은 assets/bgm 에 있는 **아무 파일이나** 돌려 썼다. 10/17 확인해 보니
 *   4곡 중 2곡이 다른 2곡의 사본이었고(엔벨로프 상관 1.00), 남은 Suno 곡도 어느 계정·요금제로
 *   만들었는지 아무도 모른다(상업 이용은 유료 요금제 조건). 폴더에 놓이면 바로 발행에 섞이는 구조가 원인.
 * → assets/bgm/SOURCES.json 에 출처·라이선스가 적힌 파일만 쓴다. 목록이 없거나 깨졌으면 아무 곡도 안 쓴다.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { licensedBeds } = await import('./bgm-beds.mjs');

const dir = mkdtempSync(join(tmpdir(), 'bgm-beds-test-'));
try {
  writeFileSync(join(dir, 'a.mp3'), '');
  writeFileSync(join(dir, 'b.wav'), '');
  writeFileSync(join(dir, 'notes.txt'), '');
  const none = licensedBeds(dir);
  (none.beds.length === 0 && none.skipped.length === 2) ? ok('[1a] 목록이 없으면 아무 곡도 안 쓴다') : bad(`[1a] ${JSON.stringify(none)}`);
  writeFileSync(join(dir, 'SOURCES.json'), JSON.stringify({ 'a.mp3': { source: 'Suno Pro', license: 'commercial' }, 'b.wav': { source: 'x' } }));
  const r = licensedBeds(dir);
  (r.beds.join() === 'a.mp3' && r.skipped.join() === 'b.wav') ? ok('[1b] 출처·라이선스 둘 다 적힌 곡만') : bad(`[1b] ${JSON.stringify(r)}`);
  writeFileSync(join(dir, 'SOURCES.json'), '{ broken');
  licensedBeds(dir).beds.length === 0 ? ok('[1c] 목록이 깨졌으면 아무 곡도 안 쓴다') : bad('[1c]');
} finally { rmSync(dir, { recursive: true, force: true }); }

const bgm = new URL('../../assets/bgm/', import.meta.url).pathname;
const real = licensedBeds(bgm);
const audio = readdirSync(bgm).filter((f) => /\.(wav|mp3|m4a)$/i.test(f));
(real.skipped.length === 0 && real.beds.length >= 3 && real.beds.length === audio.length)
  ? ok(`[2] assets/bgm — ${real.beds.length}곡 전부 출처 있음`) : bad(`[2] beds=${real.beds} skipped=${real.skipped}`);

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
for (const f of ['video/make-shorts.mjs', 'video/make-weekly-explainer.mjs']) {
  const s = src(f);
  (/licensedBeds\(/.test(s) && !/readdirSync\([^)]*assets\/bgm/.test(s) && !/readdirSync\(bgmDir\)/.test(s))
    ? ok(`[3] ${f} 가 licensedBeds 로 고른다`) : bad(`[3] ${f}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * vo-burst.test.mjs — 대사 wav 끝·앞의 '쉭/지직' 잡음 덩어리를 잘라낸다. 2026-10-17 신설.
 *   사장님 "woosh 문제 없도록 다 방지" (desktop1 전달). Gemini TTS 가 문장 끝에 0.12~0.13초짜리
 *   −6dB 전대역 잡음, 앞에 10ms 를 붙이는 것이 다른 채널에서 실측됐다. 우리 MeloTTS 44.1kHz 에선
 *   아직 안 나왔지만(10/17 19:20 회차 4개·릴스 스펙트로그램) 엔진이 바뀌어도 막혀 있어야 한다.
 * 판정(desktop1 기준): 파일의 표본율/100 크기 10ms 창 RMS 로, −45dB 아래 창 바로 뒤에
 *   −25dB 위 창이 8~20개 이어지고 그게 파일의 마지막 큰 소리면 꼬리 잡음. 정렬의 말 끝 시각보다
 *   앞에서 시작하면 말이다 — 자르지 않는다.
 * 합성음: 1초 톤(말 대신) · 조용 · 백색잡음 0.13초 · 조용.
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { findBurst, trimBurst, scanVo, cleanVoOut } from './vo-burst.mjs';
const FF = createRequire(import.meta.url)('ffmpeg-static');
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const dir = mkdtempSync(join(tmpdir(), 'vo-burst-test-'));
/** parts: [['tone'|'noise'|'quiet', 초]] → wav (s16, sr) */
function wav(name, parts, sr = 24000) {
  const src = parts.map(([k, d], i) => (k === 'tone' ? `sine=f=220:r=${sr}:d=${d},volume=0.5`
    : k === 'noise' ? `anoisesrc=c=white:r=${sr}:a=0.5:d=${d}` : `anullsrc=r=${sr}:cl=mono,atrim=0:${d}`) + `[a${i}]`);
  const f = join(dir, name);
  const r = spawnSync(FF, ['-v', 'error', '-y', '-filter_complex', `${src.join(';')};${parts.map((_, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1,aformat=sample_fmts=s16:channel_layouts=mono`, f]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  return f;
}
const dur = (f) => { const m = String(spawnSync(FF, ['-hide_banner', '-i', f]).stderr).match(/Duration: (\d+):(\d+):([\d.]+)/); return +m[1] * 3600 + +m[2] * 60 + +m[3]; };

{ // [1] 순수 판정
  const q = -90, s = -10, n = -6;
  const db = [...Array(100).fill(s), ...Array(20).fill(q), ...Array(13).fill(n), ...Array(5).fill(q)];
  const b = findBurst(db);
  (b.tail && b.tail.start === 120 && b.tail.len === 13) ? ok('[1a] 조용 뒤 13창 큰 소리 = 꼬리 잡음') : bad(`[1a] ${JSON.stringify(b)}`);
  const b2 = findBurst([...Array(100).fill(s), ...Array(20).fill(q)]);
  (!b2.tail && !b2.head) ? ok('[1b] 말 + 조용 = 없음') : bad(`[1b] ${JSON.stringify(b2)}`);
  const b3 = findBurst(db, { speechEndSec: 1.30 });
  (!b3.tail) ? ok('[1c] 정렬상 말이 1.30초까지면 1.20초 덩어리는 말 — 안 자름') : bad(`[1c] ${JSON.stringify(b3)}`);
  const b4 = findBurst([...Array(100).fill(s), ...Array(20).fill(q), ...Array(40).fill(n), ...Array(5).fill(q)]);
  (!b4.tail) ? ok('[1d] 0.4초 덩어리(20창 초과)는 말일 수 있어 안 자름') : bad(`[1d] ${JSON.stringify(b4)}`);
  const b5 = findBurst([n, q, q, ...Array(100).fill(s), ...Array(20).fill(q)]);
  (b5.head === 1) ? ok('[1e] 첫 10ms 큰 소리 뒤 조용 = 머리 잡음 1창') : bad(`[1e] ${JSON.stringify(b5)}`);
}
{ // [2] 실제 wav — 자르고 .orig.wav 를 남긴다, 말은 그대로
  const f = wav('burst.wav', [['tone', 1], ['quiet', 0.2], ['noise', 0.13], ['quiet', 0.05]]);
  const r = trimBurst(f, { speechEndSec: 1.0 });
  const d = dur(f);
  (r.cutTailSec > 0.1 && Math.abs(d - 1.2) < 0.03 && existsSync(f.replace(/\.wav$/, '.orig.wav')))
    ? ok(`[2a] 꼬리 ${r.cutTailSec.toFixed(2)}초 잘림 · 남은 길이 ${d.toFixed(2)}초 · 원본 보관`) : bad(`[2a] ${JSON.stringify(r)} dur=${d}`);
  const after = scanVo(f);
  (!after.burst.tail && after.sr === 24000) ? ok('[2b] 자른 뒤 다시 재면 없음 · 표본율 유지') : bad(`[2b] ${JSON.stringify(after.burst)} sr=${after.sr}`);
  const c = wav('clean.wav', [['tone', 1], ['quiet', 0.3]], 44100);
  const before = readFileSync(c);
  const rc = trimBurst(c, { speechEndSec: 1.0 });
  (!rc.cutTailSec && !rc.cutHeadSec && readFileSync(c).equals(before)) ? ok('[2c] 깨끗한 wav 는 손대지 않음') : bad(`[2c] ${JSON.stringify(rc)}`);
}
{ // [3] 엔진 반환을 받아 정리 — 길이·정렬을 고친다
  const f = wav('eng.wav', [['noise', 0.01], ['quiet', 0.03], ['tone', 1], ['quiet', 0.2], ['noise', 0.13], ['quiet', 0.05]]);
  const al = { characters: ['가', '나'], character_start_times_seconds: [0.05, 0.5], character_end_times_seconds: [0.5, 1.04] };
  const [o] = cleanVoOut([{ path: f, alignment: al, durationSec: 1.42, note: null }], () => {});
  (o.durationSec < 1.3 && o.durationSec > 1.2 && o.alignment.character_start_times_seconds[0] < 0.05 && o.alignment.character_end_times_seconds[1] <= o.durationSec)
    ? ok(`[3] 머리·꼬리 정리 → 길이 ${o.durationSec.toFixed(2)}초 · 정렬 앞당김 ${al.character_start_times_seconds[0]}→${o.alignment.character_start_times_seconds[0].toFixed(2)}`)
    : bad(`[3] ${JSON.stringify(o)}`);
}
{ // [4] 연결 — 모든 한국어 엔진 출구와 발행 전 관문
  const ko = readFileSync(new URL('./tts-korean.mjs', import.meta.url), 'utf8');
  const n = (ko.match(/cleanVoOut\(/g) ?? []).length;
  (n >= 3) ? ok(`[4a] tts-korean 엔진 출구 ${n}곳에서 정리(Piper·Qwen·Melo)`) : bad(`[4a] cleanVoOut 호출 ${n}곳`);
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  (/assertNoVoBurst\(scenes\.map/.test(ms)) ? ok('[4b] make-shorts 가 합성 직후 잡음 관문을 건다') : bad('[4b] make-shorts 관문 없음');
}
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n❌ vo-burst ${fail}건 실패` : '\n✅ vo-burst 전부 통과');
process.exit(fail ? 1 : 0);

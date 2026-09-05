#!/usr/bin/env node
/**
 * 낭독에 쉼이 없다 — 어느 설정이 얼마나 지웠는지 잰다.
 *
 * 실측(2026-09-05): 발행된 네 장면 모두 0.12초 이상 쉼이 **0회**. 숨도 안 쉬고 내리 읽는다.
 *   원인 후보가 셋이라 감으로 고르지 않고 하나씩 끄면서 잰다:
 *   ① 지시문의 "쉬는 구간 없이 이어서 말하라"  ② silenceremove 필터  ③ atempo 1.18
 */
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { ROOT } from './lib/project-root.mjs';
import { qwenTtsReady, ANCHOR_INSTRUCT } from './lib/tts-korean.mjs';

const FF = createRequire(import.meta.url)('ffmpeg-static');
const OUT = process.env.PROBE_DIR || join(tmpdir(), 'tts-pause-probe');
mkdirSync(OUT, { recursive: true });

// 발행된 대본 두 문장. 문장이 둘이므로 사이에 쉼이 있어야 정상이다.
const TEXT = '한화에어로스페이스가 크로아티아와 다연장로켓 천무 수출 계약을 눈앞에 두었습니다. '
  + '총 계약 금액은 4억 3520만 유로, 약 6800억원 규모입니다.';

const NO_PAUSE = ' 빠르고 경쾌한 속도로, 쉬는 구간 없이 이어서 말하라. 숨소리와 한숨을 내지 마라.';
const BASE = ANCHOR_INSTRUCT.replace(NO_PAUSE, '');
// 쉬지 말라는 말을 빼고, 대신 **어디서** 쉬라고 알려 준다. 빠르기는 유지한다.
const KEEP_PAUSE = BASE + ' 빠르고 또렷하게 읽되, 마침표에서는 한 박자 쉬고 다음 문장을 시작하라.';

// 문장 분리 + 쉼 삽입을 넣은 뒤 다시 잰다. 지시문·필터·배속은 그대로 두고 쉼만 확인한다.
const CASES = [
  ['D 문장분리후', ANCHOR_INSTRUCT, 1.18],
];

const ready = qwenTtsReady();
if (!ready.ok) { console.error(`TTS 준비 안 됨 — ${ready.reason}`); process.exit(1); }

/** 0.12초 이상 쉼의 횟수와 총 길이. 사람 앵커는 문장 사이에 0.25~0.45초 쉰다. */
function pauses(wav) {
  // ffmpeg 의 분석 결과는 **stderr** 로 나온다. execFileSync 의 반환값(stdout)만 보면 null 이다.
  const o = spawnSync(FF, ['-v', 'error', '-i', wav, '-af', 'silencedetect=n=-35dB:d=0.12', '-f', 'null', '-'],
    { encoding: 'utf8' }).stderr ?? '';
  const d = [...o.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return { n: d.length, total: d.reduce((a, b) => a + b, 0), list: d.map((x) => x.toFixed(2)) };
}
function seconds(wav) {
  const { readFileSync: rf } = { readFileSync };
  // wav 헤더로 직접 잰다 — ffmpeg 파싱보다 확실하다.
  const b = rf(wav);
  const rate = b.readUInt32LE(24), bytes = b.readUInt32LE(40), bits = b.readUInt16LE(34), ch = b.readUInt16LE(22);
  return bytes / (rate * ch * (bits / 8));
}

for (const [name, instruct, tempo] of CASES) {
  const pre = join(OUT, `${name.split(' ')[0]}-`);
  const tf = join(OUT, 'texts.json');
  const jf = join(OUT, 'out.json');
  writeFileSync(tf, JSON.stringify([TEXT]), 'utf8');
  try {
    execFileSync(ready.python, [
      ready.script, '--texts-file', tf, '--out-prefix', pre, '--json-out', jf,
      '--instruct', instruct, '--tempo', String(tempo),
    ], { timeout: 15 * 60_000, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, FFMPEG_BIN: FF } });
    const wav = `${pre}0.wav`;
    const p = pauses(wav);
    const s = seconds(wav);
    console.log(`  ${name.padEnd(16)} ${s.toFixed(2)}초 · 쉼 ${p.n}회(${p.total.toFixed(2)}초) ${p.list.join(',')}  → ${wav}`);
  } catch (e) {
    console.log(`  ${name.padEnd(16)} 실패: ${String(e.message).slice(0, 80)}`);
  }
}
console.log(`\n  글자수 ${TEXT.length}자 · 목표 속도 6.7자/초 → ${(TEXT.length / 6.7).toFixed(1)}초 안팎이면 정상`);

#!/usr/bin/env node
/**
 * 숫자를 어떻게 적어야 TTS 가 제대로 읽는가 — 재서 정한다.
 *
 * 실측(2026-09-05, whisper 되들음): "4억 3520만 유로" 가 "4억 3장 520만" 으로 깨졌다.
 *   같은 문장의 "6800억원" 은 멀쩡했다. 자릿수 문제인지 앞말 영향인지 감으로 고르지 않는다.
 */
import { execFileSync, spawnSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { qwenTtsReady, ANCHOR_INSTRUCT } from './lib/tts-korean.mjs';

const FF = createRequire(import.meta.url)('ffmpeg-static');
const OUT = process.env.PROBE_DIR || join(tmpdir(), 'tts-num-probe');
mkdirSync(OUT, { recursive: true });

const CASES = [
  ['현재(영문)', '오늘 다룬 이슈의 전체 분석과 실시간 시장 데이터는 flowvium.net 에서 보실 수 있습니다.'],
  ['한글 닷넷', '오늘 다룬 이슈의 전체 분석과 실시간 시장 데이터는 플로비움 닷넷에서 보실 수 있습니다.'],
  ['한글 점넷', '오늘 다룬 이슈의 전체 분석과 실시간 시장 데이터는 플로비움 점 넷에서 보실 수 있습니다.'],
  ['0건 그대로', '중기부 법안 0건이라는 지적에 반박했습니다.'],
  ['0건 한글', '중기부 법안 영 건이라는 지적에 반박했습니다.'],
  ['0건 풀어씀', '중기부 법안이 한 건도 없다는 지적에 반박했습니다.'],
];

const ready = qwenTtsReady();
if (!ready.ok) { console.error(`TTS 준비 안 됨 — ${ready.reason}`); process.exit(1); }

const tf = join(OUT, 't.json');
const jf = join(OUT, 'o.json');
writeFileSync(tf, JSON.stringify(CASES.map(([, t]) => t)), 'utf8');
execFileSync(ready.python, [
  ready.script, '--texts-file', tf, '--out-prefix', join(OUT, 'n'), '--json-out', jf,
  '--instruct', ANCHOR_INSTRUCT, '--tempo', '1.18',
], { timeout: 20 * 60_000, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, FFMPEG_BIN: FF } });

// 되들어서 확인한다. 귀 대신 whisper 를 쓴다 — 내가 "잘 읽힌다" 고 말하려면 근거가 있어야 한다.
const py = `
from faster_whisper import WhisperModel
m = WhisperModel('base', device='cpu', compute_type='int8')
import sys, json
for i, name in enumerate(json.loads(sys.argv[1])):
    segs, _ = m.transcribe('${join(OUT, 'n')}%d.wav' % i, language='ko')
    print('%s\\t%s' % (name, ' '.join(s.text.strip() for s in segs)))
`;
const r = spawnSync(ready.python, ['-c', py, JSON.stringify(CASES.map(([n]) => n))], { encoding: 'utf8' });
for (const line of (r.stdout ?? '').trim().split('\n')) {
  const [name, heard] = line.split('\t');
  if (!name) continue;
  console.log(`  ${String(name).padEnd(11)} → ${heard}`);
}

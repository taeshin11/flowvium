#!/usr/bin/env node
/**
 * tts-melo.test.mjs — 한국어 TTS 가 Melo 로 바뀌었는데 계약이 그대로인가.
 *
 * 배경(2026-09-13): 사용자가 두 음성을 직접 듣고 골랐다 — "멜로가 낫다".
 *   실측 속도 — Melo 문장당 0.7~0.9초(실시간 7배) vs Qwen 문장당 15초(실시간 0.26배).
 *
 * 엔진을 갈아끼울 때 깨지는 건 소리가 아니라 **계약**이다. 이 저장소에서 실제로 난 사고가
 *   "생산자만 바꾸고 소비처를 안 봐서 30시간 발간이 멈춘" 것이었다. 그래서 여기서 못박는다:
 *     · 반환 모양이 Qwen·Piper 와 같은가 (path/alignment/durationSec/note)
 *     · 글자 수와 시각 개수가 일치하는가 — 어긋나면 자막이 통째로 밀린다
 *     · 조용히 다른 엔진으로 떨어지지 않는가 — 목소리가 바뀐 걸 모르고 발행하면 안 된다
 *
 * 실제 합성은 무겁다(모델 적재 포함 ~20초). 그래서 **한 문장만** 만들어 본다.
 *   합성 자체를 건너뛰면 "계약이 같다" 를 말할 수 없으므로 건너뛰지는 않는다.
 */
import { requires } from './test-env.mjs';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./tts-korean.mjs');

// [1] 엔진 준비 상태를 이유와 함께 말한다
{
  const r = M.meloTtsReady();
  r.ok
    ? ok(`melo 준비됨 (${r.python.split('/').slice(-4, -2).join('/')})`)
    : bad(`melo 준비 안 됨 — ${r.reason}`);
  if (!r.ok) { console.log('\n❌ 1건 실패'); process.exit(1); }
}

// [2] 디스패처가 기본으로 melo 를 고르고, 고른 걸 말한다
{
  const said = [];
  const prev = process.env.KO_TTS_ENGINE;
  delete process.env.KO_TTS_ENGINE;
  try {
    // 합성까지 가지 않게 outPrefix 를 빼고 부른다 — 고른 엔진만 보고 싶다.
    try { M.synthesizeKoreanAuto(['시험'], { log: (m) => said.push(m) }); } catch { /* outPrefix 없음 */ }
  } finally { if (prev) process.env.KO_TTS_ENGINE = prev; }
  said.some((m) => /엔진 melo/.test(m))
    ? ok(`기본 엔진이 melo 이고 로그로 말한다: "${said.find((m) => /엔진/.test(m))}"`)
    : bad(`엔진 선택을 말하지 않는다 — 목소리가 바뀌어도 모른다 (로그: ${JSON.stringify(said)})`);
}

// [3] KO_TTS_ENGINE=qwen 으로 되돌릴 수 있다
{
  const said = [];
  const prev = process.env.KO_TTS_ENGINE;
  process.env.KO_TTS_ENGINE = 'qwen';
  try {
    try { M.synthesizeKoreanAuto(['시험'], { log: (m) => said.push(m) }); } catch { /* outPrefix 없음 */ }
  } finally { prev ? (process.env.KO_TTS_ENGINE = prev) : delete process.env.KO_TTS_ENGINE; }
  said.some((m) => /엔진 qwen/.test(m))
    ? ok('KO_TTS_ENGINE=qwen 으로 되돌아간다')
    : bad(`되돌리기가 안 먹는다 (로그: ${JSON.stringify(said)})`);
}

// [4] 실제로 한 문장 만들어 계약을 확인한다
{
  const dir = join(tmpdir(), `melo-contract-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const text = '코스피가 사흘 만에 반등했습니다.';
  try {
    const t0 = Date.now();
    const [r] = M.synthesizeKoreanMelo([text], { outPrefix: `${dir}/s` });
    const secs = (Date.now() - t0) / 1000;

    existsSync(r.path) && r.durationSec > 0.5
      ? ok(`합성됨 ${r.durationSec.toFixed(1)}초 음성 / ${secs.toFixed(0)}초 소요(적재 포함)`)
      : bad(`합성물이 이상하다: ${JSON.stringify({ path: r.path, dur: r.durationSec })}`);

    const a = r.alignment ?? {};
    const n = a.characters?.length ?? -1;
    (n === text.length
      && a.character_start_times_seconds?.length === n
      && a.character_end_times_seconds?.length === n)
      ? ok(`글자 ${n}개와 시각 개수가 일치 (어긋나면 자막이 통째로 밀린다)`)
      : bad(`정렬 길이 불일치 — 글자 ${text.length} / chars ${n} / start ${a.character_start_times_seconds?.length} / end ${a.character_end_times_seconds?.length}`);

    const last = a.character_end_times_seconds?.at(-1) ?? Infinity;
    last <= r.durationSec + 0.05
      ? ok(`마지막 글자 시각(${last.toFixed(2)}s)이 음성 길이(${r.durationSec.toFixed(2)}s) 안에 있다`)
      : bad(`시각이 음성 길이를 넘는다 — ${last.toFixed(2)}s > ${r.durationSec.toFixed(2)}s`);

    'note' in r ? ok('note 필드로 정렬 실패를 알린다') : bad('note 필드가 없다 — 균등분배로 떨어져도 모른다');
  } catch (e) {
    bad(`합성 실패: ${String(e.message).slice(0, 160)}`);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

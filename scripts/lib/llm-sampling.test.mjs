#!/usr/bin/env node
/**
 * llm-sampling.test.mjs — 생성 요청이 **모두 같은 로짓 처리기 모양**을 보내는가.
 *
 * 왜 (2026-09-18 실측·재현): mlx_lm 0.31.3 은 배치에 요청을 붙일 때 처리기가 없는 자리에
 *   None 을 넣고(generate.py:1065), 한 자리라도 처리기가 있으면 전 자리를 순회한다(1337·1346).
 *   그래서 **페널티를 보내는 요청과 안 보내는 요청이 한 배치에 섞이면** 생성 스레드가 죽는다.
 *   죽어도 GET /v1/models 는 200 이라 포트만 보는 감시는 못 잡는다.
 *
 *   재현: 긴 프롬프트 4개를 섞어서(2개만 페널티) 동시에 던짐 → 예외 7→8, 이후 생성 전부 타임아웃.
 *   수정 후: 같은 부하를 페널티 1.05 로 맞춰 3회 반복 → 예외 8→8, 전부 정상.
 *
 *   src/lib/llm-local.ts 가 1.05 를 보내는 한, scripts 쪽 호출자도 전부 보내야 한다.
 *   한 곳만 빠져도 그 한 곳이 서버를 죽인다 — 그래서 목록이 아니라 **전수**로 본다.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { ROOT } from './project-root.mjs';
import { SAMPLING_DEFAULTS } from './llm-config.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

SAMPLING_DEFAULTS.repetition_penalty === 1.05
  ? ok('[1] 공용 설정이 llm-local.ts 와 같은 값(1.05)이다')
  : bad(`[1] 공용 설정 값이 다르다: ${JSON.stringify(SAMPLING_DEFAULTS)}`);

/** scripts/ 와 src/lib/ 를 훑어 chat/completions 를 치는 파일을 전부 모은다. 백업본(.bak*)은 뺀다. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (!/\.(mjs|ts|js)$/.test(name) || /\.bak/.test(name) || /\.test\./.test(name)) continue;
    out.push(p);
  }
  return out;
}

const callers = [];
for (const f of [...walk(join(ROOT, 'scripts')), ...walk(join(ROOT, 'src/lib'))]) {
  const src = readFileSync(f, 'utf8');
  if (!/chat\/completions/.test(src)) continue;
  // 본문을 만들지 않고 경로 문자열만 언급하는 파일(주석·라우팅 점검)은 뺀다.
  if (!/JSON\.stringify\(\{|body:\s*\{/.test(src)) continue;
  callers.push({ file: relative(ROOT, f), src });
}

callers.length >= 3 ? ok(`[2] 생성 요청을 만드는 파일 ${callers.length}개를 찾았다`)
  : bad(`[2] 훑기가 고장났다 — ${callers.length}개만 찾음`);

for (const { file, src } of callers) {
  const has = /repetition_penalty|SAMPLING_DEFAULTS/.test(src);
  has ? ok(`[3] ${file} 가 처리기 모양을 맞춘다`)
      : bad(`[3] ${file} 가 페널티 없이 요청한다 — 이 한 곳이 :8001 생성 스레드를 죽인다`);
}

console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ llm-sampling 통과');
process.exit(fail ? 1 : 0);

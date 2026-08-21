#!/usr/bin/env node
/**
 * wave1-retry.test.mjs — "품질 게이트가 차단하는 섹션은 재시도 대상이어야 한다".
 *
 * 배경(2026-08-21 라이브 장애): Wave1 5개 중 narrative · opportunity · regional 3개가 실패했다.
 *     opportunity=false(squeeze:0), narrative=false
 *   regional 은 재시도로 살아났다(regional-retry 158.7s → 1727c). 나머지 둘은 재시도가 없다.
 *
 *   ※ 정정(같은 날 실측): 처음엔 로그의 `0.0s` 를 보고 "연결 거부" 로 적었는데 틀렸다.
 *     그 0.0s 는 vLLM 이 아니라 *그 다음* 폴백인 Ollama(:11434, 안 떠 있음) 의 실패시간이다.
 *     vLLM 쪽 실패는 시간을 안 찍고 있었다. 진짜 원인은 서버가 --prompt-concurrency 1 인데
 *     클라이언트가 5건을 동시에 던져 뒤 요청들이 서버 큐에서 굶은 것이다(llm-gate.mjs 참조).
 *     원인은 llm-gate 가 고쳤다. 이 테스트가 지키는 건 그와 별개인 불변식 —
 *     "일시 실패는 언제든 다시 날 수 있으니, 발간을 *차단* 하는 섹션은 재시도가 있어야 한다".
 *
 *   그런데 게이트는 이렇게 되어 있다:
 *     :854  if (!report.marketNarrative) issues.push('marketNarrative MISSING')   ← 차단
 *     :860  if (!report.shortSqueeze?.length) warnings.push('... 비차단')          ← 경고
 *   즉 marketNarrative 는 없으면 발간이 막히는데 재시도가 없다. 일시적 실패 한 번에
 *   발간이 통째로 막힌다. macro·regional 은 같은 차단 등급인데 재시도가 있다 —
 *   재시도 범위가 차단 범위와 어긋나 있었다. 설계가 아니라 누락으로 보인다.
 *
 * 불변식만 검사한다: 차단(issues) ⟹ 재시도 존재.
 *   비차단(warnings)에는 재시도를 요구하지 않는다 — 없어도 발간되는 섹션에 재시도를 붙이면
 *   그건 증상 덮기다. 게이트 등급이 바뀌면 이 테스트도 따라 바뀐다(하드코딩 아님).
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stripCommentsPreservingLines } from './context-keys.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = stripCommentsPreservingLines(readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8'));

// 재시도 블록 — retryNeeded 선언부터 parseJson 반영까지
const rIdx = src.indexOf('const retryNeeded = [];');
if (rIdx < 0) { bad('Wave1 재시도 블록을 못 찾음 — 테스트 앵커가 낡았다'); }
const retryBlock = rIdx >= 0 ? src.slice(rIdx, rIdx + 1800) : '';

// Wave1 섹션 ↔ 게이트 필드 ↔ 파싱 결과 변수
const SECTIONS = [
  { name: 'macro',       gateField: 'thesis',          dataVar: 'macroData' },
  { name: 'regional',    gateField: 'regionStances',   dataVar: 'regionalData' },
  { name: 'narrative',   gateField: 'marketNarrative', dataVar: 'narrativeData' },
  { name: 'opportunity', gateField: 'shortSqueeze',    dataVar: 'opportunityData' },
];

for (const s of SECTIONS) {
  // 게이트 등급을 소스에서 읽는다 — 내가 정하지 않는다.
  const blockingRx = new RegExp(`issues\\.push\\([^)]*${s.gateField}`);
  const warningRx  = new RegExp(`warnings\\.push\\([^)]*${s.gateField}`);
  const blocking = blockingRx.test(src);
  const warning  = warningRx.test(src);
  const retried  = new RegExp(`\\b${s.dataVar}\\b`).test(retryBlock);
  const grade = blocking ? '차단' : warning ? '경고' : '미검사';

  if (blocking) {
    retried ? ok(`${s.name}: 게이트 ${grade} → 재시도 있음`)
            : bad(`${s.name}: 게이트가 차단(${s.gateField} MISSING → issues)인데 재시도가 없다 — 일시 실패 한 번에 발간이 막힌다`);
  } else {
    ok(`${s.name}: 게이트 ${grade} → 재시도 불요 (있으면 ${retried ? '있음' : '없음'})`);
  }
}

// 재시도 안내 문구가 실제 대상과 일치해야 한다 (로그가 거짓말하면 추적이 어긋난다)
{
  const listed = [...retryBlock.matchAll(/retryNeeded\.push\('(\w+)'\)/g)].map(m => m[1]);
  const called = SECTIONS.filter(s => new RegExp(`'${s.name}-retry'`).test(retryBlock)).map(s => s.name);
  JSON.stringify([...listed].sort()) === JSON.stringify([...called].sort())
    ? ok(`retryNeeded 목록과 실제 재시도 호출 일치: ${listed.sort().join(', ')}`)
    : bad(`목록 ${JSON.stringify(listed.sort())} vs 실제 호출 ${JSON.stringify(called.sort())} — 로그가 실제와 다르다`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

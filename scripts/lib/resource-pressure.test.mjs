#!/usr/bin/env node
/**
 * resource-pressure.test.mjs — 모니터가 자원 고갈을 본다.
 *
 * 배경(2026-08-21 조사): check-stall 의 검사 7종([1]~[7]) 중 메모리·스왑·열을 보는 것이 하나도 없다.
 *   이 기기는 27B(31.7GB) + 4B(5.2GB) + embed(0.69GB) = 37.6GB 를 상주시킨다(vmmap 실측).
 *   조사 시점 실측: 여유 25% · 압축기 9.9GB · 스왑 1.89/3.0GB(61%).
 *   llm-local.ts 주석에 6/7 hard freeze 전력이 기록돼 있는데, 정작 자원 고갈을 감시하는 눈이 없다.
 *   "컴퓨터가 다운되지 않게" 의 첫 조건은 다운되기 전에 보이는 것이다.
 *
 * 열도 같이 본다. 조절기가 LLM 을 SIGSTOP 하는 비율(가동률)은 이 기기의 실질 처리량이자
 *   열 여유의 직접 지표다 — 실측 오늘 가동률 68%, 정지 303회.
 *
 * GPU 를 쓰지 않는 소스만 쓴다(vm_stat · sysctl · 조절기 로그). 감시가 부하를 만들면 안 된다.
 * 임계값은 코드에 박지 않고 data/resource-thresholds.json 에서 읽는다.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let M = null;
try { M = await import('./resource-pressure.mjs'); }
catch (e) { bad(`scripts/lib/resource-pressure.mjs 없음 — ${e.message}`); }

if (M) {
  const mem = await M.readMemory();
  if (mem && Number.isFinite(mem.freePct) && Number.isFinite(mem.swapPct)) {
    ok(`메모리 판독: 여유 ${mem.freePct}% · 스왑 ${mem.swapPct}% (${mem.swapUsedMB}/${mem.swapTotalMB}MB) · 압축 ${mem.compressedGB}GB`);
  } else bad(`readMemory() 가 수치를 못 냄: ${JSON.stringify(mem)}`);

  const th = await M.readThermalDuty();
  if (th === null) ok('조절기 로그 없음 → null (모른다고 답한다)');
  else if (Number.isFinite(th.dutyPct) && Number.isFinite(th.pauses)) ok(`열 판독: 최근창 가동률 ${th.dutyPct}% · 정지 ${th.pauses}회`);
  else bad(`readThermalDuty() 형식 오류: ${JSON.stringify(th)}`);

  // 임계값이 설정에서 온다 (코드 리터럴 금지)
  const cfgPath = resolve(ROOT, 'data/resource-thresholds.json');
  existsSync(cfgPath) ? ok('임계값 설정 파일 존재') : bad('data/resource-thresholds.json 없음 — 임계값이 코드에 박혔다');
  const src = readFileSync(resolve(ROOT, 'scripts/lib/resource-pressure.mjs'), 'utf8');
  /resource-thresholds\.json/.test(src) ? ok('설정 파일을 읽는다') : bad('설정을 안 읽는다');

  // 판정: 명백한 고갈 상황을 issue 로 낸다
  const badSnap = { mem: { freePct: 2, swapPct: 99, compressedGB: 20 }, thermal: { dutyPct: 10, pauses: 500 } };
  const issues = M.assess(badSnap);
  Array.isArray(issues) && issues.length >= 2
    ? ok(`고갈 상황에서 issue ${issues.length}건 (예: ${issues[0].slice(0, 46)}…)`)
    : bad(`고갈 상황인데 issue ${issues?.length ?? 'N/A'}건`);

  const goodSnap = { mem: { freePct: 60, swapPct: 5, compressedGB: 1 }, thermal: { dutyPct: 95, pauses: 3 } };
  (M.assess(goodSnap) || []).length === 0 ? ok('여유 상황에서는 조용하다') : bad('여유 상황인데 경고를 낸다');
}

console.log('\n모니터가 이 검사를 경유하는가');
const stall = readFileSync(resolve(ROOT, 'scripts/check-stall.mjs'), 'utf8');
/resource-pressure\.mjs/.test(stall) ? ok('check-stall 이 자원 압력을 점검한다')
  : bad('check-stall 이 메모리·스왑·열을 안 본다 — 다운 직전까지 아무도 모른다');

console.log(fail === 0 ? '\n✅ resource-pressure 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

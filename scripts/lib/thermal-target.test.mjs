#!/usr/bin/env node
/**
 * thermal-target.test.mjs — 온도 조절기가 '보고서 LLM 만' 멈추는지 검증.
 *
 * 배경(2026-08-20 실측): TEMP_TARGET_PROC="mlx_lm server" 를 pgrep -f 로 매칭하는데,
 *   웹 레인(:8001, Qwen3.5-4B)을 띄우자 두 서버가 모두 매칭됐다(PID 52772, 75904).
 *   웹 레인은 번역·챗을 2초에 처리하는 소형 모델이고 사용자 대면이라 멈추면 안 된다.
 *   GPU 열의 주범은 27.5GB 보고서 모델이다. 대상을 포트로 특정해야 한다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const gov = readFileSync(resolve(process.env.HOME, 'flowvium_runtime/thermal-governor.py'), 'utf8');
/TEMP_TARGET_PORT|--port/.test(gov) ? ok('조절기가 포트로 대상을 특정')
                                    : bad('조절기가 프로세스명만으로 매칭 — 모든 mlx_lm server 를 잡는다');

// 실제 매칭 결과 확인
const plist = (() => { try { return readFileSync(resolve(process.env.HOME, 'Library/LaunchAgents/com.spinai.thermal-governor.plist'), 'utf8'); } catch { return ''; } })();
const pat = plist.match(/TEMP_TARGET_PROC<\/key><string>([^<]*)</)?.[1]
         ?? plist.match(/<key>TEMP_TARGET_PROC<\/key>\s*<string>([^<]*)</)?.[1] ?? '';
if (pat) {
  const n = (() => { try { return execSync(`pgrep -f ${JSON.stringify(pat)}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { return 0; } })();
  n <= 1 ? ok(`패턴 "${pat}" 매칭 프로세스 ${n}개 (보고서 LLM 만)`)
         : bad(`패턴 "${pat}" 이 ${n}개 프로세스를 잡는다 — 웹 레인까지 정지시킨다`);
} else ok('TEMP_TARGET_PROC 미사용(포트 기반)');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

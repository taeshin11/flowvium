#!/usr/bin/env node
/**
 * thermal-target.test.mjs — 온도 조절기가 '보고서 LLM 만' 멈추는지 검증.
 *
 * 배경(2026-08-20 실측): TEMP_TARGET_PROC="mlx_lm server" 를 pgrep -f 로 매칭하는데,
 *   웹 레인(:8001, Qwen3.5-4B)을 띄우자 두 서버가 모두 매칭됐다(PID 52772, 75904).
 *   웹 레인은 번역·챗을 2초에 처리하는 소형 모델이고 사용자 대면이라 멈추면 안 된다.
 *   GPU 열의 주범은 27.5GB 보고서 모델이다. 대상을 포트로 특정해야 한다.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// 2026-08-21: 종전엔 ~/flowvium_runtime 의 사본을 읽었다 — 그 디렉토리는 git 밖이라
//   버전 관리·리뷰가 안 됐고, 그 상태에서 실제 장애가 났다(센서 정지 → LLM 무기한 SIGSTOP).
//   저장소를 단일 소스로 삼고, 사본이 되살아나지 못하게 아래에서 함께 검사한다.
const GOV = resolve(ROOT, 'scripts/runtime/thermal-governor.py');
const gov = readFileSync(GOV, 'utf8');
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

// 단일 소스 — plist 가 저장소 사본을 직접 실행해야 한다.
{
  const pa = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
  /scripts\/runtime\/thermal-governor\.py/.test(pa)
    ? ok('plist 가 저장소 사본을 실행한다')
    : bad(`plist 가 저장소 밖을 가리킨다 — 버전 관리 밖 코드가 돈다: ${pa.replace(/\s+/g, ' ').slice(0, 120)}`);
}
// 사본 재발 방지 — 두 벌이 있으면 어느 쪽이 도는지 알 수 없다.
{
  const stray = ['thermal-governor.py', 'thermal_policy.py']
    .filter((f) => existsSync(resolve(process.env.HOME, 'flowvium_runtime', f)));
  stray.length === 0
    ? ok('~/flowvium_runtime 에 사본 없음 (로그만 남는다)')
    : bad(`git 밖 사본 ${stray.length}개: ${stray.join(', ')} — 어느 쪽이 도는지 알 수 없다`);
}
// 센서 상실 방어 — 이번 장애의 근본 지점이 코드에 남아 있는지
{
  /on_sensor_timeout/.test(gov) ? ok('센서 상실 시 재개 경로 존재') : bad('센서가 끊기면 무기한 정지로 돌아간다');
  /select\.select/.test(gov)     ? ok('읽기 타임아웃 사용')          : bad('블로킹 읽기 — 센서 정지 시 영원히 멈춘다');
  /TEMP_MAX_PAUSE|max_pause/.test(gov) ? ok('최대 정지시간 상한 존재') : bad('최대 정지시간이 없어 무기한 굶길 수 있다');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

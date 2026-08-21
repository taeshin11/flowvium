#!/usr/bin/env node
/**
 * platform-ops.test.mjs — OS 종속 작업의 플랫폼 중립 래퍼.
 *
 * 배경(2026-08-20): 윈도우→맥 이식이 launchd 진입점만 바꾸고 하위 코드는 그대로 뒀다.
 *   전수조사 결과 실행 경로에 윈도우 전용 원시가 7군데 남아 전부 무증상 실패 중이었다:
 *     fetch-dart-corp-codes.mjs:52  powershell Expand-Archive  → dart-corpcodes 537h 미실행의 진짜 원인
 *     session-spotcheck.mjs:83      powershell Get-Content -Tail
 *     session-spotcheck.mjs:163     powershell Get-CimInstance (프로세스 조회)
 *     check-stall.mjs:120           powershell Get-CimInstance (hung report-gen 탐지)
 *     cron-runner.mjs:464/502       cmd /c run-report.bat        → 쇼크 긴급보고서 영구 미발화
 *   전부 try/catch 로 감싸여 있어 "조용히 skip" 되고 있었다 — 모니터는 결과(미실행 시간)만 보고
 *   원인을 못 짚었다. 증상마다 분기를 심지 않고 OS 종속 작업을 여기 한 곳으로 모은다.
 */
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let P;
try { P = await import('./platform-ops.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const d = mkdtempSync(join(tmpdir(), 'plat-'));

// [1] unzip — 실제로 파일이 나와야 한다 (status 0 만으로는 부족)
const inner = join(d, 'CORPCODE.xml');
writeFileSync(inner, '<result><list><corp_code>00126380</corp_code></list></result>');
const zip = join(d, 'a.zip');
execFileSync('zip', ['-j', '-q', zip, inner]);
rmSync(inner);
const uz = P.unzip(zip, d);
uz.ok && existsSync(inner) ? ok(`unzip: 파일 실제 생성 (${readFileSync(inner,'utf8').length}B)`) : bad(`unzip 실패: ${uz.error ?? '파일 없음'}`);

// [2] readTail — 마지막 N줄
const log = join(d, 'x.log');
writeFileSync(log, Array.from({length: 200}, (_, i) => `line${i+1}`).join('\n'));
const t = P.readTail(log, 80);
t.split('\n').filter(Boolean).length === 80 && t.includes('line200') && !t.includes('line120')
  ? ok('readTail: 마지막 80줄 정확') : bad(`readTail 부정확: ${t.split('\n').length}줄`);
P.readTail(join(d,'nope.log'), 10) === '' ? ok('readTail: 없는 파일 → 빈 문자열(예외 아님)') : bad('없는 파일 처리 이상');

// [3] findProcesses — 지금 도는 node 를 스스로 찾아야 한다
//   2026-08-21: 기본값이 '자기 제외' 로 바뀌었다(모니터가 자기 명령줄에 걸려 유령 생성기를
//   세던 사고). 함수 동작·ageSec 검증에는 '반드시 존재하는 프로세스' 가 필요하므로
//   여기서만 includeSelf 로 켠다. 기본값이 제외인지는 바로 아래에서 따로 못 박는다.
const procs = P.findProcesses('platform-ops.test', { includeSelf: true });
procs.some(p => p.pid === process.pid)
  ? ok(`findProcesses: 자기 자신 탐지 (pid ${process.pid}, ${procs.length}건)`)
  : bad(`findProcesses 가 자기 자신도 못 찾음: ${JSON.stringify(procs).slice(0,120)}`);
// 기본값(옵션 없음)은 자기 자신을 세지 않는다 — 유령 집계 회귀 봉쇄
P.findProcesses('platform-ops.test').some(p => p.pid === process.pid)
  ? bad('기본값인데 자기 자신이 결과에 들어온다 — 유령 프로세스 집계 재발')
  : ok('findProcesses: 기본값은 자기 자신 제외');
// 정규식 패턴도 받는다 (문자열이 스치기만 한 프로세스와 실행 파일을 구분하려면 필요)
Array.isArray(P.findProcesses(/platform-ops\.test/, { includeSelf: true }))
  ? ok('findProcesses: 정규식 패턴 지원') : bad('정규식 패턴 미지원');
const none = P.findProcesses('zzz-definitely-no-such-process-zzz');
Array.isArray(none) && none.length === 0 ? ok('findProcesses: 무매칭 → 빈 배열') : bad('무매칭 처리 이상');
// 나이(초)를 줘야 hung 탐지가 가능하다
procs[0] && typeof procs[0].ageSec === 'number' && procs[0].ageSec >= 0
  ? ok(`findProcesses: 나이 제공 (${procs[0].ageSec}s)`) : bad('ageSec 없음 — hung 탐지 불가');

rmSync(d, { recursive: true, force: true });
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

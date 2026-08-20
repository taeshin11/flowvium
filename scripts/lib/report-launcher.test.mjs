#!/usr/bin/env node
/**
 * report-launcher.test.mjs — 보고서 런처 해석의 플랫폼 중립성.
 *
 * 배경(2026-08-20): 윈도우→맥 이식에서 launchd 진입점만 run-report.sh 로 바꾸고
 *   하위 코드에 남은 윈도우 전용 실행 원시를 안 고쳤다. 결과:
 *     · cron-runner.mjs:464  execFileAsync('cmd', ['/c','scripts\\run-report.bat'])
 *         → 맥엔 cmd 가 없어 ENOENT. 시장 쇼크 긴급 보고서가 영구히 발화 안 됨(무증상).
 *     · check-stall.mjs:92   run-report.bat 를 읽어 --model= 추출
 *         → .sh 엔 그 표기가 없어 코드측 모델 목록이 비고, MODEL-ID MISMATCH 오경보 상시화.
 *   증상마다 때우면 다음 이식에서 또 샌다. 런처 해석을 한 곳으로 모은다.
 */
import { platform } from 'process';
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let L;
try { L = await import('./report-launcher.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const r = L.resolveLauncher();
r && r.cmd && Array.isArray(r.args) ? ok(`런처 해석: ${r.cmd} ${r.args.join(' ')}`) : bad('resolveLauncher 가 {cmd,args} 를 안 준다');

if (platform !== 'win32') {
  r.cmd !== 'cmd' ? ok('맥/리눅스에서 cmd 를 쓰지 않는다') : bad('맥인데 cmd 를 반환 — ENOENT 로 무증상 실패');
  r.cmd.endsWith('.sh') || r.args.some(a => a.endsWith('.sh'))
    ? ok('맥에서 .sh 런처를 가리킨다') : bad(`맥인데 .sh 가 아님: ${r.cmd} ${r.args}`);
}
// 실행 가능해야 한다 — 존재만으로는 부족(2026-06-03 교훈: 모니터가 본다 ≠ 고쳐졌다)
import { accessSync, constants } from 'fs';
const target = r.args.find(a => a.includes('run-report')) ?? r.cmd;
try { accessSync(target, constants.X_OK); ok(`런처가 실행 가능: ${target.split('/').pop()}`); }
catch { bad(`런처가 실행 불가(chmod +x 안 됨): ${target}`); }

// 세션 인자를 붙일 수 있어야 쇼크 트리거가 세션을 지정한다
const s = L.resolveLauncher({ session: 'noon', locale: 'ko', autoUpload: true });
s.args.some(a => a.includes('noon')) ? ok('세션 인자 전달됨') : bad('세션 인자가 args 에 없다');

// 모델 ID 를 런처에서 읽되, 플랫폼에 맞는 파일에서 읽어야 한다
const models = L.readLauncherModels();
Array.isArray(models) ? ok(`런처 모델 추출: [${models.join(', ') || '(없음)'}]`) : bad('readLauncherModels 가 배열이 아니다');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

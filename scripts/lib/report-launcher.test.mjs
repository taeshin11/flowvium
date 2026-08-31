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
import { accessSync, constants, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = r.args.find(a => a.includes('run-report')) ?? r.cmd;
try { accessSync(target, constants.X_OK); ok(`런처가 실행 가능: ${target.split('/').pop()}`); }
catch { bad(`런처가 실행 불가(chmod +x 안 됨): ${target}`); }

// 세션 인자를 붙일 수 있어야 쇼크 트리거가 세션을 지정한다
const s = L.resolveLauncher({ session: 'noon', locale: 'ko', autoUpload: true });
s.args.some(a => a.includes('noon')) ? ok('세션 인자 전달됨') : bad('세션 인자가 args 에 없다');

// 모델 ID 를 런처에서 읽되, 플랫폼에 맞는 파일에서 읽어야 한다
const models = L.readLauncherModels();
Array.isArray(models) ? ok(`런처 모델 추출: [${models.join(', ') || '(없음)'}]`) : bad('readLauncherModels 가 배열이 아니다');

// ── 2026-08-31: 비정기 보고서가 생성만 되고 발행이 안 되던 경로 ───────────────────
//   실측 — 12:20 시장 쇼크(KOSPI -3.9% · 이란)로 비정기 보고서가 돌아 12:25 에 DB 까지
//   저장됐다(2026-08-31:noon:ko, quality 93). 그런데 모니터가 12:41 에 이렇게 찍었다:
//     🚨 라이브 미반영: noon 발행 예정 시각을 40분 초과했는데 라이브가 83분 뒤처짐
//   logs/report.log 끝줄이 원인을 그대로 말한다:
//     "✅ 생성 완료. 내용 확인 후 업로드:  node ... --upload=latest"
//   즉 --auto-upload 가 안 붙었다. cron-runner 의 shock·catchup 두 경로가 모두
//   `resolveLauncher()` 를 **인자 없이** 부른다 → extra=[] → 세션도 업로드도 없다.
//   정기 실행(launchd plist)은 --session=noon --auto-upload 를 준다. 비정기만 빠졌다.
//
//   catchup 쪽이 더 나쁘다. 그 잡의 존재 이유가 "라이브의 공백을 메우는 것" 인데
//   발행을 안 하면 아무것도 안 메운다 — 이번 3일 정지 때도 catchup 이 돌았지만
//   라이브는 그대로였다.
{
  const withUpload = L.resolveLauncher({ session: 'noon', locale: 'ko', autoUpload: true });
  withUpload.args.includes('--auto-upload')
    ? ok('autoUpload 옵션은 --auto-upload 를 붙인다')
    : bad('autoUpload 를 줘도 인자가 안 붙는다');

  // 호출부 검사 — 라이브에 반영돼야 하는 경로가 그 옵션을 실제로 쓰는가.
  // 함수가 옵션을 지원해도 호출부가 안 쓰면 사용자에겐 아무 변화가 없다.
  //   실제 코드 모양은 `(({cmd,args}) => execFileAsync(...))(resolveLauncher())` 이라
  //   둘이 같은 줄에 있다. 그 줄만 본다 — path 만 읽는 bare 호출(로그용)은 무해하므로 뺀다.
  const cron = readFileSync(resolve(ROOT, 'scripts/cron-runner.mjs'), 'utf8').split('\n');
  const offenders = cron
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /execFileAsync/.test(l) && /resolveLauncher\(\s*\)/.test(l));
  offenders.length === 0
    ? ok('cron 의 비정기 실행 경로가 옵션 없이 런처를 실행하지 않는다')
    : bad(`비정기 실행 ${offenders.length}곳이 resolveLauncher() 를 옵션 없이 실행한다 — 생성만 하고 발행을 안 한다 (줄 ${offenders.map(o => o.n).join(', ')})`);

  //   그리고 옵션을 주더라도 autoUpload 가 빠지면 결과는 같다. 옵션 있는 호출을 전부 본다.
  //   (구간 정규식으로 훑지 않는다 — 앞선 [catchup] 로그 줄에 걸려 엉뚱한 곳을 재던 걸 고쳤다.)
  const src = cron.join('\n');
  const optCalls = [...src.matchAll(/resolveLauncher\(\s*\{([^}]*)\}\s*\)/g)].map((m) => m[1]);
  optCalls.length >= 2
    ? ok(`옵션을 주는 런처 호출 ${optCalls.length}곳 (shock · catchup)`)
    : bad(`옵션을 주는 런처 호출이 ${optCalls.length}곳뿐 — 비정기 경로 둘 다 있어야 한다`);
  const missing = optCalls.filter((o) => !/autoUpload:\s*true/.test(o));
  missing.length === 0
    ? ok('비정기 실행이 전부 autoUpload 로 발행까지 간다')
    : bad(`autoUpload 없는 호출 ${missing.length}곳 — 생성만 하고 라이브는 그대로다`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

/**
 * report-launcher.mjs — 보고서 파이프라인 런처를 플랫폼 중립으로 해석한다.
 *
 * 배경(2026-08-20): 윈도우→맥 이식에서 launchd 진입점만 run-report.sh 로 바꾸고
 *   하위 코드에 남은 윈도우 전용 실행 원시는 그대로였다.
 *     · cron-runner.mjs  execFileAsync('cmd', ['/c','scripts\\run-report.bat'])
 *         맥엔 cmd 가 없어 ENOENT → 시장 쇼크 긴급 보고서가 영구히 발화 안 됐다(무증상).
 *     · check-stall.mjs  run-report.bat 를 읽어 --model= 추출
 *         .sh 엔 그 표기가 없어 코드측 모델 집합이 비고 MODEL-ID MISMATCH 오경보가 상시화됐다.
 *   호출부마다 platform 분기를 심으면 다음 이식에서 또 샌다. 여기 한 곳만 안다.
 */
import { existsSync, readFileSync, accessSync, constants } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

const WIN = process.platform === 'win32';

/** 이 플랫폼에서 실제로 실행 가능한 런처 파일 경로. 없으면 null. */
export function launcherPath() {
  const order = WIN ? ['scripts/run-report.bat', 'scripts/run-report.sh']
                    : ['scripts/run-report.sh', 'scripts/run-report.bat'];
  for (const rel of order) {
    const p = resolve(ROOT, rel);
    if (!existsSync(p)) continue;
    if (WIN === rel.endsWith('.bat')) return p;   // 플랫폼과 확장자가 맞을 때만
  }
  return null;
}

/**
 * 실행에 필요한 {cmd, args} 를 준다.
 * opts: { session, locale, autoUpload } — 없으면 런처 기본값(대개 자동 세션 판정)을 따른다.
 */
export function resolveLauncher(opts = {}) {
  const p = launcherPath();
  if (!p) throw new Error(`[report-launcher] ${process.platform} 에서 쓸 런처가 없다 (run-report.sh/.bat 부재)`);
  const extra = [];
  if (opts.session) extra.push(`--session=${opts.session}`);
  if (opts.locale) extra.push(`--locale=${opts.locale}`);
  if (opts.autoUpload) extra.push('--auto-upload');
  // 윈도우: cmd /c 로 .bat 을 태운다. 그 외: 실행 비트가 있으면 직접, 없으면 sh 로.
  if (WIN) return { cmd: 'cmd', args: ['/c', p, ...extra], path: p };
  try { accessSync(p, constants.X_OK); return { cmd: p, args: extra, path: p }; }
  catch { return { cmd: '/bin/sh', args: [p, ...extra], path: p }; }
}

/**
 * 런처가 명시하는 모델 ID 들. 모니터가 "코드가 기대하는 모델" 집합을 만들 때 쓴다.
 * .bat 은 --model=, .sh 는 --model= 또는 MODEL= 환경변수 형태를 모두 본다.
 */
export function readLauncherModels() {
  const p = launcherPath();
  if (!p) return [];
  let txt = '';
  try { txt = readFileSync(p, 'utf8'); } catch { return []; }
  const out = new Set();
  for (const m of txt.matchAll(/--model[= ]["']?([A-Za-z0-9:._\/-]+)/g)) out.add(m[1]);
  for (const m of txt.matchAll(/^\s*(?:export\s+)?(?:VLLM_MODEL|LLM_MODEL|MODEL)\s*=\s*["']?([A-Za-z0-9:._\/-]+)/gm)) out.add(m[1]);
  return [...out];
}

/**
 * 이 플랫폼에서 실제로 실행되는 런처가 작업트리를 origin 으로 되돌리는가.
 *
 * 2026-08-20: 모니터는 "다음 cron 이 wipe" 라고 경고해 왔지만, 그 checkout 은 윈도우용
 *   run-report.bat 에만 있고 맥 launchd 는 run-report.sh(=git 명령 없음)만 부른다.
 *   틀린 메커니즘을 단정하면 사람을 엉뚱한 조치로 보낸다 — 파일을 읽어서 판정한다.
 */
export function launcherWipesWorktree() {
  const p = launcherPath();
  if (!p) return false;
  try { return /git\s+checkout\s+origin\/\S+\s+--|git\s+reset\s+--hard/.test(readFileSync(p, 'utf8')); }
  catch { return false; }
}

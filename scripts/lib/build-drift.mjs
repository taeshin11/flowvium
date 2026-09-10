/**
 * build-drift.mjs — src 가 빌드보다 새로운가(= 고쳤는데 배포 안 됨).
 *
 * 왜 (2026-09-10): 웹 레인은 launchd 가 `next start` 로 띄운다 — 프로덕션 빌드를 서빙한다.
 *   그런데 자동 빌드가 어디에도 없다(cron-runner·run-report.sh 확인). src/ 를 고치고
 *   커밋까지 해도 손으로 `next build` 를 하지 않으면 **라이브는 옛 코드 그대로다.**
 *   flowvium.net 이 이 서버로 터널되므로 그게 곧 사용자가 보는 화면이다.
 *   "고쳤다" 와 "사용자에게 닿았다" 사이의 이 틈은 아무 소리도 내지 않는다.
 *
 * 자동으로 빌드하지는 않는다 — 빌드는 CPU·메모리를 크게 먹어 보고서·쇼츠 렌더와 경합한다
 *   (2026-09-07 실측: 27B 로드가 보고서 2건과 쇼츠 4슬롯을 죽였다). 알리기만 한다.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './project-root.mjs';

const BUILD_ID = join(ROOT, '.next/BUILD_ID');

/** 빌드 시각(ms). 빌드가 없으면 null. */
export function buildStamp() {
  return existsSync(BUILD_ID) ? statSync(BUILD_ID).mtimeMs : null;
}

function walk(dir, out = []) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 빌드보다 새로운 src 파일들(리포지토리 상대경로). 빌드가 없으면 전부. */
export function driftingFiles({ stamp = buildStamp() } = {}) {
  const files = walk(join(ROOT, 'src'));
  const cut = stamp ?? 0;
  return files
    .filter((f) => { try { return statSync(f).mtimeMs > cut; } catch { return false; } })
    .map((f) => f.slice(ROOT.length + 1));
}

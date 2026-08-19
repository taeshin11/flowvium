#!/usr/bin/env node
/**
 * project-root.test.mjs — 스크립트가 절대경로를 박지 않고 루트를 유도하는지 검증.
 *
 * 배경(2026-08-20 실측): 16개 감사·검증 스크립트에 `C:/Flowvium` 이 리터럴로 박혀 있었다.
 *   맥 이관 후 이들이 전부 오작동한다. 특히 check-uncommitted-risk.mjs 는 execSync 가 없는
 *   경로에서 실패해 빈 문자열을 받고 "✅ cron wipe 위험 0" 이라는 거짓 초록을 냈다 —
 *   실제로는 tracked 13파일이 미커밋 상태였다. check-stall.mjs 는 예외로 죽으면서 rc=0 이라
 *   20분 감시 크론이 성공으로 오인했다.
 *   안전망이 "고장났다"가 아니라 "고장난 채 통과"라서 더 나쁘다.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ① 헬퍼가 존재하고 실제 루트를 가리켜야 한다
let P;
try { P = await import('./project-root.mjs'); } catch { P = null; }
if (!P?.projectRoot) { bad('project-root.mjs 미구현'); console.log('\n결과: 실패 1건'); process.exit(1); }
P.projectRoot() === ROOT ? ok(`projectRoot() = ${P.projectRoot()}`) : bad(`루트 불일치: ${P.projectRoot()} vs ${ROOT}`);

// ② scripts/ 트리에 플랫폼 절대경로 리터럴이 남아 있으면 안 된다
const BAD = /(['"`])(?:[A-Za-z]:[\\/]|\/mnt\/[a-z]\/)[^'"`]*\1/;
const offenders = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(mjs|js|ts|py|sh)$/.test(e.name)) continue;
    if (/\.bak|\.test\./.test(e.name)) continue;
    // 명시적 제외 — 고친 척 하지 않고 이유를 남긴다.
    //   scripts/sft/* : LoRA 학습 파이프라인(CUDA/WSL 전용). 2026-08-20 파인튜닝 포기 결정으로
    //   이 맥에서 실행 대상이 아니다. 되살리려면 경로부터 유도형으로 고쳐야 한다.
    if (p.includes('/sft/')) continue;
    const src = readFileSync(p, 'utf8');
    const lines = src.split('\n');
    lines.forEach((ln, i) => {
      if (!BAD.test(ln)) return;
      if (/^\s*(\/\/|#|\*)/.test(ln)) return;                       // 주석
      // 플랫폼 가드 안의 리터럴은 정당하다 — 같은 줄 또는 앞 4줄에 win32 분기가 있으면 통과.
      //   (가드 없는 리터럴만 잡는다. 테스트를 느슨하게 푸는 게 아니라 정확하게 만드는 것.)
      const ctx = lines.slice(Math.max(0, i - 4), i + 1).join(' ');
      if (/process\.platform\s*===\s*['"]win32['"]/.test(ctx)) return;
      offenders.push(`${p.replace(ROOT + '/', '')}:${i + 1}`);
    });
  }
};
walk(resolve(ROOT, 'scripts'));
offenders.length === 0
  ? ok('scripts/ 트리에 플랫폼 절대경로 리터럴 없음')
  : bad(`절대경로 리터럴 ${offenders.length}곳:\n        ` + offenders.slice(0, 20).join('\n        ') + (offenders.length > 20 ? `\n        … 외 ${offenders.length - 20}곳` : ''));

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

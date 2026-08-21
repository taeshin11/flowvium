#!/usr/bin/env node
/**
 * source-placement.test.mjs — "삽입된 코드가 실행되는 자리에 있는가".
 *
 * 이번 세션에 같은 부류의 결함을 두 번 만났다. 둘 다 문법상 유효해서
 * `node --check` 가 통과하고, 그래서 조용히 죽어 있었다.
 *
 *   1) scripts/check-data-quality.mjs
 *      코드모드가 project-root import 를 shebang *위* 에 넣어 shebang 이 2행이 됐다.
 *      → 파싱조차 안 됐고, 20분마다 도는 모니터는 dq=DEFECT 만 찍었다(이유는 안 보였다).
 *
 *   2) scripts/lib/db.mjs
 *      isTicker·insiderDirection import 두 줄이 파일 헤더 블록 주석 *안* 에 들어갔다.
 *      → 주석이라 아무 일도 안 하고, saveDomainArchives 가 ReferenceError 로 통째로 실패했다.
 *      실측: short_squeeze_archive·insider_archive 마지막 기록이 08-21 02:17(noon)에서 멈춰
 *      afternoon·evening 보고서는 한 행도 적재하지 못했다. 그 자리에 넣은 가드 자체도 죽어 있었다.
 *
 * 판정은 정규식이 아니라 파서로 한다. 처음엔 줄 단위 주석 스캐너를 손으로 짰다가
 * 문자열·정규식 속 여는 표시에 걸려 실제 코드 5줄을 주석이라고 오탐했다.
 * acorn 으로 AST 를 만들고, 원문에 import/export 로 보이는 줄이 AST 에 없으면 그건 죽은 줄이다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as acorn from 'acorn';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const files = execSync("git ls-files 'scripts/**/*.mjs' 'scripts/*.mjs'", { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

const DECL = new Set(['ImportDeclaration', 'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration']);
let dead = 0, shebangBad = 0, unparsable = 0;

for (const rel of files) {
  const src = readFileSync(resolve(ROOT, rel), 'utf8');
  const lines = src.split('\n');

  // (a) shebang 은 1행이어야 한다 — 아니면 node 가 파싱에 실패한다
  const sb = lines.findIndex(l => l.startsWith('#!'));
  if (sb > 0) { bad(`${rel}:${sb + 1} — shebang 이 1행이 아니다 (node 가 SyntaxError)`); shebangBad++; }

  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (e) {
    bad(`${rel} — 파싱 불가: ${e.message.slice(0, 70)}`);
    unparsable++;
    continue;
  }

  // AST 상 실제 최상위 선언이 있는 줄
  const live = new Set();
  for (const n of ast.body) if (DECL.has(n.type)) live.add(n.loc.start.line);

  lines.forEach((l, i) => {
    if (!/^\s*(import|export)\s/.test(l)) return;   // 원문에서 선언처럼 보이는데
    if (live.has(i + 1)) return;                     // AST 에 있으면 살아 있다
    bad(`${rel}:${i + 1} — 주석/문자열 안이라 실행되지 않는 ${l.trim().split(/\s/)[0]} 문: ${l.trim().slice(0, 58)}`);
    dead++;
  });
}

console.log(`\n검사 ${files.length}개 파일 · 죽은 선언 ${dead}건 · shebang 위치오류 ${shebangBad}건 · 파싱불가 ${unparsable}건`);
if (!dead && !shebangBad && !unparsable) ok('모든 스크립트의 import/export 가 실제로 실행되는 자리에 있다');
console.log(fail === 0 ? '\n✅ source-placement 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

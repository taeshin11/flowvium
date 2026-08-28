#!/usr/bin/env node
/**
 * css-comment.test.mjs — 스타일 블록 안에 JS 줄주석이 섞이지 않았는가.
 *
 * 배경(2026-08-28): 마무리 화면 CSS 리셋 위에 `// …` 주석을 붙였다. JS 는 멀쩡하고
 *   `node --check` 도 통과한다. 그런데 CSS 에는 줄주석이 없어서, 파서가 그 자리를
 *   잘못된 선택자로 읽고 **뒤따르는 규칙 블록을 통째로 건너뛴다.**
 *   그 결과 리셋과 body 의 padding 이 사라져 로고가 앵커 박스 밑으로 들어갔다.
 *
 * 렌더까지 가야 드러나는 결함이고, 렌더는 십수 분이 걸린다. 정적으로 잡는다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 스타일 블록 안의 JS 줄주석을 찾는다. 여는 태그가 주석 안에 있는 경우는 세지 않는다. */
export function cssLineComments(src) {
  const out = [];
  const re = /<style>([\s\S]*?)<\/style>/g;
  for (const m of src.matchAll(re)) {
    // 여는 태그가 JS 주석 줄 안에 있으면 실제 스타일 블록이 아니다.
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index))) continue;
    for (const line of m[1].split('\n')) {
      if (/^\s*\/\//.test(line)) out.push(line.trim());
    }
  }
  return out;
}

// ── 1. 재현 ──────────────────────────────────────────────────────────────────
{
  const broken = 'const x = `<style>\n// 설명\n*{margin:0}\n</style>`;';
  const got = cssLineComments(broken);
  if (got.length === 1) ok(`스타일 안 줄주석을 잡는다 ("${got[0]}")`);
  else bad(`못 잡았다 — ${got.length}건`);
}

// ── 2. 오탐 없음 ─────────────────────────────────────────────────────────────
{
  const fine = 'const x = `<style>\n/* 설명 */\n*{margin:0}\n</style>`;';
  if (cssLineComments(fine).length === 0) ok('CSS 주석(/* */)은 통과');
  else bad('CSS 주석을 잘못 잡았다');

  // 여는 태그가 JS 주석 안에 있는 경우(설명문에 태그 이름을 쓴 경우)
  const mention = '// 주석은 <style> 밖에 둔다\n// 그 뒤 블록이 사라진다\nconst y = 1;\nconst x = `<style>\n*{margin:0}\n</style>`;';
  if (cssLineComments(mention).length === 0) ok('설명문에 태그 이름이 나와도 오탐 없음');
  else bad(`오탐 — ${JSON.stringify(cssLineComments(mention))}`);
}

// ── 3. 실제 스크립트 전수 ────────────────────────────────────────────────────
{
  const hits = [];
  let n = 0;
  for (const d of ['scripts', 'scripts/lib', 'scripts/video']) {
    let ents = [];
    try { ents = readdirSync(join(ROOT, d)); } catch { continue; }
    for (const f of ents) {
      if (!f.endsWith('.mjs') || f.endsWith('.test.mjs')) continue;
      n++;
      for (const line of cssLineComments(readFileSync(join(ROOT, d, f), 'utf8'))) {
        hits.push(`${d}/${f}: ${line.slice(0, 70)}`);
      }
    }
  }
  if (!hits.length) ok(`실제 스크립트 ${n}개 — 스타일 안 줄주석 없음`);
  else bad(`${hits.length}건\n      ${hits.join('\n      ')}`);
}

console.log(fail ? `\n  ${fail}개 실패` : '\n✅ css-comment 전부 통과');
process.exit(fail ? 1 : 0);

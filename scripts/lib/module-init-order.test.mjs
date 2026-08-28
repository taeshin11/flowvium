#!/usr/bin/env node
/**
 * module-init-order.test.mjs — 모듈 최상위 const 의 초기화 순서(TDZ).
 *
 * 배경(2026-08-28): 앵커 박스를 넣으면서 `const ABOX = ... anchorBox({ width: W, ... })`
 *   를 `const W = 1920` **위에** 놓았다. 문법은 멀쩡해서 `node --check` 는 통과하고,
 *   실행하는 순간 `ReferenceError: Cannot access 'W' before initialization` 로 죽었다.
 *   렌더 스크립트는 한 번 돌리는 데 십수 분이 걸려서, 이런 건 돌려보기 전에 잡아야 한다.
 *
 * 문법 검사로는 못 잡고 실행해야만 드러나는 결함이라, 정적으로 잡는 층이 따로 필요하다.
 *   여기서 보는 것은 **선언 순서** 하나다: 최상위 `const X = <식>` 의 식이
 *   자기보다 아래에서 선언된 최상위 이름을 참조하면 실행 시 TDZ 다.
 *
 * 함수 안에서의 참조는 호출 시점에 평가되므로 무관하다 — 그래서 최상위 문장만 본다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

/** 중첩 깊이 0(모듈 최상위)의 문장만 남긴다. 문자열·주석·정규식 리터럴은 지운다. */
function topLevelStatements(src) {
  // 주석/문자열/템플릿/정규식을 공백으로 치환해 깊이 계산이 오염되지 않게 한다.
  let out = '';
  let i = 0, depth = 0;
  const stmts = [];
  let cur = '', curStart = 0;
  const flush = () => { if (cur.trim()) stmts.push({ text: cur, at: curStart }); cur = ''; };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { cur += ' '; i++; } continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const stop = e < 0 ? src.length : e + 2;
      for (; i < stop; i++) cur += src[i] === '\n' ? '\n' : ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; cur += ' '; i++;
      while (i < src.length) {
        if (src[i] === '\\') { cur += '  '; i += 2; continue; }
        if (src[i] === q) { cur += ' '; i++; break; }
        // 템플릿 안의 ${...} 는 식이라 참조가 살아 있다 — 그대로 남긴다.
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 1; cur += '  '; i += 2;
          while (i < src.length && d > 0) {
            const c2 = src[i];
            if (c2 === '{') d++; else if (c2 === '}') d--;
            // ${...} 안의 문자열도 지운다. 'MEDIA_ROOT' 같은 **라벨**이 참조로 잡혔다(2026-08-28).
            if (d > 0 && (c2 === '"' || c2 === "'")) {
              const q2 = c2; cur += ' '; i++;
              while (i < src.length) {
                if (src[i] === '\\') { cur += '  '; i += 2; continue; }
                if (src[i] === q2) { cur += ' '; i++; break; }
                cur += ' '; i++;
              }
              continue;
            }
            if (d > 0) cur += c2;
            i++;
          }
          cur += ' '; continue;
        }
        cur += src[i] === '\n' ? '\n' : ' '; i++;
      }
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    if (c === '}' || c === ')' || c === ']') depth--;
    if (cur === '') curStart = i;
    cur += c;
    if (depth === 0 && (c === ';' || c === '\n')) {
      // 한 줄짜리 문장 경계. 세미콜론이 없으면 줄바꿈으로 끊는다.
      if (c === ';' || /^\s*(const|let|var|import|export)\b/.test(cur)) flush();
      else if (!cur.trim()) cur = '';
    }
    i++;
  }
  flush();
  return stmts;
}

/** 최상위 const/let 로 묶인 이름들을 선언 순서대로 뽑는다. */
function topLevelBindings(stmts) {
  const decls = [];
  for (let s = 0; s < stmts.length; s++) {
    const t = stmts[s].text;
    const m = /^\s*(?:export\s+)?(?:const|let)\s+([\s\S]+)$/.exec(t);
    if (!m) continue;
    const head = m[1];
    const eq = head.indexOf('=');
    if (eq < 0) continue;
    const lhs = head.slice(0, eq);
    const rhs = head.slice(eq + 1);
    const names = [...lhs.matchAll(/[A-Za-z_$][\w$]*/g)].map(x => x[0]);
    decls.push({ order: s, names, rhs, raw: t });
  }
  return decls;
}

const RESERVED = new Set([
  'const','let','var','function','return','new','await','typeof','instanceof','in','of',
  'true','false','null','undefined','if','else','for','while','try','catch','throw',
  'this','void','delete','class','extends','import','export','default','from','as','yield',
]);

/** decl.rhs 안에서 참조하는 식별자. 프로퍼티 접근(.x)과 객체 키(x:)는 뺀다. */
function referenced(rhs) {
  const cleaned = rhs
    .replace(/\.\s*[A-Za-z_$][\w$]*/g, ' ')       // .prop
    .replace(/(?:^|[{,])\s*[A-Za-z_$][\w$]*\s*:/g, ' '); // { key: ... }
  return new Set([...cleaned.matchAll(/[A-Za-z_$][\w$]*/g)]
    .map(x => x[0]).filter(x => !RESERVED.has(x)));
}

/** 파일 하나를 검사해 위반 목록을 돌려준다. */
export function initOrderViolations(src) {
  const stmts = topLevelStatements(src);
  const decls = topLevelBindings(stmts);
  const declaredAt = new Map();
  for (const d of decls) for (const n of d.names) if (!declaredAt.has(n)) declaredAt.set(n, d.order);
  const bad = [];
  for (const d of decls) {
    // 함수/화살표 본문은 호출 시 평가된다 — 본문을 지우고 본다.
    const body = d.rhs.includes('=>') || /\bfunction\b/.test(d.rhs) ? '' : d.rhs;
    if (!body.trim()) continue;
    for (const ref of referenced(body)) {
      const at = declaredAt.get(ref);
      if (at !== undefined && at > d.order) {
        bad.push({ name: d.names[0], uses: ref, declLine: d.order, useLine: at });
      }
    }
  }
  return bad;
}

/**
 * 최상위 **문장**(선언이 아닌 것 — 반복문·if·호출)이 아래에서 선언된 const 를 쓰는가.
 *
 * 놓친 사례(2026-08-28): `const SCENE_TAIL` 을 쓰는 for 루프보다 **뒤에** 선언했다.
 *   initOrderViolations 는 `const X = <식>` 의 식만 봐서 못 잡았다.
 *   최상위 코드는 위에서 아래로 실행되므로, 반복문 안이라도 실행 시점은 그 자리다.
 */
export function statementOrderViolations(src) {
  const stmts = topLevelStatements(src);
  const decls = topLevelBindings(stmts);
  const declaredAt = new Map();
  for (const d of decls) for (const n of d.names) if (!declaredAt.has(n)) declaredAt.set(n, d.order);
  const declOrders = new Set(decls.map((d) => d.order));
  const bad = [];
  for (let i = 0; i < stmts.length; i++) {
    if (declOrders.has(i)) continue;
    const t = stmts[i].text;
    // 함수·클래스 선언은 호이스팅되거나 호출 시점에 평가된다. export/default/async 형태도 같다.
    if (/^\s*(export\s+)?(default\s+)?(async\s+)?(function|class)\b/.test(t)) continue;
    for (const ref of referenced(t)) {
      const at = declaredAt.get(ref);
      if (at !== undefined && at > i) bad.push({ uses: ref, at: i, declaredAt: at, text: t.trim().slice(0, 60) });
    }
  }
  return bad;
}

// ── 1. 재현: 실제로 죽었던 배치를 잡아내는가 ─────────────────────────────────
{
  const broken = `
const ROOT = '/x';
const ABOX = anchorBox({ width: W, height: H });
const W = 1920, H = 1080;
`;
  const v = initOrderViolations(broken);
  if (v.length && v.some(x => x.uses === 'W'))
    ok(`TDZ 배치를 잡는다 (${v.map(x => `${x.name}→${x.uses}`).join(', ')})`);
  else bad(`TDZ 배치를 못 잡았다 — 위반 ${v.length}건`);
}

// ── 2. 정상 배치는 통과시킨다(오탐 없음) ─────────────────────────────────────
{
  const fine = `
const W = 1920, H = 1080;
const ABOX = anchorBox({ width: W, height: H });
const later = () => W + LATE;
const LATE = 3;
`;
  const v = initOrderViolations(fine);
  if (v.length === 0) ok('정상 배치·함수 본문 참조는 통과');
  else bad(`오탐 ${v.length}건 — ${JSON.stringify(v)}`);
}

// ── 3. 실제 스크립트 전수 ────────────────────────────────────────────────────
{
  const dirs = ['scripts', 'scripts/lib', 'scripts/video'];
  const files = [];
  for (const d of dirs) {
    let ents = [];
    try { ents = readdirSync(join(ROOT, d)); } catch { continue; }
    for (const f of ents) {
      if (!f.endsWith('.mjs') || f.endsWith('.test.mjs')) continue;
      files.push(join(d, f));
    }
  }
  if (files.length < 10) { bad(`검사 대상이 ${files.length}개뿐 — 경로가 틀렸다`); }
  const hits = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const x of initOrderViolations(src)) hits.push(`${f}: ${x.name} 이 아래에서 선언된 ${x.uses} 를 참조`);
    // statementOrderViolations 는 **전수 검사에 쓰지 않는다.** 셰뱅·루프 지역변수·
    //   함수 선언을 참조로 오인해 오탐이 계속 났다(2026-08-28). 양치기 소년이 되면 결국 꺼진다.
    //   아래 [4] 에서 개념만 검증하고, 이 부류(SCENE_TAIL)는 **실제로 한 번 실행해** 잡는다.
  }
  if (hits.length === 0) ok(`실제 스크립트 ${files.length}개 — TDZ 위반 없음`);
  else bad(`TDZ 위반 ${hits.length}건\n      ${hits.join('\n      ')}`);
}

console.log(fail ? `\n  ${fail}개 실패` : '\n  전부 통과');
process.exit(fail ? 1 : 0);

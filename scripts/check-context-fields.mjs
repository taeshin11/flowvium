#!/usr/bin/env node
/**
 * check-context-fields.mjs — 컨텍스트 섹션에 *없는 필드* 를 읽는 코드를 잡는다.
 *
 * 왜(2026-08-22): 같은 부류의 버그를 이 저장소에서 세 번 만났다.
 *   ① preferSmallModel — 선언만 하고 라우팅에서 안 씀 (a17ea6f6)
 *   ② ctx.news?.articles — 존재하지 않는 필드 → micro_news_positive 가 개통 이래 0 발화
 *   ③ ctxRaw.cascade[].downstreamBeneficiaries — 그 스키마에 없음 → 공급망 룰 발화 불가 (d7ab9213)
 *   셋 다 "없는 필드를 읽고 `?? []` / `?? null` 이 조용히 삼킨" 경우다. 몇 달간 무증상이었다.
 *   증상이 없으니 아무도 안 고쳤다 — 검사가 없으면 이 부류는 계속 쌓인다.
 *
 * 근거를 어디서 얻나: 정적 분석으로 unwrap 체인(`newsCascade?.articles ?? []`)까지 재현하면
 *   깨지기 쉽다. 그래서 **실행 시점에 기록한 진짜 모양**(logs/ctx-shapes.json)과 대조한다.
 *   그 파일은 매 보고서 실행마다 갱신되므로 항상 현재를 반영한다.
 *   모양 파일이 없으면 판정하지 않는다 — 모르는 걸 아는 척하지 않는다.
 *
 * 사용: node scripts/check-context-fields.mjs
 * 종료코드: 0(문제 없음/판정 불가) · 1(없는 필드 접근 발견)
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

const SHAPES = resolve(ROOT, 'logs/ctx-shapes.json');
const SRC = resolve(ROOT, 'scripts/generate-report-local.mjs');

if (!existsSync(SHAPES)) {
  console.log('⏭️  logs/ctx-shapes.json 없음 — 보고서를 한 번 돌리면 생성된다. 판정 생략.');
  process.exit(0);
}
const shapes = JSON.parse(readFileSync(SHAPES, 'utf8')).shapes ?? {};
const rawSrc = readFileSync(SRC, 'utf8');
const lines = rawSrc.split('\n');
// 주석은 검사 대상이 아니다. 이 부류의 수정 이력 주석은 옛 표현식을 그대로 인용하므로,
//   빼지 않으면 자기 설명글을 결함으로 잡는다(오늘 같은 오탐을 세 번 만났다).
//   줄 번호를 보존해야 하므로 삭제가 아니라 **공백으로 치환**한다.
const src = lines.map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n');
const lineOf = (idx) => src.slice(0, idx).split('\n').length;

/** 섹션이 가진 키 집합. 배열이면 원소 키. */
function keysFor(section) {
  const s = shapes[section];
  if (!s) return null;
  if (s.kind === 'array') return new Set(s.elementKeys ?? []);
  if (s.kind === 'object') return new Set(s.keys ?? []);
  return null;   // 스칼라/null — 필드 접근 자체가 의미 없다
}

const findings = [];

// ── 패턴 1: ctxRaw?.<section>?.<field>  (객체 섹션의 직접 필드)
for (const m of src.matchAll(/ctxRaw\??\.(\w+)\??\.(\w+)/g)) {
  const [, section, field] = m;
  const keys = keysFor(section);
  if (!keys || !keys.size) continue;
  if (shapes[section]?.kind !== 'object') continue;   // 배열은 패턴 2가 본다
  if (!keys.has(field)) findings.push({ section, field, line: lineOf(m.index), how: '직접 필드' });
}

// ── 패턴 2: (ctxRaw?.<section> ?? []).<map|flatMap|filter|forEach|find|some|every>(<p> => … <p>.<field>)
const arrMethod = /\(?ctxRaw\??\.(\w+)\s*(?:\?\?\s*\[\])?\)?\s*\.\s*(?:map|flatMap|filter|forEach|find|some|every|reduce)\(\s*\(?(\w+)\)?\s*=>/g;
for (const m of src.matchAll(arrMethod)) {
  const [, section, param] = m;
  if (shapes[section]?.kind !== 'array') continue;
  const keys = keysFor(section);
  if (!keys || !keys.size) continue;
  // 콜백 본문(다음 400자)에서 param.<field> 를 찾는다 — 중첩 콜백은 놓칠 수 있다(보수적).
  const body = src.slice(m.index, m.index + 400);
  for (const f of body.matchAll(new RegExp(`\\b${param}\\??\\.(\\w+)`, 'g'))) {
    const field = f[1];
    if (!keys.has(field)) findings.push({ section, field, line: lineOf(m.index), how: `배열 원소(${param})` });
  }
}

const uniq = new Map();
for (const f of findings) uniq.set(`${f.section}.${f.field}`, f);

console.log('═══ 컨텍스트 필드 존재 검사 (실행 시점 모양 대조) ═══');
console.log(`섹션 ${Object.keys(shapes).length}종 · 기록 ${JSON.parse(readFileSync(SHAPES, 'utf8')).at}\n`);
if (!uniq.size) {
  console.log('✅ 섹션에 없는 필드를 읽는 코드 0건');
  process.exit(0);
}
for (const f of [...uniq.values()].sort((a, b) => a.line - b.line)) {
  const shape = shapes[f.section];
  const have = (shape.kind === 'array' ? shape.elementKeys : shape.keys) ?? [];
  console.log(`❌ generate-report-local.mjs:${f.line}  ctxRaw.${f.section} 에 '${f.field}' 없음 (${f.how})`);
  console.log(`     ${f.section} 실제 키: ${have.slice(0, 10).join(', ')}${have.length > 10 ? ' …' : ''}`);
  console.log(`     ${lines[f.line - 1]?.trim().slice(0, 110)}`);
}
console.log(`\n❌ ${uniq.size}건 — 이 접근은 항상 undefined 를 돌려주고 폴백이 조용히 삼킨다.`);
process.exit(1);

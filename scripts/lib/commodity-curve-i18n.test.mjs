#!/usr/bin/env node
/**
 * commodity-curve-i18n.test.mjs — 원자재 커브 라벨이 번역 경로를 타는지 검증.
 *
 * 배경(2026-08-20 UI 눈검증): /ko/intelligence 에 "WTI Crude Oil" / "Gold (COMEX)" 가 영문 노출.
 *   출처: src/app/api/commodity-curve/route.ts:183-184 가 표시용 라벨을 영문으로 하드코딩해 내려주고,
 *         CapitalFlowsTab.tsx:806 이 그 c.name 을 그대로 출력한다.
 *   같은 파일 26행 ITEM_LABEL_KEY 에 'oil'→cfLblOil, 'gold'→cfLblGold 매핑이 이미 있고
 *   16개 로케일 전부에 값이 채워져 있다 — 이 한 곳만 경로를 안 탔다.
 *
 * API 가 내려주는 name 은 서버가 만든 영문 상수라 로케일을 알 수 없다.
 * 표시 문자열의 로케일 결정은 클라이언트 몫이라는 것이 이 저장소의 관습이므로(ITEM_LABEL_KEY),
 * 렌더 쪽에서 id → 키 로 해석한다. API 의 name 은 로깅/디버깅용으로 남긴다.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const tab = readFileSync(resolve(ROOT, 'src/components/intelligence/CapitalFlowsTab.tsx'), 'utf8');

// ① 커브 헤더가 API 의 원문 name 을 그대로 출력하지 않는다.
const rawName = [...tab.matchAll(/\{\s*c\.name\s*\}/g)];
rawName.length === 0
  ? ok('커브 라벨을 c.name 으로 직접 출력하지 않는다')
  : bad(`c.name 직접 출력 ${rawName.length}곳 — 번역 미경유 (CapitalFlowsTab.tsx)`);

// ② 커브 라벨이 t(...) 를 경유한다. (①만 있으면 라벨을 지워도 통과해 버린다)
/commCurves\.map[\s\S]{0,2000}?\bt\(\s*ITEM_LABEL_KEY\[\s*c\.id\s*\]/.test(tab)
  ? ok('커브 라벨이 ITEM_LABEL_KEY[c.id] 로 번역된다')
  : bad('커브 렌더 블록에 t(ITEM_LABEL_KEY[c.id]) 가 없다');

// ③ 매핑이 실제로 두 id 를 덮는지 (키 오타 방지)
for (const id of ['oil', 'gold']) {
  new RegExp(`'${id}':\\s*'(cfLbl\\w+)'`).test(tab)
    ? ok(`ITEM_LABEL_KEY 에 '${id}' 매핑 존재`)
    : bad(`ITEM_LABEL_KEY 에 '${id}' 매핑 없음`);
}

// ④ 16개 로케일 전부에 값이 있어야 한다. 하나라도 비면 그 언어에서 키가 그대로 노출된다.
const find = (o, k) => {
  if (o && typeof o === 'object') {
    if (k in o) return o[k];
    for (const v of Object.values(o)) { const r = find(v, k); if (r != null) return r; }
  }
  return null;
};
const locales = readdirSync(resolve(ROOT, 'messages')).filter(f => f.endsWith('.json'));
for (const key of ['cfLblOil', 'cfLblGold']) {
  const missing = locales.filter(f => {
    const v = find(JSON.parse(readFileSync(resolve(ROOT, 'messages', f), 'utf8')), key);
    return typeof v !== 'string' || !v.trim();
  });
  missing.length === 0
    ? ok(`${key} — 로케일 ${locales.length}개 전부 채워짐`)
    : bad(`${key} 누락: ${missing.join(', ')}`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

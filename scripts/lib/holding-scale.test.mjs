#!/usr/bin/env node
/**
 * holding-scale.test.mjs — 지분율 단위 계약(퍼센트 0~100) 검증.
 *
 * 배경(2026-08-20 실측): 지분율에 ×100 이 두 번 걸려 있다.
 *   Yahoo heldPercentInstitutions = 66.492 (이미 퍼센트, AAPL 기관보유 66.5% — 타당)
 *   → stock-supply/route.ts:192  × 100 → 6,649.2
 *   → StockSupplyModal.tsx:271   × 100 → 664,920.0%   ← 화면에 이 값이 뜬다
 *   Yahoo 가 예전에는 분수(0.66)를 주다가 퍼센트로 바꿨고, 두 계층이 각자 ×100 하고 있었다.
 *   단위 계약이 어디에도 적혀 있지 않아 양쪽이 서로 다른 가정을 했다.
 *
 * 계약: 이 프로젝트의 지분율 필드는 항상 '퍼센트(0~100)'다. 소비처는 다시 곱하지 않는다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ① 단위 정규화 헬퍼가 있어야 한다
const H = await import('./holding-scale.mjs').catch(() => null);
if (!H?.toPercent) { bad('toPercent 미구현 — 단위 정규화 지점이 없다'); console.log('\n결과: 실패 1건'); process.exit(1); }

// ② 분수/퍼센트 양쪽을 받아 퍼센트로 정규화
H.toPercent(0.66492) === 66.49 ? ok('분수 0.66492 → 66.49%') : bad(`분수 변환 실패: ${H.toPercent(0.66492)}`);
H.toPercent(66.492)  === 66.49 ? ok('퍼센트 66.492 → 66.49% (재곱 안 함)') : bad(`퍼센트 변환 실패: ${H.toPercent(66.492)}`);
H.toPercent(null) === null ? ok('null → null') : bad('null 처리 실패');
H.toPercent(150) === null ? ok('100% 초과 → null (불가능한 값을 만들지 않음)') : bad(`150 처리: ${H.toPercent(150)}`);

// ③ UI 가 다시 ×100 하지 않아야 한다
const modal = readFileSync(resolve(ROOT, 'src/components/StockSupplyModal.tsx'), 'utf8');
const dbl = [...modal.matchAll(/data\.(instHeld|insiderHeld|shortPct)\s*\*\s*100/g)].map(m => m[1]);
dbl.length === 0 ? ok('UI 에 재곱 없음') : bad(`UI 가 다시 ×100: ${[...new Set(dbl)].join(', ')} (StockSupplyModal.tsx)`);

// ④ API 가 이중 배율을 하지 않아야 한다
const api = readFileSync(resolve(ROOT, 'src/app/api/stock-supply/route.ts'), 'utf8');
/heldPercentInstitutions \* 100/.test(api) ? bad('API 가 무조건 ×100 (단위 미검사)') : ok('API 가 단위를 검사해 정규화');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

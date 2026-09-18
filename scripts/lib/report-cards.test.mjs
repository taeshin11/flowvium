#!/usr/bin/env node
/**
 * report-cards.test.mjs — 빈 카드 판정이 생성기와 검증기에서 **같은 값**을 쓰는가.
 *
 * 2026-09-18 신설. 같은 상수가 두 파일에 따로 있었고, 2026-07-06 에 검출만 넣고
 *   예방을 안 넣어 두 달 만에 같은 빈 카드가 또 발간됐다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';
import { CARD_MIN, emptyCards } from './report-cards.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 판정
emptyCards({ macroAnalysis: 'ㄱ'.repeat(30), technicalAnalysis: 'ㄴ'.repeat(15), fundamentalAnalysis: 'ㄷ'.repeat(15) }).length === 0
  ? ok('[1] 다 채워져 있으면 빈 카드 없음') : bad('[1] 멀쩡한 보고서를 막았다');
JSON.stringify(emptyCards({ macroAnalysis: 'ㄱ'.repeat(30), technicalAnalysis: 'ㄴ'.repeat(15), fundamentalAnalysis: '' }).map((x) => x.field)) === '["fundamentalAnalysis"]'
  ? ok('[1b] 빈 필드만 집어낸다') : bad('[1b] 집어내지 못했다');
emptyCards({ fundamentalAnalysis: '짧다' }).length === 3
  ? ok('[1c] 없는 필드도 빈 것으로 본다') : bad('[1c] 누락 필드를 놓쳤다');
emptyCards(null).length === 3 ? ok('[1d] 보고서가 없으면 전부 빈 것') : bad('[1d] null 처리');

// [2] 두 파일이 같은 출처를 쓰는가 — 상수를 따로 적어 두면 반드시 어긋난다
for (const f of ['scripts/generate-report-local.mjs', 'scripts/verify-report.mjs']) {
  const src = readFileSync(resolve(ROOT, f), 'utf8');
  /report-cards\.mjs/.test(src)
    ? ok(`[2] ${f} 가 공용 출처를 쓴다`)
    : bad(`[2] ${f} 에 CARD_MIN 사본이 남아 있다 — 어긋난다`);
}

// [3] 값이 바뀌면 알아채게 고정
JSON.stringify(CARD_MIN) === '{"macroAnalysis":30,"technicalAnalysis":15,"fundamentalAnalysis":15}'
  ? ok('[3] 기준값 고정') : bad(`[3] 기준값이 바뀌었다: ${JSON.stringify(CARD_MIN)}`);

console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ report-cards 통과');
process.exit(fail ? 1 : 0);

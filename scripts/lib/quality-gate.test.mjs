#!/usr/bin/env node
/**
 * quality-gate.test.mjs — 차단 게이트가 '존재'가 아니라 '내용'을 봐야 한다.
 *
 * 배경(2026-08-21 실측): 조절기 장애로 narrative LLM 호출이 실패한 오늘 afternoon 보고서가
 *   marketNarrative: {} (빈 객체) 인 채로 품질 게이트를 통과했다.
 *
 *   같은 파일 안에서 세 곳이 서로 다른 기준을 쓴다:
 *     체크리스트(표시) : ['marketNarrative', !!(finalReport.marketNarrative?.why)]   ← 내용. ❌ 로 맞게 표시
 *     점수 가산        : if (report.marketNarrative?.why || report.marketNarrative?.story) score += 5  ← 내용
 *     차단 게이트      : if (!report.marketNarrative) issues.push('marketNarrative MISSING')  ← 존재만
 *   JS 에서 !{} 는 false 다. 빈 객체가 통과한다.
 *   실제 로그: "❌ marketNarrative" 를 찍고도 "품질 점수: 90/100 ✅ 통과".
 *
 *   verify-report.mjs 의 narrative_card_empty 게이트는 발간 경로에서 돌지 않는다
 *   (run-report.sh 에 없고 이번 실행 로그에도 흔적 0). 즉 최종 방어선도 없었다.
 *   결과: 빈 marketNarrative 섹션이 그대로 발간된다.
 *
 * 불변식: 차단 게이트의 판정 기준은 체크리스트와 같아야 한다. 표시가 ❌ 인데 통과시키면
 *   게이트가 아니라 장식이다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stripCommentsPreservingLines } from './context-keys.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = stripCommentsPreservingLines(readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8'));

// ① 차단 게이트가 내용을 본다
{
  const m = src.match(/if \(([^)]*marketNarrative[^)]*)\)\s*issues\.push\([^)]*marketNarrative MISSING/);
  if (!m) {
    bad('marketNarrative 차단 게이트를 못 찾음 — 테스트 앵커가 낡았다');
  } else {
    const cond = m[1];
    /\?\.(why|story)/.test(cond)
      ? ok(`차단 게이트가 내용을 본다: ${cond.trim()}`)
      : bad(`차단 게이트가 존재만 본다: "${cond.trim()}" — JS 에서 !{} 는 false 라 빈 객체가 통과한다`);
  }
}

// ② 체크리스트와 기준이 일치한다 (표시가 ❌ 인데 통과시키면 게이트가 아니다)
{
  const listItem = src.match(/\['marketNarrative',\s*([^\]]+)\]/);
  const gate = src.match(/if \(([^)]*marketNarrative[^)]*)\)\s*issues\.push\([^)]*marketNarrative MISSING/);
  if (listItem && gate) {
    const listFields = [...listItem[1].matchAll(/\?\.(\w+)/g)].map(x => x[1]).sort();
    const gateFields = [...gate[1].matchAll(/\?\.(\w+)/g)].map(x => x[1]).sort();
    gateFields.length > 0 && listFields.every(f => gateFields.includes(f))
      ? ok(`체크리스트(${listFields.join('|')}) 기준을 게이트(${gateFields.join('|')})가 포함한다`)
      : bad(`기준 불일치 — 체크리스트 [${listFields}] vs 게이트 [${gateFields}]`);
  } else bad('체크리스트/게이트 앵커를 못 찾음');
}

// ③ 빈 컬렉션이 통과하는 다른 자리도 없는지 — 같은 유형의 재발 방지
{
  const bare = [...src.matchAll(/if \(!report\.(\w+)\)\s*issues\.push/g)].map(m => m[1]);
  // 객체/배열 필드에 bare presence 검사를 쓰면 {} 나 [] 가 통과한다.
  const OBJECTISH = new Set(['marketNarrative', 'regionStances', 'portfolio', 'companyChanges', 'shortSqueeze', 'stopLossRationale']);
  const risky = bare.filter(f => OBJECTISH.has(f));
  risky.length === 0
    ? ok('객체/배열 필드에 bare presence 차단 검사 없음')
    : bad(`bare presence 로 차단 판정하는 객체 필드: ${risky.join(', ')} — 빈 값이 통과한다`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

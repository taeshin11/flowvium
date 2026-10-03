#!/usr/bin/env node
/**
 * market-outlook.test.mjs — 보고서 맨 위 '매수 우위' 배지가 바로 아래 종합 판단과 같은 말을 하는가. 2026-10-03 신설.
 *
 * 사장님(10/03): "이게 매수우위가 주식 매수우위라는거야?" → "이게 미국 주식 중립 이렇게 적어줘야되".
 * 실측: 최근 40개 보고서 중 38개가 맨 위 '매수 우위'(LLM stance) · 바로 아래 '미국·거시 종합 판단: 중립'(결정론).
 *   같은 화면에서 정반대. 맨 위는 LLM 이 쓴 값이고 위험 급등 때만 깎였다.
 * 고침: 맨 위 stance 를 결정론 판정(marketVerdict 미국·한국)에서 만든다 — 둘이 다르면 중립.
 *   화면은 '미국 주식 중립 · 한국 주식 분할 매수' 처럼 시장과 판단을 같이 적는다.
 */
import { verdictStance, outlookStance } from '../../src/lib/market-outlook.mjs';
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
({ buy_dip: 'bullish', accumulate: 'bullish', neutral_ready: 'neutral', neutral: 'neutral', wait: 'bearish', defensive: 'bearish' }[('x', 'accumulate')] === verdictStance('accumulate')
  && ['buy_dip', 'accumulate', 'neutral_ready', 'neutral', 'wait', 'defensive'].map(verdictStance).join() === 'bullish,bullish,neutral,neutral,bearish,bearish')
  ? ok('[1] 판정 → stance 대응') : bad('[1]');
outlookStance({ verdict: 'neutral', krVerdict: { verdict: 'accumulate' } }) === 'neutral' ? ok('[2a] 미국 중립·한국 분할매수 → 전체 중립(같은 화면에서 매수 우위라 하지 않는다)') : bad('[2a]');
outlookStance({ verdict: 'accumulate', krVerdict: { verdict: 'buy_dip' } }) === 'bullish' ? ok('[2b] 둘 다 매수 쪽 → 매수') : bad('[2b]');
outlookStance({ verdict: 'defensive' }) === 'bearish' ? ok('[2c] 한국 판정 없으면 미국만') : bad('[2c]');
outlookStance(null) === null ? ok('[2d] 판정 없으면 null(호출부가 기존 값)') : bad('[2d]');
const gen = src('scripts/generate-report-local.mjs');
/let gatedStance = outlookStance\(marketVerdict\) \?\?/.test(gen) ? ok('[3] 생성기: 맨 위 stance 를 결정론 판정에서(이후 위험 게이트는 그대로)') : bad('[3] 생성기가 아직 LLM stance 를 쓴다');
const ui = src('src/components/pages/ReportPage.tsx');
(/outlookUs/.test(ui) && /outlookKr/.test(ui) && /krVerdict/.test(ui.slice(ui.indexOf('stanceCfg!.icon'), ui.indexOf('stanceCfg!.icon') + 1500)))
  ? ok('[4] 화면: 맨 위에 "미국 주식 … · 한국 주식 …"') : bad('[4] 화면 맨 위가 시장 이름 없이 stance 만 보인다');
for (const l of ['ko', 'en', 'ja']) { const m = JSON.parse(src(`messages/${l}.json`)); const r = m.report ?? Object.values(m).find((v) => v?.stanceBullish); (r?.outlookUs && r?.outlookKr) ? ok(`[5] ${l} 문구`) : bad(`[5] ${l} outlookUs/outlookKr 없음`); }
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

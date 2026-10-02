#!/usr/bin/env node
/**
 * funnel-hard-veto.test.mjs — 후보 깔때기와 최종 심판이 같은 hard 매도신호를 쓰는가. 2026-10-02 신설.
 *
 * 실측(10/02 오후판): top30 의 KR 9종이 전원 최종 심판에서 hard:tech_dead_cross / tech_200ma_breach 로 탈락,
 *   US 도 BA·APP·GS 가 같은 사유로 탈락 → 발간 포트폴리오 FCX·AAPL 2종. 같은 시각 KR 풀 456종 중 114종
 *   (삼성전자·SK하이닉스 등)은 50MA>200MA·종가>200MA 였다. 원인: Stage 2 의 hasHardBuyVeto 는 RSI≤35 를
 *   '분할매수 앵커'로 면제하는데(GS RSI 20, APP 30, BA 33), 최종 심판은 데드크로스/200MA 이탈을 앵커와
 *   무관하게 hard 로 떨군다. 어차피 떨어질 종목이 top30 자리를 차지해 멀쩡한 종목이 못 들어왔다.
 */
import { evaluateSellRule, hasHardBuyVeto } from '../../src/lib/buy-sell-engine.mjs';
import { HARD_SELL_IDS, finalGateHardVeto } from './funnel-hard-veto.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const rules = JSON.parse(readFileSync(resolve(ROOT, 'data/sell-rules-tuned.json'), 'utf8')).rules;

// [1] GS 실측값: 과매도라 Stage 2 매수 veto 는 면제되지만 최종 심판 hard 에는 걸린다
const gs = { price: 940, sma50: 1007.22, sma200: 960, rsi: 20, high52w: 1152.07, low52w: 863.04 };
hasHardBuyVeto(gs, {}) === null ? ok('[1a] Stage2 매수 veto 는 과매도 앵커로 면제(현행 동작)') : bad('[1a] 전제 깨짐');
const v = finalGateHardVeto(gs, rules, evaluateSellRule);
v?.id === 'tech_200ma_breach' || v?.id === 'tech_dead_cross' ? ok(`[1b] 최종 심판 hard 를 깔때기에서도 본다: ${v.id}`) : bad(`[1b] ${JSON.stringify(v)}`);

// [2] 상승추세는 안 걸린다
finalGateHardVeto({ price: 120, sma50: 110, sma200: 100, rsi: 55 }, rules, evaluateSellRule) === null ? ok('[2] 50>200·종가>200 은 통과') : bad('[2] 상승추세가 걸렸다');

// [3] 데이터 없으면 안 건다(빠진 값으로 거르지 않는다)
finalGateHardVeto({ price: 100 }, rules, evaluateSellRule) === null ? ok('[3] MA 없으면 통과') : bad('[3]');

// [4] 최종 심판과 같은 목록 — 심판 코드가 이 상수를 쓰고, 깔때기(buildBuyCandidates)도 이 함수를 부른다
const src = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
/HARD_IDS\s*=\s*HARD_SELL_IDS/.test(src) && !/HARD_IDS\s*=\s*new Set\(\[/.test(src) ? ok('[4a] 심판의 HARD_IDS 가 공용 상수') : bad('[4a] 심판이 자기 목록을 따로 갖는다');
const s = src.indexOf('async function buildBuyCandidates'), e = src.indexOf('\nasync function', s + 10);
/finalGateHardVeto\(/.test(src.slice(s, e)) ? ok('[4b] 깔때기 Stage 2 가 같은 hard 를 본다') : bad('[4b] 깔때기가 최종 hard 를 안 본다');
['price_stop_breach', 'tech_dead_cross', 'tech_200ma_breach'].every((id) => HARD_SELL_IDS.has(id)) ? ok('[4c] 목록 내용 보존') : bad('[4c]');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

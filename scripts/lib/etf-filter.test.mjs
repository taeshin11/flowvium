#!/usr/bin/env node
// etf-filter.test.mjs — 종목 추천 풀의 ETF 판정(generate-report-local 에서 옮김, 2026-10-15). 엔진 장부 대조군도 같은 규칙을 쓴다.
import { readFileSync } from 'fs';
import { isEtf, isCashLikeEtf } from './etf-filter.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const u = JSON.parse(readFileSync(new URL('../../data/candidate-tickers.json', import.meta.url), 'utf8'));
const m = (t) => u.meta[t] ?? {};
isEtf('SPY', m('SPY')) && isEtf('069500.KS', m('069500.KS')) ? ok('[1] US ETF(cap etf)·KR ETF(KODEX 200) → ETF') : bad('[1]');
!isEtf('AAPL', m('AAPL')) && !isEtf('005930.KS', m('005930.KS')) ? ok('[2] 보통주(AAPL·삼성전자) → 아님') : bad('[2]');
isCashLikeEtf('KODEX CD금리액티브(합성)') && isCashLikeEtf('X', 100, 98) && !isCashLikeEtf('삼성전자', 300, 150) ? ok('[3] 현금성 ETF(이름·52주 레인지<5%)') : bad('[3]');
// 생성기가 같은 함수를 import 한다(복사본이 다시 생기지 않게)
const gen = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8');
/import \{ isEtf, isCashLikeEtf \} from '\.\/lib\/etf-filter\.mjs'/.test(gen) && !/function isEtf\(/.test(gen) ? ok('[4] 생성기는 lib 를 import(복사본 없음)') : bad('[4]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * hook-stakes.test.mjs — 경제 뉴스 첫 훅은 '시청자에게 무엇이 달라지나' 로. 2026-10-10 신설.
 *
 * 사장님 지시(Mac mini2 경유): Isaac「7일 만에 쇼츠 채널 떡상」에서 차용 — 첫 1~2초에 시청자 본인의 문제·손해(stakes).
 *   "놀라운 통계만 던지는 훅은 안 먹혔다(이유가 없으면 안 봄)".
 * 우리 실측(10/09, 110편): 계속 시청 증시·금리·환율 0.31 · 기업·산업 0.30 vs 국내정치 0.44. 하위 훅 예 "기준금리 5% 경고"(0.16)·
 *   "증권사 위험인수 확대"(0.12) — 지표·기관 이름만. 이 갈래에만 규칙을 더한다(정치·사건은 이미 '무슨 일' 훅이 잘 된다).
 * ⚠ 뉴스다 — 기사에 그 영향(대출이자·월급·물가·내 주식)이 **적혀 있을 때만**. 없는 손해를 지어내면 거짓말.
 * 측정: 증시·금리·환율 계속 시청 0.31 → 다음 20편.
 */
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
const i = src.indexOf('- hook: 화면 위에 크게 박을 문구'), j = src.indexOf('- visual: 그 장면 배경으로 찾을 검색어');
const block = src.slice(i, j);
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
/경제·금리·증시·물가/.test(block) && /시청자/.test(block) ? ok('[1] 경제 뉴스 훅은 시청자에게 무엇이 달라지나') : bad('[1] 훅 규칙에 시청자 손해(stakes) 없음');
/기사에 그 영향이 적혀 있을 때만/.test(block) ? ok('[2] 기사에 있는 영향만(지어내기 금지)') : bad('[2] 사실 한정 문구 없음');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

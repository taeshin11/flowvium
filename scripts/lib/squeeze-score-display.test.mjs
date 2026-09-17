#!/usr/bin/env node
/**
 * squeeze-score-display.test.mjs — 변별력 없는 점수를 확신처럼 보여주지 않는가.
 *
 * 2026-09-18 실측: 숏스퀴즈 첫 등재 14건 중 12건이 똑같이 45점(범위 40~55),
 *   점수와 이후 20거래일 섹터 대비 성과의 순위상관 0.15. 구간별로는 거꾸로다
 *   (60점 이상 -3.5%p vs 50~60점 +13.8%p). 그런 숫자를 크게 띄우면 읽는 사람을 잘못 이끈다.
 *   실측값(공매도 유통비율·거래비중·상환일수)은 남긴다 — 그건 독자가 검증할 수 있는 사실이다.
 */
import { readFileSync } from 'fs';
import { ROOT } from './project-root.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(`${ROOT}/src/components/pages/ReportPage.tsx`, 'utf8');
const block = src.slice(src.indexOf('data.shortSqueeze?.length'), src.indexOf('data.shortSqueeze?.length') + 2200);
!/colSqueezeScore'\)}\s*\{s\.score\}/.test(block)
  ? ok('보고서에 숏스퀴즈 점수를 띄우지 않는다') : bad('아직 점수를 확신처럼 보여준다');
/colShortFloat|shortRatio/.test(block)
  ? ok('검증 가능한 실측값(공매도 비율·상환일수)은 남아 있다') : bad('실측값까지 사라졌다');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * market-caps-band.test.mjs — 단일 종목 시총 등급이 정적 목록 밖 미국 종목에도 나오는가.
 *
 * 2026-09-17: /api/market-caps?ticker= 가 CEG·GLW·CBRE 같은 S&P500 종목에 빈 bands 를 줬다
 *   (audit-coverage 6/12, 실패 12개 전부 미국). 종목 풀의 meta.cap 을 대체값으로 쓴다.
 *   그 값은 실시간 시총과 59종목 대조해 일치 57 · 한 칸 차이 2 였다.
 */
import { readFileSync } from 'fs';
import { ROOT } from './project-root.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(`${ROOT}/src/app/api/market-caps/route.ts`, 'utf8');
const uses = (src.match(/\?\? poolBand\(filterTicker\)/g) ?? []).length;
uses === 2 ? ok('단일 조회 두 경로(캐시·새로 만든 것) 모두 풀 등급으로 대체한다')
  : bad(`풀 등급 대체가 ${uses}곳뿐 — 캐시 경로와 새 경로 둘 다 걸려야 한다`);

const pool = JSON.parse(readFileSync(`${ROOT}/data/candidate-tickers.json`, 'utf8'));
const bands = new Set(['titan', 'mega', 'large', 'mid', 'small']);
const us = pool.tickers.filter((t) => !/\.(KS|KQ)$/.test(t) && pool.meta?.[t]?.cap !== 'etf');
const covered = us.filter((t) => bands.has(pool.meta?.[t]?.cap)).length;
(covered / us.length >= 0.95)
  ? ok(`미국 종목 ${us.length}개 중 ${covered}개가 등급을 가진다`)
  : bad(`등급 없는 미국 종목이 많다: ${covered}/${us.length}`);
for (const t of ['CEG', 'GLW', 'CBRE', 'CIEN']) {
  if (!bands.has(pool.meta?.[t]?.cap)) bad(`${t} 등급 없음`);
}
if (!fail) ok('실패했던 종목(CEG·GLW·CBRE·CIEN)이 등급을 가진다');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

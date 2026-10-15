#!/usr/bin/env node
// vol-ratio.test.mjs — 거래량 비율은 '끝난 장' 끼리만. 2026-10-16 사이트 눈검증(agy): 자정판(22:33 KST, 미국 개장 3분)이
//   AAPL '거래량 -92%'·WAT '-100%' 를 냈다 — 진행 중인 장의 몇 분치 거래량을 20일 평균과 비교했다.
//   Yahoo meta.currentTradingPeriod.regular {start,end}: 마지막 봉 t >= start 이고 지금 < end 면 진행 중.
import { lastBarInProgress, computeVolRatio } from './vol-ratio.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const reg = { start: 1792071000, end: 1792094400 };   // 10/15 미국 정규장(실측 meta)
lastBarInProgress({ timestamps: [1791984600, 1792071000], regular: reg, now: 1792080224 }) === true ? ok('[1] 장중(12:17 ET) 마지막 봉 = 진행 중') : bad('[1]');
lastBarInProgress({ timestamps: [1791984600, 1792071000], regular: reg, now: 1792095000 }) === false ? ok('[2] 마감 뒤엔 끝난 봉') : bad('[2]');
lastBarInProgress({ timestamps: [1791984600], regular: reg, now: 1792080224 }) === false ? ok('[3] 오늘 봉이 아직 없으면(개장 전 데이터) 끝난 봉') : bad('[3]');
lastBarInProgress({ timestamps: [1], regular: null, now: 2 }) === false ? ok('[4] 장 시간 정보가 없으면 진행 중으로 보지 않는다') : bad('[4]');
const vols = [...Array(22).fill(100), 5];   // 마지막 = 장 시작 몇 분치
computeVolRatio(vols, 20) === -95 ? ok('[5] 종전 동작(진행 중 봉 포함) = -95% — 이게 버그') : bad(`[5] ${computeVolRatio(vols, 20)}`);
computeVolRatio(vols, 20, { partialLast: true }) === 0 ? ok('[6] 진행 중 봉을 빼면 직전 끝난 장 vs 그 전 20일 = 0%') : bad(`[6] ${computeVolRatio(vols, 20, { partialLast: true })}`);
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * blog-budget.test.mjs — 쇼츠 묶음 글이 시간 한도 안에 끝난다. 2026-09-26 신설.
 * 실측(cron.log): shorts-blog 가 9/24 에 4번 연속 timeout(480초), 그 뒤 450·475초 — 한도 턱밑.
 *   쇼츠 최대 5편 × 기사 본문 최대 5개를 agy 로 **하나씩 차례로** 고쳐 쓴다(최대 25번 × 10~40초).
 *   병렬로 돌리지 않는 이유: agy 가 실패하면 로컬 4B 로 떨어지는데, 거기 동시에 보내면 배치 사고가 났다(코드 주석).
 *   → 글이 될 만큼(2편 이상) 모였고 예산(기본 240초 — 한 편이 200초까지 걸려 240+200<480)을 넘었으면 더 담지 않는다. 한도 안에 끝나고 글은 나온다.
 */
import { shouldStopAdding } from './blog-budget.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const B = 300_000;
(!shouldStopAdding({ elapsedMs: 400_000, budgetMs: B, included: 1 })) ? ok('[1] 예산 넘어도 1편뿐이면 계속(글이 안 되니까)') : bad('[1]');
(shouldStopAdding({ elapsedMs: 310_000, budgetMs: B, included: 2 })) ? ok('[2] 2편 모였고 예산 넘으면 멈춘다') : bad('[2]');
(!shouldStopAdding({ elapsedMs: 120_000, budgetMs: B, included: 3 })) ? ok('[3] 예산 안이면 계속 담는다') : bad('[3]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

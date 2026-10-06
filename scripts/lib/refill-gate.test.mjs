#!/usr/bin/env node
/**
 * refill-gate.test.mjs — '재충원(보충)' 편입을 시장별 실적으로 열고 닫는다. 2026-10-06 신설.
 *
 * 사장님(10/06, 파마리서치 손절 뒤): "제일 좋은 방향으로. 수익률 제일 높이는 방향으로".
 * 실측(6/1~, 종목·날짜당 1건, 종결 건):
 *   KR 정규 159건 손절 30% 평균 +0.90% · **KR 보충 76건 손절 58% 평균 −1.87%** (차이 t=−3.6)
 *   US 정규 505건 손절 12% 평균 +2.18% · US 보충 79건 손절 3% 평균 +2.41% (t=0.68, 차이 없음)
 *   → KR 최소 2석을 채우려 차순위를 끌어올린 편이 돈을 잃었다. US 보충은 정규와 같다.
 * 규칙(손으로 시장을 고르지 않는다): 그 시장 보충 실적이 30건 이상이고 평균이 0 보다 유의하게 낮으면(t<−2) 보충하지 않는다.
 *   실적이 회복되면 저절로 다시 열린다. 실적을 못 읽으면 막지 않는다(종전 동작).
 */
import { refillStats, refillAllowed } from './refill-gate.mjs';
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const mk = (ticker, pnl, refill, day) => ({ ticker, pnl_pct: pnl, outcome: pnl < -5 ? 'stop_loss' : 'sold', rationale: refill ? '룰 점수 상위 차순위 재충원 — …' : '정규', day });
const rows = [];
for (let i = 0; i < 40; i++) rows.push(mk(`K${i}.KS`, i % 3 === 0 ? 1 : -4, true, `d${i}`));      // KR 보충: 평균 음수
for (let i = 0; i < 40; i++) rows.push(mk(`U${i}`, i % 4 === 0 ? -2 : 3, true, `d${i}`));          // US 보충: 양수
for (let i = 0; i < 10; i++) rows.push(mk(`K${i}.KS`, -4, true, `d${i}`));                          // 같은 종목·날짜 중복 — 한 번만 센다
const s = refillStats(rows);
(s.kr.n === 40 && s.kr.mean < 0 && s.us.n === 40 && s.us.mean > 0) ? ok(`[1] 시장별 집계(중복 제거) KR ${s.kr.n}건 ${s.kr.mean.toFixed(2)}% t=${s.kr.t.toFixed(1)} · US ${s.us.n}건 ${s.us.mean.toFixed(2)}%`) : bad(`[1] ${JSON.stringify(s)}`);
const k = refillAllowed('kr', s), u = refillAllowed('us', s);
(!k.ok && /보충/.test(k.reason) && u.ok) ? ok(`[2] KR 막음("${k.reason}") · US 허용`) : bad(`[2] ${JSON.stringify([k, u])}`);
refillAllowed('kr', refillStats(rows.slice(0, 20))).ok ? ok('[3] 30건 미만이면 판단 안 함(허용)') : bad('[3]');
refillAllowed('kr', null).ok ? ok('[4] 실적 모르면 허용(종전 동작)') : bad('[4]');
const src = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8');
/refillAllowed\(mkt,/.test(src) ? ok('[5] 보고서 재충원 경로가 이 규칙을 본다') : bad('[5] 재충원 경로에 연결 안 됨');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

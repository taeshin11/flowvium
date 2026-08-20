#!/usr/bin/env node
/**
 * outcome-loop.test.mjs — 추천 결과 평가 루프가 실제로 돌고 있는가.
 *
 * 배경(2026-08-20 실측): 평가 시점(evaluate_after)이 지났는데 결과가 없는 추천이 220건이었다.
 *   원인을 따라가 보니:
 *     · recommendation_outcomes 에 INSERT 하는 saveOutcome() 은
 *       scripts/evaluate-recommendations.mjs 에서만 호출된다(db.mjs:1260)
 *     · 그 스크립트는 cron-runner 의 MAINT_JOBS 에 없다 — 사람이 손으로 돌릴 때만 실행됐다
 *     · 실증: 월별 outcome 종류를 보면 2026-06 은 'sold' 708건뿐이고
 *       evaluate-recommendations 가 쓰는 종류(hit_target/stop_loss/not_entered/still_holding)가 0건이다
 *       (5월 214 · 6월 0 · 7월 56 · 8월 86 — 산발적 수동 실행 패턴)
 *   'sold' 는 보고서 파이프라인의 saveSellRecommendations(db.mjs:1477)가 따로 쓰므로
 *   겉보기에는 outcome 이 쌓이는 것처럼 보였다 — 그래서 죽은 줄 몰랐다.
 *
 * 이게 왜 중요한가: 이 루프가 학습(tune-buy-rules/tune-sell-rules)과 수익률 통계의 입력이다.
 *   멈춰 있으면 "수익률이 처참하다"는 판단 자체가 오래된 표본 위에서 이뤄진다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 평가 스크립트가 스케줄에 등록돼 있어야 한다 — 없으면 아무도 안 돌린다
const cron = readFileSync(resolve(ROOT, 'scripts/cron-runner.mjs'), 'utf8');
/evaluate-recommendations\.mjs/.test(cron)
  ? ok('evaluate-recommendations 가 cron 에 등록됨')
  : bad('evaluate-recommendations 가 cron 에 없다 — 손으로 돌릴 때만 평가된다');

// [2] 적체가 없어야 한다. 하루 한 번 도는 잡이므로 여유는 넉넉히 준다.
//     action='buy' 만 센다 — evaluate-recommendations 는 watch 를 설계상 건너뛴다("watch(skip)").
//     2026-08-20: 처음엔 action 구분 없이 세서 220건 적체로 오경보했다. 실제로는 전부 watch 였고
//     buy 적체는 0이었다. '무엇을 세는가'를 틀리면 멀쩡한 걸 고장으로 읽는다.
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
const GRACE_DAYS = 3;
const overdue = db.prepare(`
  SELECT COUNT(*) c FROM recommendations r
  LEFT JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE o.recommendation_id IS NULL
    AND r.action = 'buy'
    AND r.evaluate_after IS NOT NULL
    AND r.evaluate_after < datetime('now', ?)`).get(`-${GRACE_DAYS} days`).c;
overdue === 0
  ? ok(`매수 추천 평가 적체 0건 (여유 ${GRACE_DAYS}일)`)
  : bad(`매수 추천 평가 적체 ${overdue}건 — 피드백 루프가 멈춰 있다`);

// [3] 최근 한 달 안에 evaluate-recommendations 계열 outcome 이 있어야 한다.
//     'sold' 는 보고서 파이프라인이 쓰므로 제외해야 '평가가 돌았는지'를 잰다.
const recent = db.prepare(`
  SELECT COUNT(*) c FROM recommendation_outcomes
  WHERE outcome != 'sold' AND evaluated_at > datetime('now','-30 days')`).get().c;
recent > 0
  ? ok(`최근 30일 평가 ${recent}건 (sold 제외 — 그건 다른 경로가 쓴다)`)
  : bad('최근 30일 평가 0건 — sold 만 쌓이고 있다(죽은 줄 모르는 상태)');

db.close();
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

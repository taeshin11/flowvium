#!/usr/bin/env node
/**
 * outcome-integrity.test.mjs — 기록된 손익이 실제로 측정된 값인가.
 *
 * 배경(2026-08-20 실측): "수익률이 처참하다"를 파다가 통계 자체를 못 믿는다는 걸 발견했다.
 *
 *  ① 체결 미검증 — recommendation_outcomes 976건('sold', 전체의 73%)이
 *     low_seen·ohlc_days 가 전부 NULL 이다. 가격 이력을 한 번도 안 가져왔다는 뜻이고,
 *     따라서 진입가에 실제로 체결됐는지 알 수 없다.
 *     경로: db.mjs saveSellRecommendations() 가 매도 추천이 나오면 그 종목의 열린 매수추천을
 *     전부 'sold' 로 마감한다(:1505-1526). OHLC 조회가 없다.
 *     그리고 evaluate-recommendations 는 getOverdueRecommendations 의 `o.id IS NULL` 때문에
 *     이미 닫힌 행을 영원히 건너뛴다 — 검증할 기회가 사라진다.
 *
 *  ② 손익 복사 — closeOutcome.run(open.id, ..., c.pnlPct, ...) 이
 *     매도추천 객체의 단일 pnlPct 를 그 종목의 모든 열린 매수추천에 그대로 쓴다.
 *     진입가가 서로 다른데도 같은 값이 들어간다.
 *     실측: NVDA -0.3% 가 77건(진입가 32종)에, TSM 0% 가 51건(30종)에 — 그런 그룹 84개.
 *
 *  진입가가 다르면 손익도 달라야 한다. 같은 값이 대량 복사돼 있으면 그건 측정이 아니다.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// 2026-08-22: 이 테스트가 무엇을 필요로 하는지 스스로 선언한다. 없으면 스킵(코드 77).
//   CI(깨끗한 clone)엔 데이터가 든 DB 가 없다 — 그걸 '실패' 로 세면 CI 가 상시 빨갛고,
//   상시 빨간 CI 는 아무도 안 본다. --strict 에서는 스킵도 실패로 센다.
import { requires } from './test-env.mjs';
await requires({ dbTables: ['recommendation_outcomes'] });

import Database from 'better-sqlite3';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ── 단위: realizedPnlPct 가 'sold' 를 어떻게 다루는가 ──
const { realizedPnlPct } = await import('./realized-pnl.mjs');
realizedPnlPct({ outcome: 'sold', entry: 100, exit: 110 }) === 10
  ? ok('sold: 실제 청산가로 손익 계산')
  : bad(`sold 미지원 — ${JSON.stringify(realizedPnlPct({ outcome:'sold', entry:100, exit:110 }))} (10 기대)`);
realizedPnlPct({ outcome: 'sold', entry: 100 }) === null
  ? ok('sold: 청산가 없으면 null (0 으로 채우지 않음)')
  : bad('청산가 없는데 숫자를 만들어냄');
// 체결 안 된 건 손익이 없다
realizedPnlPct({ outcome: 'not_entered', entry: 100, exit: 110 }) === null
  ? ok('not_entered: null 유지') : bad('not_entered 에 손익이 생김');

// ── DB: 복사된 손익이 남아 있는가 ──
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
// 손익 계산 기준은 entry_low ?? price_at_gen 이다(evaluate-recommendations.mjs:157).
// 2026-08-20: 처음엔 entry_high 로 그룹을 세서 31개가 나왔는데, 대부분 entry_low 가 같아
//   같은 손익이 나오는 게 정상인 경우였다. 실제 기준으로 재면 1개다.
//   '무엇으로 계산하는가'와 '무엇으로 검사하는가'가 다르면 멀쩡한 걸 결함으로 읽는다.
// pnl 은 소수점 2자리로 반올림된다(realized-pnl.mjs:20). 진입가가 0.005% 차이나면
// 손익이 같게 나오는 게 정상이다 — 실측: NVDA entry_low 200.14 vs 200.15 → 둘 다 2.25%.
// 그래서 '값이 다른가'가 아니라 '손익이 달라질 만큼 다른가'로 본다(상대 0.5% 초과).
const dup = db.prepare(`
  SELECT COUNT(*) c FROM (
    SELECT r.ticker, o.evaluated_at, o.pnl_pct, COUNT(*) n,
           MIN(COALESCE(r.entry_low, r.price_at_gen)) lo,
           MAX(COALESCE(r.entry_low, r.price_at_gen)) hi
    FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id
    WHERE o.pnl_pct IS NOT NULL
      -- 2026-09-03: stop_loss / hit_target 은 제외한다. 이 둘의 손익은 손절가·목표가에서 나오는데
      --   LLM 이 손절을 **진입가의 고정 비율**로 잡는다(실측: 005490.KS 진입 406560 · 손절 378101
      --   = 정확히 -7.00%). 그러면 진입가가 달라도 손익이 같은 게 정상이다.
      --   이 검사가 잡으려던 것은 매도엔진의 단일 pnlPct 가 여러 건에 그대로 복사되던 일이고,
      --   그건 'sold' 경로의 문제였다. 정상 동작까지 결함으로 세면 신호가 늘 빨개져 아무도 안 본다.
      AND o.outcome NOT IN ('stop_loss', 'hit_target')
    GROUP BY r.ticker, o.evaluated_at, o.pnl_pct
    HAVING n > 1 AND lo > 0 AND (hi - lo) / lo > 0.005)`).get().c;
dup === 0
  ? ok('서로 다른 진입가에 같은 손익이 복사된 그룹 0')
  : bad(`손익 복사 그룹 ${dup}개 — 진입가가 다른데 손익이 같다`);

// ── DB: 미체결은 손익이 없어야 한다 ──
//     realized-pnl.mjs:12 의 규약 — not_entered 는 null. 0 이나 시가평가로 채우면 평균이 오염된다.
//     실측(2026-08-20): 5월 구버전 코드가 넣은 값이 남아 not_entered 199건 평균 60.85% 였고,
//     그게 전체 평균을 5.19% 로 부풀렸다. 안 산 종목의 '수익'이 성과로 잡히면 안 된다.
const nePnl = db.prepare(`
  SELECT COUNT(*) c FROM recommendation_outcomes
  WHERE outcome='not_entered' AND pnl_pct IS NOT NULL`).get().c;
nePnl === 0
  ? ok('not_entered 에 손익이 붙은 행 0')
  : bad(`not_entered 인데 손익이 있는 행 ${nePnl}건 — 안 산 걸 수익으로 센다`);

// ── DB: 손익을 주장하려면 체결 근거가 있어야 한다 ──
const unverified = db.prepare(`
  SELECT COUNT(*) c FROM recommendation_outcomes
  WHERE pnl_pct IS NOT NULL AND low_seen IS NULL`).get().c;
unverified === 0
  ? ok('체결 근거 없이 손익만 있는 행 0')
  : bad(`체결 미검증 손익 ${unverified}건 — low_seen 없이 pnl 을 주장한다`);

db.close();
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

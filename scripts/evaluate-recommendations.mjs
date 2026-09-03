#!/usr/bin/env node
/**
 * evaluate-recommendations.mjs — 14일 경과 추천 평가 (local SQLite)
 *
 * data/flowvium.db 의 overdue 추천들에 대해:
 *  1. Yahoo OHLC (generated_at ~ now) 가져옴
 *  2. high_seen / low_seen 계산 → entryZone 진입했는지 / target 도달 / stop 발동 판정
 *  3. SPY 같은 기간 return 으로 benchmark
 *  4. recommendation_outcomes 테이블에 결과 저장
 *
 * 사용:
 *   node scripts/evaluate-recommendations.mjs              # overdue 모두 평가
 *   node scripts/evaluate-recommendations.mjs --dry-run    # DB 쓰기 없이 보기만
 *   node scripts/evaluate-recommendations.mjs --limit=10   # 상위 10건만
 */
import { realizedPnlPct, markToMarketPnlPct } from './lib/realized-pnl.mjs';
import { toYahooTicker } from './lib/ticker-normalize.mjs';
import { openDb, getOverdueRecommendations, getAllRecommendationsForEval, saveOutcome, getSummary,
         getUnverifiedOutcomes, updateVerifiedOutcome } from './lib/db.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all'); // 14d 윈도우 무시 — 조기 baseline 평가용
// 2026-08-20: 체결 미검증 outcome 재평가. saveSellRecommendations 가 OHLC 없이 'sold' 로 마감해
//   low_seen 이 비어 있는 행들이 있다(실측 976건 = 전체의 73%). getOverdueRecommendations 는
//   `o.id IS NULL` 이라 이미 닫힌 행을 못 본다 — 그래서 별도 경로로 집어온다.
const VERIFY = args.includes('--verify');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0', 10);

async function fetchYahooOHLC(rawTicker, fromIso, toIso) {
  // 2026-09-04: 손익이 안 채워진 55건 중 24건이 BRK.B 였다.
  //   BRK.B → HTTP 404 "symbol may be delisted" / BRK-B → 200. 상장폐지가 아니라 표기 차이다.
  //   우리 티커 풀에는 둘 다 들어 있어 풀 검사로는 안 걸린다 — 가져올 때 바꿔야 한다.
  const ticker = toYahooTicker(rawTicker);
  const p1 = Math.floor(new Date(fromIso).getTime() / 1000);
  const p2 = Math.floor(new Date(toIso).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const d = await res.json();
    const result = d?.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    // 0 도 typeof 'number' 라 통과해버려 Yahoo 결측일 (low=0) 이 판정 오염시킴 — 양수만.
    return {
      closes: (q.close ?? []).filter(v => typeof v === 'number' && v > 0),
      highs: (q.high ?? []).filter(v => typeof v === 'number' && v > 0),
      lows: (q.low ?? []).filter(v => typeof v === 'number' && v > 0),
      days: ts.length,
    };
  } catch {
    return null;
  }
}

function judgeOutcome(rec, ohlc) {
  if (!ohlc || ohlc.closes.length === 0) {
    return { outcome: 'unknown', detail: 'no OHLC data' };
  }
  if (ohlc.lows.length === 0 || ohlc.highs.length === 0) {
    return { outcome: 'unknown', detail: 'OHLC contains only zero/missing days (filtered out)' };
  }
  const lastClose = ohlc.closes.at(-1);
  const entryHigh = rec.entry_high ?? rec.entry_low;

  // 2026-05-27: Codex 진단 — 기존 aggregate high/low 는 hit/stop 동시 발생 시 hardcoded
  // priority (target > stop) 로 분류해 stop 을 hit 으로 잘못 판정. day-by-day 순회 로
  // 시간 순서 반영. 같은 날 양쪽 발생 시 보수적으로 stop 우선 (worst-case 가정).
  const n = Math.min(ohlc.lows.length, ohlc.highs.length);
  let entered = false;
  let highSeen = -Infinity, lowSeen = Infinity;
  for (let i = 0; i < n; i++) {
    const high = ohlc.highs[i];
    const low = ohlc.lows[i];
    if (!isFinite(high) || high <= 0 || !isFinite(low) || low <= 0) continue;
    if (high > highSeen) highSeen = high;
    if (low < lowSeen) lowSeen = low;
    if (!entered && entryHigh != null && low <= entryHigh) entered = true;
    if (entered) {
      // 같은 날 stop+target 모두 hit 시 stop 우선 (보수적, slippage 보호)
      if (rec.stop_loss != null && low <= rec.stop_loss * 1.02) {
        return {
          outcome: 'stop_loss',
          detail: `day${i+1}: low=${low} <= stop*1.02=${rec.stop_loss * 1.02}`,
          highSeen, lowSeen, lastClose,
        };
      }
      if (rec.target != null && high >= rec.target * 0.98) {
        return {
          outcome: 'hit_target',
          detail: `day${i+1}: high=${high} >= target*0.98=${rec.target * 0.98}`,
          highSeen, lowSeen, lastClose,
        };
      }
    }
  }

  if (!isFinite(lowSeen) || lowSeen <= 0 || !isFinite(highSeen) || highSeen <= 0) {
    return { outcome: 'unknown', detail: `invalid OHLC: high=${highSeen} low=${lowSeen}`, highSeen, lowSeen, lastClose };
  }
  if (!entered) {
    // 2026-06-14 (ChatGPT D30 차용): NE 를 단일 실패로 보지 말고 세분 — buy 룰 정확성 vs entry calibration
    //   오염 방지. 이 로직의 NE = 진입가를 시장가 아래로 잡아 pullback 안 온 경우(low 가 entry_high 까지 안 내려옴).
    //   ① 진입만 됐으면 target 도달(highSeen≥target) = 룰은 맞았는데 entry 너무 보수적 → NE_WINNER_MISSED
    //   ② entry 위로 드리프트했으나 target 미달 = 부분 미스 → NE_UP_DRIFT  ③ entry 부근 횡보 → NE_NO_FILL
    const ranToTarget = rec.target != null && highSeen >= rec.target * 0.98;
    const roseAboveEntry = entryHigh != null && highSeen > entryHigh * 1.02;
    const neClass = ranToTarget ? 'NE_WINNER_MISSED' : roseAboveEntry ? 'NE_UP_DRIFT' : 'NE_NO_FILL';
    return {
      outcome: 'not_entered', neClass,
      detail: `${neClass}: low_seen=${lowSeen} > entry_high=${entryHigh}, high_seen=${highSeen}${rec.target ? ` (target ${rec.target})` : ''}`,
      highSeen, lowSeen, lastClose,
    };
  }
  return {
    outcome: 'still_holding',
    detail: `last=${lastClose}`,
    highSeen, lowSeen, lastClose,
  };
}

async function fetchSpyReturn(fromIso, toIso) {
  const ohlc = await fetchYahooOHLC('SPY', fromIso, toIso);
  if (!ohlc || ohlc.closes.length < 2) return null;
  const first = ohlc.closes[0];
  const last = ohlc.closes.at(-1);
  return parseFloat(((last - first) / first * 100).toFixed(2));
}

/**
 * 체결 미검증 outcome 재평가.
 *
 * 왜 필요한가(2026-08-20 실측): 매도추천이 나오면 db.mjs 가 그 종목의 열린 매수추천을 'sold' 로
 * 마감하는데 OHLC 를 안 본다. 그래서 진입가에 실제로 체결됐는지 모른 채 손익이 기록됐고,
 * 게다가 매도엔진의 단일 pnlPct 가 진입가가 다른 여러 건에 그대로 복사됐다
 * (NVDA -0.3% → 진입가 32종 77건. 그런 그룹 84개).
 *
 * 여기서는 같은 judgeOutcome 으로 체결을 판정하고 건별 진입가로 손익을 다시 쓴다.
 * 체결이 없었으면 'not_entered' 로 재분류한다 — 안 산 걸 샀다고 기록하지 않는다.
 */
async function verifyUnverified(limit) {
  const rows = getUnverifiedOutcomes(limit);
  console.log(`체결 미검증 outcome ${rows.length}건 재평가\n`);
  const stat = { verified: 0, reclassified: 0, no_ohlc: 0, skipped: 0 };
  for (const rec of rows) {
    if (rec.action === 'watch') { stat.skipped++; continue; }
    const ohlc = await fetchYahooOHLC(rec.ticker, rec.generated_at, rec.o_evaluated_at);
    if (!ohlc || !ohlc.days) { stat.no_ohlc++; continue; }
    const judge = judgeOutcome(rec, ohlc);
    const entry = rec.entry_low ?? rec.price_at_gen;
    let det = {}; try { det = JSON.parse(rec.o_details_json ?? '{}'); } catch { /* 손상된 details 는 무시 */ }
    // 체결됐다면 매도추천이 마감한 그대로 'sold' 로 두되, 손익은 이 건의 진입가 × 실제 청산가로.
    // 체결이 없었으면 judge 의 판정(not_entered 등)을 따른다.
    const filled = judge.outcome !== 'not_entered';
    // 2026-09-03: 종전엔 매도엔진이 'sold' 로 찍어 두면 **손절 판정이 나와도 'sold' 를 유지**했다.
    //   실측 109건이 그렇게 묻혔고, 그 결과 손절률이 9.8% 로 보였다 — 실제로는 23.4% 다.
    //   손익 자체는 맞게 기록돼 있었으므로(평균 -1.51%) 수익률이 부풀려진 건 아니지만,
    //   **위험도가 실제의 절반 이하로 보였다.** 열 번에 한 번 손절하는 시스템과
    //   네 번에 한 번 손절하는 시스템은 독자에게 전혀 다른 물건이다.
    //   보유 중에 손절선을 깼으면 그건 손절이다. 그 뒤에 매도추천이 나왔다는 사실이 그걸 지우지 못한다.
    const outcome = filled
      ? (judge.outcome === 'stop_loss' ? 'stop_loss' : (rec.o_outcome === 'sold' ? 'sold' : judge.outcome))
      : 'not_entered';
    const exit = det.exitPrice ?? rec.o_price_at_eval ?? judge.lastClose;
    const pnl = realizedPnlPct({ outcome, entry, stop: rec.stop_loss, target: rec.target, lastClose: judge.lastClose, exit });
    updateVerifiedOutcome({
      recommendationId: rec.id, evaluatedAt: rec.o_evaluated_at,
      outcome, pnlPct: pnl,
      lowSeen: judge.lowSeen ?? null, highSeen: judge.highSeen ?? null, ohlcDays: ohlc.days ?? 0,
      details: JSON.stringify({ ...det, verified: true, verifiedOutcome: judge.outcome, pnlBasis: 'realized', entryUsed: entry, exitUsed: exit }),
    });
    if (outcome !== rec.o_outcome) stat.reclassified++;
    stat.verified++;
    if (stat.verified % 100 === 0) console.log(`  ...${stat.verified}건 검증`);
  }
  console.log(`\n=== 검증 결과 ===`);
  console.log(`  검증 완료 ${stat.verified} · 재분류 ${stat.reclassified} · OHLC 없음 ${stat.no_ohlc} · watch skip ${stat.skipped}`);
  return stat;
}

async function main() {
  if (VERIFY) { await verifyUnverified(limit); return; }
  openDb();
  const before = getSummary();
  console.log(`\n=== evaluate-recommendations ${DRY ? '— DRY RUN' : ''} ===\n`);
  console.log(`현재 DB: ${before.recs} 추천 / ${before.overdue} overdue / ${before.outcomes} outcomes\n`);

  let queue = ALL ? getAllRecommendationsForEval() : getOverdueRecommendations();
  if (limit > 0) queue = queue.slice(0, limit);
  if (queue.length === 0) {
    console.log(`💡 ${ALL ? '미평가 추천' : 'overdue 추천'} 0건 — 평가 대상 없음`);
    return;
  }
  if (ALL) console.log(`📡 --all 모드: 14d 윈도우 무시 (${queue.length}건 조기 baseline 평가)\n`);

  // SPY 벤치마크 — 가장 오래된 보고서 시점부터 캐싱
  const oldestGen = queue.reduce((min, r) => r.generated_at < min ? r.generated_at : min, queue[0].generated_at);
  const nowIso = new Date().toISOString();
  const spyRet = await fetchSpyReturn(oldestGen, nowIso);
  console.log(`SPY ${oldestGen.slice(0,10)} → now: ${spyRet}%\n`);

  let counts = { hit_target: 0, stop_loss: 0, not_entered: 0, still_holding: 0, unknown: 0, skipped_watch: 0 };
  const neClasses = { NE_WINNER_MISSED: 0, NE_UP_DRIFT: 0, NE_NO_FILL: 0 };  // 2026-06-14 NE 세분
  for (const rec of queue) {
    // watch 추천은 "대기" 의미 — outcome 평가에서 제외 (not_entered 통계 오염 방지)
    if (rec.action === 'watch') { counts.skipped_watch++; continue; }
    const ohlc = await fetchYahooOHLC(rec.ticker, rec.generated_at, nowIso);
    const judge = judgeOutcome(rec, ohlc);
    counts[judge.outcome]++;
    if (judge.neClass && neClasses[judge.neClass] != null) neClasses[judge.neClass]++;

    const entry = rec.entry_low ?? rec.price_at_gen;
    // 2026-08-20: 라벨과 일치하는 실현손익으로 바꾼다. 종전에는 라벨과 무관하게 마지막 종가로만 재서
    //   손절 발동 후 회복한 건이 수익으로 기록됐다(38일 표본 stop_loss 41건 중 17건).
    //   mtm(현재가 기준)은 details 에 함께 남겨 과거 데이터와 대조할 수 있게 한다.
    const pnl = realizedPnlPct({ outcome: judge.outcome, entry, stop: rec.stop_loss, target: rec.target, lastClose: judge.lastClose });
    const mtm = markToMarketPnlPct({ entry, lastClose: judge.lastClose });

    console.log(`${rec.ticker.padEnd(12)} ${rec.generated_at.slice(0,10)}  ${judge.outcome.padEnd(15)} ${pnl !== null ? `${pnl>0?'+':''}${pnl}%` : '  -  '} (mtm ${mtm !== null ? `${mtm>0?'+':''}${mtm}%` : '-'})  ${judge.detail}`);

    if (!DRY) {
      saveOutcome({
        recommendation_id: rec.id,
        evaluated_at: nowIso,
        price_at_eval: judge.lastClose ?? null,
        outcome: judge.outcome,
        pnl_pct: pnl,
        ohlc_days: ohlc?.days ?? 0,
        high_seen: judge.highSeen ?? null,
        low_seen: judge.lowSeen ?? null,
        spy_return: spyRet,
        details: { ...judge, pnlBasis: 'realized', mtmPnlPct: mtm },
      });
    }
  }

  console.log(`\n=== 합계 (${queue.length}) ===`);
  console.log(`  ✅ hit_target:     ${counts.hit_target}`);
  console.log(`  ❌ stop_loss:      ${counts.stop_loss}`);
  console.log(`  ⏸  not_entered:    ${counts.not_entered}  [WINNER_MISSED ${neClasses.NE_WINNER_MISSED} (entry 과보수→손실) · UP_DRIFT ${neClasses.NE_UP_DRIFT} · NO_FILL ${neClasses.NE_NO_FILL}]`);
  if (neClasses.NE_WINNER_MISSED >= 3) console.log(`     ⚠️ WINNER_MISSED ${neClasses.NE_WINNER_MISSED}건 — entry zone 너무 보수적(시장가 아래)로 winner 놓침. entry calibration 완화 검토 (buy 룰은 정확).`);
  console.log(`  📊 still_holding:  ${counts.still_holding}`);
  console.log(`  ?  unknown:        ${counts.unknown}`);
  if (counts.skipped_watch) console.log(`  👁  watch(skip):    ${counts.skipped_watch}`);
  if (!DRY) {
    const after = getSummary();
    console.log(`\nDB 갱신: outcomes ${before.outcomes} → ${after.outcomes}`);
  }

  // 만성 NE 자동감지: 5회+ 연속 not_entered ticker 경고
  const db = openDb();
  const chronicNe = db.prepare(`
    SELECT r.ticker, COUNT(*) AS ne_count
    FROM recommendation_outcomes o
    JOIN recommendations r ON r.id = o.recommendation_id
    WHERE o.outcome = 'not_entered' AND r.action = 'buy'
    GROUP BY r.ticker
    HAVING ne_count >= 5
    ORDER BY ne_count DESC
  `).all();
  if (chronicNe.length) {
    console.log('\n🚨 만성 미진입 경고 (buy 5회+ NE):');
    for (const { ticker, ne_count } of chronicNe) {
      console.log(`  ${ticker}: ${ne_count}회 not_entered — entry-calibration strict clamp 또는 ban-list 검토 권장`);
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

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
import { openDb, getOverdueRecommendations, getAllRecommendationsForEval, saveOutcome, getSummary } from './lib/db.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all'); // 14d 윈도우 무시 — 조기 baseline 평가용
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0', 10);

async function fetchYahooOHLC(ticker, fromIso, toIso) {
  // ticker normalization: 000660.KS 같은 KS suffix 는 Yahoo 가 그대로 받음
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
    return {
      outcome: 'not_entered',
      detail: `low_seen=${lowSeen} > entry_high=${entryHigh}`,
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

async function main() {
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
  for (const rec of queue) {
    // watch 추천은 "대기" 의미 — outcome 평가에서 제외 (not_entered 통계 오염 방지)
    if (rec.action === 'watch') { counts.skipped_watch++; continue; }
    const ohlc = await fetchYahooOHLC(rec.ticker, rec.generated_at, nowIso);
    const judge = judgeOutcome(rec, ohlc);
    counts[judge.outcome]++;

    const entry = rec.entry_low ?? rec.price_at_gen;
    const pnl = entry && judge.lastClose
      ? parseFloat(((judge.lastClose - entry) / entry * 100).toFixed(2))
      : null;

    console.log(`${rec.ticker.padEnd(12)} ${rec.generated_at.slice(0,10)}  ${judge.outcome.padEnd(15)} ${pnl !== null ? `${pnl>0?'+':''}${pnl}%` : '-'}  ${judge.detail}`);

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
        details: judge,
      });
    }
  }

  console.log(`\n=== 합계 (${queue.length}) ===`);
  console.log(`  ✅ hit_target:     ${counts.hit_target}`);
  console.log(`  ❌ stop_loss:      ${counts.stop_loss}`);
  console.log(`  ⏸  not_entered:    ${counts.not_entered}`);
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

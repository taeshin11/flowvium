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
import { openDb, getOverdueRecommendations, saveOutcome, getSummary } from './lib/db.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
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
    return {
      closes: (q.close ?? []).filter(v => typeof v === 'number'),
      highs: (q.high ?? []).filter(v => typeof v === 'number'),
      lows: (q.low ?? []).filter(v => typeof v === 'number'),
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
  const highSeen = Math.max(...ohlc.highs);
  const lowSeen = Math.min(...ohlc.lows);
  const lastClose = ohlc.closes.at(-1);

  // 1) Entry zone 진입 여부 — low_seen ≤ entry_high (역지정가 도달)
  const entryHigh = rec.entry_high ?? rec.entry_low;
  const entryLow = rec.entry_low ?? rec.entry_high;
  const entered = entryHigh != null && lowSeen != null && lowSeen <= entryHigh;

  if (!entered) {
    return {
      outcome: 'not_entered',
      detail: `low_seen=${lowSeen} > entry_high=${entryHigh}`,
      highSeen, lowSeen, lastClose,
    };
  }

  // 2) Target 도달 — high_seen ≥ target*0.98
  if (rec.target != null && highSeen >= rec.target * 0.98) {
    return {
      outcome: 'hit_target',
      detail: `high_seen=${highSeen} >= target*0.98=${rec.target * 0.98}`,
      highSeen, lowSeen, lastClose,
    };
  }

  // 3) Stop loss 발동 — low_seen ≤ stop_loss*1.02
  if (rec.stop_loss != null && lowSeen != null && lowSeen <= rec.stop_loss * 1.02) {
    return {
      outcome: 'stop_loss',
      detail: `low_seen=${lowSeen} <= stop*1.02=${rec.stop_loss * 1.02}`,
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

  let queue = getOverdueRecommendations();
  if (limit > 0) queue = queue.slice(0, limit);
  if (queue.length === 0) {
    console.log('💡 overdue 추천 0건 — 평가 대상 없음');
    return;
  }

  // SPY 벤치마크 — 가장 오래된 보고서 시점부터 캐싱
  const oldestGen = queue.reduce((min, r) => r.generated_at < min ? r.generated_at : min, queue[0].generated_at);
  const nowIso = new Date().toISOString();
  const spyRet = await fetchSpyReturn(oldestGen, nowIso);
  console.log(`SPY ${oldestGen.slice(0,10)} → now: ${spyRet}%\n`);

  let counts = { hit_target: 0, stop_loss: 0, not_entered: 0, still_holding: 0, unknown: 0 };
  for (const rec of queue) {
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
  if (!DRY) {
    const after = getSummary();
    console.log(`\nDB 갱신: outcomes ${before.outcomes} → ${after.outcomes}`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

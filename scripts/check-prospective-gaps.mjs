#!/usr/bin/env node
/**
 * scripts/check-prospective-gaps.mjs ???꾪뼢???곌뎄 blind spot 遺꾩꽍
 *
 * ?곕━媛 痢≪젙/?됯??덉?留??쒖슜 ????吏??+ 痢≪젙議곗감 ????吏??+ ?섎せ ?댁꽍??吏??
 */
import Database from 'better-sqlite3';
const db = new Database('C:/Flowvium/data/flowvium.db', { readonly: true });

console.log('?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??);
console.log('  ?꾪뼢???곌뎄 blind spot 遺꾩꽍 ??' + new Date().toISOString().slice(0,19));
console.log('?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧??n');

// ?? BLIND SPOT 1: Confidence calibration ?좊ː??????????????????????????????
console.log('## 1) Confidence calibration ??high/medium/low 媛 ?뺣쭚 hit 李⑥씠?\n');
const confCal = db.prepare(`
  SELECT r.confidence, COUNT(*) n,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) hits,
    SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) stops,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) ne,
    ROUND(AVG(o.pnl_pct),1) avg_pnl,
    ROUND(AVG(CASE WHEN o.outcome IN ('hit_target','stop_loss','still_holding') THEN o.pnl_pct END),1) real_pnl
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE r.action='buy' AND r.confidence IS NOT NULL
  GROUP BY r.confidence
`).all();
console.log('   conf      n     hit   stop  NE    hit%   avg_pnl%  real_pnl%(NE?쒖쇅)');
for (const r of confCal) {
  const hitPct = ((r.hits / r.n) * 100).toFixed(0) + '%';
  console.log(`   ${String(r.confidence).padEnd(9)} ${String(r.n).padEnd(5)} ${String(r.hits).padEnd(5)} ${String(r.stops).padEnd(5)} ${String(r.ne).padEnd(5)} ${hitPct.padEnd(6)} ${String(r.avg_pnl ?? '').padEnd(9)} ${r.real_pnl ?? ''}`);
}
console.log('   ??high vs medium 李⑥씠媛 ?섎??덈뒗吏? ?좊ː??calibration ?뺥빀???먭?.');

// ?? BLIND SPOT 2: Alpha vs SPY (?좏깮 ?뚰뙆 vs ?쒖옣 異붿쥌) ????????????????????
console.log('\n## 2) Alpha ??SPY ?鍮??뚰뙆 (ticker selection ?먯껜 媛移?\n');
const alpha = db.prepare(`
  SELECT
    COUNT(*) n,
    ROUND(AVG(o.pnl_pct),2) ticker_avg,
    ROUND(AVG(o.spy_return),2) spy_avg,
    ROUND(AVG(o.pnl_pct - o.spy_return),2) alpha,
    SUM(CASE WHEN o.pnl_pct > o.spy_return THEN 1 ELSE 0 END) beat_spy,
    SUM(CASE WHEN o.pnl_pct < o.spy_return THEN 1 ELSE 0 END) lose_spy
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE r.action='buy' AND o.outcome IN ('hit_target','stop_loss','still_holding') AND o.spy_return IS NOT NULL
`).get();
console.log(`   n=${alpha.n}, ticker avg=${alpha.ticker_avg}%, SPY avg=${alpha.spy_avg}%, ALPHA=${alpha.alpha}%`);
console.log(`   beat SPY: ${alpha.beat_spy} / lose: ${alpha.lose_spy} ??win rate ${((alpha.beat_spy/(alpha.beat_spy+alpha.lose_spy))*100).toFixed(0)}%`);
console.log('   ??ticker selection ???⑥닚 SPY 異붿쥌 蹂대떎 ?곗썡? ?곗썡?섎㈃ 吏꾩쭨 alpha.');

// ?? BLIND SPOT 3: Time-to-hit (鍮좊Ⅸ hit vs ?먮┛ hit) ??????????????????????
console.log('\n## 3) Time-to-hit ???됯퇏 硫곗튌 留뚯뿉 hit/stop?\n');
const timeToHit = db.prepare(`
  SELECT
    o.outcome,
    COUNT(*) n,
    ROUND(AVG(o.ohlc_days),1) avg_days,
    MIN(o.ohlc_days) min_d, MAX(o.ohlc_days) max_d
  FROM recommendation_outcomes o
  WHERE o.outcome IN ('hit_target','stop_loss','still_holding','not_entered') AND o.ohlc_days IS NOT NULL
  GROUP BY o.outcome
`).all();
for (const r of timeToHit) {
  console.log(`   ${r.outcome.padEnd(14)} n=${String(r.n).padEnd(4)} avg=${r.avg_days}??(range ${r.min_d}~${r.max_d})`);
}
console.log('   ??hit_target ???덈Т 鍮좊Ⅴ硫?(e.g., <3?? target ???덈Т ?묎쾶 ?ㅼ젙??嫄?');

// ?? BLIND SPOT 4: 醫낅ぉ ?ㅼ뼇??媛먯냼 ?⑦꽩 ???????????????????????????????????
console.log('\n## 4) 醫낅ぉ ?ㅼ뼇????留ㅼ＜ unique ticker 異붿꽭\n');
const divers = db.prepare(`
  SELECT
    strftime('%Y-W%W', generated_at) wk,
    COUNT(*) n_recs,
    COUNT(DISTINCT ticker) uniq,
    ROUND(100.0 * COUNT(DISTINCT ticker) / COUNT(*), 1) diversity_pct
  FROM recommendations
  WHERE action='buy'
  GROUP BY wk
  ORDER BY wk DESC LIMIT 6
`).all();
console.log('   week        n_recs  unique  diversity%');
for (const r of divers) {
  console.log(`   ${r.wk.padEnd(11)} ${String(r.n_recs).padEnd(7)} ${String(r.uniq).padEnd(7)} ${r.diversity_pct}%`);
}

// ?? BLIND SPOT 5: hit_target ???됯퇏 pnl ??target ???묎쾶 ?ㅼ젙?먮굹? ??????
console.log('\n## 5) hit_target pnl 遺꾪룷 ??target ???덈Т 蹂댁닔??\n');
const targetDist = db.prepare(`
  SELECT
    ROUND(MIN(o.pnl_pct),1) min_pnl,
    ROUND(AVG(o.pnl_pct),1) avg_pnl,
    ROUND(MAX(o.pnl_pct),1) max_pnl,
    COUNT(*) n
  FROM recommendation_outcomes o
  WHERE o.outcome='hit_target'
`).get();
console.log(`   hit_target n=${targetDist.n}, pnl: min ${targetDist.min_pnl}% / avg ${targetDist.avg_pnl}% / max ${targetDist.max_pnl}%`);
// hit_target +10% 誘몃쭔 鍮꾩쑉 (?묒? target)
const smallTarget = db.prepare(`SELECT COUNT(*) c FROM recommendation_outcomes WHERE outcome='hit_target' AND pnl_pct < 10`).get().c;
const totalHit = db.prepare(`SELECT COUNT(*) c FROM recommendation_outcomes WHERE outcome='hit_target'`).get().c;
console.log(`   hit_target 以?pnl < +10% 鍮꾩쑉: ${smallTarget}/${totalHit} = ${((smallTarget/totalHit)*100).toFixed(0)}%`);
console.log('   ???ㅼ닔媛 +10% 誘몃쭔?대㈃ target ???덈Т ?묎쾶 ?ㅼ젙??(= "?ъ슫 hit").');

// ?? BLIND SPOT 6: Sector 蹂?hit rate ???대뼡 sector 媛 吏꾩쭨 媛뺥뻽?? ????????
console.log('\n## 6) Sector hit rate ???대뵒??吏꾩쭨 ??留욌굹?\n');
const sec = db.prepare(`
  SELECT
    COALESCE(r.sector, '(null)') sec,
    COUNT(*) n,
    SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) hits,
    SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) ne,
    ROUND(AVG(o.pnl_pct),1) avg_pnl,
    ROUND(AVG(o.pnl_pct - COALESCE(o.spy_return,0)),1) alpha
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE r.action='buy'
  GROUP BY sec
  HAVING n >= 4
  ORDER BY hits*1.0/n DESC
`).all();
console.log('   sector                    n     hit   NE   hit%   avg_pnl%   alpha%');
for (const r of sec) {
  const hitPct = ((r.hits/r.n)*100).toFixed(0)+'%';
  console.log(`   ${r.sec.padEnd(25)} ${String(r.n).padEnd(5)} ${String(r.hits).padEnd(5)} ${String(r.ne).padEnd(4)} ${hitPct.padEnd(6)} ${String(r.avg_pnl).padEnd(10)} ${r.alpha}`);
}

// ?? BLIND SPOT 7: NE ??entry vs market gap 痢≪젙 ????????????????????????
console.log('\n## 7) NE 耳?댁뒪??entry gap 遺꾪룷 ???쇰쭏??硫?댁꽌 吏꾩엯 紐삵븿?\n');
const neGap = db.prepare(`
  SELECT
    r.ticker,
    COUNT(*) n_ne,
    ROUND(AVG((o.high_seen - r.entry_high) / r.entry_high * 100), 1) median_gap
  FROM recommendation_outcomes o JOIN recommendations r ON r.id=o.recommendation_id
  WHERE o.outcome='not_entered' AND r.entry_high > 0 AND o.high_seen IS NOT NULL
  GROUP BY r.ticker
  HAVING n_ne >= 3
  ORDER BY median_gap DESC LIMIT 10
`).all();
console.log('   ticker        n_NE   avg_gap%');
for (const r of neGap) console.log(`   ${r.ticker.padEnd(13)} ${String(r.n_ne).padEnd(6)} ${r.median_gap}%`);
console.log('   ???묒닔 gap% = ?쒖옣媛媛 entry 蹂대떎 ?? ?뚯닔硫??쒖옣媛媛 ????븘 吏꾩엯 媛?ν뻽?댁빞 ?덉쓬 (??NE?)');

// ?? BLIND SPOT 8: still_holding ???됯? 湲곌컙 留뚮즺 ?꾩뿉??泥섎━?먮굹? ???????
console.log('\n## 8) still_holding ???됯? 湲곌컙 留뚮즺 ??outcome 媛깆떊 ?⑦꽩\n');
const sh = db.prepare(`
  SELECT
    ROUND(AVG(o.pnl_pct),1) avg_pnl,
    ROUND(AVG(o.ohlc_days),1) avg_days,
    COUNT(*) n,
    SUM(CASE WHEN o.pnl_pct > 0 THEN 1 ELSE 0 END) profitable
  FROM recommendation_outcomes o
  WHERE o.outcome='still_holding'
`).get();
console.log(`   n=${sh.n}, avg_pnl=${sh.avg_pnl}%, avg_days=${sh.avg_days}?? profitable=${sh.profitable}/${sh.n} (${((sh.profitable/sh.n)*100).toFixed(0)}%)`);
console.log('   ??"still_holding" ??30% 李⑥?. ?됯? 湲곌컙 ?앸굹??醫낃껐 outcome (close_at_period) ?쇰줈 ????꺼媛?= 痢≪젙 lag.');

// ?? BLIND SPOT 9: Quality score ?쒖슜 ???????????????????????????????????
console.log('\n## 9) Quality score (DB ????????쒖슜?)\n');
const qs = db.prepare(`
  SELECT
    ROUND(AVG(o.quality_score),1) avg_qs,
    MIN(o.quality_score) min_qs,
    MAX(o.quality_score) max_qs,
    COUNT(o.quality_score) n
  FROM recommendation_outcomes o WHERE o.quality_score IS NOT NULL
`).get();
console.log(`   quality_score: n=${qs.n}, avg=${qs.avg_qs}, range=${qs.min_qs}~${qs.max_qs}`);
const qsByOutcome = db.prepare(`
  SELECT o.outcome, ROUND(AVG(o.quality_score),1) avg_qs, COUNT(*) n
  FROM recommendation_outcomes o WHERE o.quality_score IS NOT NULL
  GROUP BY o.outcome
`).all();
for (const r of qsByOutcome) console.log(`   ${r.outcome.padEnd(14)} avg_qs=${r.avg_qs} n=${r.n}`);
console.log('   ??quality_score 媛 outcome 怨??곴? ?덈굹? 痢≪젙留??섍퀬 蹂닿퀬??prompt ??諛섏쁺 ????');

// ?? BLIND SPOT 10: ?됯? burst ?⑦꽩 ??cron 遺?뺢린 ??????????????????????????
console.log('\n## 10) ?됯? cron 遺?뺢린 ?ㅽ뻾 ???됱씪 ?됯? 0嫄?\n');
const evalBurst = db.prepare(`
  SELECT substr(evaluated_at,1,10) d, COUNT(*) c
  FROM recommendation_outcomes
  WHERE evaluated_at >= date('now','-30 days')
  GROUP BY d ORDER BY d DESC LIMIT 30
`).all();
const evalDays = new Map(evalBurst.map(r => [r.d, r.c]));
let zeroDays = 0, totalDays = 0;
for (let i = 0; i < 30; i++) {
  const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  totalDays++;
  if (!evalDays.has(d)) zeroDays++;
}
console.log(`   理쒓렐 30??以??됯? 0嫄??쇱옄: ${zeroDays}/${totalDays}`);
console.log(`   evaluate-signals cron ???쇱슂??03:00 UTC 留??ㅽ뻾 ??二쇱쨷 ?됯? ?꾩쟻 ???쇱슂??burst.`);
console.log(`   ??eval_after ?대? 吏??異붿쿇??5-6???숈븞 誘명룊媛 ?곹깭濡??몄텧 (?ъ슜?먯뿉寃뚮뒗 stale).`);

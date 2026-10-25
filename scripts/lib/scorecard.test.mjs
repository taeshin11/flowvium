#!/usr/bin/env node
/**
 * scorecard.test.mjs — 공개 성적표 집계와 시장별 매수 축소 판정. 2026-10-25 신설.
 *
 * 사장님(10/25) "이런 전향적 연구 안 하냐 … 제일 좋은 방향으로 ChatGPT·agy·Claude 다 상의해서". 세 곳 모두 순서가 같았다:
 *   ① 한국 손실부터 줄인다 ② 성적을 숨김없이 공개한다(시장 분리·중앙값·미진입/추적 중 따로·전체 목록) ③ 되먹임은 미리 정한 기준으로만.
 * 판정을 고친 뒤(judge-outcome.test 머리말) 다시 잰 성적(14일 추적, 같은 종목 14일 안 재추천은 한 번):
 *   미국 끝난 338건 — 이익 49% · 중앙 0.0% · 지수 대비 중앙 0.0%p · 손절 24%
 *   한국 끝난 88건  — 이익 26% · 중앙 −5.9% · 지수 대비 중앙 −1.9%p · 손절 60% (6개월 중 5개월 지수 아래)
 * 축소 기준(미리 고정 — 세 곳 중 둘 이상: 두 조건 동시·최소 표본·절반 축소·그림자 평가·회복 조건):
 *   최근 90일 끝난 건 30건 이상에서 '지수 대비 중앙 < 0' 그리고 '손절 > 35%' → 그 시장 매수를 절반으로.
 *   풀림: 최근 끝난 30건(축소로 빠진 그림자 추천 포함)이 '지수 대비 중앙 ≥ 0' 그리고 '손절 ≤ 35%'.
 *   공포·탐욕 구간 표는 넣지 않는다(시장과 얽혀 갈리지 않는다 — 둘이 반대).
 */
const M = await import('./scorecard.mjs').catch((e) => { console.log(String(e)); return null; });
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
if (!M) { bad('[0] lib/scorecard.mjs 가 없다'); console.log('\n❌ 1건 실패'); process.exit(1); }
const { episodes, summarize, gateFor } = M;
const D = 86400e3;
const at = (d) => new Date(Date.parse('2026-09-01T00:00:00Z') + d * D).toISOString();
const row = (o) => ({ market: 'kr', done: true, res: 'time_exit', pnl: 1, bench: 0, ticker: 'A', name: 'A', gen: at(0), ...o });

{ // 같은 종목을 14일 안에 다시 내면 한 번으로
  const e = episodes([row({ gen: at(0) }), row({ gen: at(3) }), row({ gen: at(15) }), row({ ticker: 'B', gen: at(3) })]);
  (e.length === 3 && e.filter((r) => r.ticker === 'A').length === 2) ? ok('[1] 같은 종목 14일 안 재추천은 한 번으로 센다') : bad(`[1] ${e.length}`);
}
{ // 분모: 미진입·추적 중은 성적에 안 섞고 개수만
  const s = summarize([row({ pnl: 2, bench: 1 }), row({ ticker: 'B', pnl: -4, bench: 0, res: 'stop_loss' }), row({ ticker: 'C', res: 'not_entered', pnl: null }), row({ ticker: 'E', done: false, res: 'still_holding', pnl: null })], { now: Date.parse(at(60)) }).kr;
  (s.recommended === 4 && s.notEntered === 1 && s.tracking === 1 && s.finished === 2) ? ok('[2] 추천 → 미진입·추적 중·끝남으로 나눠 센다') : bad(`[2] ${JSON.stringify(s)}`);
  (s.profitShare === 50 && s.medianPct === -1 && s.meanPct === -1 && s.stopShare === 50 && s.worstPct === -4) ? ok('[3] 이익 비율·중앙값·평균·손절 비율·최악') : bad(`[3] ${JSON.stringify(s)}`);
  (s.vsIndexMedian === -1.5) ? ok('[4] 지수 대비는 건별 차이의 중앙값') : bad(`[4] ${s.vsIndexMedian}`);
}
{ // 시장을 섞지 않는다
  const s = summarize([row({ market: 'us', pnl: 5 }), row({ market: 'kr', pnl: -5 })], { now: Date.parse(at(60)) });
  (s.us.finished === 1 && s.kr.finished === 1 && s.us.medianPct === 5 && s.kr.medianPct === -5 && !('all' in s)) ? ok('[5] 미국·한국을 따로 — 합친 숫자는 없다') : bad(`[5] ${JSON.stringify(s)}`);
}
{ // 최근 목록은 좋은 것만 고르지 않는다 — 끝난 순서대로 전부(최대 30)
  const rows = Array.from({ length: 40 }, (_, i) => row({ ticker: `T${i}`, gen: at(i), pnl: i % 2 ? 3 : -3 }));
  const s = summarize(rows, { now: Date.parse(at(90)) }).kr;
  (s.recent.length === 30 && s.recent[0].ticker === 'T39' && s.recent.filter((r) => r.pnlPct < 0).length === 15) ? ok('[6] 최근 끝난 30건을 손익 상관없이 최신순으로') : bad(`[6] ${s.recent.length} ${s.recent[0]?.ticker}`);
}
{ // 월별 표
  const s = summarize([row({ gen: '2026-09-03T00:00:00Z', pnl: 1 }), row({ ticker: 'B', gen: '2026-10-02T00:00:00Z', pnl: -2 })], { now: Date.parse('2026-11-30T00:00:00Z') }).kr;
  (s.monthly.length === 2 && s.monthly[0].month === '2026-09' && s.monthly[1].medianPct === -2) ? ok('[7] 월별(추천한 달) 표') : bad(`[7] ${JSON.stringify(s.monthly)}`);
}
const now = Date.parse(at(100));
const mk = (n, f) => Array.from({ length: n }, (_, i) => row({ ticker: `K${i}`, gen: at(20 + i), ...f(i) }));
{ // 축소: 두 조건 동시 + 30건 이상
  const badRows = mk(40, (i) => ({ pnl: -5, bench: -1, res: i < 20 ? 'stop_loss' : 'time_exit' }));   // 지수 대비 −4 · 손절 50%
  const g = gateFor('kr', badRows, { now });
  (g.reduce === true && g.n === 40) ? ok('[8] 지수 아래 + 손절 35% 초과 + 30건 이상 → 절반으로') : bad(`[8] ${JSON.stringify(g)}`);
  const few = gateFor('kr', badRows.slice(0, 29), { now });
  few.reduce === false ? ok('[9] 30건 미만이면 판단하지 않는다') : bad(`[9] ${JSON.stringify(few)}`);
  const oneOnly = gateFor('kr', mk(40, () => ({ pnl: -5, bench: -1, res: 'time_exit' })), { now });   // 지수 아래지만 손절 0%
  oneOnly.reduce === false ? ok('[10] 한 조건만 나쁘면 줄이지 않는다') : bad(`[10] ${JSON.stringify(oneOnly)}`);
  const old = gateFor('kr', mk(40, (i) => ({ gen: at(-200 + i), pnl: -5, bench: -1, res: 'stop_loss' })), { now });
  old.reduce === false ? ok('[11] 90일보다 오래된 성적으로는 줄이지 않는다') : bad(`[11] ${JSON.stringify(old)}`);
}
{ // 풀림은 따로: 이미 줄인 상태면 최근 30건(그림자 포함)이 회복해야 푼다
  const mixed = [...mk(40, (i) => ({ pnl: -5, bench: -1, res: i < 20 ? 'stop_loss' : 'time_exit' }))];
  const stillBad = gateFor('kr', mixed, { now, wasReduced: true });
  const recovered = gateFor('kr', [...mixed.map((r) => ({ ...r, gen: at(-150) })), ...Array.from({ length: 30 }, (_, i) => row({ ticker: `S${i}`, gen: at(60 + i), pnl: 2, bench: 0, shadow: i % 2 === 0 }))], { now, wasReduced: true });
  (stillBad.reduce === true && recovered.reduce === false) ? ok('[12] 줄인 뒤에는 최근 30건(그림자 포함)이 지수 이상·손절 35% 이하일 때만 푼다') : bad(`[12] ${JSON.stringify([stillBad, recovered])}`);
  const s = summarize([...mixed, row({ ticker: 'Z', shadow: true, pnl: 9 })], { now }).kr;
  (s.finished === 40) ? ok('[13] 그림자 추천은 공개 성적에 섞지 않는다(판정에만 쓴다)') : bad(`[13] ${s.finished}`);
}
{ // 보고서에 적용: 그 시장 매수만 절반(올림) — 확신순(앞)을 남기고 뒤를 그림자로
  const { applyMarketGate } = M;
  const P = [
    { ticker: 'AAPL', action: 'buy' }, { ticker: '005930.KS', action: 'buy', entryZone: '₩70,000-₩72,000', stopLoss: '₩65,000', target: '₩80,000', name: '삼성전자' },
    { ticker: '000660.KS', action: 'buy', entryZone: '₩200,000-₩205,000', stopLoss: '₩190,000', target: '₩230,000' },
    { ticker: '035420.KS', action: 'buy', entryZone: '₩180,000-₩185,000', stopLoss: '₩170,000', target: '₩200,000' },
    { ticker: '051910.KS', action: 'watch' },
  ];
  const sc = { generatedAt: new Date(Date.now() - 3600e3).toISOString(), gate: { kr: { reduce: true, reason: 'x' }, us: { reduce: false } } };
  const r = applyMarketGate(P, sc, { generatedAt: '2026-10-26T00:00:00Z' });
  (typeof applyMarketGate === 'function' && r.portfolio.map((p) => p.ticker).join(',') === 'AAPL,005930.KS,000660.KS,051910.KS' && r.dropped.length === 1 && r.dropped[0].ticker === '035420.KS')
    ? ok('[14] 한국 매수 3 → 2(올림 절반) · 확신순 앞을 남긴다 · 미국·관망은 그대로') : bad(`[14] ${JSON.stringify(r?.portfolio?.map((p) => p.ticker))}`);
  const d = r.dropped[0];
  (d.market === 'kr' && d.entry_low === 180000 && d.entry_high === 185000 && d.stop_loss === 170000 && d.target === 200000 && d.generated_at === '2026-10-26T00:00:00Z')
    ? ok('[15] 빠진 추천은 그림자로 — 가격대·손절·목표를 숫자로 남겨 계속 채점한다') : bad(`[15] ${JSON.stringify(d)}`);
  (r.marketGate?.kr?.reduce === true && r.marketGate?.us?.reduce === false) ? ok('[16] 보고서에 축소 여부를 남긴다(화면 한 줄)') : bad(`[16] ${JSON.stringify(r.marketGate)}`);
  const stale = applyMarketGate(P, { ...sc, generatedAt: new Date(Date.now() - 72 * 3600e3).toISOString() }, { generatedAt: '2026-10-26T00:00:00Z' });
  (stale.portfolio.length === 5 && stale.dropped.length === 0) ? ok('[17] 성적표가 48시간보다 오래됐으면 건드리지 않는다') : bad(`[17] ${stale.portfolio.length}`);
  const none = applyMarketGate(P, null, {});
  (none.portfolio.length === 5) ? ok('[18] 성적표가 없으면 그대로') : bad('[18]');
  const one = applyMarketGate([{ ticker: '005930.KS', action: 'buy' }], sc, {});
  (one.portfolio.length === 1) ? ok('[19] 한 종목뿐이면 그대로(올림 — 시장을 통째로 비우지 않는다)') : bad('[19]');
}
{ // 생성기가 실제로 건다 — 12 cap 뒤, 저장 전
  const { readFileSync } = await import('node:fs');
  const g = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8');
  const iCap = g.indexOf('[total-cap]'), iGate = g.indexOf('applyMarketGate('), iSave = g.indexOf('saveRecommendations(finalReport');
  (iGate > iCap && iGate < iSave && /scorecard-shadow\.jsonl/.test(g) && /finalReport\.marketGate = /.test(g)) ? ok('[20] generate-report-local: 12 cap 뒤에 걸고, 그림자를 남기고, 보고서에 marketGate 를 싣는다') : bad(`[20] ${iCap}/${iGate}/${iSave}`);
}
{ // 10/25 문구 검토(Claude·agy): 가장 나빴던(좋았던) 추천이 어떤 종목·언제인지
  const s = summarize([row({ ticker: 'A', name: '가', gen: '2026-09-03T00:00:00Z', pnl: -9 }), row({ ticker: 'B', name: '나', gen: '2026-09-05T00:00:00Z', pnl: 7 }), row({ ticker: 'C', name: '다', pnl: 1 })], { now: Date.parse('2026-11-30T00:00:00Z') }).kr;
  (s.worst?.ticker === 'A' && s.worst?.name === '가' && s.worst?.date === '2026-09-03' && s.worst?.pct === -9 && s.best?.ticker === 'B' && s.best?.pct === 7)
    ? ok('[21] 가장 나빴던·좋았던 추천의 종목·날짜') : bad(`[21] ${JSON.stringify([s.worst, s.best])}`);
}
{ // 줄인 날짜(안내 문구 '○일부터'): 처음 줄인 날을 이어 간다
  const { gateSince } = M;
  (typeof gateSince === 'function' && gateSince({ reduce: true }, { reduce: true, since: '2026-10-20' }, '2026-10-25') === '2026-10-20'
    && gateSince({ reduce: true }, { reduce: false }, '2026-10-25') === '2026-10-25' && gateSince({ reduce: true }, null, '2026-10-25') === '2026-10-25'
    && gateSince({ reduce: false }, { reduce: true, since: '2026-10-20' }, '2026-10-25') === null)
    ? ok('[22] 줄인 날: 이어서 줄이면 처음 날, 새로 줄이면 오늘, 풀리면 없음') : bad('[22] gateSince');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

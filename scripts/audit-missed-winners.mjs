// 일회성: 엔진 사각지대 역방향 사냥 — 상승 종목 중 미포착분 원인 분류 (세션 후 삭제)
import fs from 'fs';
import Database from 'better-sqlite3';

const cand = JSON.parse(fs.readFileSync('data/candidate-tickers.json', 'utf8'));
const tickers = cand.tickers.filter(t => !/^(SPY|VOO|IVV|VTI|ITOT|SPLG|QQQ|QQQM|DIA|IWM|GLD|SLV|TLT|HYG|LQD|EFA|EEM|KORU|YINN|EDC|INDL)$/.test(t)); // 지수 ETF 제외
const meta = cand.meta ?? {};

const db = new Database('data/flowvium.db', { readonly: true });
const surfaced = new Set(db.prepare('SELECT DISTINCT ticker FROM buy_candidates').all().map(r => r.ticker));
const recommended = new Set(db.prepare('SELECT DISTINCT ticker FROM recommendations').all().map(r => r.ticker));
db.close();

console.log(`[hunt] 풀 ${tickers.length}종 3개월 수익률 실측 시작 (이력: top30 경험 ${surfaced.size} / 추천 경험 ${recommended.size})`);

async function ret3mo(t) {
  for (const host of ['query1', 'query2']) {
    try {
      const j = await (await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1wk&range=3mo`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })).json();
      const c = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(x => x != null);
      if (c?.length >= 4) {
        // 오염틱 가드 (KLAC 교훈): 인접 주봉 2.2x 초과 점프는 skip
        for (let i = 1; i < c.length; i++) if (c[i] / c[i - 1] > 2.2 || c[i] / c[i - 1] < 0.45) return null;
        return ((c.at(-1) / c[0]) - 1) * 100;
      }
      return null;
    } catch { /* 다음 host */ }
  }
  return null;
}

const winners = [];
let done = 0, noData = 0;
for (const t of tickers) {
  const r = await ret3mo(t);
  done++;
  if (done % 200 === 0) console.log(`  ${done}/${tickers.length}...`);
  if (r == null) { noData++; continue; }
  if (r >= 25) winners.push({ t, r: Math.round(r * 10) / 10 });
  await new Promise(res => setTimeout(res, 120));
}
winners.sort((a, b) => b.r - a.r);
console.log(`\n[hunt] 3개월 +25% 이상: ${winners.length}종 / 시세없음 ${noData}종`);

// 미포착 winner 분류
const missed = winners.filter(w => !surfaced.has(w.t) && !recommended.has(w.t));
console.log(`[hunt] 그중 top30/추천 경험 0회 (미포착): ${missed.length}종`);
const causes = { kr_signal_blind: [], sector_unknown: [], us_quiet: [] };
for (const w of missed) {
  const m = meta[w.t] ?? {};
  const isKR = /\.(KS|KQ)$/.test(w.t);
  if (isKR) causes.kr_signal_blind.push(`${w.t}(${m.name ?? '?'} +${w.r}%)`);
  else if (!m.sector || m.sector === 'Unknown') causes.sector_unknown.push(`${w.t} +${w.r}%`);
  else causes.us_quiet.push(`${w.t}(${m.sector}) +${w.r}%`);
}
console.log(`\n■ KR 신호맹 (한미반도체 클래스): ${causes.kr_signal_blind.length}종`);
console.log('  ' + causes.kr_signal_blind.slice(0, 12).join(', '));
console.log(`■ US 섹터 Unknown: ${causes.sector_unknown.length}종`);
console.log('  ' + causes.sector_unknown.slice(0, 8).join(', '));
console.log(`■ US 신호 조용 (signal quiet): ${causes.us_quiet.length}종`);
console.log('  ' + causes.us_quiet.slice(0, 12).join(', '));
console.log(`\n■ 포착됐던 winner: ${winners.length - missed.length}종 (참고: 엔진이 잡은 비율 ${Math.round((winners.length - missed.length) / Math.max(1, winners.length) * 100)}%)`);

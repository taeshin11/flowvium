import Database from 'better-sqlite3';

const db = new Database('D:/Flowvium/data/flowvium.db', { readonly: true });

// price_at_gen 이 NULL 이므로 price_at_eval 를 surrogate 로 사용
const rows = db.prepare(`
  SELECT r.ticker, r.entry_low, r.entry_high, r.stop_loss,
         o.price_at_eval AS pe, o.high_seen AS hi, o.low_seen AS lo
  FROM recommendation_outcomes o
  JOIN recommendations r ON r.id = o.recommendation_id
  WHERE o.outcome = 'not_entered'
    AND r.entry_low IS NOT NULL AND r.entry_high IS NOT NULL AND o.price_at_eval IS NOT NULL
`).all();

let hallucLow = 0, unreachableHigh = 0, marketGap = 0, ambiguous = 0;
const halluc = [], unr = [], md = [];

for (const r of rows) {
  const ratio = r.entry_high / r.pe;
  if (ratio < 0.85) { hallucLow++; halluc.push({ ...r, ratio }); }
  else if (r.entry_low > r.pe * 1.05) { unreachableHigh++; unr.push(r); }
  else if (r.lo > r.entry_high) { marketGap++; md.push(r); }
  else { ambiguous++; }
}

const pct = n => (n / rows.length * 100).toFixed(0) + '%';
console.log('not_entered ' + rows.length + '건 분해 (price_at_eval surrogate):');
console.log('  🚨 환각(낮게 깜, entry_high < eval×0.85): ' + hallucLow + ' (' + pct(hallucLow) + ')');
console.log('  도달불가(높게 깜, entry_low > eval×1.05): ' + unreachableHigh + ' (' + pct(unreachableHigh) + ')');
console.log('  시장 변동 부족(zone 아래로 안 내려옴): ' + marketGap + ' (' + pct(marketGap) + ')');
console.log('  애매: ' + ambiguous + ' (' + pct(ambiguous) + ')');

console.log('\n=== 환각 TOP 12 (ratio = entry_high / price_at_eval) ===');
halluc.sort((a, b) => a.ratio - b.ratio).slice(0, 12).forEach(r => {
  console.log('  ' + r.ticker.padEnd(11)
    + ' entry=' + r.entry_low + '-' + r.entry_high
    + ' eval=' + r.pe.toFixed(2)
    + ' ratio=' + (r.ratio * 100).toFixed(0) + '%');
});

console.log('\n=== 도달불가 TOP 12 ===');
unr.slice(0, 12).forEach(r => {
  console.log('  ' + r.ticker.padEnd(11)
    + ' entry=' + r.entry_low + '-' + r.entry_high
    + ' eval=' + r.pe.toFixed(2)
    + ' lo=' + r.lo.toFixed(2));
});

console.log('\n=== 시장 변동 부족 (정상 미진입) TOP 12 ===');
md.slice(0, 12).forEach(r => {
  console.log('  ' + r.ticker.padEnd(11)
    + ' entry=' + r.entry_low + '-' + r.entry_high
    + ' eval=' + r.pe.toFixed(2)
    + ' lo=' + r.lo.toFixed(2));
});

console.log('\n=== ticker 별 not_entered 빈도 TOP 12 ===');
const tk = {};
rows.forEach(r => tk[r.ticker] = (tk[r.ticker] || 0) + 1);
Object.entries(tk).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([t, c]) => {
  console.log('  ' + t.padEnd(11) + ' x' + c);
});

db.close();

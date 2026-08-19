#!/usr/bin/env node
/**
 * stage2-ctx.test.mjs — Stage 2 평가 컨텍스트 필드 커버리지 검증.
 *
 * 배경(2026-08-20 실측): Stage 1 은 ctx 에 change1d 를 넣어 평가하지만, 살아남은 후보를
 *   stage1Scored 로 push 할 때 change1d 를 빠뜨렸다(generate-report-local.mjs:5350).
 *   fetchBuyTechSignals 도 change1d 를 안 채운다 → Stage 2 에서 영구 결측.
 *   결과: change1d 를 요구하는 Stage2 룰이 DB 4,092행 전체에서 정확히 0건 발화.
 *     tech_volume_surge(live)      0건   vs  tech_ma_golden_cross 2,794건
 *     shadow_buy_trend_pullback    0건   vs  백테스트 163건
 *   즉 live 룰 하나가 죽어 있었고, 전향연구 가설 하나가 검증된 적이 없었다.
 *
 * 이 테스트는 "Stage2 에서 평가되는 모든 룰이 읽는 ctx 필드가 실제로 공급되는가"를 소스에서 확인한다.
 * 특정 필드를 하드코딩하지 않는다 — 엔진 소스에서 ctx.X 를 추출해 비교하므로 룰이 늘어도 따라간다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const engine = readFileSync(resolve(ROOT, 'src/lib/buy-sell-engine.mjs'), 'utf8');
const gen    = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ── ① 엔진 소스에서 condition type → 읽는 ctx 필드 추출 ──
function ctxFieldsByType(src) {
  const map = new Map();
  const re = /case '([A-Za-z0-9_]+)':([\s\S]*?)(?=\n\s{4}case '|\n\s{2}\}\n)/g;
  let m;
  while ((m = re.exec(src))) {
    const fields = new Set([...m[2].matchAll(/ctx\.([A-Za-z0-9_]+)/g)].map(x => x[1]));
    map.set(m[1], fields);
  }
  return map;
}
const byType = ctxFieldsByType(engine);
byType.size > 20 ? ok(`엔진에서 condition type ${byType.size}종 추출`) : bad(`추출 실패 (${byType.size}종)`);

// ── ② Stage2 컨텍스트가 공급하는 필드 = 후보 객체 ∪ fetchBuyTechSignals sig ──
const pushM = gen.match(/stage1Scored\.push\(\{([^}]*)\}\)/);
if (!pushM) bad('stage1Scored.push 앵커를 못 찾음 (코드 이동?)');
const candFields = new Set((pushM?.[1] ?? '').split(',').map(s => s.split(':')[0].trim()).filter(Boolean));

const sigM = gen.slice(gen.indexOf('async function fetchBuyTechSignals')).match(/const sig = \{([^}]*)\}/);
if (!sigM) bad('fetchBuyTechSignals sig 앵커를 못 찾음');
const sigFields = new Set((sigM?.[1] ?? '').split(',').map(s => s.split(':')[0].trim()).filter(Boolean));
const supplied = new Set([...candFields, ...sigFields]);
console.log(`        후보 필드: ${[...candFields].join(', ')}`);
console.log(`        sig 필드 : ${[...sigFields].join(', ')}`);

// ── ③ Stage2 에서 평가되는 룰(technical/price 계열 + shadow)의 요구 필드 검사 ──
const specs = [
  ['buy-rules-tuned', JSON.parse(readFileSync(resolve(ROOT, 'data/buy-rules-tuned.json'), 'utf8')).rules
      .filter(r => r.category === 'technical' || (r.category === 'price' && r.id !== 'price_oversold_gap'))],
  ['shadow-rules',    JSON.parse(readFileSync(resolve(ROOT, 'data/shadow-rules.json'), 'utf8')).rules
      .filter(r => (r.side ?? 'buy') === 'buy')],
];
// 나중 단계(fundamentals/krFlow/macro)에서 병합되는 필드는 Stage2 시점 판정에서 제외한다.
const LATER = new Set(['vix','fgScore','fg','roe','roePct','opMargin','opMarginPct','revenueYoY','peRatio','peg',
  'krFlowIntensity','burstUpNotional','sectorStance','regionStance','newsScore','newsGap','squeezeScore',
  'insiderNet','cascadeUpstream','backlogGrowth','supplyContract','boost','ban','held','heldPnl','opMarginDecline']);

const missing = [];
for (const [label, rules] of specs) {
  for (const r of rules) {
    const t = r.condition?.type;
    const need = byType.get(t);
    if (!need) { missing.push(`${label}/${r.id}: 알 수 없는 type '${t}'`); continue; }
    for (const f of need) {
      if (LATER.has(f) || supplied.has(f)) continue;
      missing.push(`${label}/${r.id} (type=${t}) → ctx.${f} 미공급`);
    }
  }
}
missing.length ? bad(`Stage2 결측 필드 ${missing.length}건:\n        ` + missing.join('\n        '))
               : ok('Stage2 에서 평가되는 모든 룰의 요구 필드가 공급됨');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

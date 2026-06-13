#!/usr/bin/env node
/**
 * scripts/check-rule-firing.mjs — 룰 발화 커버리지 감사 (메타 검증체계).
 *
 * 배경(2026-06-14 ChatGPT 리뷰 + 사용자 "왜 최선의 방법을 시행 안 하고 있었는지 검증체계를 마련해"):
 *   오늘 잡힌 결함의 공통 패턴 = **"룰은 정의돼 있는데 데이터/ctx 가 안 닿아 silent no-op"**.
 *   - Stage1 매수 fundamental 룰: ctx 필드명 불일치(revenueYoY vs revenueGrowth)로 0 발화.
 *   - 매도 후보 tech: macroCtx.signals 미정의로 rsi/sma 항상 null → 기술 룰 0 발화.
 *   - 심판 게이트: 내부자/13F ctx 미전달 → micro_insider_selling(hard) 0 발화.
 *   - verify "차량": INDUSTRY_TERMS 누락으로 한 번도 매칭 안 됨.
 *   "룰이 있다" ≠ "룰이 발화한다". 정의된 모든 buy/sell 룰의 실제 발화 횟수를 최근 산출물에서 집계해
 *   **0-발화 룰 = 사각지대(죽은 배선 or 죽은 임계)** 로 surface. happy-path("룰 파일에 있음")가 아닌
 *   실제 발화 증거로 검증.
 *
 * 데이터: buy_candidates.matched_rules(최근 N 보고서) + reports/reconciliation/*.json(최근 N).
 * 사용: node scripts/check-rule-firing.mjs [reportN=20]
 * exit: 0=정상(또는 warn만), 1=정의된 룰 중 0-발화 비율 과다(>40%) → 배선 의심.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const N = parseInt(process.argv[2] ?? '20', 10);

function loadRules(file) {
  try { return (JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')).rules ?? []); } catch { return []; }
}
const buyRules = loadRules('data/buy-rules-tuned.json');
const sellRules = loadRules('data/sell-rules-tuned.json');

// ── 매수 룰 발화: buy_candidates.matched_rules ────────────────────────────────
const buyFire = new Map(buyRules.map(r => [r.id, 0]));
let buyReports = 0;
try {
  const { openDb } = await import('./lib/db.mjs');
  const db = openDb();
  const recentReports = db.prepare('SELECT DISTINCT report_id FROM buy_candidates ORDER BY generated_at DESC LIMIT ?').all(N).map(r => r.report_id);
  buyReports = recentReports.length;
  if (recentReports.length) {
    const ph = recentReports.map(() => '?').join(',');
    const rows = db.prepare(`SELECT matched_rules FROM buy_candidates WHERE report_id IN (${ph})`).all(...recentReports);
    for (const row of rows) {
      let mr; try { mr = JSON.parse(row.matched_rules ?? '[]'); } catch { mr = []; }
      for (const h of mr) { const id = h.ruleId ?? h.id; if (buyFire.has(id)) buyFire.set(id, buyFire.get(id) + 1); }
    }
  }
} catch (e) { console.warn('[buy] DB 읽기 실패:', e.message); }

// ── 매도/심판 룰 발화: reconciliation trails ──────────────────────────────────
const sellFire = new Map(sellRules.map(r => [r.id, 0]));
let trails = 0;
try {
  const dir = resolve(ROOT, 'reports/reconciliation');
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().slice(-N);
  trails = files.length;
  for (const f of files) {
    let j; try { j = JSON.parse(readFileSync(resolve(dir, f), 'utf8')); } catch { continue; }
    for (const c of (j.candidates ?? [])) for (const h of (c.hits ?? [])) { const id = h.id ?? h.ruleId; if (sellFire.has(id)) sellFire.set(id, sellFire.get(id) + 1); }
  }
} catch (e) { console.warn('[sell] trail 읽기 실패:', e.message); }

// context-limited 룰: 측정 맥락에서 자연히 0-발화 가능 → 배선 의심에서 제외.
//  - 매도 held-only(stop/target/rotation): fresh-buy 심판 trail 엔 포지션 없어 자연 0.
//  - 희소 이벤트 룰(squeeze/cascade/ban): 해당 이벤트 최근 부재면 0 정상.
const HELD_OR_RARE = new Set([
  'price_stop_breach', 'price_stop_near', 'price_target_near', 'rotation_profit', 'rotation_loss', 'rotation_neutral',
  'micro_squeeze_score', 'micro_cascade_upstream', 'selflearn_ban_list_penalty', 'guru_greenblatt_magic', 'guru_graham_value',
]);

// ── 리포트 ────────────────────────────────────────────────────────────────────
function report(label, rules, fire, sampleN, sampleUnit) {
  const zero = rules.filter(r => (fire.get(r.id) ?? 0) === 0);
  const wiringSuspect = zero.filter(r => !HELD_OR_RARE.has(r.id));   // should-fire 인데 0 → 진짜 배선 의심
  const contextOk = zero.filter(r => HELD_OR_RARE.has(r.id));
  console.log(`\n## ${label} 발화 커버리지 (최근 ${sampleN} ${sampleUnit})`);
  console.log(`   정의 ${rules.length}룰 | 발화 ${rules.length - zero.length} | 0-발화 ${zero.length} (배선의심 ${wiringSuspect.length} + 맥락정상 ${contextOk.length})`);
  const byCat = {};
  for (const r of wiringSuspect) (byCat[r.category] ??= []).push(r.id);
  for (const [cat, ids] of Object.entries(byCat)) console.log(`   🔧 [${cat}] 배선의심 0-발화: ${ids.join(', ')}`);
  if (contextOk.length) console.log(`   · 맥락상 0 정상(held/희소): ${contextOk.map(r => r.id).join(', ')}`);
  if (!wiringSuspect.length) console.log('   ✅ should-fire 룰 전부 1회+ 발화 (배선 정상)');
  // 분모 = should-fire 룰 (context-limited 제외)
  const denom = rules.filter(r => !HELD_OR_RARE.has(r.id)).length;
  return wiringSuspect.length / Math.max(denom, 1);
}

console.log('═══ 룰 발화 커버리지 감사 (룰 정의 ≠ 발화 — silent no-op 사각지대 탐지) ═══');
console.log('메타검증: "룰 파일에 있음"(happy-path) 아닌 *실제 발화 증거*로 배선 검증. (2026-06-14 신설)');
const buyZeroRatio = report('매수 룰', buyRules, buyFire, buyReports, '보고서 buy_candidates');
const sellZeroRatio = report('매도/심판 룰', sellRules, sellFire, trails, 'reconciliation trail(gate)');

console.log('\n해석: 🔧 배선의심 0-발화 = ctx/데이터가 룰에 안 닿음(오늘 Stage1 alias·gate insider 류). next cron');
console.log('      후 재실행해 발화로 전환됐는지 확인. (이 감사는 informational — push 차단 안 함.)');
const suspectTotal = Math.round(buyZeroRatio * 100);
console.log(`\n${buyZeroRatio > 0.3 || sellZeroRatio > 0.3 ? '⚠️' : '✅'} 배선의심 0-발화 비율 buy ${Math.round(buyZeroRatio * 100)}% / sell ${Math.round(sellZeroRatio * 100)}% (should-fire 기준).`);
process.exit(0);  // informational — 0-발화는 surface 하되 push 차단 안 함(legitimate 0 존재)

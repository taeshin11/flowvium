#!/usr/bin/env node
/**
 * build-sft-dataset.mjs — AITS_FINANCE_T SFT 학습 데이터셋 빌더 (2026-06-18 신설)
 *
 * 목적: Qwen3-30B-A3B 에 LoRA 로 "매수·매도 심판엔진" 을 정렬. 핵심 차별점 = recommendation_outcomes
 * 의 *실제 성과 레이블*(hit_target/stop_loss/sold + alpha)로 가중 → 수익 낸 추론 패턴만 학습
 * (reward-weighted SFT, Karpathy 데이터엔진 완성형).
 *
 * 데이터 소스 (3종):
 *   1) 매수 판단 (recommendations ⋈ recommendation_outcomes) — 성과 가중/필터
 *   2) 매도 판단 (sell_recommendations)
 *   3) 원칙/룰 instruction (judgment-doctrine + investor-wisdom + buy/sell rules)
 *
 * 출력: data/sft/aits-finance-t.jsonl  (OpenAI chat 포맷: {messages:[{role,content}], weight, meta})
 *   axolotl/llama-factory/unsloth 모두 호환. weight 는 reward-weighted 학습용(성과 비례).
 *
 * 사용:  node scripts/build-sft-dataset.mjs
 */
import { openDb } from './lib/db.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(ROOT, 'data/sft');
const OUT = resolve(OUT_DIR, 'aits-finance-t.jsonl');
const loadJson = (p) => { try { return JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')); } catch { return null; } };

const SYSTEM = `너는 "매수·매도 심판엔진" — 규율 있고 근거 기반인 투자 판단 AI다. 종목의 매수/분할매수/관망/비중축소/매도/회피를 판단하고, 실시간 데이터·매수매도 룰·구루 원칙을 근거로 인용하며, 리스크와 진입/손절을 제시한다. 수치를 지어내지 않고, 데이터 없으면 솔직히 말한다.`;

const db = openDb();
const cur = (mkt, tk) => (mkt === 'kospi' || mkt === 'kosdaq' || /\.(KS|KQ)$/.test(tk || '')) ? '₩' : '$';
const fmt = (n, c) => n == null ? '?' : (c === '₩' ? `${c}${Math.round(n).toLocaleString('en-US')}` : `${c}${(+n).toFixed(2)}`);

const rows = [];

// ── 1) 매수 판단 (성과 레이블) ────────────────────────────────────────────────
// 가중: hit_target=1.0, still_holding(+)=0.7, sold(alpha>0)=0.6, not_entered(큰 상승=entry과보수)=0.3(주의예시),
//   stop_loss/sold(alpha<0)=0.15(저가중 — 오답이나 "신중" 학습용, 소량 유지). unknown 제외.
const buys = db.prepare(`
  SELECT r.ticker, r.name, r.market, r.sector, r.action, r.confidence, r.entry_low, r.entry_high,
         r.target, r.stop_loss, r.price_at_gen, r.rationale, o.outcome, o.pnl_pct, o.spy_return
  FROM recommendations r JOIN recommendation_outcomes o ON o.recommendation_id = r.id
  WHERE r.rationale IS NOT NULL AND length(r.rationale) > 25 AND r.action='buy'
`).all();
let buyKept = 0;
for (const r of buys) {
  const alpha = (r.pnl_pct != null && r.spy_return != null) ? r.pnl_pct - r.spy_return : null;
  let w = 0;
  if (r.outcome === 'hit_target') w = 1.0;
  else if (r.outcome === 'still_holding') w = (r.pnl_pct ?? 0) > 0 ? 0.7 : 0.25;
  else if (r.outcome === 'sold') w = (alpha ?? 0) > 0 ? 0.6 : 0.15;
  else if (r.outcome === 'not_entered') w = 0.3;
  else if (r.outcome === 'stop_loss') w = 0.15;
  else continue; // unknown
  const c = cur(r.market, r.ticker);
  const user = `${r.name || r.ticker}(${r.ticker}${r.sector ? `, ${r.sector}` : ''}) 매수해도 될까? 현재가 ${fmt(r.price_at_gen, c)}.`;
  const lvls = [r.entry_low != null && `진입 ${fmt(r.entry_low, c)}~${fmt(r.entry_high, c)}`, r.stop_loss != null && `손절 ${fmt(r.stop_loss, c)}`, r.target != null && `목표 ${fmt(r.target, c)}`].filter(Boolean).join(' · ');
  const assistant = `판단: 매수${r.confidence ? `(${r.confidence})` : ''}\n근거: ${r.rationale}${lvls ? `\n${lvls}` : ''}\n투자 판단·책임은 본인에게 있음.`;
  rows.push({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }, { role: 'assistant', content: assistant }], weight: +w.toFixed(2), meta: { src: 'buy', ticker: r.ticker, outcome: r.outcome, alpha } });
  buyKept++;
}

// ── 2) 매도 판단 ──────────────────────────────────────────────────────────────
let sellKept = 0;
try {
  const candMeta = loadJson('data/candidate-tickers.json')?.meta ?? {};
  const sells = db.prepare(`SELECT ticker, market, sector, sell_type, urgency, current_price, stop_loss, target, rationale FROM sell_recommendations WHERE rationale IS NOT NULL AND length(rationale)>15`).all();
  for (const s of sells) {
    const c = cur(s.market, s.ticker);
    const nm = candMeta[s.ticker]?.name || s.ticker;
    const user = `${nm}(${s.ticker}) 지금 팔아야 할까? 현재가 ${fmt(s.current_price, c)}.`;
    const assistant = `판단: 비중축소/매도${s.urgency ? `(긴급도 ${s.urgency})` : ''}\n근거: ${s.rationale}\n투자 판단·책임은 본인에게 있음.`;
    rows.push({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }, { role: 'assistant', content: assistant }], weight: 0.6, meta: { src: 'sell', ticker: s.ticker, sellType: s.sell_type } });
    sellKept++;
  }
} catch (e) { console.warn('sell skip:', e.message); }

// ── 3) 원칙/룰 instruction ────────────────────────────────────────────────────
let instrKept = 0;
const addInstr = (q, a, w = 0.8) => { rows.push({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: q }, { role: 'assistant', content: a }], weight: w, meta: { src: 'doctrine' } }); instrKept++; };
const doctrine = loadJson('data/judgment-doctrine.json'); const docArr = Array.isArray(doctrine) ? doctrine : doctrine?.principles ?? [];
for (const p of docArr) if (p.rule) addInstr(`투자 판단에서 "${p.id}" 원칙이 뭐야?`, `${p.rule}${p.apply ? ` 적용: ${p.apply}` : ''}${p.sources?.length ? ` (출처: ${p.sources.join(', ')})` : ''}`);
const wisdom = loadJson('data/investor-wisdom.json'); const wisArr = Array.isArray(wisdom) ? wisdom : wisdom?.principles ?? [];
for (const p of wisArr) if (p.rule) addInstr(`${(p.sources || []).join('·') || '구루'}의 "${p.id}" 가르침을 적용하면?`, `${p.rule}`);
const rulesFile = (f, kind) => { const j = loadJson(f); const arr = Array.isArray(j) ? j : j?.rules ?? []; for (const r of arr) if (r.description) addInstr(`${kind} 룰 "${r.id}"(${r.category}) 가 발화하면 무슨 의미야?`, `${r.description} → ${kind} 신호 (점수 ${r.score ?? '?'}).`, 0.6); };
rulesFile('data/buy-rules-tuned.json', '매수'); rulesFile('data/sell-rules-tuned.json', '매도');

// ── 4) 버핏 주주서한 학습예시 (gen-buffett-sft.mjs 가 생성한 한국어 Q&A) ───────────
//   사용자 "버핏의 주주서한 모음은 우리 매수 매도 심판엔진에게도 학습시켜". RAG(런타임 검색)와 별개로
//   모델 자체에 가치투자 추론을 내재화. data/sft/buffett-wisdom.jsonl 이 있으면 머지(weight 그대로).
let buffettKept = 0;
const BUFFETT = resolve(OUT_DIR, 'buffett-wisdom.jsonl');
if (existsSync(BUFFETT)) {
  for (const ln of readFileSync(BUFFETT, 'utf8').split('\n').filter(Boolean)) {
    try {
      const o = JSON.parse(ln);
      if (o?.messages?.length >= 2) {
        // system 누락 시 표준 SYSTEM 주입(일관성)
        if (o.messages[0]?.role !== 'system') o.messages.unshift({ role: 'system', content: SYSTEM });
        rows.push({ ...o, weight: o.weight ?? 0.5, meta: { ...(o.meta || {}), src: 'buffett' } });
        buffettKept++;
      }
    } catch { /* skip bad line */ }
  }
} else {
  console.warn('buffett-wisdom.jsonl 없음 — scripts/sft/gen-buffett-sft.mjs 먼저 실행 (RAG 임베딩 완료 후)');
}

// ── 출력 ──────────────────────────────────────────────────────────────────────
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
const wsum = rows.reduce((s, r) => s + r.weight, 0);
console.log(`=== AITS_FINANCE_T SFT 데이터셋 ===`);
console.log(`매수판단 ${buyKept} (성과가중) · 매도판단 ${sellKept} · 원칙/룰 ${instrKept} · 버핏서한 ${buffettKept} = 총 ${rows.length} 예시`);
console.log(`가중합(effective) ${wsum.toFixed(0)} · 출력 ${OUT}`);
console.log(`샘플:`, JSON.stringify(rows[0]).slice(0, 240));

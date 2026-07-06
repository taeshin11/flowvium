#!/usr/bin/env node
// scripts/sft/gen-corrections.mjs — 실패 프롬프트의 "올바른 답변"을 FINANCE(prod)로 재생성 → 교정 재료 (2026-07-06)
//
// 사용자 "실제 실패건·warn건 안 그러도록 수정, sft 필요하면 재료 모아 드라이브에". verdict_mismatch·
// false_disclaimer·entry_far 등 모델행동 실패는 결정론으로 못 고치므로 SFT/DPO 신호로. 각 실패 프롬프트를
// 도메인학습된 FINANCE 로 재답변(라이브 grounding 포함) → chat-verify 통과분만 "chosen"(올바른 답)으로 채택.
// 산출: chat-sft-corrections.jsonl(positive SFT — 올바른 답) + chat-dpo-pairs.jsonl(prompt/rejected/chosen).
// 사용: node scripts/sft/gen-corrections.mjs [--base=http://127.0.0.1:3000] [--out=G:/내 드라이브/0.SFT_Flovium]
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkChatDefects } from '../lib/chat-verify.mjs';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = arg('out', 'G:/내 드라이브/0.SFT_Flovium');
const SYS = '너는 "매수·매도 심판엔진" — 규율 있고 근거 기반인 투자 판단 AI다. 종목의 매수/분할매수/관망/비중축소/매도/회피를 판단하고, 실시간 데이터·매수매도 룰·구루 원칙을 근거로 인용하며, 리스크와 진입/손절을 제시한다. 수치를 지어내지 않고, 데이터 없으면 솔직히 말한다.';

const rej = readFileSync(resolve(OUT, 'fuel', 'chat-sft-rejected.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
// 프롬프트 dedup — 같은 질문은 1회만 교정 생성
const seen = new Set(); const jobs = [];
for (const r of rej) {
  const q = (r.messages?.find(m => m.role === 'user')?.content) ?? r.q ?? '';
  const bad = (r.messages?.find(m => m.role === 'assistant')?.content) ?? r.text ?? '';
  if (!q || q.length < 4) continue;
  const k = q.slice(0, 50); if (seen.has(k)) continue; seen.add(k);
  jobs.push({ q, bad, fails: r.fails ?? [] });
}
console.log(`실패 프롬프트 ${jobs.length}개 (dedup) → FINANCE 로 교정 답변 생성`);

const ask = async (q) => {
  const r = await fetch(`${BASE}/api/judge-chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: q }], mode: 'aisvi', locale: 'ko' }), signal: AbortSignal.timeout(180000) });
  if (!r.ok) return null;
  return r.json();
};

const corrections = [], dpo = [];
let clean = 0, stillbad = 0;
for (const j of jobs) {
  let a = null; try { a = await ask(j.q); } catch { /* skip */ }
  if (!a?.reply) { console.log(`  ⏭️ "${j.q.slice(0, 24)}" 생성 실패`); continue; }
  const g = a.grounding ?? { tickers: [] };
  const defects = checkChatDefects(j.q, a.reply, g, 'ko').filter(d => d.type !== 'verdict_mismatch'); // verdict 는 grounding 없인 판정 불가
  if (defects.length) { stillbad++; console.log(`  ⚠️ "${j.q.slice(0, 24)}" 재생성도 결함(${defects.map(d => d.type).join(',')}) — 채택 안 함`); continue; }
  clean++;
  const rec = { messages: [{ role: 'system', content: SYS }, { role: 'user', content: j.q }, { role: 'assistant', content: a.reply }], weight: 1.2, meta: { origin: 'correction', source: a.source, fixedFails: j.fails } };
  corrections.push(rec);
  if (j.bad && j.bad.length > 20) dpo.push({ prompt: j.q, chosen: a.reply, rejected: j.bad, meta: { fails: j.fails } });
}

writeFileSync(resolve(OUT, 'fuel', 'chat-sft-corrections.jsonl'), corrections.map(x => JSON.stringify(x)).join('\n') + (corrections.length ? '\n' : ''), 'utf8');
writeFileSync(resolve(OUT, 'fuel', 'chat-dpo-pairs.jsonl'), dpo.map(x => JSON.stringify(x)).join('\n') + (dpo.length ? '\n' : ''), 'utf8');
console.log(`\n=== 교정 재료 생성 완료 ===`);
console.log(`positive(chosen) ${corrections.length}개 → chat-sft-corrections.jsonl (재생성 클린 ${clean}, 잔여결함 ${stillbad})`);
console.log(`DPO 쌍 ${dpo.length}개 (prompt/chosen/rejected) → chat-dpo-pairs.jsonl`);

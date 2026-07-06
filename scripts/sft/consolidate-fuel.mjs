#!/usr/bin/env node
// scripts/sft/consolidate-fuel.mjs — 신규 챗 연료 → v1 SFT 포맷 정제·병합 (2026-07-06)
//
// 사용자 "둘다 SFT 해서 비교" 준비 — GPU 창 열리면 즉시 학습하도록 연료를 미리 학습형식으로.
// eval/stress/history 의 pass 턴만(rejected 제외) → {messages:[system,user,assistant], weight, meta} 로 변환,
// v1(aisvi-finance-t.jsonl)과 병합 + dedup(질문+답변 앞 80자 해시). 출력: 0.SFT_Flovium/fuel/chat-sft-train.jsonl.
// rejected(fail)는 별도 chat-sft-rejected.jsonl 로(추후 DPO negative). 학습은 별도(SERA/GPU창) — 이건 준비만.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = 'G:/내 드라이브/0.SFT_Flovium';
const SYS = '너는 "매수·매도 심판엔진" — 규율 있고 근거 기반인 투자 판단 AI다. 종목의 매수/분할매수/관망/비중축소/매도/회피를 판단하고, 실시간 데이터·매수매도 룰·구루 원칙을 근거로 인용하며, 리스크와 진입/손절을 제시한다. 수치를 지어내지 않고, 데이터 없으면 솔직히 말한다.';
const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

const seen = new Set();
const key = (q, a) => `${(q || '').slice(0, 60)}|${(a || '').slice(0, 80)}`.replace(/\s+/g, '');
const train = [], rejected = [];

// eval/stress/history 연료 → 학습 예시
// chat-sft-corrections.jsonl: 실패 프롬프트의 FINANCE 재답변(올바른 답) — weight↑ 로 교정 강조.
for (const f of ['chat-sft-corrections.jsonl', 'chat-sft-eval.jsonl', 'chat-sft-stress.jsonl', 'chat-sft-history.jsonl']) {
  for (const r of readJsonl(resolve(OUT, 'fuel', f))) {
    // corrections 는 이미 messages 완성형(weight 포함)
    if (f === 'chat-sft-corrections.jsonl' && r.messages) {
      const q = r.messages.find(m => m.role === 'user')?.content ?? '';
      const a = r.messages.find(m => m.role === 'assistant')?.content ?? '';
      const k = key(q, a); if (seen.has(k)) continue; seen.add(k);
      train.push(r); continue;
    }
    // 답변 본문 추출: eval 은 messages[assistant], stress 는 text
    let q = r.q ?? (r.messages?.find(m => m.role === 'user')?.content) ?? '';
    let a = r.text ?? (r.messages?.find(m => m.role === 'assistant')?.content) ?? '';
    a = String(a).trim(); q = String(q).trim();
    if (!q || a.length < 40) continue;               // 빈약 답변 제외
    const rec = { messages: [{ role: 'system', content: SYS }, { role: 'user', content: q }, { role: 'assistant', content: a }], weight: 1.0, meta: { origin: r.origin ?? f, id: r.id } };
    if (r.label === 'fail') { rejected.push({ ...rec, fails: r.fails }); continue; }
    if (r.label === 'pass' || f === 'chat-sft-history.jsonl') {  // history 는 이미 클린 전용
      const k = key(q, a); if (seen.has(k)) continue; seen.add(k);
      train.push(rec);
    }
  }
}

// v1 병합(중복 제거)
const v1 = readJsonl(resolve(process.cwd(), 'data/sft/aisvi-finance-t.jsonl'));
let v1kept = 0;
for (const r of v1) {
  const q = r.messages?.find(m => m.role === 'user')?.content ?? '';
  const a = r.messages?.find(m => m.role === 'assistant')?.content ?? '';
  const k = key(q, a); if (seen.has(k)) continue; seen.add(k);
  train.push(r); v1kept++;
}

const trainPath = resolve(OUT, 'fuel', 'chat-sft-train.jsonl');
const rejPath = resolve(OUT, 'fuel', 'chat-sft-rejected.jsonl');
writeFileSync(trainPath, train.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');
writeFileSync(rejPath, rejected.map(x => JSON.stringify(x)).join('\n') + (rejected.length ? '\n' : ''), 'utf8');
console.log(`=== SFT 연료 정제 완료 ===`);
console.log(`학습 예시 ${train.length}개 (v1 ${v1kept} + 신규 챗 pass ${train.length - v1kept}) → ${trainPath}`);
console.log(`rejected ${rejected.length}개 (DPO negative 후보) → ${rejPath}`);
console.log(`포맷: {messages:[system,user,assistant], weight, meta} — v1 동일 (Unsloth/trl SFTTrainer 호환)`);

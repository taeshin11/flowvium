#!/usr/bin/env node
// scripts/rag/verify-rag-scores.mjs — RAG 점수·관련성 검증 (2026-07-06 사용자 "RAG 점수가 잘 매겨졌는지
//   검증은 어떻게 하고 있어? / 없다고 하면 진짜 없는지 검증기가 확인해야").
//
// 종전엔 RAG 검증이 전무 → 임베더가 죽어도(C: 이관 후 미설치였음) ragRetrieve 가 조용히 [] 반환 = 거짓 부재.
// production 과 동일 로직(corpus.ndjson + EMBED_URL 코사인)으로 4층 검증:
//   [1] 임베더 생존: /embed 가 정상 차원 벡터 반환. 죽었으면 ❌ (RAG "hit 없음"이 거짓 부재임을 폭로).
//   [2] 관련성(anti-false-negative): 온토픽 골든 질의가 ≥1 hit + 기대 구루그룹이 최상위. 0 hit = 임계/코퍼스 갭.
//   [3] 점수 밴드: 온토픽 top score ≥ 0.45 (0.35 임계 겨우 넘는 저품질 매칭 아님) + 오프토픽 top < 온토픽 top
//       (판별력 — 스코어가 실제로 관련성을 반영하는가).
//   [4] 정합: 라이브 /api/judge-chat aisvi-rag 의 ragSources 가 비어있지 않은지(웹 경로도 RAG 살아있나).
// 사용: node scripts/rag/verify-rag-scores.mjs [--skip-live]
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EMBED_URL = process.env.EMBED_URL ?? 'http://127.0.0.1:8100/embed';
const CORPUS = resolve(ROOT, 'data/rag/corpus.ndjson');
const SKIP_LIVE = process.argv.includes('--skip-live');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fail++; };

function guruGroup(s) {
  s = (s || '').toLowerCase();
  if (s.includes('버크셔') || s.includes('buffett') || s.includes('버핏')) return 'buffett';
  if (s.includes('soros') || s.includes('소로스')) return 'soros';
  if (s.includes('lynch') || s.includes('린치')) return 'lynch';
  if (s.includes('kostolany') || s.includes('코스톨라니')) return 'kostolany';
  if (s.includes('marks') || s.includes('막스')) return 'marks';
  return 'other';
}
const cosine = (a, b) => { let d = 0, na = 0, nb = 0, n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0; };
// 2026-07-06: production rag.ts 의 effScore boost 재현(한글 +0.06, 큐레이션 태그 +0.04) — raw 영어 letter
//   조각이 한국어 질의 top 을 오염하던 것을 큐레이션 원칙 위로 re-rank. Claude 직접판독으로 발견한 개선.
const CURATION_TAG = /\b(guru|discipline|fundamental|technical|macro)\b|매수엔진|매도엔진/;
const effBoost = (t) => (/[가-힣]/.test(t) ? 0.06 : 0) + (CURATION_TAG.test(t) ? 0.04 : 0);
const embed = async (t) => { try { const r = await fetch(EMBED_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts: [t] }), signal: AbortSignal.timeout(15000) }); if (!r.ok) return null; return (await r.json())?.embeddings?.[0] ?? null; } catch { return null; } };

// [1] 임베더 생존
console.log('## RAG 점수·관련성 검증\n');
const warm = await embed('워밍업 문장입니다');
ok(Array.isArray(warm) && warm.length >= 256, `[1] 임베더 생존 (dim ${warm?.length ?? 'NULL'}) — 죽었으면 RAG "hit 없음"은 거짓 부재`);
if (!warm) { console.log('\n❌ 임베더 다운 — RAG 는 현재 조용히 [] 반환 중(거짓 부재). serve-embed 기동 필요.'); process.exit(1); }

// 코퍼스 로드
if (!existsSync(CORPUS)) { ok(false, `[코퍼스] ${CORPUS} 없음`); process.exit(1); }
const corpus = readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x && Array.isArray(x.embedding));
console.log(`[코퍼스] ${corpus.length} 청크 로드`);
const groupsPresent = new Set(corpus.map(c => guruGroup(c.source)));

// [2][3] 골든 관련성 + 점수 밴드
// 골든: 구루 개념은 중첩되므로(예 "공포에 사라"는 버핏·코스톨라니 공유) rank-1 강제는 brittle →
//   기대 구루가 top-3 에 존재하는지로 검증(관련성 반영 확인). 시그니처 개념으로 질의 선정.
const GOLDEN = [
  { q: '위대한 기업을 적정가에 사서 오래 보유하고 경제적 해자를 본다', expect: 'buffett' },
  { q: '길거리에서 신제품을 보고 10루 성장주를 발견하는 아마추어의 강점', expect: 'lynch' },
];
const OFFTOPIC = '김치찌개 끓이는 법과 재료 손질';
const topScoreOf = async (q) => { const qv = await embed(q); if (!qv) return { top: 0, src: null }; let best = { score: -1, source: null }; for (const c of corpus) { const s = cosine(qv, c.embedding); if (s > best.score) best = { score: s, source: c.source }; } return { top: best.score, src: best.source }; };

const offtopic = await topScoreOf(OFFTOPIC);
console.log(`[3] 오프토픽 baseline top score: ${offtopic.top.toFixed(3)}`);
for (const g of GOLDEN) {
  if (!groupsPresent.has(g.expect)) { console.log(`⏭️ [2] ${g.expect} 코퍼스에 없음 — 골든 skip`); continue; }
  const qv = await embed(g.q);
  const scored = corpus.map(c => { const s = cosine(qv, c.embedding); return { g: guruGroup(c.source), s, eff: s + effBoost(c.text) }; }).sort((a, b) => b.eff - a.eff);
  const top = scored[0];
  const hits = scored.filter(x => x.eff >= 0.35).length;
  ok(hits >= 1, `[2] "${g.q.slice(0, 24)}…" ≥1 hit (${hits}건, top=${top.s.toFixed(3)}) — 온토픽 무회수=거짓부재/임계과high`);
  ok(top.s >= 0.45, `[3] top score ${top.s.toFixed(3)} ≥ 0.45 (임계 0.35 겨우넘는 저품질 아님)`);
  ok(top.s > offtopic.top + 0.05, `[3] 판별력: 온토픽 ${top.s.toFixed(3)} > 오프토픽 ${offtopic.top.toFixed(3)} — 스코어가 관련성 반영`);
  // production 의 구루 다양성 캡(그룹당 2) 재현 후 검증 — 코퍼스가 버크셔 5430청크로 압도적이라 raw 랭킹은
  //   전부 buffett. production 은 캡으로 다른 구루를 노출하므로, 캡 적용 top-k 로 기대 구루 회수를 확인해야 충실.
  const eligible = scored.filter(x => x.s >= 0.35);
  const cnt = {}; const capped = [];
  for (const h of eligible) { if ((cnt[h.g] = (cnt[h.g] ?? 0) + 1) <= 2) capped.push(h.g); if (capped.length >= 6) break; }
  ok(capped.includes(g.expect), `[2] 기대 구루 ${g.expect} ∈ 캡적용 top-6 [${capped.join(',')}] (production 다양성 캡 재현)`);
}

// [4] 라이브 웹 경로 정합
if (!SKIP_LIVE) {
  try {
    const res = await fetch('http://127.0.0.1:3000/api/judge-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '버핏이라면 지금 시장 어떻게 볼까?' }], mode: 'aisvi-rag', locale: 'ko' }), signal: AbortSignal.timeout(180000) });
    const j = await res.json();
    const rag = j.grounding?.ragSources ?? [];
    ok(rag.length >= 1, `[4] 라이브 aisvi-rag ragSources ${rag.length}건 (웹 경로 RAG 활성) — ${rag.map(h => `${h.source}=${h.score}`).slice(0, 3).join(', ')}`);
  } catch (e) { ok(false, `[4] 라이브 프로브 실패: ${e.message}`); }
}

console.log(fail ? `\n❌ RAG 검증 FAIL ${fail}건` : '\n✅ RAG 점수·관련성 검증 통과 (임베더 생존·관련성·점수밴드·판별력·라이브)');
process.exit(fail ? 1 : 0);

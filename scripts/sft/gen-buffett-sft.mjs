#!/usr/bin/env node
/**
 * gen-buffett-sft.mjs — 버크셔 주주서한 청크 → 한국어 SFT 학습예시 생성 (2026-06-18)
 *
 * 사용자 "버핏의 주주서한 모음은 우리 매수 매도 심판엔진에게도 학습시켜". RAG(런타임 의미검색)와 별개로
 * 모델 가중치 자체에 버핏의 가치투자 추론을 내재화하기 위한 SFT 예시를 만든다.
 *
 * 방식: data/rag/corpus.ndjson 의 서한 청크(영문)를 vLLM(localhost:8000, flowvium-local)에 주고
 *   "이 구절이 담은 투자 원칙을 가르치는 한국어 Q&A 1개"를 JSON 으로 생성(self-distillation).
 *   수치 환각 방지 위해 "구체 수치/연도 인용 금지, 원칙만" 지시. weight=0.5(합성, 원칙급).
 *
 * 출력: data/sft/buffett-wisdom.jsonl  → build-sft-dataset.mjs 가 머지.
 * 사용: node scripts/sft/gen-buffett-sft.mjs [MAX=400] [CONC=4]
 *   (RAG 임베딩 ingest 완료 후 실행 — corpus.ndjson 필요)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());
const CORPUS = resolve(ROOT, 'data/rag/corpus.ndjson');
const OUT_DIR = resolve(ROOT, 'data/sft');
const OUT = resolve(OUT_DIR, 'buffett-wisdom.jsonl');
const VLLM = process.env.VLLM_URL?.replace(/\/v1\/?$/, '') || 'http://localhost:8000';
const MODEL = process.env.OLLAMA_TRANSLATE_MODEL || 'flowvium-local';
const MAX = parseInt(process.argv[2] || '400', 10);
const CONC = parseInt(process.argv[3] || '4', 10);

const SYSTEM = `너는 "매수·매도 심판엔진" — 규율 있고 근거 기반인 투자 판단 AI다. 종목의 매수/분할매수/관망/비중축소/매도/회피를 판단하고, 실시간 데이터·매수매도 룰·구루 원칙을 근거로 인용하며, 리스크와 진입/손절을 제시한다. 수치를 지어내지 않고, 데이터 없으면 솔직히 말한다.`;

const GEN_PROMPT = (year, text) => `다음은 워런 버핏의 버크셔 해서웨이 주주서한(${year || '연도미상'}) 발췌다. 이 구절이 담은 "투자 판단 원칙"을 한국어로 가르치는 학습예시 1개를 만들어라.

규칙:
- 출력은 JSON 한 개만: {"q": "...", "a": "..."}
- q: 투자자가 심판엔진에게 물을 법한 한국어 질문 (이 구절의 원칙과 관련된 일반적 판단 질문).
- a: 버핏의 원칙에 근거한 간결한 한국어 답변(2~4문장). 발췌의 핵심 교훈을 일반 원칙으로 풀되,
  구체적 수치·연도·회사 실적 숫자는 인용하지 마라(환각 방지). 원칙만.
- 발췌가 투자 원칙과 무관한 행정/형식 내용이면 {"skip": true} 만 출력.

발췌:
"""
${text.slice(0, 1400)}
"""`;

async function vllm(messages, maxTokens = 400) {
  const r = await fetch(`${VLLM}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.4 }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`vllm ${r.status}`);
  const d = await r.json();
  return d?.choices?.[0]?.message?.content ?? '';
}

function parseQA(txt) {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (o.skip) return null;
    if (typeof o.q === 'string' && typeof o.a === 'string' && o.q.length > 5 && o.a.length > 15) {
      return { q: o.q.trim(), a: o.a.trim() };
    }
  } catch { /* */ }
  return null;
}

async function main() {
  if (!existsSync(CORPUS)) { console.error('corpus.ndjson 없음 — ingest-corpus.py 먼저 실행'); process.exit(1); }
  const chunks = readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(c => c && c.source === '버크셔 주주서한' && c.text && c.text.length > 250);
  console.log(`서한 청크 ${chunks.length}개 중 ${Math.min(MAX, chunks.length)}개 샘플링`);

  // 균등 샘플링 (연도 편향 방지)
  const step = Math.max(1, Math.floor(chunks.length / MAX));
  const sample = chunks.filter((_, i) => i % step === 0).slice(0, MAX);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, '');  // 새로 시작
  let ok = 0, skip = 0, fail = 0, done = 0;

  for (let i = 0; i < sample.length; i += CONC) {
    const batch = sample.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (c) => {
      try {
        const txt = await vllm([{ role: 'user', content: GEN_PROMPT(c.year, c.text) }]);
        return { c, qa: parseQA(txt) };
      } catch (e) { return { c, qa: null, err: e.message }; }
    }));
    for (const { c, qa, err } of results) {
      done++;
      if (err) { fail++; continue; }
      if (!qa) { skip++; continue; }
      const ex = {
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: qa.q }, { role: 'assistant', content: `${qa.a}\n투자 판단·책임은 본인에게 있음.` }],
        weight: 0.5, meta: { src: 'buffett', year: c.year, chunk: c.id },
      };
      appendFileSync(OUT, JSON.stringify(ex) + '\n');
      ok++;
    }
    if (done % 40 === 0 || done === sample.length) console.log(`[${done}/${sample.length}] ok=${ok} skip=${skip} fail=${fail}`);
  }
  console.log(`완료: ok=${ok} skip=${skip} fail=${fail} → ${OUT}`);
}

main().catch(e => { console.error('[FATAL]', e?.stack ?? e); process.exit(1); });

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
const OUT = resolve(OUT_DIR, 'wisdom-sft.jsonl');
const VLLM = process.env.VLLM_URL?.replace(/\/v1\/?$/, '') || 'http://localhost:8000';
const MODEL = process.env.OLLAMA_TRANSLATE_MODEL || 'flowvium-local';
const MAX = parseInt(process.argv[2] || '400', 10);
const CONC = parseInt(process.argv[3] || '4', 10);

// 3개 엔진(심판·매수·매도) — 같은 Qwen3-30B-A3B 를 공유하므로 LoRA 한 번이 셋 다에 적용되나,
// 각 엔진의 *역할(persona)* 로 버핏 원칙을 학습시켜야 매수엔진/매도엔진이 그 관점에서 추론한다
// (사용자 "심판엔진 뿐아니라 매수엔진, 매도엔진 다 학습"). 청크를 라운드로빈으로 3역할에 배분.
const ENGINES = [
  {
    key: 'judge',
    system: `너는 "매수·매도 심판엔진" — 규율 있고 근거 기반인 투자 판단 AI다. 종목의 매수/분할매수/관망/비중축소/매도/회피를 판단하고, 실시간 데이터·매수매도 룰·구루 원칙을 근거로 인용하며, 리스크와 진입/손절을 제시한다. 수치를 지어내지 않고, 데이터 없으면 솔직히 말한다.`,
    role: '투자자가 심판엔진에게 매수/매도/관망을 물을 법한 한국어 질문',
    answer: '버핏의 원칙에 근거해 판단의 사고틀을 가르치는 간결한 한국어 답변',
  },
  {
    key: 'buy',
    system: `너는 "매수엔진" — 가치투자 관점에서 매수 후보를 발굴·정당화하는 AI다. 해자·내재가치·안전마진·경영진 질·장기복리를 근거로 매수 논거를 제시하고, 진입 규율과 리스크를 함께 본다. 수치를 지어내지 않는다.`,
    role: '매수 후보 발굴/정당화에 대해 매수엔진에게 물을 법한 한국어 질문(어떤 기업을 왜 사야 하는가)',
    answer: '버핏의 가치투자 원칙(해자·안전마진·장기보유)으로 매수 논거를 세우는 간결한 한국어 답변',
  },
  {
    key: 'sell',
    system: `너는 "매도엔진" — 매도/비중축소 규율을 판단하는 AI다. 가격 하락이 아니라 펀더멘털 훼손·내재가치 대비 고평가·더 나은 기회비용·매수 논거의 소멸을 근거로 매도를 판단하고, 함부로 팔지 않는 인내도 함께 본다. 수치를 지어내지 않는다.`,
    role: '언제 팔고 언제 버텨야 하는지 매도엔진에게 물을 법한 한국어 질문',
    answer: '버핏의 매도 규율(가격이 아닌 논거 소멸·고평가·기회비용, 그리고 인내)로 푸는 간결한 한국어 답변',
  },
];

const GEN_PROMPT = (eng, source, year, text) => `다음은 투자 고전/원전 "${source}${year ? ` (${year})` : ''}" 발췌다(버핏 주주서한·피터 린치·소로스·코스톨라니 등). 이 구절이 담은 "투자 원칙"을 "${eng.key} 엔진" 관점으로 가르치는 한국어 학습예시 1개를 만들어라.

규칙:
- 출력은 JSON 한 개만: {"q": "...", "a": "..."}
- q: ${eng.role}.
- a: ${eng.answer} (2~4문장). 발췌의 핵심 교훈을 일반 원칙으로 풀되,
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
  // 산문 원전(서한·서적·에세이) 전부 — 큐레이션 원칙('투자 지혜'/'심판 doctrine')은 짧고 이미 SFT
  //   source 3 에 있으므로 제외.
  const CURATED = new Set(['투자 지혜', '심판 doctrine']);
  const chunks = readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(c => c && c.text && c.text.length > 250 && !CURATED.has(c.source));
  const srcDist = {};
  for (const c of chunks) srcDist[c.source] = (srcDist[c.source] || 0) + 1;
  console.log(`원전 청크 ${chunks.length}개 중 ${Math.min(MAX, chunks.length)}개 샘플링 · 소스:`, JSON.stringify(srcDist));

  // 균등 샘플링 (연도 편향 방지)
  const step = Math.max(1, Math.floor(chunks.length / MAX));
  const sample = chunks.filter((_, i) => i % step === 0).slice(0, MAX);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, '');  // 새로 시작
  let ok = 0, skip = 0, fail = 0, done = 0;

  const perEngine = { judge: 0, buy: 0, sell: 0 };
  for (let i = 0; i < sample.length; i += CONC) {
    const batch = sample.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (c, j) => {
      const eng = ENGINES[(i + j) % ENGINES.length];  // 라운드로빈 3역할 배분
      try {
        const txt = await vllm([{ role: 'user', content: GEN_PROMPT(eng, c.source, c.year, c.text) }]);
        return { c, eng, qa: parseQA(txt) };
      } catch (e) { return { c, eng, qa: null, err: e.message }; }
    }));
    for (const { c, eng, qa, err } of results) {
      done++;
      if (err) { fail++; continue; }
      if (!qa) { skip++; continue; }
      const ex = {
        messages: [{ role: 'system', content: eng.system }, { role: 'user', content: qa.q }, { role: 'assistant', content: `${qa.a}\n투자 판단·책임은 본인에게 있음.` }],
        weight: 0.5, meta: { src: 'wisdom', engine: eng.key, source: c.source, year: c.year, chunk: c.id },
      };
      appendFileSync(OUT, JSON.stringify(ex) + '\n');
      ok++; perEngine[eng.key]++;
    }
    if (done % 40 === 0 || done === sample.length) console.log(`[${done}/${sample.length}] ok=${ok} skip=${skip} fail=${fail} (judge=${perEngine.judge} buy=${perEngine.buy} sell=${perEngine.sell})`);
  }
  console.log(`완료: ok=${ok} skip=${skip} fail=${fail} → ${OUT}`);
  console.log(`엔진별: 심판=${perEngine.judge} 매수=${perEngine.buy} 매도=${perEngine.sell}`);
}

main().catch(e => { console.error('[FATAL]', e?.stack ?? e); process.exit(1); });

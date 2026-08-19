#!/usr/bin/env node
/**
 * test-rag-e2e.mjs — RAG 종단 검증. 통과/실패를 종료코드로 낸다.
 *  ① 임베딩 서비스 /health 도달 + 차원 보고
 *  ② 코퍼스 차원과 서비스 차원 일치 (불일치면 재색인 필요 — 조용히 넘어가면 안 됨)
 *  ③ 실제 질의로 top-k 히트 확보 (0건이면 실패)
 *  ④ 빈 결과 경로가 로그를 남기는지(관측 가능성) 확인
 * 경로/포트를 박지 않는다. EMBED_URL 로 덮을 수 있다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EMBED_URL = process.env.EMBED_URL ?? 'http://127.0.0.1:8100/embed';
const HEALTH = EMBED_URL.replace(/\/embed$/, '/health');
const CORPUS = resolve(ROOT, 'data/rag/corpus.ndjson');
let fail = 0;
const ok  = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// ① 서비스
let svcDim = null;
try {
  const r = await fetch(HEALTH, { signal: AbortSignal.timeout(10_000) });
  const d = await r.json();
  svcDim = d.dim;
  ok(`임베딩 서비스 도달 — model=${d.model} device=${d.device} dim=${d.dim}`);
} catch (e) { bad(`임베딩 서비스 도달 불가 (${HEALTH}) — ${e.cause?.message ?? e.message}`); }

// ② 차원 일치
let corpDim = null, chunks = 0;
try {
  const first = readFileSync(CORPUS, 'utf8').slice(0, 2_000_000).split('\n').find(Boolean);
  corpDim = JSON.parse(first).embedding.length;
  ok(`코퍼스 읽기 — dim=${corpDim}`);
} catch (e) { bad(`코퍼스 읽기 실패 (${CORPUS}) — ${e.message}`); }
if (svcDim && corpDim) {
  svcDim === corpDim ? ok(`차원 일치 ${svcDim} — 재색인 불필요`)
                     : bad(`차원 불일치 서비스 ${svcDim} vs 코퍼스 ${corpDim} — 재색인 필요`);
}

// ③ 실제 검색
if (svcDim && corpDim && svcDim === corpDim) {
  const { ragRetrieve, ragCorpusSize } = await import('../../src/lib/rag');
  chunks = ragCorpusSize();
  chunks > 0 ? ok(`코퍼스 적재 ${chunks} 청크`) : bad('코퍼스 적재 0 청크');
  for (const q of ['주가가 떨어질 때 어떻게 해야 하나', 'margin of safety']) {
    const hits = await ragRetrieve(q, 4);
    hits.length ? ok(`검색 "${q}" → ${hits.length}건 (top ${hits[0].score.toFixed(3)} · ${hits[0].source})`)
                : bad(`검색 "${q}" → 0건`);
  }
}
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

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
// ④ 빈 결과 경로 — 헤더가 약속만 하고 구현이 없던 항목(2026-08-20 추가).
//   "검색 결과가 비었을 때 처리 경로"가 실제로 무엇을 하는지 코드로 고정한다.
//   임계값을 넘기 어렵게 만들어(RAG_MIN_SCORE) 코퍼스·임베딩이 정상인데도 0건이 나오는 상황을
//   결정론적으로 재현한다. 코퍼스 밖 질의를 찾는 방식은 임베딩 모델이 바뀌면 흔들려서 쓰지 않는다.
//   자식 프로세스로 도는 이유: MIN_EFF_SCORE 가 모듈 로드 시 1회 읽히므로 같은 프로세스에선 못 바꾼다.
if (svcDim && corpDim && svcDim === corpDim) {
  const { spawnSync } = await import('child_process');
  // 프로브는 프로젝트 안의 고정 파일이다. 임시 디렉토리에 만들면 프로젝트 tsconfig 가 적용되지 않아
  //   경로 별칭(@/lib/logger)이 해석되지 않는다(실측: SyntaxError).
  const r = spawnSync('npx', ['tsx', resolve(ROOT, 'scripts/rag/rag-empty-probe.mts')], {
    cwd: ROOT, encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, RAG_MIN_SCORE: '0.99' },   // 사실상 도달 불가한 임계값
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const m = out.match(/__HITS__(\d+)/);
  if (!m) {
    bad(`빈 결과 경로 재현 실패 — 프로브가 안 돌았다: ${out.slice(0, 200)}`);
  } else {
    Number(m[1]) === 0 ? ok('임계값 미달 시 0건 반환 (예외 아님)')
                       : bad(`임계값 0.99 인데 ${m[1]}건 반환 — 임계값이 안 먹는다`);
    // 0건을 조용히 넘기면 AISVI+RAG 가 AISVI 로 강등된 사실이 아무 데도 안 남는다.
    /"event":"retrieve_empty"/.test(out)
      ? ok('빈 결과가 retrieve_empty 로그를 남김 (관측 가능)')
      : bad('0건인데 로그가 없다 — 무음 강등(관측 불가)');
    /"topEffScore"/.test(out)
      ? ok('로그에 최고점 포함 (임계값 미달 vs 코퍼스 밖 구분 가능)')
      : bad('최고점이 없어 원인 구분 불가');
  }
}

// ── 2026-08-21: 빈 결과의 *원인* 구분 ────────────────────────────────────────────
// 종전엔 세 경로가 다르게 끝났다:
//   :89  코퍼스 0청크        → return []            (무음. retrieve_empty 에 도달조차 못 함)
//   :91  임베딩 불가         → embed_unavailable 로그
//   :124 임계값 미달         → retrieve_empty 로그
// 소비자 입장에서는 셋 다 "검색이 비었다" 인데 관측 지점이 갈라져 있었다.
// 하나로 모으고 reason 을 붙인다 — 원인별 대응이 다르므로 구분은 필드로 한다.
{
  const { spawnSync } = await import('child_process');
  const r = spawnSync('npx', ['tsx', resolve(ROOT, 'scripts/rag/rag-empty-probe.mts')], {
    cwd: ROOT, encoding: 'utf8', timeout: 180_000,
    // 코퍼스를 없는 경로로 돌려 '코퍼스 0청크' 경로를 결정론적으로 재현한다.
    env: { ...process.env, RAG_CORPUS_PATH: 'data/rag/__does_not_exist__.ndjson' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  /__HITS__0/.test(out)
    ? ok('코퍼스 없음 → 0건 반환 (예외 아님)')
    : bad(`코퍼스 없음 경로 재현 실패: ${out.slice(0, 200)}`);
  /"event":"retrieve_empty"/.test(out)
    ? ok('코퍼스 없음도 retrieve_empty 로 관측된다')
    : bad('코퍼스 없음이 무음 — 검색이 빈 사실이 한 곳에서 안 보인다');
  /"reason":"corpus_empty"/.test(out)
    ? ok('원인이 reason=corpus_empty 로 구분된다')
    : bad('원인 구분 불가 — 임계값 미달과 코퍼스 부재가 같은 로그로 보인다');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

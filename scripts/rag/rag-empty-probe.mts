#!/usr/bin/env npx tsx
/**
 * rag-empty-probe.mts — 빈 검색 결과 경로를 결정론적으로 재현하는 프로브.
 *
 * test-rag-e2e.mts 가 자식 프로세스로 부른다. 별도 프로세스인 이유:
 *   src/lib/rag.ts 의 MIN_EFF_SCORE 가 모듈 로드 시 1회만 읽히므로(rag.ts:19)
 *   같은 프로세스 안에서는 임계값을 바꿔 재현할 수 없다.
 *
 * 코퍼스 밖 질의를 찾는 방식은 임베딩 모델이 바뀌면 흔들리므로 쓰지 않는다.
 * 대신 임계값을 도달 불가하게 올려(RAG_MIN_SCORE), 코퍼스·임베딩이 모두 정상인데도
 * 0건이 나오는 상황을 만든다 — 이게 관측되어야 할 '무음 강등' 지점이다.
 */
// 정적 import 는 tsx 의 CJS 상호운용에 걸려 named export 를 못 찾는다(실측: SyntaxError).
// 같은 파일의 ③번 검사가 쓰는 동적 import 형태로 맞춘다.
const mod = await import('../../src/lib/rag');
const ragRetrieve = (mod as any).ragRetrieve ?? (mod as any).default?.ragRetrieve;
if (typeof ragRetrieve !== 'function') {
  console.error('__PROBE_ERR__ ragRetrieve 를 찾지 못함: ' + JSON.stringify(Object.keys(mod)));
  process.exit(2);
}

const hits = await ragRetrieve(process.env.RAG_PROBE_QUERY ?? '안전마진', 4);
console.log(`__HITS__${hits.length}`);

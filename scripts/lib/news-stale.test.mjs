#!/usr/bin/env node
/**
 * news-stale.test.mjs — 뉴스 라우트에 stale 폴백이 있는지 검증.
 *
 * 배경(2026-08-20 실측): 한국어 사용자의 첫 방문이 영문이다.
 *   news-cascade/route.ts 흐름:
 *     :851  translatedKey 캐시 hit → 번역본 ✅
 *     :905  영문 캐시만 있고 wait 미지정 → 영문 즉시 반환 + 배경 번역  ← 여기
 *     :1106 캐시 없음 → 신규 수집 후 영문 반환
 *   translatedKey TTL 6h · listKey TTL 4h 이므로 하루 여러 번 이 창이 열린다.
 *   의도는 '30초 동기 대기 회피'(:904 주석)지만, 한국어 독자에게는
 *   '조금 지난 한국어'가 '방금 만든 영어'보다 낫다.
 *
 *   이 저장소는 이미 같은 문제를 stale 키로 푼다 —
 *     investment-strategy(:48) · company-news(:33) · flow-analysis(:37) · tic-flows · fund-flows
 *   news-cascade 만 빠져 있다. 새 패턴을 발명하는 게 아니라 있는 패턴을 적용한다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const src = readFileSync(resolve(ROOT, 'src/app/api/news-cascade/route.ts'), 'utf8');

// ① stale 키가 정의돼 있는가 (다른 라우트와 동일 관습)
/staleTranslatedKey|:stale:/.test(src)
  ? ok('stale 키 정의됨') : bad('stale 키 없음 — 다른 5개 라우트에는 있다');

// ② 번역 성공 시 stale 에도 기록하는가
/staleTranslatedKey\([^)]*\),\s*translated/.test(src) || /loggedRedisSet\([^)]*staleTranslated/.test(src)
  ? ok('번역 성공 시 stale 기록') : bad('stale 기록 없음 — 폴백할 데이터가 안 쌓인다');

// ③ 영문 반환 직전에 stale 을 먼저 보는가
const idx = src.indexOf("source: 'cached-en'");
const before = idx > 0 ? src.slice(Math.max(0, idx - 1800), idx) : '';
/staleTranslatedKey/.test(before)
  ? ok('영문 반환 전에 stale 조회') : bad('영문을 바로 반환 — stale 한국어가 있어도 안 쓴다');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

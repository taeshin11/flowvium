#!/usr/bin/env node
/**
 * news-cache-keys.test.mjs — 뉴스 캐시 키를 쓰는 쪽과 읽는 쪽이 어긋나지 않는가.
 *
 * 배경(2026-08-20 실측): 한국어 홈에 영문 뉴스 헤드라인이 나왔다.
 *   Redis 를 보니 한국어 번역본은 멀쩡히 있었다:
 *     flowvium:news-cascade:v2:translated:ko:2026-08-20 → "코스피 매수 사이드카 발동…" ✅
 *   그런데 읽는 쪽이 v1 을 봤다:
 *     latest-updates/route.ts:288  `flowvium:news-cascade:v1:translated:${locale}:${today}`
 *   → 항상 미스 → 영어 리스트 캐시로 폴백 → 한국어 페이지에 영문.
 *
 *   news-cascade 가 v1→v2 로 올린 건 fd893795(5월)인데 latest-updates 는 안 따라왔다.
 *   문자열을 양쪽에 각각 적어두면 한쪽만 고쳐도 아무 신호가 없다 — 캐시 미스는 조용하다.
 *   (이번 세션의 내 커밋 66075797 이 "홈 영문 노출 제거"였는데 이 근본을 못 짚었다.)
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let K;
try { K = await import('./news-cache-keys.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const DAY = '2026-08-20';
K.listKey(DAY) === 'flowvium:news-cascade:v1:list:2026-08-20'
  ? ok(`listKey: ${K.listKey(DAY)}`) : bad(`listKey 다름: ${K.listKey(DAY)}`);
K.translatedKey('ko', DAY) === 'flowvium:news-cascade:v2:translated:ko:2026-08-20'
  ? ok(`translatedKey: ${K.translatedKey('ko', DAY)}`) : bad(`translatedKey 다름: ${K.translatedKey('ko', DAY)}`);
K.staleTranslatedKey('ko') === 'flowvium:news-cascade:v2:translated:stale:ko'
  ? ok(`staleTranslatedKey: ${K.staleTranslatedKey('ko')}`) : bad(`stale 키 다름: ${K.staleTranslatedKey('ko')}`);

// stale 키에는 날짜가 없어야 한다 — 자정에 끊기면 폴백이 성립하지 않는다
!/\d{4}-\d{2}-\d{2}/.test(K.staleTranslatedKey('ko')) ? ok('stale 키에 날짜 없음') : bad('stale 키에 날짜가 들어감');
// 날짜 미지정이면 오늘(UTC) 로
/\d{4}-\d{2}-\d{2}$/.test(K.translatedKey('ko')) ? ok('날짜 생략 시 오늘로 채움') : bad('기본 날짜 처리 이상');
// 로케일 분리
K.translatedKey('ja', DAY) !== K.translatedKey('ko', DAY) ? ok('로케일 분리') : bad('로케일이 섞임');

// ── 핵심: 실제 소스 파일들이 이 모듈을 쓰는가 (문자열 재기입 금지) ──
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const f of ['src/app/api/news-cascade/route.ts', 'src/app/api/latest-updates/route.ts']) {
  let src = '';
  try { src = readFileSync(resolve(ROOT, f), 'utf8'); } catch { bad(`${f} 읽기 실패`); continue; }
  const literals = [...src.matchAll(/['"`]flowvium:news-cascade:v\d+:(translated|list)[^'"`]*/g)].map(m => m[0]);
  literals.length === 0
    ? ok(`${f.split('/').slice(-2).join('/')}: 키 문자열 직접 기입 없음`)
    : bad(`${f}: 키를 직접 적음 ${JSON.stringify(literals.slice(0, 2))} — 드리프트 재발 지점`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

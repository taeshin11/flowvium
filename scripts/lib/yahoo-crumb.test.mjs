#!/usr/bin/env node
/**
 * yahoo-crumb.test.mjs — Yahoo crumb 획득이 실패 응답을 crumb 으로 착각하지 않는가.
 *
 * 사건(2026-08-22): pre-push 의 audit-data-sources 가 `Yahoo v7 quote 401` 로 push 를 막았다.
 *   실측 프로브:
 *     fc.yahoo status: 404   (쿠키는 정상 발급 — 이건 원래 그렇다)
 *     getcrumb status: 429   body="Too Many Requests\r\n"
 *     v7 quote  status: 401
 *   generate-report-local.mjs:1574 의 가드는
 *       if (!cr.crumb || cr.crumb.length > 30) return out;
 *   **길이만** 본다. "Too Many Requests\r\n" 는 19자라 통과한다.
 *   그 문자열이 crumb 파라미터로 들어가 401 을 받는다.
 *
 * 두 겹의 결함:
 *   ① 응답 status 를 아무도 안 본다 — 같은 코드가 6개 스크립트에 복제돼 있고 6곳 모두 그렇다
 *      (generate-report-local / audit-data-sources / build-candidate-tickers /
 *       snapshot-etf-so / build-company-profiles / enrich-sectors)
 *   ② 실패값이 _yCrumb 에 캐시된다 — 한 번 429 를 맞으면 그 프로세스는 끝까지 Yahoo 가격 0건.
 *      보고서 실행 전체가 조용히 가격 없이 진행된다.
 *
 * 429 자체도 자초한 것이다: 프로세스마다 따로 getcrumb 을 친다. 크럼은 쿠키에 묶인
 *   재사용 가능한 값이므로 디스크에 캐시해 호출 자체를 줄인다. (재시도로 덮는 게 아니라
 *   호출 횟수를 줄이는 것 — 원인 쪽 수정이다.)
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, rmSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./yahoo-crumb.mjs')
  .catch((e) => { bad(`yahoo-crumb.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// [1] 실제로 받은 실패 본문들을 crumb 으로 받아들이면 안 된다
for (const junk of ['Too Many Requests\r\n', 'Too Many Requests', '', '   ', 'Unauthorized\n',
                    '<!DOCTYPE html><html>', 'Edge: too many requests']) {
  M.isValidCrumb(junk)
    ? bad(`실패 본문을 crumb 으로 받아들인다: ${JSON.stringify(junk).slice(0,32)}`)
    : ok(`거부: ${JSON.stringify(junk).slice(0,32)}`);
}
// [2] 진짜 crumb 모양은 통과해야 한다 (과잉 차단 방지)
for (const good of ['Edge.LK2c9Ry', '9d0Y0zJ.PL7', 'hLPPnfM/FDG', 'a1b2c3d4e5f', 'A.b\\u002Fc']) {
  M.isValidCrumb(good) ? ok(`허용: ${good}`) : bad(`정상 crumb 을 거부한다: ${good}`);
}

// [3] 실패는 캐시되지 않는다 — 한 번의 429 가 프로세스 전체를 죽이면 안 된다
{
  const cache = resolve(ROOT, 'logs/.crumb-test.json');
  if (existsSync(cache)) rmSync(cache);
  let calls = 0;
  const failingFetch = async () => { calls++; return { ok: false, status: 429, text: async () => 'Too Many Requests\r\n', headers: { getSetCookie: () => ['A=1; Path=/'] } }; };
  const a = await M.getYahooCrumb({ cacheFile: cache, fetchImpl: failingFetch });
  const b = await M.getYahooCrumb({ cacheFile: cache, fetchImpl: failingFetch });
  a === null && b === null ? ok('429 면 crumb 없음(null) 을 반환') : bad(`실패인데 crumb 을 반환: ${JSON.stringify(a)}`);
  !existsSync(cache) ? ok('실패값을 디스크에 캐시하지 않는다') : bad('실패값이 디스크 캐시에 남았다');
  calls >= 4 ? ok('실패 후 다음 호출이 다시 시도한다(메모리에 실패 고착 없음)') : bad(`실패가 캐시돼 재시도가 없다 (fetch ${calls}회)`);
  if (existsSync(cache)) rmSync(cache);
}

// [4] 성공은 캐시된다 — 프로세스마다 getcrumb 을 치는 게 429 의 원인이었다
{
  const cache = resolve(ROOT, 'logs/.crumb-test2.json');
  if (existsSync(cache)) rmSync(cache);
  let calls = 0;
  const okFetch = async (url) => { calls++; return {
    ok: true, status: 200,
    text: async () => (String(url).includes('getcrumb') ? 'Edge.LK2c9Ry' : ''),
    headers: { getSetCookie: () => ['A=1; Path=/'] } }; };
  const a = await M.getYahooCrumb({ cacheFile: cache, fetchImpl: okFetch });
  const before = calls;
  const b = await M.getYahooCrumb({ cacheFile: cache, fetchImpl: okFetch, freshMemory: true });
  a?.crumb === 'Edge.LK2c9Ry' ? ok('정상 crumb 획득') : bad(`crumb 획득 실패: ${JSON.stringify(a)}`);
  existsSync(cache) ? ok('성공값은 디스크에 캐시된다') : bad('성공인데 디스크 캐시가 없다');
  calls === before && b?.crumb === a?.crumb ? ok('두 번째 호출은 네트워크를 치지 않는다') : bad(`디스크 캐시가 재사용되지 않는다 (fetch ${calls}회)`);
  rmSync(cache, { force: true });
}

// [5] 6개 복제본이 이 모듈을 쓰는가 — 한 곳만 고치면 나머지 5곳이 같은 401 을 낸다
const USERS = ['scripts/generate-report-local.mjs', 'scripts/audit-data-sources.mjs',
               'scripts/build-candidate-tickers.mjs', 'scripts/snapshot-etf-so.mjs',
               'scripts/build-company-profiles.mjs', 'scripts/enrich-sectors.mjs'];
for (const f of USERS) {
  const src = readFileSync(resolve(ROOT, f), 'utf8').split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const inline = /v1\/test\/getcrumb/.test(src);
  const uses   = /yahoo-crumb\.mjs/.test(src);
  uses && !inline ? ok(`${f.replace('scripts/','')} 단일 출처 사용`)
                  : bad(`${f.replace('scripts/','')} 아직 자체 getcrumb 구현 (inline=${inline} uses=${uses})`);
}

console.log(fail === 0 ? '\n✅ yahoo-crumb 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

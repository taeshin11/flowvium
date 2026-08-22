/**
 * yahoo-crumb.mjs — Yahoo Finance v7 quote 용 crumb/cookie 단일 출처.
 *
 * 2026-08-22: 같은 crumb 획득 코드가 6개 스크립트에 복제돼 있었고, 6곳 모두
 *   getcrumb 응답의 **status 를 보지 않았다**. Yahoo 가 429 를 주면 본문
 *   "Too Many Requests\r\n"(19자) 가 그대로 crumb 이 되어 v7 quote 가 401 을 냈다.
 *   generate-report-local.mjs 의 가드는 `crumb.length > 30` 이라 19자를 통과시켰다.
 *   게다가 실패값이 프로세스 캐시(_yCrumb)에 박혀, 한 번 429 를 맞으면 그 보고서 실행은
 *   끝까지 Yahoo 가격 0건으로 조용히 진행됐다.
 *
 * 429 는 자초한 면이 크다 — 프로세스마다 fc.yahoo + getcrumb 왕복을 따로 했다.
 *   crumb 은 쿠키에 묶인 재사용 가능한 값이므로 디스크에 캐시해 호출 횟수 자체를 줄인다.
 *   (증상을 재시도로 덮는 게 아니라 호출 빈도라는 원인을 줄이는 것.)
 *
 * 실패 시 null 을 돌려준다 — 호출부는 이미 fallback 경로를 갖고 있다.
 * 삼키지 않는다: 왜 실패했는지 onWarn 으로 올린다.
 */
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_CACHE = resolve(ROOT, 'logs/yahoo-crumb.json');
const TTL_MS = 6 * 60 * 60 * 1000;   // 쿠키 수명보다 짧게. 만료 전에 401 이 나면 invalidate 로 즉시 버린다.
/**
 * crumb/쿠키는 이걸 발급받을 때 쓴 User-Agent 에 묶인다. 호출부가 제각각 다른 UA 로
 * 요청하면 같은 crumb 이어도 401 이 난다 — 그래서 UA 도 함께 돌려주고 호출부는 그걸 쓴다.
 */
export const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const UA = { 'User-Agent': YAHOO_UA };

/**
 * 진짜 crumb 인지. Yahoo crumb 은 공백 없는 짧은 토큰(보통 11자 안팎, `.`/`/`/`\` 이스케이프 포함).
 * 에러 본문("Too Many Requests", "Unauthorized", HTML)은 공백이나 `<` 를 반드시 포함한다.
 */
export function isValidCrumb(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 5 || t.length > 30) return false;
  if (t !== s) return false;              // 앞뒤 공백/개행 = 본문이지 토큰이 아니다
  if (/\s/.test(t)) return false;         // "Too Many Requests"
  if (/[<>{}"']/.test(t)) return false;   // HTML/JSON 오류 페이지
  return /^[A-Za-z0-9._\-/\\+=:~]+$/.test(t);
}

let _mem = null;

function readCache(file) {
  try {
    if (!existsSync(file)) return null;
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (!j?.crumb || !j?.cookie || !j?.at) return null;
    if (j.ua !== YAHOO_UA) return null;   // UA 가 바뀌면 그 crumb 은 더 이상 유효하지 않다
    if (Date.now() - j.at > TTL_MS) return null;
    if (!isValidCrumb(j.crumb)) return null;
    return { crumb: j.crumb, cookie: j.cookie, ua: YAHOO_UA };
  } catch { return null; }
}

function writeCache(file, v) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    // 세션 쿠키가 들어간다 — 소유자만 읽게 하고 .gitignore 에도 올려 둔다.
    writeFileSync(file, JSON.stringify({ ...v, at: Date.now() }), { mode: 0o600 });
  } catch { /* 캐시 실패는 치명적이지 않다 — 다음 호출이 다시 받는다 */ }
}

/** v7 quote 가 401 을 주면 crumb 이 죽은 것이다. 메모리·디스크 양쪽을 버린다. */
export function invalidateCrumb(cacheFile = DEFAULT_CACHE) {
  _mem = null;
  try { rmSync(cacheFile, { force: true }); } catch { /* noop */ }
}

/**
 * @param {{cacheFile?:string, fetchImpl?:Function, onWarn?:Function, freshMemory?:boolean}} opts
 * @returns {Promise<{crumb:string,cookie:string,ua:string}|null>} 실패면 null (호출부 fallback 로).
 */
export async function getYahooCrumb(opts = {}) {
  const { cacheFile = DEFAULT_CACHE, fetchImpl = fetch, onWarn = (m) => console.warn(`  [yahoo-crumb] ${m}`) } = opts;
  if (opts.freshMemory) _mem = null;
  if (_mem) return _mem;
  const cached = readCache(cacheFile);
  if (cached) { _mem = cached; return _mem; }

  let cookie = '';
  try {
    const r = await fetchImpl('https://fc.yahoo.com', { headers: UA, signal: AbortSignal.timeout(8000) });
    // fc.yahoo.com 은 404 를 주면서 Set-Cookie 를 준다 — status 는 여기선 신호가 아니다.
    cookie = (r.headers?.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  } catch (e) {
    onWarn(`쿠키 획득 실패: ${e.message}`);
    return null;
  }
  if (!cookie) { onWarn('Set-Cookie 없음'); return null; }

  let crumb = null, status = 0;
  try {
    const cr = await fetchImpl('https://query1.finance.yahoo.com/v1/test/getcrumb',
      { headers: { ...UA, Cookie: cookie }, signal: AbortSignal.timeout(8000) });
    status = cr.status;
    // status 를 본다 — 이걸 안 봐서 "Too Many Requests" 가 crumb 이 됐다.
    if (!cr.ok) { onWarn(`getcrumb HTTP ${status} — crumb 없이 진행(호출부 fallback)`); return null; }
    crumb = await cr.text();
  } catch (e) {
    onWarn(`getcrumb 실패: ${e.message}`);
    return null;
  }
  if (!isValidCrumb(crumb)) {
    onWarn(`crumb 모양이 아님(HTTP ${status}): ${JSON.stringify(String(crumb).slice(0, 40))}`);
    return null;
  }
  _mem = { crumb, cookie, ua: YAHOO_UA };
  writeCache(cacheFile, _mem);
  return _mem;
}

/**
 * i18n-keys.mjs — messages/*.json 의 키를 안전하게 읽고 쓴다.
 *
 * 배경(2026-08-20): i18n 래칫 baseline 이 2,781건이다. 분석해 보니 1,491건(54%)은
 *   src/app/api 의 로그 태그·프롬프트라 사용자에게 안 보이고, 실제 UI 부채는
 *   src/components/pages(594) + src/app/[locale](511) 쪽이다.
 *   그걸 줄이려면 키를 16개 로케일에 일관되게 넣어야 하는데, 손으로 하면 꼭 한둘을 빠뜨린다.
 *   빠뜨린 로케일은 런타임에 MISSING_MESSAGE 로 깨진다 —
 *   이번 세션에 home.featureCards.companyComparator 로 실제로 겪었다.
 *
 * 파일 포맷(들여쓰기 2 + 끝 개행)을 유지한다. 안 그러면 16개 파일이 통째로 diff 에 뜬다.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/** messages 디렉토리의 로케일 코드들. */
export function listLocales(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  } catch { return []; }
}

/** 점 경로로 값 읽기. 없으면 undefined. */
export function getKey(obj, path) {
  let cur = obj;
  for (const seg of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

const load = (dir, locale) => JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8'));
const save = (dir, locale, obj) => writeFileSync(join(dir, `${locale}.json`), JSON.stringify(obj, null, 2) + '\n', 'utf8');

/** 점 경로에 값 쓰기. 중간 경로는 만들고, 기존 키는 건드리지 않는다. */
export function setKey(dir, locale, path, value) {
  const p = join(dir, `${locale}.json`);
  if (!existsSync(p)) return false;
  const obj = load(dir, locale);
  const segs = String(path).split('.');
  let cur = obj;
  for (const seg of segs.slice(0, -1)) {
    if (cur[seg] == null || typeof cur[seg] !== 'object') cur[seg] = {};
    cur = cur[seg];
  }
  cur[segs.at(-1)] = value;
  save(dir, locale, obj);
  return true;
}

/** 이 키가 없는 로케일들. 비어 있지 않으면 그 로케일은 런타임에 깨진다. */
export function missingLocales(dir, path) {
  return listLocales(dir).filter((loc) => {
    try { return getKey(load(dir, loc), path) === undefined; } catch { return true; }
  });
}

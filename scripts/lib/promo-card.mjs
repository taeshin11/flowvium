/**
 * promo-card.mjs — 쇼츠 끝 2초 광고 고르기(aisvi / flowvium, 네 편씩 번갈아). 근거는 promo-card.test.mjs 머리말.
 */
import { existsSync } from 'fs';
import { join } from 'path';

export const PROMO_FILES = { aisvi: 'assets/outro/aisvi-card.mp4', flowvium: 'assets/outro/flowvium-card.mp4' };
/** 2026-10-31 사장님(Mac mini2 경유): 한국어 AISVI 광고 교체 — 카톡 무료체험 v16 짧은 판(2.5초, ots-9e 가 자른 공용 파일)에
 *  무음 소리 길을 붙여 본편 규격으로 다시 감싼 것. 있으면 aisvi 자리는 판(a/b/c)과 상관없이 이것(판 기호는 설명란 utm_content 용으로 유지). */
export const AISVI_SHORT_AD = 'assets/outro/aisvi-ad-kakao-v16.mp4';
export const promoFor = (seed) => (Math.floor(Math.abs(Math.trunc(Number(seed) || 0)) / 4) % 2 === 0 ? 'aisvi' : 'flowvium');

/** 원하는 광고 파일. 없으면 다른 쪽으로 대신한다. @returns {{name:string|null, path:string|null, fallback:boolean}} */
export function promoPath(want, root, { version = null } = {}) {
  if (want === 'none') return { name: null, path: null, fallback: false };   // 2026-10-17 IG 릴스 — 끝 카드를 아예 뺀다
  // 2026-10-28 AISVI 광고 새 판(lib/ad-line) — 판 파일(make-outro-clip --card --version)이 있으면 그 판. 없으면 아래 옛 카드.
  if (want === 'aisvi') {
    const p = join(root, AISVI_SHORT_AD);
    if (existsSync(p)) return { name: 'aisvi', path: p, fallback: false, version };
  }
  if (want === 'aisvi' && version) {
    const p = join(root, `assets/outro/aisvi-card-${version}.mp4`);
    if (existsSync(p)) return { name: 'aisvi', path: p, fallback: false, version };
  }
  const order = [want, ...Object.keys(PROMO_FILES).filter((k) => k !== want)].filter((k) => PROMO_FILES[k]);
  for (const k of order) {
    const p = join(root, PROMO_FILES[k]);
    if (existsSync(p)) return { name: k, path: p, fallback: k !== want };
  }
  return { name: null, path: null, fallback: false };
}

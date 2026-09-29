/**
 * promo-card.mjs — 쇼츠 끝 2초 광고 고르기(aisvi / flowvium, 네 편씩 번갈아). 근거는 promo-card.test.mjs 머리말.
 */
import { existsSync } from 'fs';
import { join } from 'path';

export const PROMO_FILES = { aisvi: 'assets/outro/aisvi-card.mp4', flowvium: 'assets/outro/flowvium-card.mp4' };
export const promoFor = (seed) => (Math.floor(Math.abs(Math.trunc(Number(seed) || 0)) / 4) % 2 === 0 ? 'aisvi' : 'flowvium');

/** 원하는 광고 파일. 없으면 다른 쪽으로 대신한다. @returns {{name:string|null, path:string|null, fallback:boolean}} */
export function promoPath(want, root) {
  const order = [want, ...Object.keys(PROMO_FILES).filter((k) => k !== want)].filter((k) => PROMO_FILES[k]);
  for (const k of order) {
    const p = join(root, PROMO_FILES[k]);
    if (existsSync(p)) return { name: k, path: p, fallback: k !== want };
  }
  return { name: null, path: null, fallback: false };
}

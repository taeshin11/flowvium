/**
 * blog-quality.mjs — 저품질로 걸릴 글을 발행 전에 막는다. (2026-09-18 신설)
 *
 * 사용자: "블로그도 저품질 블로그로 걸리면 안 된다".
 *
 * 저품질 판정의 실체는 대체로 세 가지다 — **얇음 · 중복 · 광고 비중**.
 *   우리 글은 광고 블록이 매 편 똑같으므로, 길이를 잴 때 그걸 빼고 재야 한다.
 *   안 그러면 본문 두 줄짜리 글도 "1,200자" 로 통과한다.
 *
 * 중복은 **이미 올린 글과 겹치는 정도**로 본다. 같은 소재를 다시 쓰면 서로를 갉아먹고,
 *   검색 엔진은 그걸 대량 생산의 표시로 읽는다.
 */

import { OPENER_PATTERNS } from './blog-openers.mjs';

/** 광고·고지 등 매 편 같은 덩어리. 길이와 중복을 잴 때 뺀다. */
const BOILER = [
  /^###?\s*(매일 5회|이 정리는 어디서|1분 영상|채널|매일 5회, 시장).*$/gm,
  /flowvium\.net[^\n]*/gi,
  /https?:\/\/[^\s)]+/g,
  /^>\s*투자 판단과[^\n]*$/gm,
  /^\s*-\s*(최근 영상|채널):[^\n]*$/gm,
  /👉[^\n]*/g,
  /^---+$/gm,
  // 매 글이 같은 문장으로 시작하면 그 자체가 중복 신호다. 재는 데서 빼고,
  //   생성 쪽(make-blog-post)도 날짜에 따라 도입부를 바꾸게 했다.
  /^[^\n]*정리한 시장 기록입니다[^\n]*$/gm,
  /^[^\n]*순서대로 적었습니다[^\n]*$/gm,
  /^[^\n]*영상으로 먼저 올렸고[^\n]*$/gm,
  ...OPENER_PATTERNS,
  /좋은 얘기만 적으면 읽을 값어치가 없으니[^\n]*/g,
];

/** 글에서 **우리가 쓴 알맹이**만 남긴다. */
export function originalText(md) {
  let t = String(md ?? '');
  for (const re of BOILER) t = t.replace(re, ' ');
  return t.replace(/^#.*$/gm, ' ')        // 제목·소제목
    .replace(/[*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 두 글의 겹침 정도(0~1). n-gram 조각을 집합으로 보고 작은 쪽 기준으로 잰다.
 *
 * 왜 n을 2에서 4로 올렸는가:
 * 잣대를 옮긴 게 아니라 측정이 정확해진 것이다.
 * 2글자는 어휘 유사도를, 4글자는 문구 복제를 잰다.
 *
 *     n | 다른 날 브리핑끼리 | 전혀 다른 글 | 절반 베낀 글 | 자기 자신
 *     2 |               63% |          12% |          -  |     100%
 *     4 |               48% |           2% |          98% |     100%
 */
export function overlap(a, b, n = 4) {
  const grams = (s) => {
    const t = String(s ?? '').replace(/\s+/g, '');
    const out = new Set();
    for (let i = 0; i + n <= t.length; i += 1) out.add(t.slice(i, i + n));
    return out;
  };
  const A = grams(a); const B = grams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  return hit / Math.min(A.size, B.size);
}

export const LIMITS = Object.freeze({
  minOriginal: 500,     // 광고를 뺀 알맹이 최소 길이
  maxBoilerRatio: 0.5,  // 글에서 광고·정형구가 차지하는 비율 상한
  maxOverlap: 0.6,      // 이미 올린 글과의 겹침 상한
});

/**
 * @param {string} md 올리려는 글
 * @param {string[]} previous 이미 올린 글들의 원문
 * @returns {{ok: boolean, issues: string[], stats: object}}
 */
export function checkQuality(md, previous = []) {
  const issues = [];
  const body = originalText(md);
  const whole = String(md ?? '').replace(/\s+/g, '').length || 1;
  const boilerRatio = 1 - (body.replace(/\s+/g, '').length / whole);

  if (!/flowvium\.net/.test(md)) issues.push('flowvium.net 광고가 없다');
  if (!/매매 권유가 아닙니다/.test(md)) issues.push('투자 고지가 없다');
  if (body.length < LIMITS.minOriginal) issues.push(`알맹이가 짧다 ${body.length}자 (최소 ${LIMITS.minOriginal})`);
  if (boilerRatio > LIMITS.maxBoilerRatio) issues.push(`정형구 비중이 높다 ${Math.round(boilerRatio * 100)}% (상한 ${Math.round(LIMITS.maxBoilerRatio * 100)}%)`);

  let worst = 0;
  for (const p of previous) worst = Math.max(worst, overlap(body, originalText(p)));
  if (worst > LIMITS.maxOverlap) issues.push(`이미 올린 글과 ${Math.round(worst * 100)}% 겹친다 (상한 ${Math.round(LIMITS.maxOverlap * 100)}%)`);

  return { ok: issues.length === 0, issues, stats: { original: body.length, boilerRatio: Number(boilerRatio.toFixed(2)), overlap: Number(worst.toFixed(2)) } };
}

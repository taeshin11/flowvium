/**
 * channel-guide.mjs — FlowVium 쇼츠 주간 채널 지침(구성 갈래 비중). 근거는 channel-guide.test.mjs 머리말. (2026-11-13)
 *   buildGuide: 지난 성적 → 갈래별 비중. armFor·pickCombo: 편 번호로 갈래를 고른다(제작은 이 파일의 지침만 따른다).
 */
import { readFileSync } from 'fs';
import { topicLift } from './topic-lift.mjs';

/** 갈래와 선택지. 지침이 없거나 깨졌을 때의 비중 = 11/13 까지 explore-slot 이 쓰던 고정 비율. */
export const LEVERS = {
  layout: { arms: ['classic', 'zoom'], fallback: { classic: 0.25, zoom: 0.75 } },
  opener: { arms: ['anchor', 'question'], fallback: { anchor: 0.5, question: 0.5 } },
  motion: { arms: ['push', 'still'], fallback: { push: 0.5, still: 0.5 } },
};
export const DEFAULT_GUIDE = { source: 'default', levers: Object.fromEntries(Object.entries(LEVERS).map(([k, v]) => [k, { shares: { ...v.fallback } }])) };

const FLOOR = 0.2;   // 지는 갈래도 이만큼은 계속 만든다 — 한쪽으로 몰면 다시 '같은 틀 반복'이 되고 재측정도 못 한다
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * @param {Array<{video_id:string, views:number, age_hours:number, published_at:string} & Record<string, unknown>>} rows
 *   shorts_stats 관측 × 그 영상의 갈래 값(layout·opener·motion)
 */
export function buildGuide(rows, { now = Date.now(), minSamples = 8 } = {}) {
  const levers = {};
  for (const [lever, { arms }] of Object.entries(LEVERS)) {
    const lift = topicLift(rows.map((r) => ({ ...r, topic: r[lever] ?? null })), { minSamples });
    const ev = Object.fromEntries(arms.map((a) => [a, lift.get(a) ?? null]));
    const missing = arms.filter((a) => !ev[a]);
    if (missing.length) {
      levers[lever] = { shares: Object.fromEntries(arms.map((a) => [a, r2(1 / arms.length)])), evidence: ev,
        why: `표본 부족(${missing.join('·')} ${minSamples}편 미만) — 판단하지 않고 같은 비중` };
      continue;
    }
    const total = arms.reduce((s, a) => s + ev[a].lift, 0);
    const raw = arms.map((a) => (total > 0 ? ev[a].lift / total : 1 / arms.length));
    const clamped = raw.map((x) => Math.min(1 - FLOOR * (arms.length - 1), Math.max(FLOOR, x)));
    const sum = clamped.reduce((s, x) => s + x, 0);
    const shares = Object.fromEntries(arms.map((a, i) => [a, r2(clamped[i] / sum)]));
    levers[lever] = { shares, evidence: ev, why: `48시간 조회 ÷ 같은 날 또래 중앙값(lift) 비례, 바닥 ${FLOOR * 100}%` };
  }
  return { source: 'weekly', generatedAt: new Date(now).toISOString(), levers };
}

// 편 번호 → [0,1) — explore-slot 의 mix 와 같은 곱셈 해시, 갈래마다 다른 소금
const mix = (n) => { let x = (Math.abs(Math.trunc(Number(n) || 0)) + 0x9e3779b9) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const SALT = { layout: 7919, opener: 15485863, motion: 104729 };
const unit = (seed, lever) => mix(Number(seed) * 31 + (SALT[lever] ?? 1)) / 4294967296;

/** 지침 비중대로 갈래 하나. 지침에 그 갈래가 없으면 기본 비중. */
export function armFor(seed, lever, guide) {
  const shares = guide?.levers?.[lever]?.shares ?? LEVERS[lever].fallback;
  const arms = LEVERS[lever].arms;
  let u = unit(seed, lever);
  for (const a of arms) { u -= Number(shares[a]) || 0; if (u < 0) return a; }
  return arms[arms.length - 1];
}

/**
 * 이번 편 구성. 바로 앞 편(prev)과 세 갈래가 다 같으면, 비중이 가장 고른 갈래 하나를 다른 쪽으로 바꾼다
 *   — 같은 틀이 연달아 나가지 않게(반복 콘텐츠 정책). prev 를 모르면 그대로. levers: 그 제작물이 쓰는 갈래만(상시 쇼츠는 opener 없음).
 */
export function pickCombo(seed, guide, prev, levers = Object.keys(LEVERS)) {
  const combo = Object.fromEntries(levers.map((l) => [l, armFor(seed, l, guide)]));
  if (!prev || levers.some((l) => combo[l] !== prev[l])) return combo;
  const balance = (l) => { const s = guide?.levers?.[l]?.shares ?? LEVERS[l].fallback; return Math.min(...LEVERS[l].arms.map((a) => Number(s[a]) || 0)); };
  const flip = [...levers].sort((a, b) => balance(b) - balance(a))[0];
  const other = LEVERS[flip].arms.find((a) => a !== combo[flip]);
  return { ...combo, [flip]: other };
}

/** 지침 파일이 쓸 만한가 — 알려진 갈래·선택지만, 비중 합 1(±0.02). 아니면 부르는 쪽이 DEFAULT_GUIDE 로. */
export function validGuide(g) {
  if (!g || typeof g !== 'object' || !g.levers || typeof g.levers !== 'object') return false;
  for (const [lever, v] of Object.entries(g.levers)) {
    const spec = LEVERS[lever];
    if (!spec || !v?.shares) return false;
    const keys = Object.keys(v.shares);
    if (keys.some((k) => !spec.arms.includes(k))) return false;
    const sum = keys.reduce((s, k) => s + (Number(v.shares[k]) || 0), 0);
    if (Math.abs(sum - 1) > 0.02) return false;
  }
  return true;
}

const LEVER_KO = { layout: '화면 배치(classic 그림 작게·zoom 그림 크게)', opener: '첫 문장(anchor 단정·question 질문)', motion: '첫 장면 움직임(push 당기기·still 고정)' };

/** 사람이 읽는 지침 1장. */
export function guideMarkdown(g) {
  const L = ['# FlowVium 쇼츠 채널 지침', '', `만든 시각 ${g.generatedAt ?? '-'} · 근거: 지난 주 쇼츠의 48시간 조회 ÷ 같은 날 또래 중앙값`, '',
    '제작(video-publish·상시 쇼츠)은 이 파일의 비중만 따른다. 바로 앞 편과 구성이 같으면 하나를 바꾼다(같은 틀 연속 금지).', ''];
  for (const [lever, v] of Object.entries(g.levers)) {
    L.push(`## ${LEVER_KO[lever] ?? lever}`, '');
    L.push(Object.entries(v.shares).map(([a, s]) => `${a} ${Math.round(s * 100)}%`).join(' · '));
    for (const [a, e] of Object.entries(v.evidence ?? {})) if (e) L.push(`- ${a}: 또래 대비 ${e.lift.toFixed(2)}배 · 또래를 넘은 비율 ${Math.round(e.beat * 100)}% · ${e.n}편`);
    if (v.why) L.push(`- 이유: ${v.why}`);
    L.push('');
  }
  return L.join('\n');
}

/** 제작이 읽는 자리. 없거나 깨졌으면 기본값 — 지침이 없다고 발행을 멈추지는 않는다. */
export function loadGuide(file) {
  try {
    const f = file ?? new URL('../../data/channel-guide/flowvium-shorts.json', import.meta.url);
    const g = JSON.parse(readFileSync(f, 'utf8'));
    return validGuide(g) ? g : DEFAULT_GUIDE;
  } catch { return DEFAULT_GUIDE; }
}

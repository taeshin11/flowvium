/**
 * slot-trial.mjs — 정해진 기간에만 도는 시험 칸(2026-10-19: 22:45 9번째 쇼츠, 10/20~10/26).
 *
 * 왜: 10/19 실측(72h 넘은 쇼츠 97편) 하루 4~8편에서 편당 3일 조회가 평평하고 하루 합은 편수와 함께 올랐다.
 *   9편 이상은 잰 적이 없다 → Mac mini2(사장님 결정): 7일 시험, 같은 잣대로 판정. 머리말 근거는 slot-trial.test.mjs.
 * 규칙: 시험 칸은 **그날 기사 풀의 새 이슈만** 쓴다 — 지난 며칠 국뽕(넓은 풀)·예비로 채우면 '서로 다른 이슈가 충분한 날만' 이 깨진다.
 *   낼 것이 없으면 거른다(거른 날도 판정에 적는다). 기간은 한국 날짜, 끝난 뒤 불려도 아무것도 안 한다.
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';

export const TRIAL_ENV = Object.freeze({ SHORTS_TODAY_ONLY: '1', SHORTS_SPARE: '0' });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const kstDay = (ms) => new Date(ms + 9 * 36e5).toISOString().slice(0, 10);

/** 'YYYY-MM-DD:YYYY-MM-DD' → {from, until}. 깨졌거나 거꾸로면 null. */
export function parseTrial(s) {
  const [from, until] = String(s ?? '').split(':');
  return DAY.test(from ?? '') && DAY.test(until ?? '') && from <= until ? { from, until } : null;
}

/** 지금(한국 날짜)이 기간 앞·안·뒤 중 어디인가. */
export function trialPhase(nowMs, { from, until }) {
  const d = kstDay(nowMs);
  return d < from ? 'before' : d > until ? 'ended' : 'active';
}

/** 다 익은 날 — 그날 마지막 편(자정 전)이 minAgeH 를 넘긴 날만. 덜 익은 날을 넣으면 하루 합이 작게 나온다. */
export function matureDays(days, nowMs, minAgeH = 72) {
  return days.filter((d) => Date.parse(`${d}T23:59:59+09:00`) + minAgeH * 36e5 <= nowMs);
}

/** 시험 칸으로 나간 편 id 원장(판정이 시각 추측 대신 id 로 가른다). */
export function recordTrialVideo(file, { trial, videoId, at = new Date().toISOString() }) {
  let j = { trials: {} };
  try { if (existsSync(file)) j = JSON.parse(readFileSync(file, 'utf8')); }
  catch { renameSync(file, `${file}.broken-${Date.now()}`); }   // 깨진 원장은 덮지 않고 옆에 남긴다
  j.trials ??= {};
  (j.trials[trial] ??= []).push({ id: videoId, at });
  writeFileSync(file, JSON.stringify(j, null, 1));
}

export function trialIds(file, trial = null) {
  try {
    const t = JSON.parse(readFileSync(file, 'utf8')).trials ?? {};
    return new Set(Object.entries(t).filter(([k]) => !trial || k === trial).flatMap(([, v]) => v.map((x) => x.id)));
  } catch { return new Set(); }
}

/**
 * report-eta.mjs — 이 회차가 실제로 얼마나 걸리는가, 지난 기록에서 뽑는다. (2026-09-12 신설)
 *
 * 왜 필요한가: 같은 기기의 다른 세션에 "예상 30~60분" 이라고 손으로 적어 보내고 있었다.
 *   실측은 달랐다 — 자정 회차 다섯 번이 90·90·97·90·106분이다. 상대는 그 숫자를 믿고
 *   자기 작업을 00:20 에 잡았고, 실제로는 00:16 에나 끝나 4분 차이로 부딪힐 뻔했다.
 *   틀린 숫자를 자신 있게 보내는 게 아무 숫자도 안 보내는 것보다 나쁘다.
 *
 * 회차 경계는 스케줄을 박지 않고 **로그의 시간 간격**으로 가른다 — 한 회차 안의 줄들은
 *   몇 분 이내로 이어지고, 회차 사이는 몇 시간이 빈다. 스케줄이 바뀌어도 따라온다.
 */
import { readFileSync } from 'fs';
import { ROOT } from './project-root.mjs';

const TS = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/;
// 회차 안에서도 로그가 오래 비는 구간이 있다 — 모델이 본문을 쓰는 동안 한 줄도 안 남는다.
//   실측(midnight·morning·evening 로그): 회차 *안* 의 최장 침묵 140분,
//   회차 *사이* 의 최단 간격 541분. 그 사이가 통째로 비어 있어 경계가 자의적이지 않다.
const GAP_MS = 4 * 60 * 60 * 1000;

/** 로그에서 완료된 회차들의 소요 분(minute) 목록. 최신이 뒤. */
export function pastDurationsMin(sessionLogPath) {
  let text;
  try { text = readFileSync(sessionLogPath, 'utf8'); } catch { return []; }

  const runs = [];
  let start = null, prev = null, sawSuccess = null;
  for (const line of text.split('\n')) {
    const m = TS.exec(line);
    if (!m) continue;
    const t = Date.parse(m[1].replace(' ', 'T'));
    if (!Number.isFinite(t)) continue;
    if (start === null || (prev !== null && t - prev > GAP_MS)) {
      if (start !== null && sawSuccess !== null) runs.push((sawSuccess - start) / 60000);
      start = t; sawSuccess = null;
    }
    if (line.includes('[SUCCESS] 완료')) sawSuccess = t;
    prev = t;
  }
  if (start !== null && sawSuccess !== null) runs.push((sawSuccess - start) / 60000);
  return runs.filter((d) => d > 0);
}

/**
 * 사람에게 보낼 한 줄. 기록이 없으면 모른다고 쓴다 — 숫자를 지어내지 않는다.
 * @param {string} session  'midnight' 같은 회차 이름
 */
export function etaLine(session, { root = ROOT, minRuns = 3 } = {}) {
  const runs = pastDurationsMin(`${root}/logs/report-${session}.log`);
  if (runs.length < minRuns) return runs.length ? `예상 ${Math.round(runs.at(-1))}분 (기록 ${runs.length}회뿐)` : '소요시간 기록 없음';
  const recent = runs.slice(-10).sort((a, b) => a - b);
  const med = recent[Math.floor(recent.length / 2)];
  const max = recent.at(-1);
  return `예상 ${Math.round(med)}분 (최근 ${recent.length}회 중앙값, 최장 ${Math.round(max)}분)`;
}

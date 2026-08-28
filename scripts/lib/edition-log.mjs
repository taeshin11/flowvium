/**
 * edition-log.mjs — 이미 내보낸 뉴스를 다시 내보내지 않기 위한 편성 기록.
 *
 * 요구(2026-08-28): "하루 5편을 하긴 할건데, 그 사이에 새로 나오는 뉴스를 모아서 만들자."
 *
 * 수집 창을 고정 12시간으로 두면 하루 5편이 **같은 뉴스를 다섯 번** 내보낸다.
 *   창을 좁히면(예: 4시간) 이번엔 소재가 얇아 편성이 비는 날이 생긴다.
 *   그래서 창은 넓게 두되 **이미 쓴 헤드라인을 빼는** 쪽으로 간다 —
 *   새 뉴스가 없으면 소재가 줄지언정, 같은 뉴스를 다시 읽지는 않는다.
 *
 * 기록은 **로컬**에 둔다. 드라이브가 잠깐 안 되는 날에도 중복 방지는 살아 있어야 한다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** 헤드라인을 비교 가능한 형태로. 매체마다 따옴표·대소문자가 달라 그대로는 안 맞는다. */
export function normHeadline(h) {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9가-힣 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readLog(file) {
  if (!existsSync(file)) return [];
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(j) ? j : (j.editions ?? []);
  } catch { return []; }            // 깨진 기록 때문에 편성을 멈추지는 않는다
}

/** 최근 n 편에서 쓴 헤드라인 집합. */
export function usedHeadlines(log, editions = 5) {
  const recent = (log ?? []).slice(-Math.max(0, editions));
  const set = new Set();
  for (const e of recent) for (const h of e?.headlines ?? []) set.add(normHeadline(h));
  return set;
}

/**
 * 이미 쓴 헤드라인을 걸러낸다.
 * @returns {{rows: any[], dropped: number}}
 */
export function filterUsed(rows, used) {
  const out = (rows ?? []).filter((r) => !used.has(normHeadline(r?.headline)));
  return { rows: out, dropped: (rows ?? []).length - out.length };
}

/**
 * 이번 편을 기록한다. 기록이 무한정 커지지 않게 최근 것만 남긴다.
 * @param {string} file
 * @param {{at?:string, keywords?:string[], headlines?:string[], video?:string}} entry
 */
export function appendEdition(file, entry, keep = 60) {
  const log = readLog(file);
  log.push({
    at: entry.at ?? null,
    keywords: entry.keywords ?? [],
    headlines: (entry.headlines ?? []).slice(0, 80),
    video: entry.video ?? null,
  });
  const trimmed = log.slice(-keep);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(trimmed, null, 1));
  return trimmed.length;
}

/**
 * data-contamination.mjs — 오염된 보고서 판에서 나온 장부 줄을 채점에서 뺀다. 근거·규칙은 data-contamination.test.mjs 머리말.
 *   목록: data/data-contamination.json { entries: [{ date, reason, reports: [{ file, generatedAt }] }] }
 */
import { existsSync, readFileSync } from 'fs';

export function loadContamination(path) {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')).entries ?? []) : []; } catch { return []; }
}

/** 장부 줄(report.file·report.generatedAt)이 오염된 판에서 나왔으면 {date, reason}, 아니면 null. */
export function contaminationOf(rec, entries) {
  const f = rec?.report?.file; const g = rec?.report?.generatedAt;
  if (!f || !g) return null;
  for (const e of entries ?? []) if ((e.reports ?? []).some((r) => r.file === f && r.generatedAt === g)) return { date: e.date, reason: e.reason };
  return null;
}

/** @param {(x:any)=>any} ledgerOf 집계 줄 → 그 줄의 장부 기록 */
export function splitContaminated(items, entries, ledgerOf) {
  const clean = []; const ids = []; const days = new Set();
  for (const x of items ?? []) {
    const c = contaminationOf(ledgerOf(x), entries);
    if (c) { ids.push(ledgerOf(x)?.id ?? x?.id); days.add(c.date); } else clean.push(x);
  }
  return { clean, contaminated: { n: ids.length, ids, days: [...days].sort() } };
}

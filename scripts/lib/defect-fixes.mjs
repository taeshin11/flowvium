/**
 * defect-fixes.mjs — "이 결함은 언제 코드로 고쳤나" 를 기록하고, 그 이후 발생분만 센다.
 *
 * 왜 (2026-09-09): audit-coverage 는 같은 결함이 7일에 5회 넘으면 "코드 fix 필수" 로 push 를 막는다.
 *   규칙 자체는 옳다. 문제는 **고친 뒤에도 지난 7일 기록이 그대로 남아 계속 막았다** 는 것이다.
 *   오늘 magnitude_overstate(2.3%를 "급등") 를 생성 단계에서 막았는데도 과거 7건 때문에 게이트가
 *   그대로 빨간불이었다. 고쳐도 안 풀리는 게이트는 --no-verify 를 부르고, 한 번 우회하기 시작하면
 *   그 게이트는 없는 것과 같아진다.
 *
 * 그래서 고친 시점을 남기고 **그 이후 발생분만** 센다. 고치면 풀리고, 재발하면 다시 막힌다.
 *   과거 기록을 지우거나 이름을 바꾸지 않는다 — 추세를 보려면 원본이 남아 있어야 한다.
 */

/** fixes: { defect_type: ISO } — 그 시점 **이후** 발생분만 남긴다. 기록이 없으면 전부 센다. */
export function countableSince(history, fixes = {}) {
  return history.filter((h) => {
    const at = fixes[h.defect_type];
    return !at || h.detected_at > at;
  });
}

/** 고친 뒤로도 threshold 회 이상 재발한 결함이 있는가. */
export function stillBroken(history, fixes = {}, threshold = 5) {
  const n = new Map();
  for (const h of countableSince(history, fixes)) n.set(h.defect_type, (n.get(h.defect_type) ?? 0) + 1);
  return [...n.values()].some((c) => c >= threshold);
}

/** 기록용 테이블. 스키마를 여기 두어 audit 과 기록 스크립트가 같은 정의를 쓴다. */
export function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS defect_fixes (
    defect_type TEXT PRIMARY KEY,
    fixed_at    TEXT NOT NULL,
    note        TEXT
  )`);
}

export function recordFix(db, defectType, note) {
  ensureTable(db);
  db.prepare('INSERT OR REPLACE INTO defect_fixes (defect_type, fixed_at, note) VALUES (?, ?, ?)')
    .run(defectType, new Date().toISOString(), note ?? null);
}

export function loadFixes(db) {
  ensureTable(db);
  return Object.fromEntries(db.prepare('SELECT defect_type, fixed_at FROM defect_fixes').all().map((r) => [r.defect_type, r.fixed_at]));
}

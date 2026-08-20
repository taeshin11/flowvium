/**
 * translation-backlog.ts — 번역이 거부됐음을 기록한다 (웹 쓰기 경로).
 *   scripts/lib/translation-backlog.mjs 가 소비(27B 로 채우기)를 담당한다. 둘을 함께 고칠 것.
 *
 * 왜(2026-08-20 눈검증): 가드가 나쁜 번역을 거부하고 원문을 보여주는 것까지는 맞다.
 *   없는 건 '그 다음'이다 — 같은 문자열이 다음에도 4B 로 가서 또 거부되고 영원히 영문으로 남았다.
 *   (홈에서 "Pharma / Biotech", "Industrial conglomerates, machinery…" 가 그렇게 남아 있었다.)
 *   거부를 남겨 두면 한가할 때 27B 가 채워 사전으로 승격시킨다.
 */
import Database from 'better-sqlite3';
import { join } from 'path';

const MAX_TERM_LEN = 300;
const norm = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();

let db: Database.Database | null = null;
let tried = false;

function handle(): Database.Database | null {
  if (tried) return db;
  tried = true;
  try {
    db = new Database(join(process.cwd(), 'data/flowvium.db'), { fileMustExist: true });
    db.exec(`CREATE TABLE IF NOT EXISTS translation_backlog (
      key TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 1, last_reason TEXT,
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      PRIMARY KEY (key, locale))`);
  } catch { db = null; }   // DB 못 열어도 번역 경로 자체를 막지는 않는다
  return db;
}

/** 번역 거부를 기록. 실패해도 요청을 깨지 않는다 — 기록은 부가 기능이다. */
export function recordRejection(text: string, locale: string, reason: string): void {
  const t = norm(text);
  if (!t || t.length > MAX_TERM_LEN) return;
  const h = handle();
  if (!h) return;
  try {
    const now = new Date().toISOString();
    h.prepare(`INSERT INTO translation_backlog (key, locale, text, hits, last_reason, first_seen, last_seen)
               VALUES (?, ?, ?, 1, ?, ?, ?)
               ON CONFLICT(key, locale) DO UPDATE SET hits = hits + 1, last_reason = ?, last_seen = ?`)
     .run(t.toLowerCase(), locale, t, reason.slice(0, 40), now, now, reason.slice(0, 40), now);
  } catch { /* 기록 실패는 무시 — 번역 응답이 우선 */ }
}

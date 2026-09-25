/**
 * visits.ts — 페이지 조회 기록(자가호스팅 방문자 측정). 2026-09-25 신설.
 *
 * 왜 별도 파일(data/visits.db)인가: flowvium.db 는 보고서 파이프라인이 한 번에 크게 쓴다.
 *   조회마다 쓰는 작은 쓰기가 그 잠금과 부딪히지 않게 나눈다. 판정 규칙은 visits-core.mjs.
 * 저장하는 것: 날(KST)·시각·경로·로케일·유입 호스트·utm_source·국가(Cloudflare 헤더)·하루짜리 방문자 해시.
 * 저장하지 않는 것: IP·UA 원문·쿼리 문자열·쿠키.
 */
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { isBot, visitorId, refHost, normPath } from './visits-core.mjs';

let db: Database.Database | null = null;
function open(): Database.Database {
  if (db?.open) return db;
  db = new Database(join(process.cwd(), 'data/visits.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, locale TEXT,
      ref TEXT, utm TEXT, country TEXT, visitor TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pv_day ON page_views(day);
    CREATE TABLE IF NOT EXISTS day_salt (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
  `);
  return db;
}

/** KST 날짜(YYYY-MM-DD). */
export function kstDay(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}

/** 그날의 소금 — 재시작해도 같은 날엔 같은 값(순방문자가 재시작으로 두 번 세어지지 않게). 지난 날 소금은 지운다. */
function daySalt(conn: Database.Database, day: string): string {
  const row = conn.prepare('SELECT salt FROM day_salt WHERE day = ?').get(day) as { salt: string } | undefined;
  if (row) return row.salt;
  const salt = randomBytes(16).toString('hex');
  conn.prepare('INSERT OR IGNORE INTO day_salt(day, salt) VALUES (?, ?)').run(day, salt);
  conn.prepare('DELETE FROM day_salt WHERE day < ?').run(day);   // 지난 소금이 남으면 날 넘어 대조할 수 있다
  return (conn.prepare('SELECT salt FROM day_salt WHERE day = ?').get(day) as { salt: string }).salt;
}

export function recordView(v: { path: string; referrer?: string; utm?: string; ua: string; ip: string; country?: string }): boolean {
  if (isBot(v.ua)) return false;
  const conn = open();
  const day = kstDay();
  const path = normPath(v.path);
  const locale = /^\/([a-z]{2}(?:-[A-Z]{2})?)(?:\/|$)/.exec(path)?.[1] ?? null;
  conn.prepare(`INSERT INTO page_views (ts, day, path, locale, ref, utm, country, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(new Date().toISOString(), day, path, locale, refHost(v.referrer ?? '', 'flowvium.net'),
      v.utm ? String(v.utm).slice(0, 40) : null, v.country ? String(v.country).slice(0, 2) : null,
      visitorId(v.ip, v.ua, daySalt(conn, day)));
  return true;
}

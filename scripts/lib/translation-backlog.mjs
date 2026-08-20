/**
 * translation-backlog.mjs — 거부된 번역을 대기열에 남긴다. 27B 가 한가할 때 채운다.
 *
 * 배경(2026-08-20, 홈 화면 눈검증): 사용자에게 영문이 그대로 보이는 3건이 있었다.
 *     "Pharma / Biotech"                     → garbage-fallback (가드 거부 → 원문 노출)
 *     "Industrial conglomerates, machinery…"  → mixed-fallback   (가드 거부 → 원문 노출)
 *     "hawkish (prev 224K/wk)"                → 4B "호각적…" (오역인데 한국어라 게이트 통과)
 *   가드는 제대로 동작한다 — 나쁜 번역 대신 원문을 보여준다. 없는 건 '그 다음'이다:
 *   같은 문자열이 다음에도 4B 로 가서 또 거부되고, 영원히 영문으로 남는다.
 *
 *   웹 레인을 27B 로 바꾸는 건 답이 아니다. 실측: 이 작업 중 27B 는 segments-refresh 의
 *   4,609토큰 프리필에 점유돼 300초 타임아웃이 났다. 보고서·유지보수 잡과 다툰다.
 *   그래서 거부를 기록해 두고 한가할 때 27B 가 채워 translation_memory 로 승격시킨다.
 */
import Database from 'better-sqlite3';

// 사전은 '용어' 저장소다. 문단은 Redis 응답 캐시가 담당한다 — 여기 넣으면 대기열이 문단으로 찬다.
const MAX_TERM_LEN = 300;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function openBacklog(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_backlog (
      key         TEXT NOT NULL,
      locale      TEXT NOT NULL,
      text        TEXT NOT NULL,
      hits        INTEGER NOT NULL DEFAULT 1,
      last_reason TEXT,
      first_seen  TEXT NOT NULL,
      last_seen   TEXT NOT NULL,
      PRIMARY KEY (key, locale)
    )`);

  const up = db.prepare(`
    INSERT INTO translation_backlog (key, locale, text, hits, last_reason, first_seen, last_seen)
    VALUES (@key, @locale, @text, 1, @reason, @now, @now)
    ON CONFLICT(key, locale) DO UPDATE SET
      hits = hits + 1, last_reason = @reason, last_seen = @now`);
  const sel = db.prepare(`SELECT text, hits, last_reason, last_seen FROM translation_backlog
                          WHERE locale = ? ORDER BY hits DESC, last_seen DESC LIMIT ?`);
  const del = db.prepare('DELETE FROM translation_backlog WHERE key = ? AND locale = ?');

  return {
    /** 번역이 거부됐음을 기록. 같은 문자열은 행이 늘지 않고 횟수만 오른다. */
    record(text, locale, reason) {
      const t = norm(text);
      if (!t || t.length > MAX_TERM_LEN) return false;
      up.run({ key: t.toLowerCase(), locale, text: t, reason: String(reason ?? '').slice(0, 40),
               now: new Date().toISOString() });
      return true;
    },

    /** 채워야 할 것들 — 거부가 잦은 순. 27B 시간은 유한하므로 우선순위가 필요하다. */
    pending(locale, limit = 200) { return sel.all(locale, limit); },

    /** 사전에 들어갔으면 대기열에서 뺀다. 안 그러면 매번 다시 번역한다. */
    resolve(text, locale) { del.run(norm(text).toLowerCase(), locale); },

    close() { db.close(); },
  };
}

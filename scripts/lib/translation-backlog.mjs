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
 *
 * 2026-08-31 — 그 대기열이 이번엔 반대로 GPU 를 태웠다. 실측:
 *   translation_memory 의 마지막 27B 행이 08-23 인데 :8000 은 이 잡에 4일간 421회 깨워졌다
 *   (mlx.log 분 분포 :25 = idle 시간대 최대 소비자). 8일간 산출 0.
 *   원인은 여기 있었다 — 성공은 resolve() 로 빠지는데 **실패는 아무 데도 안 남는다**.
 *   그리고 pending() 은 hits DESC 라 자주 거부된 것이 *먼저* 온다. 즉 번역이 불가능한
 *   문자열일수록 매시간 맨 앞에 서서 27B 를 깨운다:
 *     "EWY 1w, F&G"(차트 툴팁 조각) · "TSM 1w, 59" · "tyChg3m"(데이터 필드명)
 *   가드는 옳게 거부한다. 없던 것은 "다시 해도 소용없다" 는 기억이다 — 그걸 여기 넣는다.
 *
 *   다만 *일시적* 실패(타임아웃·HTTP)를 같이 세면 안 된다. 08-28~08-31 처럼 서버가 3일
 *   죽어 있으면 멀쩡한 용어가 통째로 은퇴한다. 가드 거부(결정론적: 같은 입력 → 같은 거부)만
 *   센다.
 */
import Database from 'better-sqlite3';

// 사전은 '용어' 저장소다. 문단은 Redis 응답 캐시가 담당한다 — 여기 넣으면 대기열이 문단으로 찬다.
const MAX_TERM_LEN = 300;

/**
 * 가드가 몇 번 거부하면 포기하는가.
 * 1 이 아닌 이유: 가드는 결정론적이지만 *번역기 출력* 은 temperature 0.2 로 흔들린다 —
 *   한 번의 나쁜 샘플로 은퇴시키면 고칠 수 있는 용어를 버린다.
 * 크게 잡지 않는 이유: 3회면 매시 실행 기준 3시간 만에 판정이 끝난다. 그 뒤로는 영원히
 *   안 깨운다. 지금 이 값을 넘긴 것들(위 주석의 툴팁 조각들)은 11일째 실패 중이었다.
 */
export const MAX_GUARD_FAILURES = 3;
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
  // 기존 DB 에도 붙인다. 이 컬럼이 없던 시절의 행은 0 으로 시작해 정상적으로 판정된다.
  if (!db.prepare("PRAGMA table_info(translation_backlog)").all().some((c) => c.name === 'guard_failures')) {
    db.exec('ALTER TABLE translation_backlog ADD COLUMN guard_failures INTEGER NOT NULL DEFAULT 0');
  }

  const up = db.prepare(`
    INSERT INTO translation_backlog (key, locale, text, hits, last_reason, first_seen, last_seen)
    VALUES (@key, @locale, @text, 1, @reason, @now, @now)
    ON CONFLICT(key, locale) DO UPDATE SET
      hits = hits + 1, last_reason = @reason, last_seen = @now`);
  // 소진분 제외가 *여기* 여야 하는 이유: 정렬이 hits DESC 다. 거르지 않으면 번역 불가
  // 문자열이 대기열 맨 앞을 영구 점거하고, LIMIT 예산을 전부 먹는다(실측 등록 0 · 실패 7).
  const sel = db.prepare(`SELECT text, hits, last_reason, last_seen FROM translation_backlog
                          WHERE locale = ? AND guard_failures < @max
                          ORDER BY hits DESC, last_seen DESC LIMIT ?`.replace('@max', String(MAX_GUARD_FAILURES)));
  const del = db.prepare('DELETE FROM translation_backlog WHERE key = ? AND locale = ?');

  // 가드 거부 기록. 대기열에 없던 문자열(시드 목록 등)도 여기서 행이 생겨야 한다 —
  // 이번 사건의 정크 7건은 전부 대기열이 아니라 data/translation-seed-terms.json 에서 왔다.
  const failUp = db.prepare(`
    INSERT INTO translation_backlog (key, locale, text, hits, last_reason, first_seen, last_seen, guard_failures)
    VALUES (@key, @locale, @text, 1, @reason, @now, @now, 1)
    ON CONFLICT(key, locale) DO UPDATE SET
      guard_failures = guard_failures + 1, last_reason = @reason, last_seen = @now`);
  const failCount = db.prepare('SELECT guard_failures FROM translation_backlog WHERE key = ? AND locale = ?');

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

    /**
     * 번역 시도가 실패했음을 기록한다.
     * @param {{transient?: boolean}} [opt] transient — 타임아웃·HTTP 등 서버 사정. 소진으로 세지 않는다.
     *        (08-28~08-31 서버 3일 사망 때 이걸 셌다면 사전이 통째로 은퇴했다.)
     */
    recordFailure(text, locale, reason, opt) {
      const t = norm(text);
      if (!t || t.length > MAX_TERM_LEN) return false;
      if (opt?.transient) return false;   // 서버 탓은 문자열 탓이 아니다
      failUp.run({ key: t.toLowerCase(), locale, text: t,
                   reason: String(reason ?? '').slice(0, 40), now: new Date().toISOString() });
      return true;
    },

    /** 더 시도해봐야 소용없는가. 호출부는 이걸 보고 27B 를 아예 안 깨운다. */
    isExhausted(text, locale) {
      const row = failCount.get(norm(text).toLowerCase(), locale);
      return (row?.guard_failures ?? 0) >= MAX_GUARD_FAILURES;
    },

    /** 사전에 들어갔으면 대기열에서 뺀다. 안 그러면 매번 다시 번역한다.
     *  행을 통째로 지우므로 소진 기록도 같이 사라진다 — 사람이 고쳐 넣은 뒤엔 다시 살아나야 한다. */
    resolve(text, locale) { del.run(norm(text).toLowerCase(), locale); },

    close() { db.close(); },
  };
}

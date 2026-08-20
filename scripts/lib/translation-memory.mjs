/**
 * translation-memory.mjs — 확정 번역 저장소 (사용자 제안 "llm wiki나 db").
 *
 * 배경(2026-08-20 실측): 웹 LLM 레인은 Qwen3.5-4B(:8001)다. 보고서(27B, :8000)의 긴 프리필이
 *   GPU 를 독점해 웹 요청이 타임아웃되던 문제로 내가 분리한 구조이고, 그 이유는 지금도 유효하다.
 *   그러나 4B 의 금융 번역 품질이 못 쓸 수준이다(같은 프롬프트·thinking off):
 *       industrial conglomerate   4B "산업 컨glomerate"     27B "산업 재벌"
 *       Short squeeze candidate   4B "단축 압력 후보"        27B "숏 스퀴즈 후보"
 *   앞은 게이트가 걸러 원문이 노출되고, 뒤는 '한국어이긴 해서' 통과해 틀린 채로 나간다.
 *
 *   레인을 27B 로 되돌리면 경합이 재발한다. 대신 반복되는 용어를 미리 확정해 둔다 —
 *   웹 경로는 조회만 하니 GPU 를 안 건드리고 품질은 27B 것이다. Redis 캐시(30일 TTL)와
 *   역할이 다르다: 저건 만료되는 응답 캐시, 이건 만료되지 않는 용어 사전이고 사람이 교정할 수 있다.
 */
import Database from 'better-sqlite3';

// 낮을수록 신뢰. 낮은 신뢰가 높은 신뢰를 덮지 못하게 한다 —
// 4B 가 한 번 끼어들어 27B/사람 번역을 지우면 조용히 품질이 내려앉는다.
const RANK = { human: 0, 'qwen3.8-27b': 1, 'qwen3.5-4b': 3, unknown: 9 };
const rankOf = (s) => RANK[s] ?? RANK.unknown;

/** 표기 흔들림 흡수. UI 문자열은 대소문자·공백이 제각각이라 정규화 없이는 매번 GPU 로 간다. */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function openMemory(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_memory (
      key        TEXT NOT NULL,          -- 정규화된 원문
      locale     TEXT NOT NULL,
      source_text TEXT NOT NULL,         -- 원문 원형(감사용)
      translated TEXT NOT NULL,
      source     TEXT NOT NULL,          -- human | qwen3.8-27b | qwen3.5-4b
      rank       INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (key, locale)
    )`);

  const selStmt = db.prepare('SELECT translated FROM translation_memory WHERE key=? AND locale=?');
  const curStmt = db.prepare('SELECT rank FROM translation_memory WHERE key=? AND locale=?');
  const upStmt  = db.prepare(`INSERT INTO translation_memory (key, locale, source_text, translated, source, rank, updated_at)
                              VALUES (@key,@locale,@source_text,@translated,@source,@rank,@updated_at)
                              ON CONFLICT(key,locale) DO UPDATE SET
                                translated=@translated, source=@source, rank=@rank,
                                source_text=@source_text, updated_at=@updated_at`);

  return {
    /** 확정 번역 또는 null. 없음을 빈 문자열로 돌려주지 않는다 — 호출부가 '번역됨'으로 오인한다. */
    lookup(text, locale) {
      const r = selStmt.get(norm(text), locale);
      return r?.translated ?? null;
    },

    /**
     * 확정 번역 등록. 다음은 저장하지 않는다:
     *   · 빈 값 — 실패를 캐시하면 영구 고착된다.
     *   · 원문과 동일 — 번역이 아니라 '번역 실패'의 흔적이다.
     *   · 기존보다 신뢰가 낮은 소스 — 조용한 품질 하락을 막는다.
     * @returns {boolean} 실제로 기록했는지
     */
    remember(text, locale, translated, { source = 'unknown' } = {}) {
      const t = String(translated ?? '').trim();
      if (!t) return false;
      if (norm(t) === norm(text)) return false;
      const key = norm(text), rank = rankOf(source);
      const cur = curStmt.get(key, locale);
      if (cur && cur.rank < rank) return false;
      upStmt.run({ key, locale, source_text: String(text), translated: t, source, rank,
                   updated_at: new Date().toISOString() });
      return true;
    },

    stats() {
      const total = db.prepare('SELECT COUNT(*) c FROM translation_memory').get().c;
      const rows = db.prepare('SELECT locale, COUNT(*) c FROM translation_memory GROUP BY locale').all();
      const bySource = db.prepare('SELECT source, COUNT(*) c FROM translation_memory GROUP BY source').all();
      return {
        total,
        byLocale: Object.fromEntries(rows.map(r => [r.locale, r.c])),
        bySource: Object.fromEntries(bySource.map(r => [r.source, r.c])),
      };
    },

    close() { db.close(); },
  };
}

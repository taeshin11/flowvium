/**
 * segment-rotation.mjs — 세그먼트 갱신 회전. 실패 종목에 갇히지 않게 한다.
 *
 * 배경(2026-08-20 실측): cron 의 segments-refresh 가 15회 연속 ✓0 ✗6 (성공률 0.0%)이었다.
 *   20분마다 27B GPU 를 쓰면서 아무것도 못 만들었고, 조절기는 시간당 20~56회 정지를 걸었다.
 *   원인 ②: db.mjs 의 getSegmentTickersToRefresh 가
 *       const missing = us.filter(t => !have.has(t));
 *       return [...missing, ...stale].slice(0, n);
 *   실패는 company_segments 에 행을 안 남기므로 영원히 missing 맨 앞에 남아
 *   매 주기 같은 6개를 다시 골랐다(BRK.B·TSM·GOOGL·UNH·ABT·ISRG).
 *
 *   잡이 고장난 게 아니다 — 일반 미국 대형주로는 4/5 성공한다(MSFT·NVDA·JNJ·KO).
 *   회전이 갇혀 있었을 뿐이라, 끄지 않고 전진하게 만든다.
 *   실패도 '시도'로 기록해서 뒤로 보내고, 반복 실패는 지수 백오프로 쉬게 한다.
 */
import Database from 'better-sqlite3';

/**
 * SEC 표기로 정규화. 클래스주는 점이 아니라 하이픈이다 — BRK.B → BRK-B.
 *   2026-09-10: 이 차이 하나로 BRK.B 가 계속 no-cik 이었다. 죽은 티커가 아니라 표기 문제였다.
 */
export function secTicker(t) {
  return String(t ?? '').toUpperCase().replace(/\./g, '-');
}

/**
 * SEC 목록에 실제로 있는 티커만 남긴다(원래 표기 유지 — 호출부가 그 이름으로 저장한다).
 *
 * 2026-09-10: 실측 183건의 no-cik 중 178건이 ETF(XLF·YINN)이거나 상장폐지(GPS→GAP 개명,
 *   GTLS 피인수)였다. 대상이 아닌 것을 시도하고 실패로 세면 진짜 실패가 묻힌다.
 *   저장된 실패 이력으로 추측하지 않는다 — 그 방식으로는 SPY·QQQ·DIA·MDY 가 걸렸는데
 *   지금 SEC 목록에는 멀쩡히 있다(과거 조회 이상의 흔적). 매번 최신 목록으로 확인한다.
 *   목록이 빈약하면(조회 이상) 아무것도 거르지 않는다 — 멀쩡한 티커를 버리는 쪽이 더 나쁘다.
 */
export function resolvableTickers(universe, cikMap) {
  if (!cikMapSane(cikMap)) return [...universe];
  return universe.filter((t) => Object.prototype.hasOwnProperty.call(cikMap, secTicker(t)));
}

export const MIN_CIK_ENTRIES = 5000;
export function cikMapSane(map) {
  return Object.keys(map ?? {}).length >= MIN_CIK_ENTRIES;
}


// 연속 실패 n회 → 2^n 시간 대기. 6회면 64시간 — 사실상 사람이 볼 때까지 쉰다.
const BACKOFF_BASE_MS = 60 * 60 * 1000;
const MAX_BACKOFF_POW = 6;

export function openRotation(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS segment_attempts (
      ticker       TEXT PRIMARY KEY,
      last_attempt TEXT NOT NULL,
      fail_count   INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT
    )`);

  const up = db.prepare(`
    INSERT INTO segment_attempts (ticker, last_attempt, fail_count, last_error)
    VALUES (@ticker, @now, @inc, @err)
    ON CONFLICT(ticker) DO UPDATE SET
      last_attempt = @now,
      fail_count   = CASE WHEN @err IS NULL THEN 0 ELSE fail_count + 1 END,
      last_error   = @err`);
  const all = db.prepare('SELECT ticker, last_attempt, fail_count, last_error FROM segment_attempts');

  return {
    /** 시도 기록. error 가 null 이면 성공(실패 카운트 초기화). */
    recordAttempt(ticker, error) {
      up.run({ ticker, now: new Date().toISOString(), inc: error ? 1 : 0, err: error ?? null });
    },

    /**
     * 다음에 시도할 종목 n개.
     *  - 이미 보유(have)한 종목은 제외
     *  - 백오프 중인 종목은 제외 (연속 실패 n회 → 2^n 시간)
     *  - 한 번도 시도 안 한 것 우선, 그다음 오래된 시도 순 → 실패해도 전진한다
     */
    pick(universe, have = new Set(), n = 6, now = Date.now()) {
      const att = new Map(all.all().map(r => [r.ticker, r]));
      const eligible = [];
      for (const t of universe) {
        if (have.has(t)) continue;
        const a = att.get(t);
        if (!a) { eligible.push({ ticker: t, key: '' }); continue; }   // 미시도 최우선
        if (a.fail_count > 0) {
          const wait = BACKOFF_BASE_MS * 2 ** Math.min(a.fail_count - 1, MAX_BACKOFF_POW);
          if (now - Date.parse(a.last_attempt) < wait) continue;       // 백오프 중
        }
        eligible.push({ ticker: t, key: a.last_attempt });
      }
      eligible.sort((x, y) => x.key.localeCompare(y.key));
      return eligible.slice(0, n).map(x => x.ticker);
    },

    /** 무엇이 왜 실패하는지 — 끄기 전에 이유를 볼 수 있어야 한다. */
    stats() {
      const rows = all.all();
      const byError = {};
      for (const r of rows) if (r.last_error) byError[r.last_error] = (byError[r.last_error] ?? 0) + 1;
      return {
        total: rows.length,
        failing: rows.filter(r => r.fail_count > 0).length,
        byError,
      };
    },

    close() { db.close(); },
  };
}

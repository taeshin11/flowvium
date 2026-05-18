/**
 * scripts/lib/db.mjs — 로컬 SQLite 헬퍼.
 *
 * data/flowvium.db (git ignore) 에 다음을 저장:
 *   reports               — 전체 보고서 JSON
 *   endpoint_snapshots    — 보고서 작성 시점의 18+ 엔드포인트 응답
 *   recommendations       — portfolio entry 별 정형 데이터
 *   recommendation_outcomes — 14일 후 평가 결과
 *
 * 모든 mjs 스크립트가 이 라이브러리로 공통 인터페이스 사용.
 * Vercel build 에는 들어가지 않음 (devDependency + scripts/ 외부 import 없음).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
export const DATA_DIR = resolve(ROOT, 'data');
export const DB_PATH = resolve(DATA_DIR, 'flowvium.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,        -- 'YYYY-MM-DD:session:locale'
  generated_at  TEXT NOT NULL,
  kst_date      TEXT NOT NULL,
  session       TEXT NOT NULL,            -- morning/afternoon/evening
  locale        TEXT NOT NULL,
  source        TEXT NOT NULL,            -- 'local-qwen3:8b', 'gemini', 'fallback'
  stance        TEXT,
  risk_level    TEXT,
  thesis        TEXT,
  quality_score INTEGER,
  full_json     TEXT NOT NULL,            -- 보고서 전체 JSON
  audit_json    TEXT,                     -- harnessAudit JSON
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_generated_at ON reports(generated_at);
CREATE INDEX IF NOT EXISTS idx_reports_session ON reports(session, locale);

CREATE TABLE IF NOT EXISTS endpoint_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT NOT NULL,
  endpoint      TEXT NOT NULL,            -- '/api/fear-greed' 형태
  captured_at   TEXT NOT NULL,
  http_status   INTEGER,
  source        TEXT,                     -- response.source / response.dataSource
  ok            INTEGER NOT NULL,         -- 0/1
  response_json TEXT NOT NULL,
  duration_ms   INTEGER,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snap_report   ON endpoint_snapshots(report_id);
CREATE INDEX IF NOT EXISTS idx_snap_endpoint ON endpoint_snapshots(endpoint, captured_at);

CREATE TABLE IF NOT EXISTS recommendations (
  id              TEXT PRIMARY KEY,       -- 'YYYY-MM-DD:session:ticker'
  report_id       TEXT NOT NULL,
  generated_at    TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  name            TEXT,
  market          TEXT,                   -- us / korea / global / japan / ...
  sector          TEXT,
  action          TEXT,                   -- buy / watch / hold
  confidence      TEXT,
  allocation      REAL,
  entry_low       REAL,
  entry_high      REAL,
  target          REAL,
  target_bull     REAL,
  stop_loss       REAL,
  price_at_gen    REAL,
  currency        TEXT,                   -- $ / ₩ / €
  rationale       TEXT,
  evaluate_after  TEXT NOT NULL,          -- generatedAt + 14d
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rec_ticker     ON recommendations(ticker);
CREATE INDEX IF NOT EXISTS idx_rec_eval_after ON recommendations(evaluate_after);

CREATE TABLE IF NOT EXISTS recommendation_outcomes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id TEXT NOT NULL,
  evaluated_at      TEXT NOT NULL,
  price_at_eval     REAL,
  outcome           TEXT NOT NULL,        -- hit_target/stop_loss/not_entered/still_holding
  pnl_pct           REAL,
  ohlc_days         INTEGER,
  high_seen         REAL,
  low_seen          REAL,
  spy_return        REAL,
  quality_score     INTEGER,
  details_json      TEXT,
  FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outcome_rec_eval ON recommendation_outcomes(recommendation_id, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_outcome_evaluated ON recommendation_outcomes(evaluated_at);
`;

let _dbInstance = null;

export function openDb() {
  if (_dbInstance) return _dbInstance;
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  _dbInstance = db;
  return db;
}

export function closeDb() {
  if (_dbInstance) { _dbInstance.close(); _dbInstance = null; }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function parsePrice(s) {
  if (s == null) return null;
  const m = String(s).replace(/[$₩€,\s]/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function parseZone(s) {
  if (!s) return [null, null];
  const m = String(s).match(/([₩$€]?[\d,]+\.?\d*)\s*[-~]\s*([₩$€]?[\d,]+\.?\d*)/);
  if (!m) { const p = parsePrice(s); return [p, p]; }
  return [parsePrice(m[1]), parsePrice(m[2])];
}
function detectCurrency(...sources) {
  for (const s of sources) {
    if (!s) continue;
    const m = String(s).match(/[$₩€]/);
    if (m) return m[0];
  }
  return null;
}
function inferReportId(report) {
  const gen = report.generatedAt ?? new Date().toISOString();
  const kst = new Date(new Date(gen).getTime() + 9*3600000).toISOString().slice(0, 10);
  const session = report.session ?? (() => {
    const h = (new Date(gen).getUTCHours() + 9) % 24;
    return h < 16 ? 'morning' : h < 22 ? 'afternoon' : 'evening';
  })();
  const locale = report.locale ?? 'ko';
  return `${kst}:${session}:${locale}`;
}

// ── public API ────────────────────────────────────────────────────────────────

/** 보고서 저장 (또는 갱신). 같은 (date, session, locale) 은 upsert. */
export function saveReport(report) {
  const db = openDb();
  const id = inferReportId(report);
  const gen = report.generatedAt ?? new Date().toISOString();
  const kst = new Date(new Date(gen).getTime() + 9*3600000).toISOString().slice(0, 10);
  const session = report.session ?? id.split(':')[1];
  const locale = report.locale ?? id.split(':')[2];

  db.prepare(`
    INSERT INTO reports (id, generated_at, kst_date, session, locale, source, stance, risk_level, thesis, quality_score, full_json, audit_json)
    VALUES (@id, @generated_at, @kst_date, @session, @locale, @source, @stance, @risk_level, @thesis, @quality_score, @full_json, @audit_json)
    ON CONFLICT(id) DO UPDATE SET
      generated_at = excluded.generated_at,
      source       = excluded.source,
      stance       = excluded.stance,
      risk_level   = excluded.risk_level,
      thesis       = excluded.thesis,
      quality_score= excluded.quality_score,
      full_json    = excluded.full_json,
      audit_json   = excluded.audit_json
  `).run({
    id,
    generated_at: gen,
    kst_date: kst,
    session,
    locale,
    source: report.source ?? 'unknown',
    stance: report.stance ?? null,
    risk_level: report.riskLevel ?? null,
    thesis: (report.thesis ?? '').slice(0, 500),
    quality_score: typeof report.qualityScore === 'number' ? report.qualityScore : null,
    full_json: JSON.stringify(report),
    audit_json: report.harnessAudit ? JSON.stringify(report.harnessAudit) : null,
  });
  return id;
}

/** 엔드포인트 응답 스냅샷 한 건 저장. response 객체 그대로 받음. */
export function saveSnapshot({ reportId, endpoint, status, response, capturedAt, durationMs }) {
  const db = openDb();
  const sourceField = typeof response === 'object' && response !== null
    ? (response.source ?? response.dataSource ?? null) : null;
  db.prepare(`
    INSERT INTO endpoint_snapshots
      (report_id, endpoint, captured_at, http_status, source, ok, response_json, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reportId, endpoint, capturedAt ?? new Date().toISOString(),
    status ?? null, sourceField,
    response && (status === 200 || status === undefined) ? 1 : 0,
    JSON.stringify(response ?? null),
    durationMs ?? null,
  );
}

/** portfolio entry → recommendation row 변환 + 저장. report.id 필요. */
export function saveRecommendations(report, reportId) {
  if (!Array.isArray(report.portfolio)) return 0;
  const db = openDb();
  const gen = report.generatedAt ?? new Date().toISOString();
  const kst = new Date(new Date(gen).getTime() + 9*3600000).toISOString().slice(0, 10);
  const session = reportId.split(':')[1];
  const evalAfter = new Date(new Date(gen).getTime() + 14*86400000).toISOString();

  const stmt = db.prepare(`
    INSERT INTO recommendations
      (id, report_id, generated_at, ticker, name, market, sector,
       action, confidence, allocation,
       entry_low, entry_high, target, target_bull, stop_loss,
       price_at_gen, currency, rationale, evaluate_after)
    VALUES
      (@id, @report_id, @generated_at, @ticker, @name, @market, @sector,
       @action, @confidence, @allocation,
       @entry_low, @entry_high, @target, @target_bull, @stop_loss,
       @price_at_gen, @currency, @rationale, @evaluate_after)
    ON CONFLICT(id) DO UPDATE SET
      action       = excluded.action,
      confidence   = excluded.confidence,
      allocation   = excluded.allocation,
      entry_low    = excluded.entry_low,
      entry_high   = excluded.entry_high,
      target       = excluded.target,
      target_bull  = excluded.target_bull,
      stop_loss    = excluded.stop_loss,
      price_at_gen = excluded.price_at_gen,
      rationale    = excluded.rationale,
      evaluate_after = excluded.evaluate_after
  `);

  const tx = db.transaction((entries) => {
    for (const p of entries) {
      if (!p?.ticker || p.action === 'hold') continue;
      const [lo, hi] = parseZone(p.entryZone);
      stmt.run({
        id: `${kst}:${session}:${p.ticker}`,
        report_id: reportId,
        generated_at: gen,
        ticker: p.ticker,
        name: p.name ?? null,
        market: p.market ?? null,
        sector: p.sector ?? null,
        action: p.action ?? 'watch',
        confidence: p.confidence ?? null,
        allocation: typeof p.allocation === 'number' ? p.allocation : null,
        entry_low: lo, entry_high: hi,
        target: parsePrice(p.target),
        target_bull: parsePrice(p.targetBull),
        stop_loss: parsePrice(p.stopLoss),
        price_at_gen: typeof p.currentPrice === 'number' ? p.currentPrice : null,
        currency: detectCurrency(p.entryZone, p.stopLoss, p.target),
        rationale: (p.rationale ?? '').slice(0, 500),
        evaluate_after: evalAfter,
      });
    }
  });
  tx(report.portfolio);
  return report.portfolio.length;
}

/** Outcome 한 건 기록 (recommendation 평가 결과). */
export function saveOutcome(rec) {
  const db = openDb();
  db.prepare(`
    INSERT INTO recommendation_outcomes
      (recommendation_id, evaluated_at, price_at_eval, outcome, pnl_pct,
       ohlc_days, high_seen, low_seen, spy_return, quality_score, details_json)
    VALUES
      (@recommendation_id, @evaluated_at, @price_at_eval, @outcome, @pnl_pct,
       @ohlc_days, @high_seen, @low_seen, @spy_return, @quality_score, @details_json)
    ON CONFLICT(recommendation_id, evaluated_at) DO UPDATE SET
      price_at_eval = excluded.price_at_eval,
      outcome       = excluded.outcome,
      pnl_pct       = excluded.pnl_pct,
      ohlc_days     = excluded.ohlc_days,
      high_seen     = excluded.high_seen,
      low_seen      = excluded.low_seen,
      spy_return    = excluded.spy_return,
      quality_score = excluded.quality_score,
      details_json  = excluded.details_json
  `).run({
    recommendation_id: rec.recommendation_id,
    evaluated_at: rec.evaluated_at ?? new Date().toISOString(),
    price_at_eval: rec.price_at_eval ?? null,
    outcome: rec.outcome,
    pnl_pct: rec.pnl_pct ?? null,
    ohlc_days: rec.ohlc_days ?? null,
    high_seen: rec.high_seen ?? null,
    low_seen: rec.low_seen ?? null,
    spy_return: rec.spy_return ?? null,
    quality_score: rec.quality_score ?? null,
    details_json: rec.details ? JSON.stringify(rec.details) : null,
  });
}

/** 평가 대기 (overdue) 추천 목록 — 14일 경과 + outcome 아직 없는 것. */
export function getOverdueRecommendations(asOf = new Date().toISOString()) {
  const db = openDb();
  return db.prepare(`
    SELECT r.*
    FROM recommendations r
    LEFT JOIN recommendation_outcomes o ON o.recommendation_id = r.id
    WHERE r.evaluate_after <= ?
      AND o.id IS NULL
    ORDER BY r.evaluate_after ASC
  `).all(asOf);
}

/** 전체 추천 (14d 윈도우 무시) — 조기 baseline 측정용. */
export function getAllRecommendationsForEval() {
  const db = openDb();
  return db.prepare(`
    SELECT r.*
    FROM recommendations r
    LEFT JOIN recommendation_outcomes o ON o.recommendation_id = r.id
    WHERE o.id IS NULL
    ORDER BY r.generated_at ASC
  `).all();
}

/** ticker 별 outcome 통계 — Phase 1 컬링/가중치 결정용. */
export function getTickerStats() {
  const db = openDb();
  return db.prepare(`
    SELECT r.ticker,
           COUNT(o.id)                                                   AS evaluated,
           SUM(CASE WHEN o.outcome='hit_target'    THEN 1 ELSE 0 END)    AS hits,
           SUM(CASE WHEN o.outcome='stop_loss'     THEN 1 ELSE 0 END)    AS stops,
           SUM(CASE WHEN o.outcome='not_entered'   THEN 1 ELSE 0 END)    AS skipped,
           SUM(CASE WHEN o.outcome='still_holding' THEN 1 ELSE 0 END)    AS holding,
           ROUND(AVG(o.pnl_pct), 2)                                      AS avg_pnl,
           ROUND(AVG(CASE WHEN o.outcome IN ('hit_target','stop_loss')
                          THEN o.pnl_pct END), 2)                        AS realized_pnl,
           MIN(r.generated_at)                                            AS first_seen,
           MAX(r.generated_at)                                            AS last_seen,
           COUNT(DISTINCT r.id)                                           AS total_recs
    FROM recommendations r
    LEFT JOIN recommendation_outcomes o ON o.recommendation_id = r.id
    GROUP BY r.ticker
    HAVING total_recs > 0
    ORDER BY evaluated DESC, hits DESC
  `).all();
}

/**
 * Ticker 별 NE / hit 패턴 + entry 부족분 — 환각 prevention prompt feedback 용.
 * "이 ticker는 entry 너무 낮게 잡음, X% 올려야 함" 같은 cue 를 LLM 에 주입.
 */
export function getEntryFeedbackStats() {
  const db = openDb();
  return db.prepare(`
    SELECT r.ticker,
      COUNT(*) AS total,
      SUM(CASE WHEN o.outcome='hit_target' THEN 1 ELSE 0 END) AS hits,
      SUM(CASE WHEN o.outcome='not_entered' THEN 1 ELSE 0 END) AS ne,
      SUM(CASE WHEN o.outcome='stop_loss' THEN 1 ELSE 0 END) AS stops,
      ROUND(AVG(CASE WHEN o.outcome='not_entered' THEN r.entry_high END), 2) AS avg_ne_entry,
      ROUND(AVG(CASE WHEN o.outcome='not_entered' THEN o.price_at_eval END), 2) AS avg_ne_actual,
      ROUND(AVG(CASE WHEN o.outcome='hit_target' THEN r.entry_high END), 2) AS avg_hit_entry
    FROM recommendations r
    JOIN recommendation_outcomes o ON o.recommendation_id = r.id
    WHERE r.action = 'buy'
      AND o.evaluated_at >= datetime('now', '-30 days')
    GROUP BY r.ticker
    HAVING total >= 3
    ORDER BY ne DESC
    LIMIT 20
  `).all();
}

/** 요약 통계. */
export function getSummary() {
  const db = openDb();
  const reports     = db.prepare('SELECT COUNT(*) as n FROM reports').get().n;
  const snapshots   = db.prepare('SELECT COUNT(*) as n FROM endpoint_snapshots').get().n;
  const recs        = db.prepare('SELECT COUNT(*) as n FROM recommendations').get().n;
  const outcomes    = db.prepare('SELECT COUNT(*) as n FROM recommendation_outcomes').get().n;
  const pending     = db.prepare("SELECT COUNT(*) as n FROM recommendations r LEFT JOIN recommendation_outcomes o ON o.recommendation_id = r.id WHERE r.evaluate_after > datetime('now') AND o.id IS NULL").get().n;
  const overdue     = db.prepare("SELECT COUNT(*) as n FROM recommendations r LEFT JOIN recommendation_outcomes o ON o.recommendation_id = r.id WHERE r.evaluate_after <= datetime('now') AND o.id IS NULL").get().n;
  const byOutcome   = db.prepare("SELECT outcome, COUNT(*) as n FROM recommendation_outcomes GROUP BY outcome").all();
  const byEndpoint  = db.prepare("SELECT endpoint, COUNT(*) as n FROM endpoint_snapshots GROUP BY endpoint ORDER BY n DESC").all();
  return { reports, snapshots, recs, outcomes, pending, overdue, byOutcome, byEndpoint };
}

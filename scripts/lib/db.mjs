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

-- 2026-05-29: 뉴스 장기 아카이브 (30년 누적 — point-in-time 검색 가능)
-- 매 보고서 cycle 마다 news-cascade + supplyChainChanges + companyChanges 헤드라인 저장.
-- report_id 로 endpoint_snapshots / recommendations / outcomes 와 join → 그 시점의
-- 시장심리/macro/추천/실제 가격 반응 종합 컨텍스트 검색 가능.
CREATE TABLE IF NOT EXISTS news_archive (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id   TEXT,                     -- 원본 article id (dedup key)
  source        TEXT NOT NULL,            -- news-cascade / supply-chain / company-change / cascade-event
  ticker        TEXT,                     -- 대표 ticker (null = macro/global)
  tickers_json  TEXT,                     -- 관련 ticker 배열 ['NVDA','TSM']
  headline      TEXT NOT NULL,
  summary       TEXT,
  pub_date      TEXT,                     -- 원본 게시일 (RSS pubDate)
  captured_at   TEXT NOT NULL,
  sentiment     TEXT,                     -- bullish/bearish/neutral
  importance    TEXT,                     -- high/medium/low
  signal_type   TEXT,                     -- supply_risk/contract_win/earnings 등
  direction     TEXT,                     -- positive/negative/neutral
  link          TEXT,
  cascades_json TEXT,                     -- LLM cascade 분석 (영향 받는 ticker)
  raw_json      TEXT,                     -- 전체 원본 (자료 보존)
  report_id     TEXT,                     -- 어느 보고서 cycle 에서 발견 (join key)
  locale        TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_news_ticker     ON news_archive(ticker, pub_date);
CREATE INDEX IF NOT EXISTS idx_news_pub_date   ON news_archive(pub_date);
CREATE INDEX IF NOT EXISTS idx_news_source     ON news_archive(source);
CREATE INDEX IF NOT EXISTS idx_news_sentiment  ON news_archive(sentiment, importance);
CREATE INDEX IF NOT EXISTS idx_news_report     ON news_archive(report_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_news_ext_src ON news_archive(external_id, source) WHERE external_id IS NOT NULL;

-- FTS5 full-text search (검색용 — "Powell rate cut" 같은 자연어 query)
CREATE VIRTUAL TABLE IF NOT EXISTS news_archive_fts USING fts5(
  headline, summary, ticker, sentiment, signal_type,
  content=news_archive, content_rowid=id,
  tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS news_archive_ai AFTER INSERT ON news_archive BEGIN
  INSERT INTO news_archive_fts(rowid, headline, summary, ticker, sentiment, signal_type)
  VALUES (new.id, new.headline, new.summary, new.ticker, new.sentiment, new.signal_type);
END;
CREATE TRIGGER IF NOT EXISTS news_archive_ad AFTER DELETE ON news_archive BEGIN
  INSERT INTO news_archive_fts(news_archive_fts, rowid, headline, summary, ticker, sentiment, signal_type)
  VALUES ('delete', old.id, old.headline, old.summary, old.ticker, old.sentiment, old.signal_type);
END;

-- 뉴스 후 가격 반응 (전향적 평가 cron 이 1d/5d/30d 후 채움)
CREATE TABLE IF NOT EXISTS news_price_reactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id         INTEGER NOT NULL,
  ticker          TEXT NOT NULL,
  pub_date        TEXT NOT NULL,
  pnl_1d          REAL,
  pnl_5d          REAL,
  pnl_30d         REAL,
  high_5d         REAL,
  low_5d          REAL,
  spy_return_5d   REAL,
  alpha_5d        REAL,
  evaluated_at    TEXT NOT NULL,
  FOREIGN KEY (news_id) REFERENCES news_archive(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_news_react ON news_price_reactions(news_id, ticker);
CREATE INDEX IF NOT EXISTS idx_react_ticker ON news_price_reactions(ticker, pub_date);

-- 시점 핵심 macro 압축 (endpoint_snapshots JSON 무거워 query 느림 → 핵심 column 분리)
CREATE TABLE IF NOT EXISTS macro_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id    TEXT NOT NULL,
  captured_at  TEXT NOT NULL,
  fg_score     INTEGER,                   -- Fear & Greed
  fg_label     TEXT,
  vix          REAL,
  cpi          REAL,
  fed_rate     REAL,
  yield_10y    REAL,
  yield_2y     REAL,
  yield_spread REAL,
  hy_oas       REAL,
  ig_oas       REAL,
  gdp_growth   REAL,
  spy_close    REAL,
  qqq_close    REAL,
  risk_level   TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_macro_report ON macro_snapshots(report_id);
CREATE INDEX IF NOT EXISTS idx_macro_captured ON macro_snapshots(captured_at);

-- 2026-05-29: 숏 스퀴즈 아카이브 (시점 별 검색 + 추세 추적)
CREATE TABLE IF NOT EXISTS short_squeeze_archive (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT NOT NULL,
  captured_at   TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  score         INTEGER,                  -- squeeze score 0-100
  short_ratio   REAL,                     -- days to cover
  short_pct     REAL,                     -- short interest / float %
  timing        TEXT,                     -- LLM 분석 timing
  risk          TEXT,                     -- LLM 분석 risk
  rationale     TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_squeeze_ticker ON short_squeeze_archive(ticker, captured_at);
CREATE INDEX IF NOT EXISTS idx_squeeze_score ON short_squeeze_archive(score DESC);

-- 2026-05-29: 기업 실적 아카이브 (분기별 매출/이익 추적)
CREATE TABLE IF NOT EXISTS earnings_archive (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT,
  captured_at     TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  quarter         TEXT,                   -- 'Q1 FY2027' / '2026-Q1'
  revenue         REAL,                   -- 매출 (USD billions)
  revenue_yoy     REAL,                   -- YoY %
  op_margin       REAL,                   -- 영업이익률 %
  net_income      REAL,
  pe_ratio        REAL,
  guidance        TEXT,                   -- raised/lowered/maintained
  sentiment       TEXT,                   -- positive/negative/neutral
  source          TEXT,                   -- 'company-financials' / 'company-kr' / 'companyChanges'
  raw_json        TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_earnings_ticker ON earnings_archive(ticker, captured_at);
CREATE INDEX IF NOT EXISTS idx_earnings_quarter ON earnings_archive(ticker, quarter);

-- 2026-05-29: insider trades 아카이브 (집중 매수/매도 추적)
CREATE TABLE IF NOT EXISTS insider_archive (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT,
  captured_at     TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  filings_count   INTEGER,                -- 집중 신고 건수
  date_range      TEXT,
  significance    TEXT,
  pattern         TEXT,
  direction       TEXT,                   -- buy/sell/mixed
  raw_json        TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_insider_ticker ON insider_archive(ticker, captured_at);

-- 2026-05-29: Fear & Greed 국가별 시점 아카이브 (10국가 × 매 cycle)
CREATE TABLE IF NOT EXISTS fg_archive (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT,
  captured_at   TEXT NOT NULL,
  country       TEXT NOT NULL,           -- us/korea/japan/china/europe/uk/india/brazil/australia/global
  score         INTEGER NOT NULL,        -- 0-100
  prev_score    INTEGER,
  delta         INTEGER,                  -- score - prev_score
  level         TEXT,                    -- extreme_fear/fear/neutral/greed/extreme_greed
  trend         TEXT,                    -- up/down/neutral
  driver        TEXT,                    -- 핵심 driver 텍스트
  source        TEXT,                    -- cnn/composite/yahoo
  data_quality  TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_fg_country  ON fg_archive(country, captured_at);
CREATE INDEX IF NOT EXISTS idx_fg_score    ON fg_archive(score);
CREATE INDEX IF NOT EXISTS idx_fg_captured ON fg_archive(captured_at);

-- 2026-05-29: 자산 별 자금 흐름 (4w/1w return 등 — capital-flows + fear-greed asset)
CREATE TABLE IF NOT EXISTS asset_flow_archive (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT,
  captured_at   TEXT NOT NULL,
  asset         TEXT NOT NULL,           -- SPY / QQQ / GLD / TLT / BTC 등
  return_4w     REAL,
  return_1w     REAL,
  return_1d     REAL,
  trend         TEXT,
  source        TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_flow_asset ON asset_flow_archive(asset, captured_at);

-- 2026-05-29: 매도 추천 적재 + Karpathy pathway (closed loop) outcome 평가용.
--   sell_recommendations 가 매 보고서 cycle 마다 적재 → tune-sell-rules.mjs 가
--   주 1회 outcome 평가 → 룰 임계값 자동 조정 → 다음 cycle prompt 에 inject.
CREATE TABLE IF NOT EXISTS sell_recommendations (
  id              TEXT PRIMARY KEY,         -- 'YYYY-MM-DD:session:ticker'
  report_id       TEXT NOT NULL,
  generated_at    TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  market          TEXT,                     -- us / kr
  sector          TEXT,
  sell_type       TEXT,                     -- stop_breach / stop_near / target_near / rotation_profit / rotation_loss / rotation_neutral
  urgency         TEXT,                     -- high / medium / low
  score           INTEGER,
  current_price   REAL,
  entry_price     REAL,
  target          REAL,
  stop_loss       REAL,
  pnl_pct         REAL,
  held_days       INTEGER,
  rationale       TEXT,
  evaluate_after  TEXT NOT NULL,            -- generated_at + 14d
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sell_ticker     ON sell_recommendations(ticker);
CREATE INDEX IF NOT EXISTS idx_sell_eval_after ON sell_recommendations(evaluate_after);
CREATE INDEX IF NOT EXISTS idx_sell_sell_type  ON sell_recommendations(sell_type);

CREATE TABLE IF NOT EXISTS sell_outcomes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sell_rec_id       TEXT NOT NULL,
  evaluated_at      TEXT NOT NULL,
  price_at_eval     REAL,
  -- avoided_loss = 매도 후 가격 하락분 (매도 시점 대비)
  -- missed_gain  = 매도 후 가격 상승분 (성급한 매도 = missed opportunity)
  price_delta_pct   REAL,                   -- (eval_price - sell_price) / sell_price * 100
  outcome           TEXT NOT NULL,          -- correct_sell (가격 하락) / premature (가격 상승) / neutral
  ohlc_days         INTEGER,                -- 평가 기간 (보통 14d)
  high_seen         REAL,                   -- 평가 기간 내 최고가
  low_seen          REAL,                   -- 평가 기간 내 최저가
  FOREIGN KEY (sell_rec_id) REFERENCES sell_recommendations(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sellout_rec_eval ON sell_outcomes(sell_rec_id, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_sellout_evaluated ON sell_outcomes(evaluated_at);

-- 2026-05-29: 매수 candidate scoring 적재 — top 30 + 룰별 score breakdown.
--   사후 분석 (어떤 룰 카테고리가 hit 에 기여했는지) + buy-rules-tuned outcome 학습 source.
CREATE TABLE IF NOT EXISTS buy_candidates (
  id              TEXT PRIMARY KEY,         -- 'YYYY-MM-DD:session:ticker'
  report_id       TEXT NOT NULL,
  generated_at    TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  market          TEXT,                     -- us / kr
  sector          TEXT,
  rank            INTEGER,                  -- 1~30
  total_score     INTEGER NOT NULL,
  selected        INTEGER NOT NULL,         -- 0/1: 최종 12 portfolio 에 포함됐는지
  matched_rules   TEXT,                     -- JSON array [{ ruleId, category, score, reason }]
  category_scores TEXT,                     -- JSON object { price: 5, tech: 10, fund: 4, ... }
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_buycand_ticker  ON buy_candidates(ticker);
CREATE INDEX IF NOT EXISTS idx_buycand_report  ON buy_candidates(report_id);
CREATE INDEX IF NOT EXISTS idx_buycand_score   ON buy_candidates(total_score DESC);

-- 2026-05-30: Karpathy pathway closed loop — 발견된 LLM 환각 영구 기록.
--   verify-report 가 결함 발견 → 여기 적재 → 다음 보고서 prompt 에 anti-pattern inject.
--   목적: 같은 환각 (예: SK하이닉스 sector="Construction") 이 반복되지 않도록 LLM 학습.
CREATE TABLE IF NOT EXISTS hallucination_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT NOT NULL,
  detected_at     TEXT NOT NULL,
  ticker          TEXT,                       -- 결함 ticker (있으면)
  defect_type     TEXT NOT NULL,              -- sector_mismatch / 52w_halluc / ma_halluc / nesp / price_halluc / identity_translation / ticker_halluc
  llm_value       TEXT,                       -- LLM 가 출력한 잘못된 값
  correct_value   TEXT,                       -- meta 또는 sanity check 의 정답
  severity        TEXT NOT NULL,              -- low / medium / high
  injected_count  INTEGER NOT NULL DEFAULT 0, -- 다음 prompt 에 몇 번 inject 됐는지 (학습 추적)
  details_json    TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_halluc_ticker     ON hallucination_history(ticker);
CREATE INDEX IF NOT EXISTS idx_halluc_type       ON hallucination_history(defect_type);
CREATE INDEX IF NOT EXISTS idx_halluc_detected   ON hallucination_history(detected_at DESC);
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

/**
 * 2026-05-29: news_archive 적재. 매 보고서 cycle 마다 news/supply/companyChange 헤드라인 저장.
 * external_id+source dedup — 같은 article 여러 보고서에 등장해도 1 row.
 *
 * 입력 형식 (병합):
 *   newsArticles: [{ id, ticker, title, summary, sentiment, importance, pubDate, source, link, cascades }]
 *   supplyChainChanges: [{ ticker, headline, direction, signalType, source, date, downstreamBeneficiaries }]
 *   companyChanges: [{ ticker, name, keyChange, sentiment, latestQuarter }]
 */
export function saveNewsArchive({ reportId, locale, newsArticles = [], supplyChainChanges = [], companyChanges = [] }) {
  const db = openDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO news_archive
      (external_id, source, ticker, tickers_json, headline, summary, pub_date,
       captured_at, sentiment, importance, signal_type, direction, link, cascades_json, raw_json, report_id, locale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const txn = db.transaction(() => {
    // 1) news-cascade articles
    for (const a of newsArticles) {
      const tickers = Array.from(new Set((a.cascades ?? []).map(c => c.asset).filter(Boolean)));
      const r = stmt.run(
        a.id ?? null, 'news-cascade',
        tickers[0] ?? null, JSON.stringify(tickers),
        a.title ?? a.headline ?? '', a.summary ?? '',
        a.pubDate ?? null, now,
        a.sentiment ?? null, a.importance ?? null, null, null,
        a.link ?? null,
        JSON.stringify(a.cascades ?? []),
        JSON.stringify(a),
        reportId, locale ?? 'en',
      );
      if (r.changes > 0) inserted++;
    }
    // 2) supplyChainChanges (2026-05-29 매핑 보강 — summary/sign 채움)
    for (const s of supplyChainChanges) {
      const tickers = [s.ticker, ...(s.downstreamBeneficiaries ?? [])].filter(Boolean);
      const extId = `supply:${s.ticker}:${(s.headline ?? '').slice(0, 60)}`;
      const summary = s.downstreamBeneficiaries?.length
        ? `↘ 수혜: ${s.downstreamBeneficiaries.join(', ')}`
        : (s.signalType ? `signal=${s.signalType}` : null);
      const r = stmt.run(
        extId, 'supply-chain',
        s.ticker ?? null, JSON.stringify(tickers),
        s.headline ?? '', summary,
        s.date ?? null, now,
        s.direction === 'positive' ? 'bullish' : s.direction === 'negative' ? 'bearish' : 'neutral',
        s.conviction >= 75 ? 'high' : s.conviction >= 50 ? 'medium' : 'low',
        s.signalType ?? null, s.direction ?? null,
        s.evidenceUrl ?? null, null,
        JSON.stringify(s),
        reportId, locale ?? 'en',
      );
      if (r.changes > 0) inserted++;
    }
    // 3) companyChanges (2026-05-29 매핑 보강 — summary=keyChange, signal=earnings, importance/direction)
    for (const c of companyChanges) {
      const extId = `company:${c.ticker}:${(c.keyChange ?? '').slice(0, 60)}`;
      const direction = c.sentiment === 'positive' ? 'positive'
        : c.sentiment === 'negative' ? 'negative' : 'neutral';
      const importance = c.guidance === 'raised' ? 'high'
        : c.guidance === 'lowered' ? 'high'
        : c.guidance === 'maintained' ? 'medium' : 'low';
      const r = stmt.run(
        extId, 'company-change',
        c.ticker ?? null, JSON.stringify([c.ticker]),
        c.keyChange ?? '', c.latestQuarter ? `Quarter: ${c.latestQuarter}, guidance=${c.guidance ?? '?'}` : null,
        null, now,
        c.sentiment ?? 'neutral', importance,
        'earnings', direction,
        null,
        JSON.stringify(c),
        JSON.stringify(c),
        reportId, locale ?? 'en',
      );
      if (r.changes > 0) inserted++;
    }
  });
  txn();
  return inserted;
}

/**
 * 2026-05-29: 매 보고서 cycle 의 핵심 macro 시점 스냅샷 압축 저장.
 * endpoint_snapshots 의 JSON 무거워 query 느림 → fg/vix/cpi/금리/yield 등 핵심 column.
 */
export function saveMacroSnapshot({ reportId, capturedAt, ctxRaw, macroData }) {
  const db = openDb();
  const ind = ctxRaw?.macro?.indicators ?? [];
  const findInd = id => ind.find(i => i.id === id || i.id === id.replace('_','-'))?.actual ?? null;
  // 2026-05-29: endpoint_snapshots 직접 query — ctxRaw 누락 시 보강
  let snapVix = null, snapYields = null, snapFlows = null;
  if (reportId) {
    try {
      const volRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/volatility'`).get(reportId);
      if (volRow) snapVix = JSON.parse(volRow.response_json)?.vix ?? null;
      const ycRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/yield-curve'`).get(reportId);
      if (ycRow) snapYields = JSON.parse(ycRow.response_json);
      const cfRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/capital-flows'`).get(reportId);
      if (cfRow) snapFlows = JSON.parse(cfRow.response_json);
    } catch { /* skip */ }
  }
  const todayYields = snapYields?.today ?? [];
  const findYield = lbl => todayYields.find(y => y.label === lbl)?.value ?? null;
  const fg = ctxRaw?.fearGreed ?? ctxRaw?.fear_greed;
  // 2026-05-29: byCountry array 처리 — us 찾아서 score 추출 (기존 fg.score 단일 형식 우회)
  const fgUs = (() => {
    if (!fg) return null;
    if (typeof fg.score === 'number') return fg; // 단일 형식
    if (Array.isArray(fg.byCountry)) return fg.byCountry.find(c => c.id === 'us') ?? null;
    if (fg.byCountry?.us) return fg.byCountry.us;
    return null;
  })();
  const yc = ctxRaw?.yieldCurve ?? ctxRaw?.yield_curve;
  const yields = yc?.today ?? {};
  db.prepare(`
    INSERT OR REPLACE INTO macro_snapshots
      (report_id, captured_at, fg_score, fg_label, vix, cpi, fed_rate,
       yield_10y, yield_2y, yield_spread, hy_oas, ig_oas, gdp_growth,
       spy_close, qqq_close, risk_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reportId, capturedAt ?? new Date().toISOString(),
    fgUs?.score ?? null,
    fgUs?.level ?? fgUs?.label ?? null,
    // 2026-05-29: VIX 는 /api/volatility 응답, yields 는 /api/yield-curve.today 배열에서 찾기
    findInd('vix') ?? snapVix,
    findInd('cpi') ?? findInd('us_cpi'),
    // 2026-05-29 Codex 진단: macro-indicators route 의 실제 id 는 'fomc' / 'ig_spread'
    findInd('fed_rate') ?? findInd('fomc') ?? findInd('fedfunds'),
    findYield('10Y') ?? yields?.['10Y'] ?? yields?.['10y'] ?? null,
    findYield('2Y') ?? yields?.['2Y'] ?? yields?.['2y'] ?? null,
    snapYields?.spread2s10sCurrent ?? snapYields?.spread2s10s ?? yc?.spread10y2y ?? null,
    findInd('hy_oas') ?? findInd('hy_spread'),
    findInd('ig_oas') ?? findInd('ig_spread'),
    findInd('gdp') ?? findInd('gdp_growth'),
    snapFlows?.assets?.find(a => a.ticker === 'SPY')?.sparkline?.at(-1) ?? ctxRaw?.capital?.spy?.close ?? null,
    snapFlows?.assets?.find(a => a.ticker === 'QQQ')?.sparkline?.at(-1) ?? ctxRaw?.capital?.qqq?.close ?? null,
    macroData?.riskLevel ?? null,
  );
}

/**
 * 2026-05-29: Fear & Greed 국가별 + asset flow 적재.
 * /api/fear-greed 응답 (byCountry 배열) 그대로 받아서 10국가 × row 적재.
 */
export function saveFearGreedArchive({ reportId, capturedAt, fgResponse, capitalFlowsResponse }) {
  const db = openDb();
  const now = capturedAt ?? new Date().toISOString();
  const txn = db.transaction(() => {
    // byCountry array
    const byCountry = Array.isArray(fgResponse?.byCountry) ? fgResponse.byCountry
      : (fgResponse?.byCountry ? Object.values(fgResponse.byCountry) : []);
    const fgStmt = db.prepare(`
      INSERT INTO fg_archive
        (report_id, captured_at, country, score, prev_score, delta, level, trend, driver, source, data_quality)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of byCountry) {
      if (!c?.id || typeof c.score !== 'number') continue;
      const delta = (typeof c.prevScore === 'number') ? c.score - c.prevScore : null;
      fgStmt.run(reportId, now, c.id, c.score, c.prevScore ?? null, delta,
        c.level ?? null, c.trend ?? null,
        (c.driver ?? '').slice(0, 200), c.source ?? null, c.dataQuality ?? null);
    }
    // asset flow (fear-greed.byAsset + capital-flows.assets)
    const flowStmt = db.prepare(`
      INSERT INTO asset_flow_archive
        (report_id, captured_at, asset, return_4w, return_1w, return_1d, trend, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const byAsset = Array.isArray(fgResponse?.byAsset) ? fgResponse.byAsset
      : (fgResponse?.byAsset ? Object.values(fgResponse.byAsset) : []);
    for (const a of byAsset) {
      if (!a?.id) continue;
      flowStmt.run(reportId, now, a.id,
        a.return4w ?? null, a.return1w ?? null, a.return1d ?? null,
        a.trend ?? null, 'fear-greed');
    }
    const flowAssets = Array.isArray(capitalFlowsResponse?.assets) ? capitalFlowsResponse.assets : [];
    for (const a of flowAssets) {
      const sym = a.symbol ?? a.ticker ?? a.id;
      if (!sym) continue;
      // 2026-05-29: capital-flows 응답 형식 ret4w/ret1w/ret13w (camelCase 단축)
      flowStmt.run(reportId, now, sym,
        a.ret4w ?? a.return4w ?? a.return_4w ?? null,
        a.ret1w ?? a.return1w ?? a.return_1w ?? null,
        a.ret1d ?? a.return1d ?? a.return_1d ?? null,
        a.trend ?? null, 'capital-flows');
    }
  });
  txn();
}

/**
 * 2026-05-29: 숏 스퀴즈 + 기업 실적 + insider 아카이브 적재.
 * 매 보고서 cycle 마다 호출 — point-in-time 추세 추적 가능.
 */
export function saveDomainArchives({ reportId, capturedAt, shortSqueeze = [], companyChanges = [], insiderSignals = [], companyFinancials = null }) {
  const db = openDb();
  const now = capturedAt ?? new Date().toISOString();
  // 2026-05-29 Codex 진단: short-interest endpoint_snapshots 에서 shortFloatPct/shortRatio
  // ticker 별 조회 → shortSqueeze entry 와 join (보고서 안에 필드 없는 결함 해결)
  let shortByTicker = {};
  if (reportId) {
    try {
      const siRow = db.prepare(`SELECT response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint='/api/short-interest'`).get(reportId);
      if (siRow) {
        const entries = JSON.parse(siRow.response_json)?.entries ?? [];
        for (const e of entries) {
          if (e.ticker) shortByTicker[e.ticker.toUpperCase()] = e;
        }
      }
    } catch { /* skip */ }
  }
  // company-financials snapshots 도 ticker 별 매핑
  // 2026-05-30: caller 가 companyFinancials 직접 전달 시 우선 사용 — endpoint_snapshots 시점 의존성 제거.
  //   원인: saveDomainArchives 호출 시점에 snapshotAllEndpoints 가 아직 안 됐을 가능성 (실제로 그랬음)
  let finByTicker = {};
  if (companyFinancials && typeof companyFinancials === 'object') {
    // 형식: { NVDA: {...}, TSLA: {...} } 또는 Map
    if (companyFinancials instanceof Map) {
      for (const [k, v] of companyFinancials) finByTicker[(k ?? '').toUpperCase()] = v;
    } else {
      for (const [k, v] of Object.entries(companyFinancials)) finByTicker[(k ?? '').toUpperCase()] = v;
    }
  } else if (reportId) {
    try {
      const finRows = db.prepare(`SELECT endpoint, response_json FROM endpoint_snapshots WHERE report_id=? AND endpoint LIKE '/api/company-financials/%'`).all(reportId);
      for (const f of finRows) {
        const ticker = f.endpoint.split('/').pop()?.toUpperCase();
        if (ticker) {
          try { finByTicker[ticker] = JSON.parse(f.response_json); } catch {}
        }
      }
    } catch { /* skip */ }
  }
  const txn = db.transaction(() => {
    // 숏 스퀴즈 — short-interest snapshot join 으로 short_ratio/short_pct 채움
    const sqStmt = db.prepare(`
      INSERT INTO short_squeeze_archive
        (report_id, captured_at, ticker, score, short_ratio, short_pct, timing, risk, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of shortSqueeze) {
      const tkUp = (s.ticker ?? '').toUpperCase();
      const siEntry = shortByTicker[tkUp];
      sqStmt.run(reportId, now, s.ticker ?? '', s.score ?? null,
        s.shortRatio ?? siEntry?.shortRatio ?? null,
        s.shortPct ?? siEntry?.shortFloatPct ?? siEntry?.shortPct ?? null,
        s.timing ?? null, s.risk ?? null, s.rationale ?? siEntry?.rationale ?? null);
    }
    // 기업 실적 (companyChanges + company-financials snapshot 결합)
    const erStmt = db.prepare(`
      INSERT INTO earnings_archive
        (report_id, captured_at, ticker, quarter, revenue, revenue_yoy, op_margin,
         net_income, pe_ratio, guidance, sentiment, source, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of companyChanges) {
      // 2026-05-29: keyChange 다양한 패턴 — \$X.XB / X억 달러 / X조 원 / +Y% YoY / Y% 증가
      const k = c.keyChange ?? '';
      let rev = null;
      const m1 = k.match(/\$(\d+\.?\d*)\s*B/i);
      if (m1) rev = parseFloat(m1[1]);
      else {
        const m2 = k.match(/(\d+(?:\.\d+)?)\s*억\s*달러/);  // X억 달러 = X/10 B
        if (m2) rev = parseFloat(m2[1]) / 10;
      }
      let yoy = c.revenueYoY ?? null;
      if (yoy == null) {
        const ym = k.match(/[+\-]?(\d+\.?\d*)\s*%\s*(?:YoY|증가|성장|상승)/i)
              ?? k.match(/전년\s*대비\s*[+\-]?(\d+\.?\d*)\s*%/);
        if (ym) yoy = parseFloat(ym[1]);
      }
      // 2026-05-29 Codex 진단: op_margin 추출 — keyChange regex + company-financials snapshot
      let opMargin = null;
      const om = k.match(/(?:operating\s+margin|opMgn|운영\s*마진|영업이익률)\s*[:=]?\s*(\d+\.?\d*)\s*%/i)
            ?? k.match(/(\d+\.?\d*)\s*%\s*(?:operating\s+margin|opMgn|운영\s*마진|영업이익률)/i);
      if (om) opMargin = parseFloat(om[1]);
      // company-financials snapshot 의 latestAnnual.operatingMarginPct 로 보강
      const finData = finByTicker[(c.ticker ?? '').toUpperCase()];
      if (opMargin == null && finData?.latestAnnual?.operatingMarginPct != null) {
        opMargin = finData.latestAnnual.operatingMarginPct;
      }
      // net_income / pe_ratio 도 finData 에서 시도
      const netIncome = finData?.latestAnnual?.netIncome ?? null;
      const peRatio = finData?.peRatio ?? finData?.latestAnnual?.peRatio ?? null;
      erStmt.run(reportId, now, c.ticker ?? '', c.latestQuarter ?? null,
        rev, yoy, opMargin, netIncome, peRatio,
        c.guidance ?? null, c.sentiment ?? null, 'companyChanges',
        JSON.stringify(c));
    }
    // insider trades
    const inStmt = db.prepare(`
      INSERT INTO insider_archive
        (report_id, captured_at, ticker, filings_count, date_range, significance, pattern, direction, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const i of insiderSignals) {
      inStmt.run(reportId, now, i.ticker ?? '', i.filings ?? null,
        i.dateRange ?? null, i.significance ?? null, i.pattern ?? null,
        /매도|sell/i.test(i.pattern ?? '') ? 'sell' : 'buy',
        JSON.stringify(i));
    }
  });
  txn();
}

/**
 * 2026-05-29: 검색 helper — FTS5 query + 시점 context auto-join.
 * 예: searchNewsContext('Powell rate cut') →
 *   각 뉴스 + 그 시점 fg/vix/cpi/yield + 그 보고서의 추천 + 가격 반응 (5d) 한 row 로 반환.
 */
export function searchNewsContext(query, limit = 20) {
  const db = openDb();
  return db.prepare(`
    SELECT
      n.id, n.headline, n.summary, n.ticker, n.tickers_json,
      n.pub_date, n.sentiment, n.importance, n.signal_type, n.source,
      r.id AS report_id, r.session, r.stance, r.thesis, r.quality_score,
      m.fg_score, m.fg_label, m.vix, m.cpi, m.fed_rate,
      m.yield_10y, m.yield_2y, m.yield_spread, m.risk_level,
      pr.pnl_1d, pr.pnl_5d, pr.pnl_30d, pr.alpha_5d
    FROM news_archive_fts fts
    JOIN news_archive n ON n.id = fts.rowid
    LEFT JOIN reports r ON r.id = n.report_id
    LEFT JOIN macro_snapshots m ON m.report_id = n.report_id
    LEFT JOIN news_price_reactions pr ON pr.news_id = n.id AND pr.ticker = n.ticker
    WHERE news_archive_fts MATCH ?
    ORDER BY n.pub_date DESC NULLS LAST
    LIMIT ?
  `).all(query, limit);
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
  // 2026-05-30: quality_score 자동 inject — caller 가 안 주면 reports.quality_score 로 fallback.
  //   100% NULL 결함 fix. outcome 학습 시 quality 별 hit rate 분석 가능.
  let qs = rec.quality_score ?? null;
  if (qs == null) {
    const row = db.prepare(`SELECT r2.quality_score FROM recommendations r1 JOIN reports r2 ON r2.id=r1.report_id WHERE r1.id=?`).get(rec.recommendation_id);
    qs = row?.quality_score ?? null;
  }
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
    quality_score: qs,
    details_json: rec.details ? JSON.stringify(rec.details) : null,
  });
}

/**
 * 2026-05-30: 과거 outcome row 의 NULL quality_score 일괄 backfill.
 *   recommendation_outcomes ↔ recommendations ↔ reports JOIN 으로 채움.
 *   cleanup-hallucinations.mjs 와 비슷한 retroactive helper.
 */
export function backfillOutcomeQualityScore() {
  const db = openDb();
  const r = db.prepare(`
    UPDATE recommendation_outcomes
    SET quality_score = (
      SELECT r2.quality_score
      FROM recommendations r1 JOIN reports r2 ON r2.id = r1.report_id
      WHERE r1.id = recommendation_outcomes.recommendation_id
    )
    WHERE quality_score IS NULL
  `).run();
  return r.changes;
}

/**
 * 2026-05-30: Karpathy pathway closed loop — 환각 적재 helper.
 *   verify-report.mjs 가 호출. 같은 (ticker, defect_type, llm_value) 조합은 OR IGNORE.
 *   배열로 한꺼번에 받음.
 */
export function saveHallucinationHistory(reportId, defects = []) {
  if (!Array.isArray(defects) || defects.length === 0) return 0;
  const db = openDb();
  const detectedAt = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO hallucination_history
      (report_id, detected_at, ticker, defect_type, llm_value, correct_value, severity, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let n = 0;
  const txn = db.transaction(() => {
    for (const d of defects) {
      if (!d?.defect_type) continue;
      stmt.run(
        reportId, detectedAt,
        d.ticker ?? null, d.defect_type,
        d.llm_value ?? null, d.correct_value ?? null,
        d.severity ?? 'medium',
        d.details ? JSON.stringify(d.details) : null,
      );
      n++;
    }
  });
  txn();
  return n;
}

/**
 * 다음 보고서 prompt 에 anti-pattern inject 용. 최근 7일 환각 list 반환.
 *   같은 (ticker, defect_type, llm_value) 조합 중복 제거.
 *   injected_count 증가 (학습 추적용).
 */
export function getRecentHallucinationsForPromptInject(days = 7, maxItems = 15) {
  const db = openDb();
  const rows = db.prepare(`
    SELECT id, ticker, defect_type, llm_value, correct_value, severity, COUNT(*) repeat_count
    FROM hallucination_history
    WHERE detected_at >= datetime('now', '-' || ? || ' days')
    GROUP BY ticker, defect_type, llm_value
    ORDER BY MAX(detected_at) DESC, repeat_count DESC
    LIMIT ?
  `).all(days, maxItems);
  // injected_count 증가 (해당 group 의 모든 row)
  for (const r of rows) {
    db.prepare(`
      UPDATE hallucination_history
      SET injected_count = injected_count + 1
      WHERE COALESCE(ticker,'') = COALESCE(?,'') AND defect_type = ? AND COALESCE(llm_value,'') = COALESCE(?,'')
        AND detected_at >= datetime('now', '-' || ? || ' days')
    `).run(r.ticker, r.defect_type, r.llm_value, days);
  }
  return rows;
}

/**
 * 2026-05-29: 매도 추천 적재 — Karpathy pathway closed loop 의 source.
 * tune-sell-rules.mjs 가 sell_outcomes 평가 후 룰 임계값 자동 조정.
 */
export function saveSellRecommendations(reportId, generatedAt, sellRecs = []) {
  const db = openDb();
  const parseAmount = (s) => {
    if (s == null) return null;
    if (typeof s === 'number') return s;
    const m = String(s).replace(/[$₩€,\s]/g, '').match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };
  const insert = db.prepare(`
    INSERT INTO sell_recommendations
      (id, report_id, generated_at, ticker, market, sector, sell_type, urgency, score,
       current_price, entry_price, target, stop_loss, pnl_pct, held_days, rationale, evaluate_after)
    VALUES (@id, @report_id, @generated_at, @ticker, @market, @sector, @sell_type, @urgency, @score,
            @current_price, @entry_price, @target, @stop_loss, @pnl_pct, @held_days, @rationale, @evaluate_after)
    ON CONFLICT(id) DO UPDATE SET
      sell_type = excluded.sell_type,
      urgency = excluded.urgency,
      score = excluded.score,
      rationale = excluded.rationale,
      current_price = excluded.current_price,
      pnl_pct = excluded.pnl_pct,
      held_days = excluded.held_days
  `);
  const evalAfter = new Date(new Date(generatedAt).getTime() + 14 * 86400000).toISOString();
  const sessionTag = reportId.split(':').slice(0, 2).join(':');
  let n = 0;
  const txn = db.transaction((rows) => {
    for (const c of rows) {
      if (!c?.ticker) continue;
      insert.run({
        id: `${sessionTag}:${c.ticker}`,
        report_id: reportId,
        generated_at: generatedAt,
        ticker: c.ticker,
        market: c.market ?? null,
        sector: c.sector ?? null,
        sell_type: c.sellType ?? c.ruleId ?? null,
        urgency: c.urgency ?? null,
        score: c.score ?? null,
        current_price: parseAmount(c.currentPrice),
        entry_price: parseAmount(c.entryPrice),
        target: parseAmount(c.target),
        stop_loss: parseAmount(c.stopLoss),
        pnl_pct: c.pnlPct ?? null,
        held_days: c.heldDays ?? null,
        rationale: c.rationale ?? c.reason ?? null,
        evaluate_after: evalAfter,
      });
      n++;
    }
  });
  txn(sellRecs);
  return n;
}

/**
 * 2026-05-29: 매수 candidate scoring 적재 — top 30 + 룰별 score breakdown.
 * 사후 분석 (어떤 카테고리가 hit 에 기여) + tune-buy-rules.mjs 가 활용.
 */
export function saveBuyCandidates(reportId, generatedAt, candidates = [], selectedTickers = new Set()) {
  const db = openDb();
  const insert = db.prepare(`
    INSERT INTO buy_candidates
      (id, report_id, generated_at, ticker, market, sector, rank, total_score, selected, matched_rules, category_scores)
    VALUES (@id, @report_id, @generated_at, @ticker, @market, @sector, @rank, @total_score, @selected, @matched_rules, @category_scores)
    ON CONFLICT(id) DO UPDATE SET
      rank = excluded.rank,
      total_score = excluded.total_score,
      selected = excluded.selected,
      matched_rules = excluded.matched_rules,
      category_scores = excluded.category_scores
  `);
  const sessionTag = reportId.split(':').slice(0, 2).join(':');
  let n = 0;
  const txn = db.transaction((rows) => {
    rows.forEach((c, idx) => {
      if (!c?.ticker) return;
      const categoryScores = {};
      const matchedRules = (c.reasons ?? []).map(r => ({
        ruleId: r.ruleId, score: r.score, reason: r.reason,
        category: r.category ?? null,
      }));
      // category 별 score 합산 — reasons 에 category 가 없으면 ruleId prefix 로 추측
      for (const m of matchedRules) {
        const cat = m.category ?? (m.ruleId?.split('_')[0]) ?? 'unknown';
        categoryScores[cat] = (categoryScores[cat] ?? 0) + (m.score ?? 0);
      }
      insert.run({
        id: `${sessionTag}:${c.ticker}`,
        report_id: reportId,
        generated_at: generatedAt,
        ticker: c.ticker,
        market: c.market ?? null,
        sector: c.sector ?? null,
        rank: idx + 1,
        total_score: c.stage1Score ?? 0,
        selected: selectedTickers.has(c.ticker) ? 1 : 0,
        matched_rules: JSON.stringify(matchedRules),
        category_scores: JSON.stringify(categoryScores),
      });
      n++;
    });
  });
  txn(candidates);
  return n;
}

/** 매도 outcome 한 건 저장 (tune-sell-rules.mjs 가 사용). */
export function saveSellOutcome(row) {
  const db = openDb();
  db.prepare(`
    INSERT INTO sell_outcomes
      (sell_rec_id, evaluated_at, price_at_eval, price_delta_pct, outcome, ohlc_days, high_seen, low_seen)
    VALUES (@sell_rec_id, @evaluated_at, @price_at_eval, @price_delta_pct, @outcome, @ohlc_days, @high_seen, @low_seen)
    ON CONFLICT(sell_rec_id, evaluated_at) DO UPDATE SET
      price_at_eval = excluded.price_at_eval,
      price_delta_pct = excluded.price_delta_pct,
      outcome = excluded.outcome,
      high_seen = excluded.high_seen,
      low_seen = excluded.low_seen
  `).run({
    sell_rec_id: row.sell_rec_id,
    evaluated_at: row.evaluated_at ?? new Date().toISOString(),
    price_at_eval: row.price_at_eval ?? null,
    price_delta_pct: row.price_delta_pct ?? null,
    outcome: row.outcome,
    ohlc_days: row.ohlc_days ?? null,
    high_seen: row.high_seen ?? null,
    low_seen: row.low_seen ?? null,
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

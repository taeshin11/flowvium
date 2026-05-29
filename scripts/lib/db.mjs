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
    // 2) supplyChainChanges
    for (const s of supplyChainChanges) {
      const tickers = [s.ticker, ...(s.downstreamBeneficiaries ?? [])].filter(Boolean);
      const extId = `supply:${s.ticker}:${(s.headline ?? '').slice(0, 60)}`;
      const r = stmt.run(
        extId, 'supply-chain',
        s.ticker ?? null, JSON.stringify(tickers),
        s.headline ?? '', null,
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
    // 3) companyChanges
    for (const c of companyChanges) {
      const extId = `company:${c.ticker}:${(c.keyChange ?? '').slice(0, 60)}`;
      const r = stmt.run(
        extId, 'company-change',
        c.ticker ?? null, JSON.stringify([c.ticker]),
        c.keyChange ?? '', null,
        null, now,
        c.sentiment ?? 'neutral', null, null, null, null,
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
    findInd('vix'),
    findInd('cpi') ?? findInd('us_cpi'),
    findInd('fed_rate') ?? findInd('fedfunds'),
    yields?.['10Y'] ?? yields?.['10y'] ?? null,
    yields?.['2Y'] ?? yields?.['2y'] ?? null,
    yc?.spread10y2y ?? null,
    findInd('hy_oas') ?? findInd('hy_spread'),
    findInd('ig_oas'),
    findInd('gdp') ?? findInd('gdp_growth'),
    ctxRaw?.capital?.spy?.close ?? null,
    ctxRaw?.capital?.qqq?.close ?? null,
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
      flowStmt.run(reportId, now, sym,
        a.return4w ?? a.return_4w ?? null,
        a.return1w ?? a.return_1w ?? null,
        a.return1d ?? a.return_1d ?? null,
        a.trend ?? null, 'capital-flows');
    }
  });
  txn();
}

/**
 * 2026-05-29: 숏 스퀴즈 + 기업 실적 + insider 아카이브 적재.
 * 매 보고서 cycle 마다 호출 — point-in-time 추세 추적 가능.
 */
export function saveDomainArchives({ reportId, capturedAt, shortSqueeze = [], companyChanges = [], insiderSignals = [] }) {
  const db = openDb();
  const now = capturedAt ?? new Date().toISOString();
  const txn = db.transaction(() => {
    // 숏 스퀴즈
    const sqStmt = db.prepare(`
      INSERT INTO short_squeeze_archive
        (report_id, captured_at, ticker, score, short_ratio, short_pct, timing, risk, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of shortSqueeze) {
      sqStmt.run(reportId, now, s.ticker ?? '', s.score ?? null,
        s.shortRatio ?? null, s.shortPct ?? null,
        s.timing ?? null, s.risk ?? null, s.rationale ?? null);
    }
    // 기업 실적 (companyChanges 에서 추출)
    const erStmt = db.prepare(`
      INSERT INTO earnings_archive
        (report_id, captured_at, ticker, quarter, revenue, revenue_yoy, op_margin,
         guidance, sentiment, source, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of companyChanges) {
      // companyChanges 의 keyChange 텍스트에서 revenue + yoy 추출 시도
      const m = (c.keyChange ?? '').match(/(\$?\d+\.?\d*)\s*B\s*\(?\+?(-?\d+\.?\d*)\s*%/i);
      const rev = m ? parseFloat(m[1].replace('$','')) : null;
      const yoy = m ? parseFloat(m[2]) : c.revenueYoY ?? null;
      erStmt.run(reportId, now, c.ticker ?? '', c.latestQuarter ?? null,
        rev, yoy, null,
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

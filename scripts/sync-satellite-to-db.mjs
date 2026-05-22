#!/usr/bin/env node
/**
 * scripts/sync-satellite-to-db.mjs — Vercel satellite-signals → 로컬 SQLite 동기화.
 *
 * Vercel cron 이 매일 SAR scan → Redis 저장.
 * 이 로컬 스크립트가 매일 endpoint 호출해서 SQLite 에 누적.
 * 1개월+ 후 scripts/satellite-correlation.mjs 로 backtest.
 *
 * Cron 등록 권장 (Windows Task Scheduler):
 *   매일 08:00 KST (Vercel cron 07:40 KST 직후) 1회.
 */
import Database from 'better-sqlite3';

const DB_PATH = 'C:/NoAddsMakingApps/FlowVium/data/flowvium.db';
const ENDPOINT = 'https://flowvium.net/api/satellite-signals';

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS satellite_observations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    factory_id      TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    name            TEXT,
    country         TEXT,
    significance    TEXT,
    activity_score  INTEGER,
    vv_db           REAL,
    vh_db           REAL,
    vv_delta_db     REAL,
    vh_delta_db     REAL,
    obs_count       INTEGER,
    confidence      TEXT,
    image_date      TEXT,
    observed_at     TEXT NOT NULL,
    raw_json        TEXT,
    UNIQUE(factory_id, observed_at)
  );
  CREATE INDEX IF NOT EXISTS idx_sat_ticker_date ON satellite_observations(ticker, observed_at);
  CREATE INDEX IF NOT EXISTS idx_sat_observed_at ON satellite_observations(observed_at);
`);

const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(30000) });
if (!res.ok) {
  console.error(`❌ Vercel endpoint failed: HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const signals = data.signals ?? [];
console.log(`📡 ${signals.length} factory signals fetched from ${ENDPOINT}`);

const insert = db.prepare(`
  INSERT OR REPLACE INTO satellite_observations
    (factory_id, ticker, name, country, significance, activity_score, vv_db, vh_db, vv_delta_db, vh_delta_db, obs_count, confidence, image_date, observed_at, raw_json)
  VALUES (@factory_id, @ticker, @name, @country, @significance, @activity_score, @vv_db, @vh_db, @vv_delta_db, @vh_delta_db, @obs_count, @confidence, @image_date, @observed_at, @raw_json)
`);

const tx = db.transaction((items) => {
  for (const s of items) {
    if (!s.id || !s.ticker || !s.imageDate) continue;
    insert.run({
      factory_id: s.id,
      ticker: s.ticker,
      name: s.name ?? null,
      country: s.country ?? null,
      significance: s.significance ?? null,
      activity_score: s.activityScore ?? null,
      vv_db: s.vv_db ?? null,
      vh_db: s.vh_db ?? null,
      vv_delta_db: s.vv_delta_db ?? null,
      vh_delta_db: s.vh_delta_db ?? null,
      obs_count: s.obs_count ?? 0,
      confidence: s.confidence ?? null,
      image_date: s.imageDate,
      observed_at: s.imageDate,
      raw_json: JSON.stringify(s).slice(0, 2000),
    });
  }
});
tx(signals);

const total = db.prepare('SELECT COUNT(*) AS c FROM satellite_observations').get().c;
console.log(`✅ DB total: ${total} observations`);
db.close();

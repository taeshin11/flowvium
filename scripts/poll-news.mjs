#!/usr/bin/env node
/**
 * poll-news.mjs — 뉴스를 보고서 주기와 무관하게 상시 수집한다.
 *
 * 왜(2026-08-20 실측): news_archive 1,364건 기준 발행→수집 지연이
 *     중앙값 125분 · p90 287분 이었다.
 *   수집 시각 분포가 보고서 세션(05:30·10:30·14:30·20:00·22:30)에 정확히 몰려 있었고
 *   p90 이 세션 간격(≈4.8h)과 일치했다 — 수집이 보고서 생성에만 붙어 있었기 때문이다.
 *   즉 "속보를 더 빨리 보려면" 소스를 늘리기 전에 주기를 떼는 게 먼저다.
 *
 * 이 폴러는 LLM 을 쓰지 않는다(결정론적 적재만). 분석/캐스케이드는 기존 경로가 계속 담당한다 —
 * GPU 경합을 만들지 않으려는 의도이고, 그래서 몇 분 주기로 돌려도 안전하다.
 *
 * 사용: node scripts/poll-news.mjs [--dry] [--quiet]
 */
import { resolve } from 'path';
import Database from 'better-sqlite3';
import { ROOT } from './lib/project-root.mjs';
import { loadFeeds, parseFeed, passesFilter } from './lib/news-feeds.mjs';
import { sanitizeArticle } from './lib/news-sanitize.mjs';

const DRY = process.argv.includes('--dry');
const QUIET = process.argv.includes('--quiet');
const UA = 'FlowviumBot/1.0 (+https://flowvium.net)';
const FEED_TIMEOUT_MS = 15_000;
// 오래된 기사를 소급 적재하지 않는다. 폴러의 목적은 '지금 막 나온 것'이고,
// 과거분은 보고서 경로가 이미 채운다. 첫 실행에서 수천 건이 쏟아지는 것도 막는다.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const log = (...a) => { if (!QUIET) console.log(...a); };

async function fetchFeed(f) {
  try {
    const res = await fetch(f.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
                                     signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (!res.ok) return { feed: f, items: [], error: `HTTP ${res.status}` };
    return { feed: f, items: parseFeed(await res.text()) };
  } catch (e) {
    // 피드 하나의 실패가 나머지를 막지 않는다. 다만 조용히 넘기지 않고 집계에 남긴다.
    return { feed: f, items: [], error: String(e.message).slice(0, 80) };
  }
}

const db = new Database(resolve(ROOT, 'data/flowvium.db'));
const stmt = db.prepare(`
  INSERT OR IGNORE INTO news_archive
    (external_id, source, ticker, tickers_json, headline, summary, pub_date,
     captured_at, sentiment, importance, signal_type, direction, link, cascades_json, raw_json, report_id, locale)
  VALUES (?, ?, NULL, '[]', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, ?, NULL, ?)
`);

const results = await Promise.all(loadFeeds().map(fetchFeed));
const now = new Date().toISOString();
const nowMs = Date.now();
let inserted = 0, seen = 0, stale = 0, filtered = 0;
const lags = [];
const failures = [];

const txn = db.transaction(() => {
  for (const { feed, items, error } of results) {
    if (error) { failures.push(`${feed.source}: ${error}`); continue; }
    let ins = 0;
    for (const it of items) {
      seen++;
      if (!passesFilter(it, feed)) { filtered++; continue; }
      if (Number.isFinite(it.pubMs) && nowMs - it.pubMs > MAX_AGE_MS) { stale++; continue; }
      const { title, summary } = sanitizeArticle({ title: it.title, summary: it.summary });
      if (DRY) { ins++; continue; }
      const r = stmt.run(it.guid || it.link || title, feed.source, title, summary ?? '',
                         it.pubDate, now, it.link || null, JSON.stringify(it),
                         feed.region === 'kr' ? 'ko' : feed.region === 'jp' ? 'ja' : 'en');
      if (r.changes > 0) { ins++; if (Number.isFinite(it.pubMs)) lags.push((nowMs - it.pubMs) / 60000); }
    }
    inserted += ins;
    log(`  ${feed.source.padEnd(16)} item ${String(items.length).padStart(3)} · 신규 ${String(ins).padStart(3)}`);
  }
});
txn();

const med = lags.length ? [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)] : null;
log(`\n신규 ${inserted}건 / 조회 ${seen} (필터 ${filtered} · 6h초과 ${stale})${DRY ? '  [dry]' : ''}`);
if (med !== null) log(`  이번 배치 발행→수집 지연 중앙값 ${med.toFixed(0)}분`);
if (failures.length) log(`  ⚠️ 피드 실패 ${failures.length}건: ${failures.join(' | ')}`);
db.close();
// 전부 실패하면 조용히 성공하지 않는다 — 무증상 실패가 이 저장소의 반복 실패 유형이다.
process.exit(results.every(r => r.error) ? 1 : 0);

#!/usr/bin/env node
/**
 * platform-daily.mjs — FlowVium 플랫폼별 일일 기록(YouTube·Blogger). 2026-10-15 신설.
 *
 * 사장님 10/14: "구독 전환율, 시청률, 노출수, 조회수 다 챙겨라 … 플랫폼마다 다른 전략". 7일 뒤 효과를 재려면
 *   매일 같은 자리에 쌓여 있어야 한다. 계산·규칙은 lib/platform-daily.mjs(테스트 lib/platform-daily.test.mjs).
 * YouTube: 분석 데이터가 2~3일 늦게 차므로 최근 14일 중 **찬 날** 을 전부 다시 적는다(늦게 찬 값으로 갱신).
 *   노출·CTR 은 API 가 주지 않는다 → null(unknown).
 * Blogger: 페이지뷰 누적·7일·30일, 글 수. 하루 조회는 전날 기록과의 누적 차이.
 * 쓰는 곳: logs/platform-daily.json (배열, 날짜·플랫폼당 한 줄).
 *
 * 사용: node scripts/platform-daily.mjs   (cron-runner 가 하루 한 번)
 */
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { authorizedClient } from './lib/youtube.mjs';
import { ytRecord, lastFilledDay, upsertDaily, blogRecord } from './lib/platform-daily.mjs';

const OUT = resolve(ROOT, 'logs/platform-daily.json');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[platform-daily]', ...a);
let lines = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
let failed = 0;

try {
  const ya = google.youtubeAnalytics({ version: 'v2', auth: await authorizedClient() });
  const d = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const r = await ya.reports.query({ ids: 'channel==MINE', startDate: d(14), endDate: d(0), dimensions: 'day', sort: 'day',
    metrics: 'views,engagedViews,averageViewPercentage,subscribersGained,subscribersLost,shares' });
  const rows = r.data.rows ?? [];
  const last = lastFilledDay(rows.map((x) => [x[0], x[1]]));
  if (!last) log('YouTube: 분석 데이터가 찬 날이 없다 — 이번엔 적지 않는다');
  for (const x of rows.filter((x) => x[0] <= (last ?? ''))) {
    const [day, views, engagedViews, averageViewPercentage, subscribersGained, subscribersLost, shares] = x;
    lines = upsertDaily(lines, ytRecord({ day, views, engagedViews, averageViewPercentage, subscribersGained, subscribersLost, shares }));
  }
  const t = lines.find((l) => l.platform === 'youtube' && l.date === last);
  if (t) log(`YouTube ${last}(찬 마지막 날): 조회 ${t.views} · 본 비율 ${t.viewedRate} · 평균 시청 ${t.avgViewPct}% · 구독 +${t.subsGained}−${t.subsLost} · 1천회당 ${t.subsPer1k} · 공유 ${t.shares} · 노출 unknown`);
} catch (e) { failed++; log(`YouTube 실패: ${String(e?.message ?? e).slice(0, 120)}`); }

try {
  const { loadEnvLocal } = await import('./lib/llm-config.mjs'); loadEnvLocal?.();
  const { pageViews, listBlogs } = await import('./lib/blogger.mjs');
  const blogId = process.env.BLOGGER_BLOG_ID;
  if (!blogId) throw new Error('BLOGGER_BLOG_ID 없음');
  const counts = await pageViews(blogId);
  const posts = (await listBlogs()).find((b) => b.id === blogId)?.posts ?? null;
  const date = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 10);
  const prev = lines.filter((l) => l.platform === 'blogger' && l.date < date).at(-1) ?? null;
  const rec = blogRecord({ date, counts, posts, prev });
  lines = upsertDaily(lines, rec);
  log(`Blogger ${date}: 누적 ${rec.viewsAll} · 7일 ${rec.views7d} · 30일 ${rec.views30d} · 하루 ${rec.viewsDay ?? 'unknown(첫 기록)'} · 글 ${rec.posts}`);
} catch (e) { failed++; log(`Blogger 실패: ${String(e?.message ?? e).slice(0, 120)}`); }

writeFileSync(OUT, JSON.stringify(lines, null, 1));
log(`${OUT} — ${lines.length}줄`);
process.exit(failed === 2 ? 1 : 0);

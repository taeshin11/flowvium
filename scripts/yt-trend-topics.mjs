#!/usr/bin/env node
/**
 * yt-trend-topics.mjs — 주 1회 스튜디오 '트렌드' 탭에서 다음 편 주제어를 모으고, 칸별 48h 성적을 보고한다. (2026-10-02, 사장님 지시)
 *
 * 이 채널의 트렌드 탭은 인기 검색어 목록을 주지 않는다 — 검색창에 시드어를 넣으면 '현재 인기 콘텐츠' 몇 편이 나온다.
 *   시드어마다 그 제목들을 모아 **두 제목 이상에 겹친 낱말**을 주제어로 쓴다(lib/explore-slot trendTerms).
 *   결과는 logs/yt-trends.json(임시 파일 → 이름 바꾸기). make-shorts 의 트렌드 칸(여섯 편에 한 편)이 읽는다.
 * 프로필은 게시물·관련 동영상 작업과 같은 secrets/youtube-profile — 같은 잠금을 잡는다.
 *
 * 사용: node scripts/yt-trend-topics.mjs [--seeds 주식,증시] [--report-only]
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { writeFileSync, renameSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';
import { trendTerms, slotLift } from './lib/explore-slot.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const SEEDS = (arg('seeds') ?? process.env.YT_TREND_SEEDS ?? '주식,증시,경제,뉴스,환율,부동산').split(',').map((s) => s.trim()).filter(Boolean);
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[trends]', ...a);

/** 트렌드 탭 본문 → [{title, channel, views, age}] — '조회수 … • … 전' 줄 앞 두 줄이 제목·채널. */
export function parseResearch(text) {
  const t = String(text ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  const from = t.findIndex((x) => x === '현재 인기 콘텐츠');
  const out = [];
  for (let i = Math.max(from, 2); i < t.length && from >= 0; i++) {
    const m = /^조회수\s*(.+?)\s*•\s*(.+?전)$/.exec(t[i]);
    if (m) out.push({ title: t[i - 2], channel: t[i - 1], views: m[1], age: m[2] });
  }
  return out;
}

async function collect() {
  const { YT_PROFILE_LOCK } = await import('./lib/site-tour-video.mjs');
  const { acquireRunLock } = await import('./lib/run-lock.mjs');
  const plock = await acquireRunLock(resolve(ROOT, YT_PROFILE_LOCK), { waitMs: 20 * 60_000, pollMs: 10_000, label: 'yt-trend-topics' });
  if (!plock.ok) { log(`유튜브 프로필을 다른 작업(${plock.holder?.label ?? '?'})이 쓰고 있다 — 이번 주는 건너뛴다`); return null; }
  const ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/youtube-profile'), {
    channel: 'chrome', headless: true, viewport: { width: 1400, height: 2400 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const items = [];
  try {
    await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    const skip = page.getByText(/스튜디오로 건너뛰기/).first();
    if (await skip.count()) { await skip.click(); await page.waitForTimeout(5000); }
    const ch = /channel\/(UC[\w-]+)/.exec(page.url())?.[1] ?? /"channelId":"(UC[\w-]+)"/.exec(await page.content())?.[1];
    if (!ch) throw new Error('채널 id 를 못 읽었다(로그인 풀림?)');
    for (const q of SEEDS) {
      await page.goto(`https://studio.youtube.com/channel/${ch}/analytics/tab-research/period-default`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(7000);
      const box = page.locator('input#search-input:visible').first();
      if (!(await box.count())) { log(`${q}: 트렌드 검색창이 없다 — 화면이 바뀌었을 수 있다`); continue; }
      await box.click(); await box.fill(q); await page.keyboard.press('Enter');
      await page.waitForTimeout(10000);
      const got = parseResearch(await page.locator('body').innerText());
      log(`${q}: ${got.length}편 — ${got.map((x) => `${x.title.slice(0, 30)}(${x.views}·${x.age})`).join(' / ')}`);
      items.push(...got.map((x) => ({ q, ...x })));
      await page.waitForTimeout(3000);
    }
  } finally { await ctx.close(); plock.release(); }
  return items;
}

async function report() {
  const { openDb } = await import('./lib/db.mjs');
  const db = openDb();
  const cols = new Set(db.prepare('PRAGMA table_info(shorts_published)').all().map((c) => c.name));
  if (!cols.has('trend')) db.exec('ALTER TABLE shorts_published ADD COLUMN trend INTEGER');
  if (!cols.has('layout')) db.exec('ALTER TABLE shorts_published ADD COLUMN layout TEXT');
  const rows = db.prepare(`SELECT s.video_id, s.views, s.age_hours, s.engaged_ratio, s.avg_view_pct, p.published_at, p.trend, p.explore, p.layout
      FROM shorts_stats s JOIN shorts_published p ON p.video_id = s.video_id
     WHERE p.retracted_at IS NULL AND datetime(p.published_at) >= datetime('now', '-28 days')`).all()
    .map((r) => ({ ...r, slot: r.trend === 1 ? '트렌드 칸' : r.explore === 1 ? '실험 칸' : '보통' }));
  const m = slotLift(rows);
  const line = [...m].map(([k, v]) => `${k} ${v.n}편 · 48h 조회수 같은 날 중앙값의 ${v.lift}배 · 또래보다 잘 된 비율 ${Math.round(v.beat * 100)}%`).join(' | ');
  log(`최근 28일 칸별 성적 — ${line || '표본 없음'}`);
  // 2026-10-03 화면 배분 A/B — 조회수 말고 **계속 시청 비율·평균 시청 비율**(48h 근처 관측)로 본다. 그걸 올리려는 실험이다.
  const near = new Map();
  for (const r of rows) { if (!r.layout) continue; const p = near.get(r.video_id); if (!p || Math.abs(r.age_hours - 48) < Math.abs(p.age_hours - 48)) near.set(r.video_id, r); }
  const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const by = { classic: [], zoom: [] };
  for (const r of near.values()) by[r.layout]?.push(r);
  log(`화면 배분 A/B — ${Object.entries(by).map(([k, a]) => `${k} ${a.length}편 · 계속시청 ${med(a.map((r) => r.engaged_ratio))?.toFixed(2) ?? '-'} · 평균시청 ${med(a.map((r) => r.avg_view_pct))?.toFixed(0) ?? '-'}%`).join(' | ')}`);
  return m;
}

if (!argv.includes('--report-only')) {
  const items = await collect();
  if (items?.length) {
    // 빈도 낱말(trendTerms)은 참고로만 남긴다 — 말버릇·방송사 이름이 섞인다. 칸이 쓰는 주제어는 agy 가 고르고 코드가 거른 것.
    const { pickTrendTopics } = await import('./lib/trend-topics.mjs');
    const topics = await pickTrendTopics(items);
    const terms = (topics ?? []).flatMap((t) => t.keywords);
    log(`고른 주제: ${topics ? topics.map((t) => `${t.topic}(${t.keywords.join('·')})`).join(' / ') : '없음(agy 실패 또는 걸러서 남는 게 없다 — 이번 주 트렌드 칸은 순서를 안 바꾼다)'}`);
    const f = resolve(ROOT, 'logs/yt-trends.json'), tmp = `${f}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), seeds: SEEDS, topics, terms, freqTerms: trendTerms(items), items }, null, 2));
    renameSync(tmp, f);
    log(`주제어 ${terms.length}개: ${terms.slice(0, 12).join(' · ') || '(겹치는 낱말 없음 — 트렌드 칸은 순서를 안 바꾼다)'}`);
  } else if (items) log('인기 콘텐츠를 하나도 못 읽었다 — 지난 주제어를 그대로 둔다(8일 지나면 트렌드 칸이 쉰다)');
}
await report();
process.exit(0);

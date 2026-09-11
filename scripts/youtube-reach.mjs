#!/usr/bin/env node
/**
 * youtube-reach.mjs — 노출수·클릭률·유입경로를 본다.
 *
 * 왜 (2026-09-11): 조회수가 09-08 부터 1/3 로 떨어졌는데 **원인을 가를 수 없었다.**
 *   09-07 은 6편이 전부 1,281±32 로 들어왔다 — 내용과 무관하게 같은 양을 받았다는 뜻이다.
 *   배포가 비율로 깎였다면 편차도 줄어야 하는데(275→115) 그대로였다(260). 뺄셈이다.
 *   그런데 조회수만으로는 **배분이 멈춘 것**인지 **노출은 그대로인데 클릭이 안 된 것**인지 모른다.
 *     노출수가 같이 줄었다 → 배분이 멈춤(제목·썸네일 문제 아님)
 *     노출수는 비슷한데 CTR 이 떨어졌다 → 제목·썸네일 문제
 *   이 한 장이 그 둘을 가른다.
 *
 * 사용: node scripts/youtube-reach.mjs [--days 10]
 */
import { google } from 'googleapis';
import { authorizedClient } from './lib/youtube.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', 10));
const day = (t) => new Date(t).toISOString().slice(0, 10);
const end = day(Date.now());
const start = day(Date.now() - DAYS * 86400000);

const auth = await authorizedClient();
const ya = google.youtubeAnalytics({ version: 'v2', auth });

async function q(metrics, dimensions, extra = {}) {
  const r = await ya.reports.query({
    ids: 'channel==MINE', startDate: start, endDate: end, metrics, dimensions, ...extra,
  });
  return r.data;
}

try {
  console.log(`■ 날짜별 도달 (${start} ~ ${end})`);
  const d1 = await q('views,estimatedMinutesWatched,averageViewPercentage', 'day');
  const head = d1.columnHeaders.map((h) => h.name);
  console.log('  날짜        ' + head.slice(1).map((h) => h.slice(0, 14).padStart(15)).join(''));
  for (const row of d1.rows ?? []) {
    console.log('  ' + row[0] + '  ' + row.slice(1).map((v) => String(typeof v === 'number' ? Math.round(v * 100) / 100 : v).padStart(15)).join(''));
  }

  console.log('\n■ 유입경로별 (무엇이 멈췄나)');
  const d2 = await q('views', 'insightTrafficSourceType', { sort: '-views' });
  for (const row of d2.rows ?? []) console.log('  ' + String(row[0]).padEnd(26) + String(row[1]).padStart(8));

  console.log('\n■ 노출수·클릭률 (있으면)');
  try {
    const d3 = await q('impressions,impressionClickThroughRate,views', 'day');
    console.log('  날짜          노출수     CTR%     조회');
    for (const row of d3.rows ?? []) {
      console.log('  ' + row[0] + String(row[1]).padStart(10) + String(row[2]).padStart(9) + String(row[3]).padStart(9));
    }
  } catch (e) {
    console.log(`  ⚠ 노출수 지표를 못 읽었다: ${String(e.message).slice(0, 90)}`);
    console.log('    (impressions 는 채널 소유자 권한 + 일부 채널만 제공된다 — Studio 화면엔 있다)');
  }
} catch (e) {
  console.error(`❌ 분석 조회 실패: ${String(e.message).slice(0, 140)}`);
  process.exit(1);
}

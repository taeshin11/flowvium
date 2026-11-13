#!/usr/bin/env node
// report-first-line.mjs — 22:00 보고 첫 줄 "마지막 실제 공개 MM/DD HH:MM · 예비 N시간" (2026-11-13 사장님 지시).
//   공개 시각: 채널 RSS(로그인 없이 공개 영상만) — 우리 DB 가 아니라 시청자 화면 기준. 48시간 넘거나 못 읽으면 비상(종료코드 2).
//   예비: 상시 쇼츠 풀 완성 편 + 6시간 안 뉴스 예비 ÷ 최근 7일 하루 공개 편수 × 24.
// 사용: node scripts/report-first-line.mjs
import { loadEnvLocal } from './lib/llm-config.mjs';
import { openDb } from './lib/db.mjs';
import { listSpares, evergreenDir, spareDir } from './lib/shorts-spare.mjs';
import { feedUrl, parseFeed, lastPublic, firstLine } from './lib/public-upload.mjs';

loadEnvLocal();
const cid = process.env.YOUTUBE_CHANNEL_ID;
let last = null;
try {
  const res = await fetch(feedUrl(cid ?? ''), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (res.ok) last = lastPublic(parseFeed(await res.text()))?.published ?? null;
} catch { /* 못 읽음 = 비상으로 찍힌다(firstLine) */ }

const pool = listSpares(evergreenDir()).filter((x) => !x.dir.endsWith('.part')).length;
const news = listSpares(spareDir()).filter((x) => Date.now() - x.createdAt <= 6 * 3600e3).length;
const perDay = openDb().prepare("SELECT COUNT(*) / 7.0 AS r FROM shorts_published WHERE published_at >= datetime('now','-7 days')").get().r;
const hours = perDay > 0 ? Math.round(((pool + news) / perDay) * 24) : 0;

const line = firstLine({ last, hours });
console.log(line);
process.exit(line.startsWith('🚨') ? 2 : 0);

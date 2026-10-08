#!/usr/bin/env node
/**
 * shorts-today-check.mjs — 오늘 쇼츠가 시간표대로 나갔나 한 줄로. 문제면 exit 1. (2026-10-08 신설)
 *
 * 사장님 "내일부턴 이러지마" — 10/08 업로드 401 로 하루 0편이었는데 check-stall 은 🚨 를 크론 로그에만 남겼고
 *   (그것도 다른 🚨 뒤에 묻혀) 아무도 몰랐다. 사람이 "오늘 올라갔니" 하고 물어서야 알았다.
 *   이 스크립트는 사람에게 알리는 쪽(세션 정시 점검·푸시 알림)이 부른다 — 판정만 하고 알림은 부르는 쪽이.
 * 판정: 지난 슬롯 수(30분 여유) 대비 오늘 발행 수, 최근 3시간 업로드·인증 실패.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { recentFailures } from './lib/publish-health.mjs';

const plist = join(homedir(), 'Library/LaunchAgents/com.spinai.flowvium-video.plist');
const slots = [];
if (existsSync(plist)) for (const d of readFileSync(plist, 'utf8').matchAll(/<dict>([\s\S]*?)<\/dict>/g)) {
  const h = /<key>Hour<\/key>\s*<integer>(\d+)/.exec(d[1]); const m = /<key>Minute<\/key>\s*<integer>(\d+)/.exec(d[1]);
  if (h) slots.push(+h[1] * 60 + (m ? +m[1] : 0));
}
const now = new Date(Date.now() + 9 * 3600e3); const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes(); const day = now.toISOString().slice(0, 10);
const passed = slots.filter((s) => s + 30 <= nowMin).length;   // 렌더·업로드에 30분 여유
const { openDb } = await import('./lib/db.mjs');
const published = openDb().prepare(`SELECT COUNT(*) n FROM shorts_published WHERE retracted_at IS NULL AND video_id IS NOT NULL
  AND date(datetime(published_at, '+9 hours')) = ?`).get(day).n;
const logPath = join(homedir(), 'flowvium_runtime/video.log');
const tail = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-200000) : '';
const f = recentFailures(tail, { hours: 3 });
const behind = passed - published;
const bad = behind >= 1 || f.auth > 0 || f.upload > 0;
console.log(`${bad ? '❌' : '✅'} ${day} 쇼츠 ${published}편 발행 / 지난 슬롯 ${passed}${behind > 0 ? ` (${behind}편 모자람)` : ''}`
  + `${f.auth ? ` · 인증 실패 ${f.auth}` : ''}${f.upload ? ` · 업로드 실패 ${f.upload}` : ''}${f.lastLine ? ` · ${f.lastLine.slice(0, 80)}` : ''}`);
process.exit(bad ? 1 : 0);

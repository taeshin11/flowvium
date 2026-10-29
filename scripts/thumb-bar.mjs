/**
 * thumb-bar.mjs — 썸네일 관문 기준을 채널 성적으로 정한다(하루 한 번). 규칙은 lib/thumb-gate barFrom·thumb-gate.test [21].
 *
 * 왜: 10/29 16:0x 사장님(desktop1 → Mac mini2 경유) "잘 되는 채널은 기준을 낮춰도 된다".
 *   잘 되는 채널 = 유튜브 지난 7일 조회 > 그 전 7일(쇼츠+롱폼 채널 합계). 그러면 셋 다 7.0 + 하나 7.5, 아니면 7.5·8.
 *   두 숫자는 판정마다 남기고(관문 기록 bar), 날마다 다시 잰다. 분석 데이터는 이틀 늦게 차서 channel-weekly 와 같은 창(이틀 전까지)으로 잰다.
 *   못 재면 파일을 고치지 않는다 — 하루 반 지나면 관문이 엄한 쪽으로 돌아간다(barFrom).
 *
 *   node scripts/thumb-bar.mjs
 */
import { google } from 'googleapis';
import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { authorizedClient } from './lib/youtube.mjs';
import { BAR_FILE, barFrom } from './lib/thumb-gate.mjs';

const ya = google.youtubeAnalytics({ version: 'v2', auth: await authorizedClient() });
const day = (off) => new Date(Date.now() - 7 * 3600e3 - off * 864e5).toISOString().slice(0, 10);   // 태평양 날짜
const sum = async (startDate, endDate) => {
  const d = (await ya.reports.query({ ids: 'channel==MINE', startDate, endDate, metrics: 'views' })).data;
  const v = d.rows?.[0]?.[0];
  if (!Number.isFinite(v)) throw new Error(`조회수 없음 ${startDate}~${endDate}: ${JSON.stringify(d).slice(0, 120)}`);
  return v;
};
const last = [day(8), day(2)], prev = [day(15), day(9)];
const rec = { at: new Date().toISOString(), channel: 'FlowVium KR', last7: await sum(...last), prev7: await sum(...prev), lastRange: last, prevRange: prev };
const bar = barFrom(rec);
rec.bar = { name: bar.name, floor: bar.floor, passOne: bar.passOne };
mkdirSync(dirname(BAR_FILE), { recursive: true });
writeFileSync(BAR_FILE, JSON.stringify(rec, null, 2));
appendFileSync(resolve(dirname(BAR_FILE), 'thumb-bar.jsonl'), JSON.stringify(rec) + '\n');
console.log(`썸네일 기준 — ${rec.channel} 지난 7일 ${rec.last7}(${last.join('~')}) / 그 전 7일 ${rec.prev7}(${prev.join('~')}) → ${bar.name} ${bar.floor}·${bar.passOne}`);

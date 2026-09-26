#!/usr/bin/env node
/**
 * slots.test.mjs — 백필이 세는 '지나간 슬롯' 은 실제 편성표(plist)에서 온다. 2026-09-27 신설.
 * 실측: video-backfill 의 SLOTS 기본값이 옛 8슬롯(07:00,09:00,…,22:00)이었고 SHORTS_SLOTS 는 어디에도 없었다.
 *   실제 plist 는 7슬롯(10:15 11:10 12:10 15:10 16:20 18:20 21:45) — "모자란 편수" 를 틀리게 셌다.
 */
import { slotsFromCalendar } from './slots.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const s = slotsFromCalendar([{ Hour: 16, Minute: 20 }, { Hour: 10, Minute: 15 }, { Hour: 21, Minute: 45 }, { Hour: 9, Minute: 5 }]);
JSON.stringify(s) === JSON.stringify(['09:05', '10:15', '16:20', '21:45']) ? ok('[1] 시각순 HH:MM') : bad(`[1] ${JSON.stringify(s)}`);
JSON.stringify(slotsFromCalendar({ Hour: 7, Minute: 0 })) === JSON.stringify(['07:00']) ? ok('[2] 하나짜리(dict)도') : bad('[2]');
slotsFromCalendar(null).length === 0 ? ok('[3] 없으면 빈 목록') : bad('[3]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

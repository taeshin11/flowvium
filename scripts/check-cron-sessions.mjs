#!/usr/bin/env node
/**
 * vercel.json 의 investment-strategy cron 시각이 KST session 별로 정확히 1개씩
 * 분포하는지 검증. 같은 session 에 2 이상 cron 이 떨어지면 history 중복 발생.
 *
 * 사용: node scripts/check-cron-sessions.mjs
 * 실패 시 exit 1 (CI 에서 차단 가능)
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const cfg = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));

function utcToKstSession(cronExpr) {
  // "20 13 * * *" → UTC 13:20 → KST 22:20 → evening
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) return null;
  const kstHour = (hour + 9) % 24;
  let session;
  if (kstHour >= 7 && kstHour < 16) session = 'morning';
  else if (kstHour >= 16 && kstHour < 22) session = 'afternoon';
  else session = 'evening';
  return { kst: `${String(kstHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, session };
}

const targets = ['/api/cron/investment-strategy'];
const violations = [];

for (const target of targets) {
  const matching = (cfg.crons ?? []).filter(c => c.path === target);
  const bySession = { morning: [], afternoon: [], evening: [] };
  for (const c of matching) {
    const info = utcToKstSession(c.schedule);
    if (!info) continue;
    bySession[info.session].push({ cron: c.schedule, kst: info.kst });
  }

  console.log(`\n=== ${target} ===`);
  for (const [session, list] of Object.entries(bySession)) {
    if (list.length === 0) {
      console.log(`  ${session.padEnd(10)} : (no cron — session 미커버)`);
      violations.push({ target, session, type: 'missing', cronExprs: [] });
    } else if (list.length === 1) {
      console.log(`  ${session.padEnd(10)} : KST ${list[0].kst} (${list[0].cron})`);
    } else {
      console.log(`  ${session.padEnd(10)} : ${list.length}개 cron 충돌!`);
      for (const l of list) console.log(`    - KST ${l.kst} (${l.cron})`);
      violations.push({ target, session, type: 'duplicate', cronExprs: list.map(l => l.cron) });
    }
  }
}

console.log('');
if (violations.length === 0) {
  console.log('✅ 모든 cron 이 session 별 1:1 매핑');
  process.exit(0);
}

console.error(`❌ ${violations.length}건 위반:`);
for (const v of violations) {
  if (v.type === 'duplicate') {
    console.error(`  ${v.target} → ${v.session} session 에 ${v.cronExprs.length}개 cron 충돌`);
    console.error(`    충돌 cron: ${v.cronExprs.join(', ')}`);
    console.error(`    수정: 시간을 옮겨 다른 session 으로 분리 필요`);
  } else {
    console.error(`  ${v.target} → ${v.session} session 미커버 (cron 추가 필요)`);
  }
}
process.exit(1);

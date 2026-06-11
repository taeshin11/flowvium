#!/usr/bin/env node
/**
 * scripts/backup-takeover.mjs — 머신 사망 대비 인수인계 백업 (2026-06-12 신설).
 *
 * 배경: 6/7 하드 freeze 로 4일 다운 — 사용자 "컴퓨터 꺼지면 다른 컴퓨터에서 넘겨받아 작업".
 *   git 에 없는 로컬 상태(DB 학습이력·시크릿·발간물)를 Google Drive 로 일일 백업.
 *   다른 머신 복구 절차: HANDOFF.md "인수인계 runbook" 참조.
 *
 * 백업 대상 → G:\내 드라이브\FlowVium-backup\
 *   - flowvium-{date}.db   : SQLite 정합 백업 (better-sqlite3 backup API — WAL 안전). 최근 7개 유지.
 *   - secrets/             : .env.local + .cf-tunnel-token (사용자 본인 Drive — 시크릿 포함 주의)
 *   - reports/             : 발간물 JSON (미러)
 *   - research_history/    : 작업 이력 (미러)
 *
 * 사용: node scripts/backup-takeover.mjs   (Task Scheduler FlowVium-Backup 매일 04:35)
 */
import Database from 'better-sqlite3';
import { cpSync, mkdirSync, existsSync, readdirSync, unlinkSync, copyFileSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const DEST = process.env.FLOWVIUM_BACKUP_DIR || 'G:\\내 드라이브\\FlowVium-backup';

function log(...a) { console.log(`[backup ${new Date().toISOString().slice(0, 19)}]`, ...a); }

if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true });

// 1. SQLite 정합 백업 (라이브 cron 과 동시 실행돼도 WAL 안전)
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST 날짜
const dbDest = join(DEST, `flowvium-${today}.db`);
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
await db.backup(dbDest);
db.close();
log(`DB → ${dbDest} (${(statSync(dbDest).size / 1048576).toFixed(1)} MB)`);

// 1b. DB 백업 7개 초과분 삭제 (오래된 것부터)
const dbBackups = readdirSync(DEST).filter(f => /^flowvium-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
for (const old of dbBackups.slice(0, Math.max(0, dbBackups.length - 7))) {
  unlinkSync(join(DEST, old));
  log(`오래된 DB 백업 삭제: ${old}`);
}

// 2. 시크릿 (.env.local / .cf-tunnel-token) — 사용자 본인 Google Drive
const secretsDir = join(DEST, 'secrets');
if (!existsSync(secretsDir)) mkdirSync(secretsDir);
for (const f of ['.env.local', '.cf-tunnel-token']) {
  const src = resolve(ROOT, f);
  if (existsSync(src)) { copyFileSync(src, join(secretsDir, f)); log(`시크릿 → secrets/${f}`); }
}

// 2b. 복구 문서 + 런타임 데이터 산출물 — clone 전(폰/웹)에서도 runbook 열람 + git 미추적
//   data 파일(profiles 는 fullpage hook 이 발간마다 갱신 — 2026-06-12 untrack) 보존
for (const f of ['HANDOFF.md', 'CLAUDE.md', 'data/company-profiles.json']) {
  const src = resolve(ROOT, f);
  if (existsSync(src)) { copyFileSync(src, join(DEST, f.split('/').pop())); log(`문서/데이터 → ${f.split('/').pop()}`); }
}

// 3. reports / research_history 미러 — Google Drive FS 가 recursive cp 중 간헐 lock 에러를
//    내므로(2026-06-12 첫 실행 crash) 파일 단위 + 신규/변경분만 + per-file try/catch.
function mirrorDir(rel) {
  const src = resolve(ROOT, rel);
  if (!existsSync(src)) return;
  let copied = 0, skipped = 0, failed = 0;
  const walk = (s, d) => {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    for (const name of readdirSync(s)) {
      const sp = join(s, name), dp = join(d, name);
      const st = statSync(sp);
      if (st.isDirectory()) { walk(sp, dp); continue; }
      try {
        if (existsSync(dp) && statSync(dp).size === st.size && statSync(dp).mtimeMs >= st.mtimeMs) { skipped++; continue; }
        copyFileSync(sp, dp); copied++;
      } catch (e) { failed++; if (failed <= 3) log(`  ⚠️ ${rel}/${name}: ${String(e.message).slice(0, 60)}`); }
    }
  };
  walk(src, join(DEST, rel));
  log(`${rel}/ 미러: 복사 ${copied}, 스킵(동일) ${skipped}, 실패 ${failed}`);
  return failed;
}
const fails = (mirrorDir('reports') ?? 0) + (mirrorDir('research_history') ?? 0);

log(fails ? `⚠️ 백업 완료 (미러 실패 ${fails}건 — 다음 주기 재시도)` : '✅ 인수인계 백업 완료');
process.exitCode = 0; // 부분 실패는 다음 일일 주기에 자가 회복 — cron 을 fail 로 오기록하지 않음

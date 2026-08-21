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
import { tmpdir } from 'os';
import fsp from 'fs/promises';

const ROOT = resolve(import.meta.dirname, '..');
// 2026-08-20: 기본값이 Windows 드라이브 문자였다. 환경변수 없으면 그냥 실패시킨다 —
//   조용히 엉뚱한 곳에 백업하는 것보다 안 하는 게 낫다.
const DEST = process.env.FLOWVIUM_BACKUP_DIR;
if (!DEST) { console.error('❌ FLOWVIUM_BACKUP_DIR 미설정 — 백업 대상 경로를 지정하라'); process.exit(1); }

// 느린 클라우드 FS(Google Drive File Stream)에서 무한정 매달리지 않도록 전체 예산을 둔다.
//   값은 환경변수로 조절 — 마운트 속도는 기기·네트워크마다 다르다.
const T0 = Date.now();
const BUDGET_MS = Number(process.env.BACKUP_BUDGET_MS) || 20 * 60 * 1000;
const UNLINK_TIMEOUT_MS = Number(process.env.BACKUP_UNLINK_TIMEOUT_MS) || 30 * 1000;
const KEEP = Number(process.env.BACKUP_KEEP) || 7;

function log(...a) { console.log(`[backup ${new Date().toISOString().slice(0, 19)}]`, ...a); }

if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true });

// 1. SQLite 정합 백업 (라이브 cron 과 동시 실행돼도 WAL 안전)
//
// 2026-08-21: 종전엔 db.backup(dbDest) 로 *대상 경로에 직접* 썼다. 대상이 Google Drive
//   File Stream 이면 멈춘다 — 실측: 12분+ 동안 0바이트, CPU 0%, 파일락/쓰기 대기도 아님.
//   같은 호출을 로컬 경로로 하면 144.9MB 를 0.2초에 끝낸다. 원인은 대상 파일시스템이다:
//   SQLite backup API 는 작은 페이지 쓰기+fsync 를 반복하는데 FUSE 계열이 그 패턴을 못 견딘다.
//   (Windows 시절 G:\ 에서는 드러나지 않았다 — 맥 이관에서 처음 나타난 결함이다.)
//   로컬 임시 파일로 뜬 뒤 완성본을 한 번에 복사한다. 순차 대용량 쓰기는 Drive 도 문제없다.
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST 날짜
const dbDest = join(DEST, `flowvium-${today}.db`);
const localDb = join(tmpdir(), `flowvium-backup-${today}.db`);
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
const tDb = Date.now();
await db.backup(localDb);
db.close();
log(`DB 로컬 정합본 ${(statSync(localDb).size / 1048576).toFixed(1)} MB (${((Date.now() - tDb) / 1000).toFixed(1)}s)`);
const tCp = Date.now();
copyFileSync(localDb, dbDest);
unlinkSync(localDb);
log(`DB → ${dbDest} (${(statSync(dbDest).size / 1048576).toFixed(1)} MB, 복사 ${((Date.now() - tCp) / 1000).toFixed(1)}s)`);


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
  let copied = 0, skipped = 0, failed = 0, aborted = false;
  const walk = (s, d) => {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    for (const name of readdirSync(s)) {
      // 2026-08-21: 미러도 예산 안에서만. 이 마운트는 서버 왕복 1회가 ~9.5초라
      //   파일이 많으면 혼자 몇 시간을 쓴다 — 그동안 다음 주기가 겹치고, 실측으로
      //   같은 시각에 돌던 보고서 생성이 6.7배 느려졌다(macro 425s → 2869s, 시간 상관).
      //   미러는 증분이므로 중간에 멈춰도 다음 주기가 이어받는다.
      if (Date.now() - T0 > BUDGET_MS) { aborted = true; return; }
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
  log(`${rel}/ 미러: 복사 ${copied}, 스킵(동일) ${skipped}, 실패 ${failed}${aborted ? ' ⏱예산초과 — 다음 주기 이어서' : ''}`);
  return failed;
}
const fails = (mirrorDir('reports') ?? 0) + (mirrorDir('research_history') ?? 0);

// 4. 보존정책: DB 백업 7개 초과분 삭제 — *맨 마지막* 에, 시간예산 안에서만.
//   2026-08-21: 종전엔 DB 백업 직후(1b)에 있었다. 대상이 클라우드 전용(dehydrated) 파일이면
//   unlinkSync 가 서버 왕복을 기다리며 이벤트루프를 통째로 막는다 — 실측 이 마운트는
//   왕복 1회가 ~9.5초다(dehydrated stat 4ms vs 첫 1바이트 read 9,526ms).
//   그 결과 시크릿·문서·미러가 아예 실행되지 않았다(secrets/.env.local 이 Jul 29 그대로였다).
//   가장 덜 중요한 단계가 가장 중요한 단계를 막고 있었다. 순서를 뒤집고, 예산을 넘기면 포기한다.
//   지우다 만 파일이 남아도 무해하다 — 다음 주기가 다시 시도한다.
const overBudget = () => Date.now() - T0 > BUDGET_MS;
if (overBudget()) {
  log(`⏱ 시간예산 ${Math.round(BUDGET_MS / 60000)}분 초과 — 보존정책 삭제는 다음 주기로 미룸`);
} else {
  const dbBackups = readdirSync(DEST).filter(f => /^flowvium-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of dbBackups.slice(0, Math.max(0, dbBackups.length - KEEP))) {
    if (overBudget()) { log(`⏱ 예산 초과 — 남은 삭제(${old} 등)는 다음 주기로`); break; }
    try {
      // 동기 unlink 는 느린 FS 에서 무한정 막힌다 → 비동기 + 개별 상한.
      await Promise.race([
        fsp.unlink(join(DEST, old)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('unlink 상한 초과')), UNLINK_TIMEOUT_MS)),
      ]);
      log(`오래된 DB 백업 삭제: ${old}`);
    } catch (e) { log(`  ⚠️ ${old} 삭제 보류(${String(e.message).slice(0, 40)}) — 다음 주기 재시도`); }
  }
}

log(`총 소요 ${((Date.now() - T0) / 1000).toFixed(1)}s`);
log(fails ? `⚠️ 백업 완료 (미러 실패 ${fails}건 — 다음 주기 재시도)` : '✅ 인수인계 백업 완료');
process.exitCode = 0; // 부분 실패는 다음 일일 주기에 자가 회복 — cron 을 fail 로 오기록하지 않음

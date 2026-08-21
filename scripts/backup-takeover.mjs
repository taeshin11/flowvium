#!/usr/bin/env node
/**
 * scripts/backup-takeover.mjs — 머신 사망 대비 인수인계 백업 (2026-06-12 신설).
 *
 * 배경: 6/7 하드 freeze 로 4일 다운 — 사용자 "컴퓨터 꺼지면 다른 컴퓨터에서 넘겨받아 작업".
 *   git 에 없는 로컬 상태(DB 학습이력·시크릿·발간물)를 Google Drive 로 일일 백업.
 *   다른 머신 복구 절차: HANDOFF.md 참조.
 *
 * ── 2026-08-22 전면 재작성. 이유: 대상이 Google Drive File Stream 인데 동기 fs 호출을 쓰고 있었다.
 *
 * 이 마운트의 실측 특성 (가설 3개 중 2개를 기각하고 좁힌 결과):
 *   · 새 파일 쓰기        20MB → 3ms      (로컬 캐시에 떨어진다)
 *   · unlink(로컬 캐시본)         → 0ms
 *   · dehydrated 파일 stat        → 4ms    (메타데이터는 로컬)
 *   · dehydrated 파일 첫 1바이트 read → 9,526ms  ← 서버 왕복
 *   · dehydrated 파일 *덮어쓰기*  → 9분+ 반환 없음   ← 실제로 여기서 멈췄다
 *   · db.backup() 을 Drive 경로로 직접 → 12분+ 0바이트 (같은 호출 로컬은 0.2s)
 *
 * 그래서 세 가지 원칙으로 다시 짠다:
 *   ① SQLite 정합본은 *로컬* 로 뜬 뒤 완성본만 한 번에 복사한다.
 *      backup API 의 잦은 소량 쓰기+fsync 를 FUSE 계열이 못 견딘다.
 *   ② 모든 원격 연산에 개별 상한을 건다. 어떤 연산도 돌아온다고 가정하지 않는다.
 *      상한을 넘긴 파일은 그것만 포기한다 — 백업은 증분이라 다음 주기가 이어받는다.
 *   ③ 중요도 순서로 실행한다. 종전엔 보존정책 삭제(가장 덜 중요)가 시크릿·문서·미러 앞에 있어,
 *      그 한 번의 정지가 나머지 전부를 막았다(실측: secrets/.env.local 이 23일간 Jul 29 그대로).
 *
 * 사용: node scripts/backup-takeover.mjs   (launchd com.spinai.flowvium-backup, 매일 04:35)
 * 환경: FLOWVIUM_BACKUP_DIR(필수) · BACKUP_BUDGET_MS · BACKUP_OP_TIMEOUT_MS · BACKUP_KEEP
 */
import Database from 'better-sqlite3';
import fsp from 'fs/promises';
import { existsSync, mkdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

const ROOT = resolve(import.meta.dirname, '..');
// 2026-08-20: 기본값이 Windows 드라이브 문자였다. 환경변수 없으면 그냥 실패시킨다 —
//   조용히 엉뚱한 곳에 백업하는 것보다 안 하는 게 낫다.
const DEST = process.env.FLOWVIUM_BACKUP_DIR;
if (!DEST) { console.error('❌ FLOWVIUM_BACKUP_DIR 미설정 — 백업 대상 경로를 지정하라'); process.exit(1); }

// 2026-08-22: 로컬 2차 대상. Drive 만 믿을 수 없다는 것이 실측으로 드러났다 —
//   launchd 컨텍스트에서는 Google 서버 왕복이 필요한 연산(readdir · dehydrated unlink ·
//   기존 파일 덮어쓰기)이 완료되지 않는다. 같은 스크립트가 대화형 셸에서는 29.1s 에 완주한다.
//   원인은 실행 컨텍스트의 권한이고 그 부여는 GUI 조작(시스템 설정 → 개인정보 보호 및 보안 →
//   전체 디스크 접근 권한)이라 스크립트가 스스로 해결할 수 없다.
//   그동안 예약 백업이 *아무것도* 못 남기는 것은 최악이다. 로컬에는 반드시 남긴다 —
//   기기 사망은 못 막지만 디스크 오염·실수 삭제·롤백은 막는다. Drive 는 best-effort 로 계속 시도한다.
const LOCAL_DEST = process.env.FLOWVIUM_BACKUP_LOCAL_DIR || resolve(process.env.HOME ?? '.', 'flowvium_backups');

const T0 = Date.now();
const BUDGET_MS  = Number(process.env.BACKUP_BUDGET_MS) || 20 * 60 * 1000;
const OP_TIMEOUT_MS = Number(process.env.BACKUP_OP_TIMEOUT_MS) || 20 * 1000;
const KEEP = Number(process.env.BACKUP_KEEP) || 7;

const log = (...a) => console.log(`[backup ${new Date().toISOString().slice(0, 19)}]`, ...a);
const overBudget = () => Date.now() - T0 > BUDGET_MS;

/**
 * 대상이 있으면 *지우고* 새로 쓴다.
 *
 * 2026-08-22 실측: launchd 컨텍스트에서 이 마운트는 연산별로 갈린다 —
 *   stat OK · 새 파일 write OK · unlink OK · readdir 10s 초과 ✗ · **기존 파일 덮어쓰기 20s 초과 ✗**
 *   (같은 스크립트를 대화형 셸에서 돌리면 전부 정상, 총 29.1s 에 완주한다.
 *    즉 Drive 도 코드도 아니라 실행 컨텍스트의 권한 문제다 — 아래 주석 참조.)
 *   덮어쓰기만 막히고 삭제·신규생성은 되므로, 덮어쓰기를 그 둘의 조합으로 바꾼다.
 *   중간에 죽으면 대상이 잠깐 없는 상태가 되지만, 원본은 로컬에 그대로 있고
 *   다음 주기가 다시 쓴다 — 백업본이 잠시 비는 것보다 영영 갱신 안 되는 게 나쁘다.
 */
async function replaceFile(label, src, dest) {
  await withTimeout(`${label} 기존본 제거`, fsp.unlink(dest), OP_TIMEOUT_MS).catch(() => {});
  return withTimeout(label, fsp.copyFile(src, dest));
}

/**
 * 원격 연산 하나에 상한을 건다. 넘기면 false 를 돌려주고 진행한다.
 *   race 는 밑에서 도는 연산을 취소하지 못한다 — 스레드풀에 남는다.
 *   그래서 마지막에 process.exit 로 명시 종료한다(아래 참조).
 */
// 회로차단기: 원격 연산이 연속으로 상한을 넘기면 이번 주기 Drive 는 포기한다.
//   2026-08-22 실측 — launchd 컨텍스트에서는 서버 왕복이 필요한 연산이 *전부* 실패한다.
//   그런데도 파일마다 20초씩 기다리면 매일 밤 20분을 헛되이 태운다(그동안 디스크·Drive 데몬을
//   붙들어 같은 시각 도는 보고서까지 느려진다 — 실측으로 겪었다).
//   빨리 포기하고 로그로 사유를 남기는 게 낫다. 로컬 2차 백업은 이미 1b 에서 끝나 있다.
let consecutiveTimeouts = 0;
let remoteGaveUp = false;
const REMOTE_FAIL_LIMIT = Number(process.env.BACKUP_REMOTE_FAIL_LIMIT) || 3;

async function withTimeout(label, promise, ms = OP_TIMEOUT_MS) {
  if (remoteGaveUp) return false;
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${ms}ms 상한 초과`)), ms); }),
    ]);
    consecutiveTimeouts = 0;
    return true;
  } catch (e) {
    log(`  ⚠️ ${label}: ${String(e.message).slice(0, 60)} — 이번 주기 건너뜀`);
    if (/상한 초과/.test(String(e.message)) && ++consecutiveTimeouts >= REMOTE_FAIL_LIMIT) {
      remoteGaveUp = true;
      log(`🔌 원격(Drive) 연산 ${REMOTE_FAIL_LIMIT}회 연속 상한 초과 — 이번 주기 Drive 단계 전체 포기.`);
      log(`   원인은 실행 컨텍스트 권한이다(대화형 셸에서는 같은 스크립트가 29.1s 에 완주).`);
      log(`   조치: 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에 node 를 추가.`);
      log(`   그전까지 로컬 2차 백업(1b)이 유일한 안전망이다 — 기기 사망은 못 막는다.`);
    }
    return false;
  } finally { clearTimeout(timer); }
}

if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true });

// ── 1. SQLite 정합 백업 — 로컬로 뜨고 완성본만 복사 (원칙 ①)
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST 날짜
const dbDest = join(DEST, `flowvium-${today}.db`);
const localDb = join(tmpdir(), `flowvium-backup-${today}.db`);
const localDbKeep = localDb;
{
  const t = Date.now();
  const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
  await db.backup(localDb);
  db.close();
  log(`DB 로컬 정합본 ${(statSync(localDb).size / 1048576).toFixed(1)} MB (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  const t2 = Date.now();
  if (await replaceFile(`DB 복사 → ${dbDest}`, localDb, dbDest)) {
    log(`DB → ${dbDest} (복사 ${((Date.now() - t2) / 1000).toFixed(1)}s)`);
  }
  // 로컬 임시본은 6절(로컬 2차 백업)에서 재사용하므로 여기서 지우지 않는다.
}

// ── 1b. 로컬 2차 백업 — *Drive 단계보다 먼저*. 로컬 FS 라 빠르고 상한이 필요 없다.
//   2026-08-22: 처음엔 이걸 맨 뒤(미러 뒤)에 뒀다가 같은 실수를 반복했다 —
//   느린 Drive 단계가 앞에 있으면 가장 확실한 산출물이 예산 초과로 못 나온다.
//   확실한 것부터 만든다.
try {
  if (!existsSync(LOCAL_DEST)) mkdirSync(LOCAL_DEST, { recursive: true });
  const localCopy = join(LOCAL_DEST, `flowvium-${today}.db`);
  await fsp.rm(localCopy, { force: true });
  await fsp.copyFile(localDbKeep, localCopy);
  for (const f of ['.env.local', '.cf-tunnel-token']) {
    const src = resolve(ROOT, f);
    if (existsSync(src)) await fsp.copyFile(src, join(LOCAL_DEST, f));
  }
  // 로컬도 KEEP 개만 유지 (여긴 readdir 가 정상이다)
  const lf = (await fsp.readdir(LOCAL_DEST)).filter((f) => /^flowvium-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of lf.slice(0, Math.max(0, lf.length - KEEP))) await fsp.unlink(join(LOCAL_DEST, old)).catch(() => {});
  log(`로컬 2차 백업 → ${LOCAL_DEST} (DB + 시크릿, 최근 ${KEEP}개 유지)`);
} catch (e) { log(`⚠️ 로컬 2차 백업 실패: ${String(e.message).slice(0, 70)}`); }

// ── 2. 시크릿 — 가장 대체 불가능한 자산이라 DB 다음이다 (원칙 ③)
//    사용자 본인 Drive 이지만 시크릿이 들어간다는 점은 인지할 것.
const secretsDir = join(DEST, 'secrets');
if (!existsSync(secretsDir)) mkdirSync(secretsDir, { recursive: true });
for (const f of ['.env.local', '.cf-tunnel-token']) {
  if (overBudget()) { log('⏱ 예산 초과 — 시크릿 이후 단계 중단'); break; }
  const src = resolve(ROOT, f);
  if (!existsSync(src)) continue;
  // 기존 dehydrated 파일 덮어쓰기가 멈추는 케이스라 상한이 반드시 필요하다(헤더 실측 참조).
  if (await replaceFile(`시크릿 ${f}`, src, join(secretsDir, f))) log(`시크릿 → secrets/${f}`);
}

// ── 3. 복구 문서 + 런타임 산출물 — clone 전(폰/웹)에서도 runbook 열람 가능하게
for (const f of ['HANDOFF.md', 'CLAUDE.md', 'data/company-profiles.json']) {
  if (overBudget()) { log('⏱ 예산 초과 — 문서 단계 중단'); break; }
  const src = resolve(ROOT, f);
  if (!existsSync(src)) continue;
  const name = f.split('/').pop();
  if (await replaceFile(`문서 ${name}`, src, join(DEST, name))) log(`문서/데이터 → ${name}`);
}

// ── 4. reports / research_history 증분 미러
//    파일 단위 + 신규/변경분만 + 연산별 상한. 중간에 멈춰도 다음 주기가 이어받는다.
async function mirrorDir(rel) {
  // 차단됐으면 걷지도 않는다. 쓰기가 전부 거부되는데 대상 경로를 stat 하며 도는 건
  //   시간만 태우고(파일 476개) 같은 시각 도는 다른 작업의 디스크를 뺏는다.
  if (remoteGaveUp) { log(`${rel}/ 미러: 원격 차단 상태 — 건너뜀`); return 0; }
  const src = resolve(ROOT, rel);
  if (!existsSync(src)) return 0;
  let copied = 0, skipped = 0, failed = 0, aborted = false;
  const walk = async (s, d) => {
    if (aborted) return;
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    for (const name of await fsp.readdir(s)) {
      if (overBudget()) { aborted = true; return; }
      const sp = join(s, name), dp = join(d, name);
      const st = statSync(sp);
      if (st.isDirectory()) { await walk(sp, dp); if (aborted) return; continue; }
      try {
        // stat 은 메타데이터라 dehydrated 여도 빠르다(실측 4ms) — 스킵 판정에 안전하다.
        if (existsSync(dp) && statSync(dp).size === st.size && statSync(dp).mtimeMs >= st.mtimeMs) { skipped++; continue; }
        if (await replaceFile(`${rel}/${name}`, sp, dp)) copied++; else failed++;
      } catch (e) { failed++; if (failed <= 3) log(`  ⚠️ ${rel}/${name}: ${String(e.message).slice(0, 60)}`); }
    }
  };
  await walk(src, join(DEST, rel));
  log(`${rel}/ 미러: 복사 ${copied}, 스킵(동일) ${skipped}, 실패 ${failed}${aborted ? ' ⏱예산초과 — 다음 주기 이어서' : ''}`);
  return failed;
}
const fails = (await mirrorDir('reports')) + (await mirrorDir('research_history'));

// ── 5. 보존정책 — 맨 마지막. 실패해도 잃는 게 없는 단계다 (원칙 ③)
if (remoteGaveUp) {
  log('보존정책: 원격 차단 상태 — 건너뜀 (로컬 보존은 1b 에서 이미 적용)');
} else if (overBudget()) {
  log(`⏱ 시간예산 ${Math.round(BUDGET_MS / 60000)}분 초과 — 보존정책 삭제는 다음 주기로`);
} else {
  const files = (await fsp.readdir(DEST)).filter((f) => /^flowvium-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
    if (overBudget()) { log(`⏱ 예산 초과 — 남은 삭제(${old} 등)는 다음 주기로`); break; }
    if (await withTimeout(`오래된 백업 삭제 ${old}`, fsp.unlink(join(DEST, old)))) log(`오래된 DB 백업 삭제: ${old}`);
  }
}

log(`총 소요 ${((Date.now() - T0) / 1000).toFixed(1)}s`);
log(fails ? `⚠️ 백업 완료 (건너뛴 파일 ${fails}건 — 다음 주기 재시도)` : '✅ 인수인계 백업 완료');
// 상한을 넘긴 연산이 스레드풀에 남아 있으면 이벤트루프가 안 비어 프로세스가 안 죽는다.
//   부분 실패는 다음 일일 주기가 자가 회복하므로 여기서 명시 종료한다(cron 을 fail 로 오기록하지 않게 0).
await fsp.unlink(localDb).catch(() => {});   // 임시본 정리
process.exit(0);

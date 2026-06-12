#!/usr/bin/env node
/**
 * scripts/cron-runner.mjs — 자가호스팅 크론 러너 (Vercel cron 대체).
 *
 * 2026-06-02: Vercel fair-use 차단 → 자가호스팅 이전. vercel.json 의 crons 26개를
 *   node-cron 으로 로컬에서 동일 스케줄로 실행 (http://localhost:PORT/api/cron/* 호출).
 *   단일 프로세스. next start 와 함께 상시 구동.
 *
 * 사용: PORT=3000 node scripts/cron-runner.mjs
 *   (vercel.json 의 schedule 을 그대로 읽어 동기화 — cron 추가/변경 시 자동 반영)
 *
 * 스케줄 기준 시각: 로컬 머신 타임존 (Vercel 은 UTC 였음 — KST 머신이면 9시간 시프트됨).
 *   → CRON_TZ 환경변수로 'Etc/UTC' 지정 시 기존 Vercel UTC 스케줄 그대로 유지.
 */
import cron from 'node-cron';
import { readFileSync, existsSync, writeFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

// 2026-06-11: execSync → 비동기 execFile. execSync 는 이벤트 루프를 최대 170~300초 블로킹해
//   node-cron "missed execution" (보고서 cron 누락) 유발 + 자식이 hang 하면 러너 전체가 멈춤.
//   execFile 은 shell(cmd.exe) 미경유 → cmd 창 팝업도 원천 제거. timeout 시 SIGTERM kill 유지.
const execFileAsync = promisify(execFile);

// 2026-06-04: .env.local 로드 — pm2(plain node)는 next 와 달리 .env.local 자동 로드 안 함.
//   CRON_SECRET 미로드 → Authorization 헤더 없이 호출 → web route(CRON_SECRET 보유)가 401 →
//   모든 authed cron(news-cascade 다국어 번역 warm 등) silent 실패(HTTP 401).
try {
  const envPath = resolve(process.cwd(), '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* non-fatal */ }

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const TZ = process.env.CRON_TZ || 'Etc/UTC'; // Vercel cron 은 UTC 기준이었음 → 동일 유지
const SECRET = process.env.CRON_SECRET || ''; // 있으면 Authorization 헤더로 전달

const vercelJson = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
const crons = vercelJson.crons || [];

function log(...a) { console.log(`[cron-runner ${new Date().toISOString().slice(0, 19)}]`, ...a); }

async function runJob(path) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
      signal: AbortSignal.timeout(120000),
    });
    log(`${path} → HTTP ${res.status} (${Date.now() - t0}ms)`);
  } catch (e) {
    log(`${path} → ERROR ${String(e?.message || e)} (${Date.now() - t0}ms)`);
  }
}

// 2026-06-11: 보고서 파이프라인 실행 감지 — run-report.bat 의 mutex lock 디렉토리 기준.
//   age>=90min 은 stale(hang 잔존)로 간주해 false (영구 skip 방지). 비용 0 (fs stat).
async function isReportPipelineRunning() {
  try {
    const st = statSync(resolve(process.cwd(), 'logs/report-pipeline.lock'));
    return (Date.now() - st.ctimeMs) < 90 * 60 * 1000;
  } catch { return false; }
}

let scheduled = 0;
for (const c of crons) {
  if (!c.path || !c.schedule) continue;
  if (!cron.validate(c.schedule)) { log(`⚠️ invalid schedule "${c.schedule}" for ${c.path} — skip`); continue; }
  cron.schedule(c.schedule, () => runJob(c.path), { timezone: TZ });
  scheduled++;
}
log(`스케줄 등록 ${scheduled}/${crons.length} (TZ=${TZ}, BASE=${BASE}). Ctrl+C 종료.`);

// 2026-06-05: 자동 모니터 (촘촘히) — 수동 의존 제거. */20분 check-stall + check-data-quality 실행,
//   execSync timeout 으로 hang 방지, 결과를 logs/monitor-status.json 에 기록(가시) + 결함 시 로그 강조.
let monitorRunning = false;
const warmLast = new Map();  // 2026-06-12: auto-warm per-locale 쿨다운 (중복 트리거 방지)
const WARM_COOLDOWN_MS = 45 * 60 * 1000;  // 번역 1 locale 완주가 20분+ 걸릴 수 있어 모니터 주기(20분)보다 길게
async function runMonitor() {
  if (monitorRunning) { log('[auto-monitor] 이전 사이클 진행 중 — skip (중복 실행 방지)'); return; }
  monitorRunning = true;
  try {
  const result = { ts: new Date().toISOString(), checks: {}, defects: [] };
  for (const [key, script] of [['stall', 'scripts/check-stall.mjs'], ['dataQuality', 'scripts/check-data-quality.mjs']]) {
    try {
      await execFileAsync('node', [script], { timeout: 170000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });   // timeout = hang 방지
      result.checks[key] = 'OK';
    } catch (e) {
      const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
      result.checks[key] = e.signal === 'SIGTERM' ? 'TIMEOUT(hang)' : 'DEFECT';
      for (const l of out.split('\n')) if (l.includes('🚨')) result.defects.push(l.replace(/.*🚨\s*/, '').trim());
    }
  }
  try { writeFileSync(resolve(process.cwd(), 'logs/monitor-status.json'), JSON.stringify(result, null, 2)); } catch { /* */ }
  log(`[auto-monitor] stall=${result.checks.stall} dq=${result.checks.dataQuality}${result.defects.length ? ' 🚨 ' + result.defects.slice(0, 4).join(' | ') : ' ✅'}`);

  // 2026-06-06 cold-cache self-heal: 자가호스팅이라 cloud 번역 warm-cron(401) 부재 → 뉴스 새로고침
  //   후 비-ko locale 이 cold 로 남아 모니터마다 [B] 결함 재발(수동 warm 반복). 감지 시 자동 warm
  //   fetch 로 self-heal. 단일 ollama GPU → 직렬 warm(순차 fetch). "최선의 방법을 자동화" 요청 반영.
  const coldLocales = [...new Set(result.defects
    .map(d => d.match(/뉴스 번역\s+([a-zA-Z-]+)\s+\d+\/\d+/)?.[1])
    .filter(Boolean))];
  // 2026-06-11: 보고서 파이프라인 실행 중엔 warm skip — 단일 6GB GPU 에서 번역(exaone 모델 스왑)과
  //   Wave1(qwen3 5병렬)이 경합하면 Ollama 연결 드롭("fetch failed", 6/11 afternoon Wave1 전멸 사건)
  //   + GPU 83°C 지속(6/7 hard freeze 기여 의심). 보고서가 GPU 우선권.
  if (coldLocales.length && await isReportPipelineRunning()) {
    log(`[auto-warm] skip — 보고서 파이프라인 실행 중 (GPU 경합 방지): ${coldLocales.join(',')}`);
  } else if (coldLocales.length) {
    (async () => {
      for (const loc of coldLocales) {
        // 2026-06-12: per-locale 쿨다운 — 번역이 모니터 주기(20분) 내 못 끝나면 다음 사이클이
        //   같은 locale 을 중복 트리거해 큐 누적(GPU 27분+ 고부하 사건). 45분 내 재트리거 금지.
        if (Date.now() - (warmLast.get(loc) ?? 0) < WARM_COOLDOWN_MS) { log(`[auto-warm] ${loc} 쿨다운 중 — 중복 트리거 skip`); continue; }
        warmLast.set(loc, Date.now());
        try {
          await fetch(`${BASE}/api/news-cascade?locale=${loc}`, { signal: AbortSignal.timeout(150000) });
          log(`[auto-warm] ${loc} 번역 warm 트리거 (cold-cache self-heal)`);
        } catch { log(`[auto-warm] ${loc} warm 실패`); }
      }
    })();
  }
  } finally { monitorRunning = false; }
}
cron.schedule('*/20 * * * *', runMonitor, { timezone: TZ });
log('자동 모니터 등록: */20분 (check-stall + check-data-quality, hang-protected, → logs/monitor-status.json)');

// 2026-06-07: 동적 제품/세그먼트 매출 주기 refresh (사용자 "모니터링시 업데이트 + db + 로그").
//   2시간마다 미보유/오래된 US ticker 6개 rotating → SEC 10-K 추출 → DB company_segments 적재
//   (cron checkout wipe 안전). 정적 stale 문제 점진 해소. hang 방지 timeout 300s.
let segmentRefreshRunning = false;
async function runSegmentRefresh() {
  if (segmentRefreshRunning) { log('[segments-refresh] 이전 실행 진행 중 — skip (중복 실행 방지)'); return; }
  if (await isReportPipelineRunning()) { log('[segments-refresh] skip — 보고서 파이프라인 실행 중 (GPU 경합 방지)'); return; }
  segmentRefreshRunning = true;
  try {
    const { stdout } = await execFileAsync('node', ['scripts/build-segments-dynamic.mjs', '--refresh=6'], { timeout: 300000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    const m = stdout.match(/✓ (\d+) \/ ✗ (\d+)/);
    log(`[segments-refresh] ${m ? `✓${m[1]} ✗${m[2]}` : 'done'} (DB company_segments)`);
  } catch (e) { log(`[segments-refresh] 실패: ${e.signal === 'SIGTERM' ? 'timeout' : String(e.message).slice(0, 60)}`); }
  finally { segmentRefreshRunning = false; }
}
cron.schedule('30 * * * *', runSegmentRefresh, { timezone: TZ });
log('동적 세그먼트 refresh 등록: 매시 6 ticker rotating (DB company_segments, 10-K 추출 — 873 US 약 6일 1순회)');

// 2026-06-12: 사라진 유지보수 작업 복원 — 이전 Windows Task Scheduler 의 DART-CorpCodes(02:00)/
//   DART-Prefetch(03:00)/Tune-Rules(일 04:00) 가 머신 재구성 중 소멸돼 silent 미시행 상태였음
//   (백엔드 census 중 발견). 자가호스팅 일원화 원칙대로 cron-runner 에 재배선.
async function runMaintenance(label, script, timeoutMs) {
  if (await isReportPipelineRunning()) { log(`[${label}] skip — 보고서 파이프라인 실행 중`); return; }
  try {
    await execFileAsync('node', [script], { timeout: timeoutMs, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    log(`[${label}] 완료`);
  } catch (e) { log(`[${label}] 실패: ${e.signal === 'SIGTERM' ? 'timeout' : String(e.message).slice(0, 80)}`); }
}
cron.schedule('5 17 * * *', () => runMaintenance('dart-corpcodes', 'scripts/fetch-dart-corp-codes.mjs', 300000), { timezone: TZ });   // 02:05 KST
cron.schedule('5 18 * * *', () => runMaintenance('dart-prefetch', 'scripts/prefetch-dart-financials.mjs', 900000), { timezone: TZ }); // 03:05 KST
cron.schedule('5 19 * * 6', () => runMaintenance('tune-sell-rules', 'scripts/tune-sell-rules.mjs', 600000), { timezone: TZ });        // 일 04:05 KST
cron.schedule('20 19 * * 6', () => runMaintenance('tune-buy-rules', 'scripts/tune-buy-rules.mjs', 600000), { timezone: TZ });         // 일 04:20 KST
log('유지보수 cron 복원: DART corp-codes(02:05)/prefetch(03:05) 매일 + buy/sell rules 튜닝(일 04:05/04:20 KST)');

// keep alive
process.stdin.resume();

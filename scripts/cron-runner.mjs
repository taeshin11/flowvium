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
import { readFileSync, existsSync, writeFileSync, statSync, readdirSync } from 'fs';
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

// 2026-06-17 (전수조사 #5): HTTP 크론 실패 표면화. 기존 runJob 은 non-200/error/200-error-body 를 log 만
//   → send-alerts/verify-metrics/daily-brief 등이 silent 실패해도 무알림이던 사각지대. 실패를 모듈 배열에
//   기록하고 runMonitor 가 최근(<25m) 실패를 monitor-status.defects 로 surface → 스팟체크에 노출.
const cronFailures = []; // { ts, path, detail }
function recordCronFailure(path, detail) {
  cronFailures.push({ ts: Date.now(), path, detail });
  while (cronFailures.length > 50) cronFailures.shift();
}

// 2026-07-02: HTTP 크론 마지막 성공 기록 — 시작시 catchup(놓친 슬롯 자기치유)의 판정 근거.
//   컷오버/재부팅으로 슬롯을 놓치면 Redis 캐시가 TTL 만료로 조용히 죽던 클래스(signal-retrospective
//   콜드캐시 + /api/signals 빈배열, 2026-07-02 같은 날 2건)의 영구 봉쇄.
const lastRunPath = resolve(process.cwd(), 'logs/cron-last-run.json');
let _lastRun = {};
try { _lastRun = JSON.parse(readFileSync(lastRunPath, 'utf8')); } catch { /* 최초 */ }
function recordRun(path) {
  _lastRun[path] = Date.now();
  try { writeFileSync(lastRunPath, JSON.stringify(_lastRun, null, 1)); } catch { /* 비치명 */ }
}

async function runJob(path) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
      signal: AbortSignal.timeout(120000),
    });
    let fail = '';
    if (res.status >= 400) fail = `HTTP ${res.status}`;
    else {
      // HTTP 200 이어도 body 가 {"error":...} 면 silent 실패 (CLAUDE.md DART 404 사건 클래스)
      // 2026-06-17: verify-metrics 는 *헬스 리포터* — payload 가 정상적으로 nested "error" status 를 담는다
      //   (overallStatus=error = "지표 결함 발견", cron 실행 실패 아님). nested "error" 를 cron 실패로 오분류해
      //   매 사이클 false [cron] 경보. → meta-monitor 엔드포인트는 *top-level* error 필드만 실패로 판정.
      //   지표 결함 자체는 verify-metrics 가 overallStatus 로 이미 surface(대시보드/B1 메타검증).
      try {
        const txt = (await res.text()).slice(0, 2000);
        const isMetaMonitor = /\/verify-metrics/.test(path);
        let parsed = null; try { parsed = JSON.parse(txt); } catch {}
        const topLevelError = parsed && typeof parsed === 'object' && typeof parsed.error === 'string';
        if (isMetaMonitor) {
          if (topLevelError) fail = `endpoint error: ${String(parsed.error).slice(0, 60)}`; // 실제 실패(401 등)만
        } else if (/"error"\s*:/.test(txt)) {
          fail = `200 error-body: ${txt.replace(/\s+/g, ' ').slice(0, 80)}`;
        }
      } catch {}
    }
    log(`${path} → HTTP ${res.status} (${Date.now() - t0}ms)${fail ? ' ⚠️ ' + fail : ''}`);
    if (fail) recordCronFailure(path, fail); else recordRun(path);
  } catch (e) {
    const detail = String(e?.message || e);
    log(`${path} → ERROR ${detail} (${Date.now() - t0}ms)`);
    recordCronFailure(path, detail);
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
const LOCAL_MODEL_NAME = process.env.OLLAMA_TRANSLATE_MODEL || 'qwen3:8b';  // gpu-watchdog 언로드 대상
const warmLast = new Map();  // 2026-06-12: auto-warm per-locale 쿨다운 (중복 트리거 방지)
const WARM_COOLDOWN_MS = 45 * 60 * 1000;  // 번역 1 locale 완주가 20분+ 걸릴 수 있어 모니터 주기(20분)보다 길게
async function runMonitor() {
  if (monitorRunning) { log('[auto-monitor] 이전 사이클 진행 중 — skip (중복 실행 방지)'); return; }
  monitorRunning = true;
  try {
  // 2026-06-12: 배포 재시작 직후 프로브 오탐 가드 — pm2 web uptime < 3분이면 endpoint 프로브만 skip.
  //   사건: verdict 빌드 배포 순간 모니터가 닿아 14 엔드포인트 DEAD(HTTP 500) 대량 오탐.
  let deployWindow = false;
  try {
    // Node 20.12+ 의 .cmd spawn 보안 변경으로 shell 필수 (spawn EINVAL — 가드 silent 실패 사건).
    const { stdout } = await execFileAsync('pm2', ['jlist'], { timeout: 15000, windowsHide: true, shell: true, maxBuffer: 10 * 1024 * 1024 });
    const webs = JSON.parse(stdout).filter((p) => p.name === 'flowvium-web');
    // cluster 다중 인스턴스 — 가장 최근 재시작 기준 (rolling reload 중이면 endpoint 프로브만 skip)
    const newest = Math.max(...webs.map((w) => w?.pm2_env?.pm_uptime ?? 0));
    deployWindow = !!(newest && Date.now() - newest < 180000);
  } catch (e) { log(`[auto-monitor] pm2 uptime 조회 실패(가드 미적용): ${String(e?.message).slice(0, 40)}`); }
  const result = { ts: new Date().toISOString(), checks: {}, defects: [] };
  // 2026-06-13: 배포창에도 모니터 깜깜 금지 (사용자 스팟체크 stale 발견) — endpoint 프로브(웹 의존,
  //   재시작 중 오탐)만 skip 하고 GPU/lock/wipe(웹 독립) 체크는 항상 실행 + status 갱신.
  if (deployWindow) {
    result.checks.deploy = 'web 재시작 직후 — endpoint 프로브 skip(오탐 방지), GPU/lock 만 점검';
    log('[auto-monitor] 배포창(uptime<3분) — endpoint 프로브 skip, GPU/lock 만 점검');
  }
  for (const [key, script] of (deployWindow ? [] : [['stall', 'scripts/check-stall.mjs'], ['dataQuality', 'scripts/check-data-quality.mjs']])) {
    try {
      await execFileAsync('node', [script], { timeout: 170000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });   // timeout = hang 방지
      result.checks[key] = 'OK';
    } catch (e) {
      const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
      result.checks[key] = e.signal === 'SIGTERM' ? 'TIMEOUT(hang)' : 'DEFECT';
      for (const l of out.split('\n')) if (l.includes('🚨')) result.defects.push(l.replace(/.*🚨\s*/, '').trim());
    }
  }
  // 2026-06-12 GPU 열 감시 (사용자 "GPU 96%/82°C — 컴퓨터 꺼지지 않게 조치 철저히"; 6/7 hard
  //   freeze 기여 의심): 83°C+ 결함 표면화, 87°C+ 이고 보고서 파이프라인이 아니면 ollama 모델
  //   강제 언로드(load shed). 웹측 semaphore(llm-local)와 이중 방어.
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 10000, windowsHide: true });
    const [temp, util] = stdout.trim().split(',').map((s) => parseInt(s.trim(), 10));
    result.checks.gpu = `${temp}C/${util}%`;
    if (temp >= 83) {
      result.defects.push(`[GPU] ${temp}°C util ${util}% — 과열 주의 (freeze 위험)`);
      if (temp >= 87 && !(await isReportPipelineRunning())) {
        try {
          await execFileAsync('ollama', ['stop', LOCAL_MODEL_NAME], { timeout: 30000, windowsHide: true });
          result.defects.push(`[GPU] ${temp}°C 비상 — ollama ${LOCAL_MODEL_NAME} 강제 언로드 (load shed)`);
          log(`[gpu-watchdog] 🚨 ${temp}°C — ollama ${LOCAL_MODEL_NAME} 언로드 실행`);
        } catch { log('[gpu-watchdog] ollama stop 실패'); }
      }
    }
  } catch { /* nvidia-smi 부재/실패 — skip */ }

  // 2026-06-17 (사용자 "fallback 보고서 사전검열·배포 전 삭제 + 모니터가 왜 못잡냐"): 매 사이클(20분)
  //   fallback purge — route.ts 원천차단(hist 키·배열 미기록)의 2차 안전망. Redis 세션/stale/hist 키 SCAN
  //   → fallback source 면 즉시 삭제. 기존엔 deep 모니터(6h throttle)에서만 돌아 morning 06:40 실패 후
  //   07:20 fallback 이 ~30분+ 노출됐다(사용자 발견). 이제 20분마다 청소 + 발견 시 결함 표면화.
  try {
    let out = '';
    try { const r = await execFileAsync('node', ['scripts/purge-fallback-report.mjs'], { timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }); out = r.stdout || ''; }
    catch (e) { out = (e.stdout?.toString() || '') + (e.stderr?.toString() || ''); }
    const pline = out.trim().split('\n').pop() || '';
    result.checks.fallbackPurge = /PURGE-FALLBACK ALERT/.test(pline) ? 'PURGED' : 'clean';
    if (/PURGE-FALLBACK ALERT/.test(pline)) result.defects.push(`[fallback] 배포된 fallback 삭제: ${pline.replace(/^.*ALERT:\s*/, '').slice(0, 90)}`);
  } catch { result.checks.fallbackPurge = 'err'; }

  // 2026-07-04: 프런트(브라우저) 에러 수집 소비 — ClientErrorReporter→/api/client-log 링버퍼의 최근 25분
  //   건수. 실사용자 렌더 예외/unhandledrejection 이 서버 로그 사각이던 갭. 3건+ 이면 결함 surface.
  try {
    const r = await fetch(`${BASE}/api/client-log?sinceMin=25`, { headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {}, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      result.checks.clientErrors = j.count ?? 0;
      if ((j.count ?? 0) >= 3) {
        const s = (j.samples ?? [])[0];
        result.defects.push(`[프런트] 브라우저 에러 ${j.count}건/25분${s ? `: ${String(s.message).slice(0, 60)} @${s.url}` : ''}`);
      }
    }
  } catch { /* 비치명 */ }

  // 2026-06-17 (전수조사 #5): 최근 25분 내 HTTP 크론 실패 surface (runJob 이 기록).
  try {
    const recent = cronFailures.filter((f) => Date.now() - f.ts < 25 * 60 * 1000);
    result.checks.cronFails = recent.length;
    if (recent.length) {
      const uniq = [...new Set(recent.map((f) => `${f.path}(${f.detail.slice(0, 40)})`))];
      result.defects.push(`[cron] HTTP 크론 실패 ${recent.length}건: ${uniq.slice(0, 3).join(' | ').slice(0, 140)}`);
    }
  } catch { /* */ }

  // 2026-06-17 (전수조사 #6): 유지보수 잡 freshness — 잡이 silent 미실행되면 어떤 모니터도 안 봤다
  //   (financials=보고서 펀더멘털, accumulation=한컴 06-14 고착 전력 등). git committer-date 는
  //   runMaintenance 가 '데이터 변경 시에만' 커밋해 잘 안 바뀌는 산출물은 오탐 → 잡 실행 자체를 기록하는
  //   heartbeat(logs/maintenance-heartbeat.json, runMaintenance 가 매 실행 갱신)로 검사. 기대주기 초과 시 결함.
  try {
    // 2026-07-02: MAINT_JOBS 단일소스에서 파생 — 등록/모니터/catchup 이 같은 기대주기 공유(drift 방지).
    const HB_MAX = Object.fromEntries(MAINT_JOBS.map((j) => [j.label, j.maxAgeH]));
    let hb = {};
    try { hb = JSON.parse(readFileSync(resolve(process.cwd(), 'logs/maintenance-heartbeat.json'), 'utf8')); } catch { /* 아직 없음 */ }
    const stale = [];
    const staleLabels = [];
    for (const [label, maxH] of Object.entries(HB_MAX)) {
      const ts = hb[label] ? new Date(hb[label]).getTime() : 0;
      const ageH = ts ? (Date.now() - ts) / 3600000 : Infinity;
      if (ageH > maxH) { stale.push(`${label} ${ts ? ageH.toFixed(0) + 'h' : '무기록'}>${maxH}h`); staleLabels.push(label); }
    }
    result.checks.artifactFresh = stale.length ? `stale ${stale.length}` : 'ok';
    if (stale.length) result.defects.push(`[maint] 잡 미실행 의심: ${stale.join(', ').slice(0, 140)}`);
    // 2026-07-04 self-heal: "모니터가 본다 ≠ fix" — stale 잡을 즉석 소급(사이클당 1개, 폭주 방지).
    //   runMaintenance 가 report lock 시 자연 skip → 다음 사이클(20분) 재시도 = 재시도 루프 자동 확보.
    //   (scan-accumulation 슬롯이 리포트 종료창과 겹쳐 4연속 skip·44h stale 인데 감지만 하던 사각지대.)
    if (staleLabels.length) {
      const j = MAINT_JOBS.find((x) => x.label === staleLabels[0]);
      if (j) {
        log(`[auto-monitor/self-heal] stale 잡 즉석 소급: ${j.label}`);
        void runMaintenance(j.label, j.script, j.timeoutMs, j.commitPaths);
      }
    }
  } catch { /* */ }

  // [발행후재검] 2026-06-19: post-publish-recheck verdict 를 *주기* 모니터에 통합. 이전엔 session-spotcheck(수동)
  //   에만 surface 돼, 그걸 안 돌리면 라이브 슬라이드 재검 alert 를 놓쳤다(사용자 "왜 이런 사각지대가 생겼지").
  //   이제 매 20분 모니터가 recheck verdict 를 자동 노출 — "프로세스가 돈다"가 아니라 *결과*를 본다.
  try {
    const rc = JSON.parse(readFileSync(resolve(process.cwd(), 'logs/recheck-status.json'), 'utf8'));
    const ageH = rc.ts ? (Date.now() - new Date(rc.ts).getTime()) / 3600000 : Infinity;
    result.checks.publishRecheck = rc.verdict === 'alert' ? `ALERT(${ageH.toFixed(1)}h)` : `${rc.verdict ?? 'n/a'}(${ageH.toFixed(1)}h)`;
    if (rc.verdict === 'alert' && ageH < 12) {
      const det = (rc.pageAudit || '').replace(/^PAGE-AUDIT\s*/i, '').slice(0, 80);
      result.defects.push(`[발행후재검] 라이브 슬라이드 ALERT${rc.liveConfirmed ? '' : '(라이브미반영)'}: ${det || `결함 ${rc.defectCount ?? '?'}`}`);
    }
  } catch { /* recheck 아직 없음 — 비치명 */ }

  try { writeFileSync(resolve(process.cwd(), 'logs/monitor-status.json'), JSON.stringify(result, null, 2)); } catch { /* */ }
  log(`[auto-monitor] stall=${result.checks.stall} dq=${result.checks.dataQuality} gpu=${result.checks.gpu ?? 'n/a'} fbPurge=${result.checks.fallbackPurge ?? 'n/a'} cronFails=${result.checks.cronFails ?? 0} artifact=${result.checks.artifactFresh ?? 'n/a'} recheck=${result.checks.publishRecheck ?? 'n/a'}${result.defects.length ? ' 🚨 ' + result.defects.slice(0, 4).join(' | ') : ' ✅'}`);

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
          // 2026-06-14: wait=1 필수 — 없으면 background fire-and-forget 경로라 번역이 캐시에 persist
          //   안 돼 cold-cache 무수렴(모니터 상시 flag). wait=1 = sync 경로(번역+translatedKey 캐시 저장 확실).
          const res = await fetch(`${BASE}/api/news-cascade?locale=${loc}&wait=1`, { signal: AbortSignal.timeout(150000) });
          const j = await res.json().catch(() => ({}));
          log(`[auto-warm] ${loc} 번역 warm (sync) — source=${j.source ?? '?'} translated=${j.translated ?? '?'}`);
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
// 2026-06-17 (사용자 "전부 20분마다로 통일"): 매시→*/20분. 6 ticker rotating 빈도 3배 → 순회 약 2일.
//   isReportPipelineRunning/segmentRefreshRunning 가드로 GPU 경합·중복 방지.
cron.schedule('*/20 * * * *', runSegmentRefresh, { timezone: TZ });
log('동적 세그먼트 refresh 등록: */20분 6 ticker rotating (DB company_segments, 10-K 추출 — 873 US 약 2일 1순회)');

// 2026-06-12: 사라진 유지보수 작업 복원 — 이전 Windows Task Scheduler 의 DART-CorpCodes(02:00)/
//   DART-Prefetch(03:00)/Tune-Rules(일 04:00) 가 머신 재구성 중 소멸돼 silent 미시행 상태였음
//   (백엔드 census 중 발견). 자가호스팅 일원화 원칙대로 cron-runner 에 재배선.
async function runMaintenance(label, script, timeoutMs, commitPaths = []) {
  if (await isReportPipelineRunning()) { log(`[${label}] skip — 보고서 파이프라인 실행 중`); return; }
  try {
    await execFileAsync('node', script.split(' '), { timeout: timeoutMs, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }); // script 문자열에 인자(예: '--apply') 허용
    log(`[${label}] 완료`);
    // 2026-06-17 (전수조사 #6): 잡 실행 heartbeat — 데이터 변경 여부와 무관하게 '돌았다'를 기록.
    //   runMonitor 의 freshness 검사가 이 타임스탬프로 silent 미실행을 감지.
    try {
      const hbP = resolve(process.cwd(), 'logs/maintenance-heartbeat.json');
      let hb = {}; try { hb = JSON.parse(readFileSync(hbP, 'utf8')); } catch { /* 최초 */ }
      hb[label] = new Date().toISOString();
      writeFileSync(hbP, JSON.stringify(hb, null, 2));
    } catch { /* heartbeat 실패 비치명 */ }
    // 2026-06-13: 산출물이 tracked 파일이면 자동 커밋+푸시 — 매일 02:05 갱신분이 미커밋으로 남아
    //   wipe-risk 경보 + run-report checkout revert 위험이 반복되던 것 (수동 커밋 toil 제거).
    if (commitPaths.length) {
      try {
        const { stdout: st } = await execFileAsync('git', ['status', '--porcelain', '--', ...commitPaths], { timeout: 15000, windowsHide: true });
        if (st.trim()) {
          await execFileAsync('git', ['add', ...commitPaths], { timeout: 15000, windowsHide: true });
          await execFileAsync('git', ['commit', '-m', `chore(${label}): cron 산출 데이터 자동 커밋`], { timeout: 15000, windowsHide: true });
          // 2026-06-15: --no-verify — 자동생성 *데이터* 커밋이라 pre-push hook(npm run verify, 수분+코드용 게이트)
          //   을 돌리면 안 됨(60s 타임아웃 초과/무관한 fail 로 cron 푸시 차단). 코드 게이트는 사람 push 에만.
          await execFileAsync('git', ['push', '--no-verify', 'origin', 'master'], { timeout: 60000, windowsHide: true });
          log(`[${label}] 산출물 자동 커밋+푸시 (${commitPaths.join(',')})`);
        }
      } catch (e) { log(`[${label}] 자동 커밋 실패(수동 필요): ${String(e?.message).slice(0, 60)}`); }
    }
  } catch (e) { log(`[${label}] 실패: ${e.signal === 'SIGTERM' ? 'timeout' : String(e.message).slice(0, 80)}`); }
}
// 2026-07-02: 유지보수 잡 테이블화 — 스케줄 등록·모니터 freshness(HB_MAX)·시작시 catchup 3소비처가
//   같은 정의를 공유(중복 나열 drift 방지). maxAgeH = runMonitor 기대주기(초과=미실행 의심/catchup 대상).
//   각 항목 이력·사유는 git blame 참조(2026-06-12~17 신설분).
const MAINT_JOBS = [
  { label: 'dart-corpcodes',       script: 'scripts/fetch-dart-corp-codes.mjs',      timeoutMs: 300000,  commitPaths: ['data/dart-corp-codes.json'],          schedules: ['5 17 * * *'],                 maxAgeH: 30 },
  // 2026-07-04: 슬롯 0분→20분 — 07:00/16:00 KST 정각이 morning/afternoon 리포트 종료창(~xx:00:06)과 겹쳐
  //   lock skip 4연속(44h stale, 모니터는 감지만 하던 사각지대). 리포트 종료 후 여유 확보.
  { label: 'scan-accumulation',    script: 'scripts/scan-accumulation.mjs',          timeoutMs: 600000,  commitPaths: ['data/accumulation-watchlist.json'],   schedules: ['20 7 * * *', '20 22 * * *'],  maxAgeH: 20 },
  { label: 'build-us-smallcap',    script: 'scripts/build-us-smallcap-universe.mjs', timeoutMs: 600000,  commitPaths: ['data/us-smallcap-universe.json'],     schedules: ['0 19 * * 1'],                 maxAgeH: 8 * 24 },
  { label: 'scan-accumulation-us', script: 'scripts/scan-accumulation.mjs --us',     timeoutMs: 900000,  commitPaths: ['data/accumulation-watchlist-us.json'], schedules: ['30 21 * * *', '0 13 * * *'],  maxAgeH: 20 },
  { label: 'scan-insider-kr',      script: 'scripts/scan-insider-kr.mjs',            timeoutMs: 900000,  commitPaths: ['data/insider-kr-feed.json'],          schedules: ['30 7 * * *', '30 22 * * *'],  maxAgeH: 20 },
  { label: 'dart-prefetch',        script: 'scripts/prefetch-dart-financials.mjs',   timeoutMs: 900000,  commitPaths: [],                                     schedules: ['5 18 * * *'],                 maxAgeH: 30 },
  { label: 'sell-outcomes',        script: 'scripts/evaluate-sell-outcomes.mjs',     timeoutMs: 600000,  commitPaths: [],                                     schedules: ['35 18 * * *'],                maxAgeH: 30 },
  { label: 'tune-sell-rules',      script: 'scripts/tune-sell-rules.mjs --apply',    timeoutMs: 600000,  commitPaths: ['data/sell-rules-tuned.json'],         schedules: ['5 19 * * 6'],                 maxAgeH: 9 * 24 },
  { label: 'tune-buy-rules',       script: 'scripts/tune-buy-rules.mjs --apply',     timeoutMs: 600000,  commitPaths: ['data/buy-rules-tuned.json'],          schedules: ['20 19 * * 6'],                maxAgeH: 9 * 24 },
  { label: 'build-backlog',        script: 'scripts/build-backlog.mjs',              timeoutMs: 1200000, commitPaths: ['data/backlog.json'],                  schedules: ['5 20 * * 6'],                 maxAgeH: 9 * 24 },
  { label: 'build-financials',     script: 'scripts/build-financials-cache.mjs',     timeoutMs: 1500000, commitPaths: ['data/financials.json'],               schedules: ['35 19 * * *'],                maxAgeH: 30 },
  // 2026-07-03: 전향연구 평가 — shadow 룰(live 미참여 후보)의 전향 5/10일 성적 주간 집계(TER 회고 후속).
  { label: 'eval-shadow-rules',    script: 'scripts/eval-shadow-rules.mjs',          timeoutMs: 600000,  commitPaths: [],                                     schedules: ['50 19 * * 6'],                maxAgeH: 9 * 24 },
  // 2026-07-04: 전 종목(1,338) 회사페이지 *렌더* 전수검증 주간 — API 전수(audit-company-*)와 별개로
  //   실제 화면 렌더(NaN/에러/스켈레톤/가격 미렌더)를 detector 로 회귀 감시(사용자 "모든 회사 페이지 캡쳐검증").
  { label: 'audit-company-render', script: 'scripts/visual/audit-company-render.mjs', timeoutMs: 1800000, commitPaths: [],                                    schedules: ['40 20 * * 6'],                maxAgeH: 9 * 24 },
  // 2026-07-04 (이연 이행): ETF SO 일일 스냅샷 — US 마감(20:00 UTC) 직후. ΔSO×가격=창설/상환 실측(ETF별·일별).
  { label: 'snapshot-etf-so',      script: 'scripts/snapshot-etf-so.mjs',            timeoutMs: 120000,  commitPaths: [],                                     schedules: ['15 20 * * 1-5'],              maxAgeH: 4 * 24 },
];
for (const j of MAINT_JOBS) for (const s of j.schedules) {
  cron.schedule(s, () => runMaintenance(j.label, j.script, j.timeoutMs, j.commitPaths), { timezone: TZ });
}
log(`유지보수 cron 등록: ${MAINT_JOBS.length} 잡 (DART/매집/내부자/튜닝/backlog/재무 — MAINT_JOBS 단일소스)`);

// ── 2026-07-02 시작시 catchup (놓친 슬롯 자기치유) ────────────────────────────────
//   컷오버·재부팅·러너 다운 동안 지나간 슬롯은 종전 *영구 미실행*: HTTP 크론은 Redis TTL 만료로 콜드캐시
//   (signal-retrospective 14일 키 사망 + /api/signals 빈배열 — 2026-07-02 같은 날 2건 실증), 유지보수 잡은
//   모니터가 flag 만 하고 다음 슬롯(주간이면 최대 1주)까지 방치. 시작 3분 후(웹 기동 대기) 1회 소급 실행.
//   설계: HTTP=cron-last-run.json 의 마지막 성공이 주기(일간 36h/주간 8일) 초과 시. 유지보수=heartbeat 나이
//   > maxAgeH. 전부 순차(await) — LLM/GPU 크론(investment-strategy 등) 동시 폭주 방지. 보고서 파이프라인
//   실행 중이면 중단(다음 재시작이 재시도). 발신성 크론(send-alerts=메일)은 소급 금지(과거 알림 소급발송 방지).
const CATCHUP_EXCLUDE = /send-alerts/;
async function startupCatchup() {
  // HTTP 크론: path 별 최단 주기(같은 path 다중 슬롯=일간) — dow 필드가 '*' 아니면 주간으로 간주.
  const periods = new Map();
  for (const c of crons) {
    if (!c.path || !c.schedule || CATCHUP_EXCLUDE.test(c.path)) continue;
    const dow = String(c.schedule).trim().split(/\s+/)[4];
    const periodMs = (dow && dow !== '*') ? 8 * 86400000 : 36 * 3600000;
    if (!periods.has(c.path) || periodMs < periods.get(c.path)) periods.set(c.path, periodMs);
  }
  let ran = 0;
  for (const [path, periodMs] of periods) {
    if (Date.now() - (_lastRun[path] ?? 0) < periodMs) continue;
    if (await isReportPipelineRunning()) { log('[catchup-cron] 보고서 파이프라인 실행 중 — 잔여 소급 중단(다음 재시작 재시도)'); return; }
    const ago = _lastRun[path] ? `${Math.round((Date.now() - _lastRun[path]) / 3600000)}h 전` : '기록 없음';
    log(`[catchup-cron] ${path} — 마지막 성공 ${ago} > 주기, 소급 실행`);
    await runJob(path); ran++;
  }
  // 유지보수 잡: heartbeat 나이 기준 (runMaintenance 가 성공 시 갱신).
  let hb = {};
  try { hb = JSON.parse(readFileSync(resolve(process.cwd(), 'logs/maintenance-heartbeat.json'), 'utf8')); } catch { /* 최초 */ }
  for (const j of MAINT_JOBS) {
    const ts = hb[j.label] ? new Date(hb[j.label]).getTime() : 0;
    if (ts && (Date.now() - ts) / 3600000 <= j.maxAgeH) continue;
    if (await isReportPipelineRunning()) { log('[catchup-maint] 보고서 파이프라인 실행 중 — 잔여 소급 중단'); return; }
    log(`[catchup-maint] ${j.label} — heartbeat ${ts ? Math.round((Date.now() - ts) / 3600000) + 'h 전' : '무기록'} > ${j.maxAgeH}h, 소급 실행`);
    await runMaintenance(j.label, j.script, j.timeoutMs, j.commitPaths); ran++;
  }
  log(`[catchup] 시작시 소급 완료 — ${ran}개 실행`);
}
setTimeout(() => { startupCatchup().catch((e) => log(`[catchup] 실패: ${String(e?.message).slice(0, 80)}`)); }, 180000);

// 2026-06-12: 시장 쇼크 즉시 감지 (사용자 "트럼프 트윗/기사 영향 즉각 고려") — 10분마다
//   check-market-shock(속보 키워드/VIX 인트라데이/KOSPI·원화 — 전부 결정론). 임계 초과 시
//   비정기 보고서 트리거 → earlyWarning/stance 가 신선 데이터로 즉각 재발간. 과발간 방지:
//   2시간 쿨다운 + 보고서 lock 시 skip (run-report.bat 자체 mutex 가 동시성 2중 보호).
let lastShockTrigger = 0;
const SHOCK_COOLDOWN_MS = 2 * 60 * 60 * 1000;
async function runShockCheck() {
  try {
    const { stdout } = await execFileAsync('node', ['scripts/check-market-shock.mjs'], { timeout: 90000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const r = JSON.parse(stdout.trim().split('\n').at(-1));
    if (!r.shock) return;
    log(`[shock] 🚨 시장 쇼크 감지 (score ${r.score}): ${r.signals.join(' | ')}`);
    if (Date.now() - lastShockTrigger < SHOCK_COOLDOWN_MS) { log('[shock] 쿨다운 중 — 보고서 트리거 skip'); return; }
    if (await isReportPipelineRunning()) { log('[shock] 보고서 이미 실행 중 — skip'); return; }
    lastShockTrigger = Date.now();
    log('[shock] 비정기 보고서 트리거 → run-report.bat');
    execFileAsync('cmd', ['/c', 'scripts\\run-report.bat'], { timeout: 45 * 60 * 1000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
      .then(() => log('[shock] 비정기 보고서 완료'))
      .catch((e) => log(`[shock] 비정기 보고서 실패: ${String(e.message).slice(0, 60)}`));
  } catch (e) { log(`[shock] 점검 실패: ${String(e.message).slice(0, 60)}`); }
}
// 2026-06-17 (사용자 "전부 20분마다로 통일"): */10→*/20분.
cron.schedule('*/20 * * * *', runShockCheck, { timezone: TZ });
log('시장 쇼크 모니터 등록: */20분 (속보 키워드 + VIX 인트라데이 + KOSPI/원화 → 임계시 비정기 발간, 2h 쿨다운)');

// 2026-06-18: 누락 보고서 자동 캐치업 — 예약 세션(Task Scheduler)이 hang/강제종료(267014)로 미발행되면
//   최신 보고서가 stale 해짐(과거: 야간 evening/midnight 실패 시 무알림·무복구 → 사람이 아침에 발견하던 사각지대).
//   20분마다 최신 ko 보고서 mtime 점검 → STALE_H 초과면 run-report.bat 으로 backfill. shock 와 동일하게
//   2h 쿨다운 + lock guard 로 과발간/중복 방지. (헤드리스 — 세션 없어도 자동 복구.)
let lastCatchupTrigger = 0;
const CATCHUP_STALE_MS = 5 * 60 * 60 * 1000;   // 5h+ = 정규 세션(최대 5.5h 간격) 1회 누락으로 간주
async function runCatchupCheck() {
  try {
    let newest = 0, newestSession = null;
    try {
      for (const f of readdirSync('reports')) {
        const mm = f.match(/^report-\d{4}-\d{2}-\d{2}-(\w+)-ko\.json$/);
        if (!mm) continue;
        const m = statSync(`reports/${f}`).mtimeMs;
        if (m > newest) { newest = m; newestSession = mm[1]; }
      }
    } catch { /* reports dir 접근 실패 */ }
    const ageMs = newest ? Date.now() - newest : Infinity;
    if (ageMs < CATCHUP_STALE_MS) return;
    // 2026-07-02: session-aware 가드 — 최신 리포트의 세션이 *현재 세션*이면 이미 발간된 것(누락 아님) → skip.
    //   미드나잇(23~06시)은 아침(06:40)까지 7h 단일블록이라 자연히 5h+ 경과하나, 그건 미발간이 아니라 정상 경과.
    //   이 가드 없이는 매 새벽 05시경 catchup 이 미드나잇을 '누락'으로 오판해 중복 재발간(2026-07-02 사건).
    const kstH = new Date(Date.now() + 9 * 3600000).getUTCHours();
    const curSession = kstH < 6 ? 'midnight' : kstH < 11 ? 'morning' : kstH < 15 ? 'noon' : kstH < 20 ? 'afternoon' : kstH < 23 ? 'evening' : 'midnight';
    if (newestSession === curSession) { log(`[catchup] 현재 세션(${curSession}) 이미 발간됨 — 정상 경과 ${(ageMs / 3600000).toFixed(1)}h, skip(중복 방지)`); return; }
    if (Date.now() - lastCatchupTrigger < SHOCK_COOLDOWN_MS) { log('[catchup] 쿨다운 중 — skip'); return; }
    if (await isReportPipelineRunning()) { log('[catchup] 보고서 이미 실행 중 — skip'); return; }
    lastCatchupTrigger = Date.now();
    log(`[catchup] 🚨 최신 보고서 ${(ageMs / 3600000).toFixed(1)}h stale — 누락 backfill 트리거 → run-report.bat`);
    execFileAsync('cmd', ['/c', 'scripts\\run-report.bat'], { timeout: 45 * 60 * 1000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
      .then(() => log('[catchup] backfill 완료'))
      .catch((e) => log(`[catchup] backfill 실패: ${String(e.message).slice(0, 60)}`));
  } catch (e) { log(`[catchup] 점검 실패: ${String(e.message).slice(0, 60)}`); }
}
cron.schedule('*/20 * * * *', runCatchupCheck, { timezone: TZ });
log('누락 보고서 캐치업 모니터 등록: */20분 (최신 ko 보고서 5h+ stale 시 backfill, 2h 쿨다운+lock)');

// keep alive
process.stdin.resume();

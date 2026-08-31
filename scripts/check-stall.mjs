#!/usr/bin/env node
/**
 * scripts/check-stall.mjs — 스톨 감지 모니터.
 *
 * 파이프라인이 "멈춤"(stall) 상태인지 주기적으로 감지. cron/verify 가 alive 여도
 * 결과가 갱신 안 되는 silent stall 을 잡는다. (CLAUDE.md 검증 사각지대 철학)
 *
 * 감지 항목:
 *   [1] 최신 보고서 age — 정규 cron 3회/일(≈8h). > STALE_H 시간이면 STALL.
 *   [2] 최신 cron verify-loop 결과 age (reports/verify/) — 보고서 후 자동 verify 미동작 감지.
 *   [3] hung report-gen 프로세스 — generate-report-local 가 HUNG_MIN 분 넘게 실행 = 멈춤 의심.
 *   [4] Karpathy 학습 추세 — 최근 3 보고서 환각 평균이 직전 3 대비 급증(stall/회귀) 시 경고.
 *
 * 사용: node scripts/check-stall.mjs            # 1회 점검 (exit 1 = STALL 있음)
 *       node scripts/check-stall.mjs --watch=300 # 300초 주기 반복 (Ctrl+C 종료)
 *
 * cron/모니터 등록 권장: 30분 주기. exit code 1 = 즉시 알림 대상.
 */
import Database from 'better-sqlite3';
import { readdirSync, statSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { ROOT as _PROJECT_ROOT } from './lib/project-root.mjs';
import { findProcesses } from './lib/platform-ops.mjs';
import { sessionBudgetMin, maxSessionBudgetMin, getPublishTarget } from './lib/report-sessions.mjs';
import { launcherWipesWorktree } from './lib/report-launcher.mjs';
import { checkResourcePressure } from './lib/resource-pressure.mjs';
import { findReportProcesses } from './lib/report-running.mjs';
import { backupStatus } from './lib/backup-health.mjs';
import { findStaleJobs, listProcesses, loadJobPolicy } from './lib/stale-jobs.mjs';
import { dbHealth } from './lib/db-health.mjs';
import { analyzeCorrectors } from './lib/corrector-drift.mjs';
// 발행 예정 시각을 지난 뒤 업로드/전파에 실제로 걸리는 시간의 여유분. 예산(90분)이 아니라 '전파 지연' 몫이다.
const PUBLISH_GRACE_MIN = 10;
import { readLauncherModels } from './lib/report-launcher.mjs';

const ROOT = _PROJECT_ROOT;
const STALE_H = 11;   // 보고서 최대 허용 age (8h cadence + grace)
const VERIFY_STALE_H = 13;
// 2026-08-20: 종전 상수 20 은 세션 예산(발동→발행)의 옛 사본이었다. 스케줄을 90분 앞당긴 뒤
//   갱신되지 않아, 실측 46분짜리 정상 런을 매번 HUNG 으로 오탐했다(진짜 경보를 가리는 소음).
//   상수를 다시 박지 않고 스케줄과 같은 소스에서 세션별로 유도한다.

function ageHours(iso) { return (Date.now() - new Date(iso).getTime()) / 3600000; }

/** 외부 curl 대신 런타임 내장 fetch. 2026-08-20: curl.exe 하드코딩이 맥에서 매번 'command not found' 였고,
 *  호출부의 catch 가 그걸 삼켜 라이브 probe 가 통째로 skip 되고 있었다(무증상). */
async function fetchText(url, timeoutMs = 10000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return await r.text();
}

/**
 * 모델 ID 가 실제로 통하는지 '결과'로 확인한다 — 식별자 목록 대조가 아니다.
 * MLX 의 /v1/models 는 서빙 별칭이 아니라 HF 캐시 전체를 나열해(같은 맥의 OCR 팀 모델까지 섞인다)
 * 목록 대조로는 정상 동작 중에도 MISMATCH 가 상시 발화했다.
 * { ok } | { down } (서버 무응답 — down 은 별도 probe 소관) | { error } (서버는 살아있는데 그 ID 를 거부)
 */
async function probeCompletion(url, model, timeoutMs = 20000) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) { return { down: true, error: String(e.message).slice(0, 80) }; }
  if (res.ok) return { ok: true };
  return { error: `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}` };
}

// 2026-08-20: 외부 curl 을 내장 fetch 로 바꾸고 모델 검사를 결과 기반(실제 추론 1회)으로 돌리면서 async 가 됐다.
async function checkOnce() {
  const issues = [];
  const info = [];
  const db = new Database(`${ROOT}/data/flowvium.db`, { readonly: true });

  // [1] 최신 보고서 age
  const latest = db.prepare('SELECT generated_at, session FROM reports ORDER BY generated_at DESC LIMIT 1').get();
  if (!latest) { issues.push('보고서 0건 (DB 비어있음)'); }
  else {
    const h = ageHours(latest.generated_at);
    const line = `최신 보고서 ${latest.session} ${latest.generated_at.slice(0, 16)} (${h.toFixed(1)}h 전)`;
    if (h > STALE_H) issues.push(`STALL: ${line} > ${STALE_H}h — cron 멈춤 의심`);
    else info.push(line);
  }

  // [7] 라이브 반영 정합 (2026-07-03 신설): "생성됐지만 발간 차단/업로드 실패" 사각지대 봉쇄 —
  //   07-02 afternoon/evening 이 latin_garble *오탐*으로 pre-publish gate 에 차단됐는데, [1]은 로컬 생성
  //   기준이라 침묵하고 catchup 도 파일 기준이라 미동작, 사이트는 noon 리포트가 밤까지 유지된 사건.
  //   로컬 최신 generated_at 이 라이브 generatedAt 보다 75분+ 새로우면(정시발간 대기 여유 포함) 경보.
  try {
    if (latest) {
      // 2026-08-20: curl.exe 고정이라 맥에선 매번 'command not found' → 라이브 probe 가 통째로 skip 됐다.
      //   외부 바이너리 의존을 없애고 런타임 내장 fetch 를 쓴다(플랫폼 무관).
      const raw = await fetchText('https://flowvium.net/api/investment-strategy?locale=ko', 10000);
      const live = JSON.parse(raw.replace(/^﻿/, ''));
      const liveAt = live?.generatedAt ? new Date(live.generatedAt).getTime() : 0;
      const lagMin = (new Date(latest.generated_at).getTime() - liveAt) / 60000;
      if (!liveAt) issues.push('라이브 미반영: 라이브 리포트 generatedAt 없음 (응답 이상)');
      // 2026-08-20: 종전 임계 75분은 '정시발간 대기 여유'를 상수로 박은 값이었고, 리드타임을 20→90분으로
      //   옮긴 뒤 틀린 값이 됐다. 실제로 정상 대기 중인 런(target 12:00 까지 2556s wait)을 '발간 차단'으로
      //   오탐했다. 여유를 다시 추정하지 않고, 그 세션의 발행 예정 시각을 직접 본다.
      //   발행 시각 전이면 라이브가 아직 옛 보고서인 게 정상이다 — 지나서도 안 올라갔을 때만 결함이다.
      //   getPublishTarget 은 {target, waitMs} 를 준다. target 은 KST 로 9시간 시프트된 프레임이라
      //   Date.now() 와 직접 빼면 안 된다 — 같은 프레임 안에서 계산된 waitMs 를 실제 epoch 에 더한다.
      const genMs = new Date(latest.generated_at).getTime();
      const { waitMs } = getPublishTarget(latest.session, genMs);
      const overdueMin = (Date.now() - (genMs + waitMs)) / 60000;
      if (overdueMin < 0) info.push(`라이브 반영 대기 중 — ${latest.session} 발행 예정까지 ${Math.round(-overdueMin)}분 (정상)`);
      else if (lagMin > 0 && overdueMin > PUBLISH_GRACE_MIN) issues.push(`라이브 미반영: ${latest.session} 발행 예정 시각을 ${Math.round(overdueMin)}분 초과했는데 라이브가 ${Math.round(lagMin)}분 뒤처짐 — 발간 차단(pre-publish gate)/업로드 실패 의심 → logs/report.log "발간 차단" 확인`);
      else if (!Number.isFinite(overdueMin)) issues.push(`라이브 probe 계산 불능: overdue=${overdueMin} (session=${latest.session}) — 판정 못 했으므로 통과로 처리하지 않는다`);
      else info.push(`라이브 반영 정합 ✓ (lag ${Math.round(Math.max(0, lagMin))}분, 발행 ${Math.round(overdueMin)}분 경과)`);
    }
  } catch (e) { info.push(`라이브 반영 probe skip: ${String(e?.message).slice(0, 40)}`); }

  // [4] Karpathy 추세 — 최근 3 vs 직전 3 환각 평균
  // 2026-06-17: harness_* (harness 가 잡은 교정 — 학습용 적재, 사각지대#5) 는 회귀추세에서 제외.
  //   추세는 *verify-escaped*(harness 도 못 잡은) 환각만 측정해야 — harness 가 잡는 건 파이프라인이 처리 중.
  const recent = db.prepare(`
    SELECT (SELECT COUNT(*) FROM hallucination_history WHERE report_id=reports.id AND defect_type NOT LIKE 'harness_%' AND defect_type NOT LIKE '%_sanitized') h
    FROM reports ORDER BY generated_at DESC LIMIT 6
  `).all().map(r => r.h);
  if (recent.length >= 6) {
    // 2026-06-17 (사용자 "alert 언제 고쳐"): 평균 → 중앙값(outlier-robust). 단일 보고서가 환각 15건으로
    //   튀면(예: midnight 52w/ma_halluc 14건) 3개 평균이 5.7 로 왜곡돼 '회귀'를 3사이클 오발. '회귀'는
    //   지속적 악화여야 함 — 중앙값은 2개+ 보고서가 상승해야 움직이므로 단일 outlier 를 무시. (0,15,2)→2,
    //   (6,1,0)→1 ⇒ 무경보. 진짜 회귀(여러 건 상승)는 여전히 포착.
    const med3 = (a) => [...a].sort((x, y) => x - y)[1];
    const cur = med3(recent.slice(0, 3));
    const prev = med3(recent.slice(3, 6));
    const curMean = ((recent[0] + recent[1] + recent[2]) / 3).toFixed(1);
    const line = `Karpathy 환각 최근3 중앙값 ${cur} vs 직전3 ${prev} (평균 ${curMean})`;
    if (cur > prev + 3) issues.push(`회귀 의심: ${line} (중앙값 +${cur - prev})`);
    else info.push(line);
  }
  db.close();

  // [6] model-id-match — 코드 요청 모델명 == vLLM served-model-name 실측 (2026-07-01, spinai6/spinai2 규율 차용).
  //   base+LoRA/커스텀 served-name 에서 코드 model명이 served 목록에 없으면 vLLM '관대수용'으로 우연히 동작하나
  //   strict validation/멀티모델 시 전 요청 404 = 시한폭탄. 매 사이클 실측. 조회실패=SKIP(vLLM down 은 [1]/헬스 별 probe).
  try {
    const envTxt = readFileSync(`${ROOT}/.env.local`, 'utf8');
    const codeModels = new Set();
    const vm = envTxt.match(/^\s*VLLM_MODEL\s*=\s*(.+)\s*$/m);
    if (vm) codeModels.add(vm[1].trim().replace(/^["']|["']$/g, ''));
    // 2026-08-20: run-report.bat 고정 파싱이라 맥에선 죽은 윈도우 유물의 옛 모델(qwen3:8b, C:\\Flowvium 경로)을
    //   읽어 기대집합을 오염시켰다 → MODEL-ID MISMATCH 상시 오경보. 이 플랫폼의 런처만 본다.
    for (const m of readLauncherModels()) codeModels.add(m);
    // 2026-07-01: curl 절대경로 필수 — pm2 spawn 환경은 대화형 셸과 PATH 가 달라 'curl' bare 는 못찾아
    //   catch→조용히 SKIP(프로덕션 no-op = "모니터가 본다≠fix" 함정). SystemRoot 는 항상 env 에 존재.
    // 2026-08-20: 종전에는 /v1/models 목록에 코드의 모델 ID 가 있는지 비교했다. MLX 서버에서 그 엔드포인트는
    //   '서빙 중인 별칭'이 아니라 HuggingFace 캐시 디렉토리 전체를 나열한다 — 같은 맥에 OCR 팀이 받아둔
    //   baidu/Unlimited-OCR 까지 목록에 섞여 나온다. 그래서 정상 동작 중에도 MISMATCH 가 상시 발화했다.
    //   식별자 비교로는 '이 ID 로 실제 추론이 되는가'를 알 수 없다. 결과로 판정한다.
    // 2026-08-31: `r.down` 을 info 로 강등하고 "down 은 별도 probe" 에 미루던 줄이 여기 있었다.
    //   **그 별도 probe 는 이 파일에 없다.** 미룬 곳이 비어 있으면 아무도 안 본다는 뜻이다.
    //   실제 결과: 08-28 10:44 Metal OOM 으로 생성 스레드가 죽은 뒤 이 프로브는 매 20분 타임아웃
    //   (= r.down) 났고, 3일 내내 info 로만 쌓였다. 유일하게 발화한 [1] 은 "최신 보고서 75.3h 전 —
    //   cron 멈춤 의심" 이라 **원인을 cron 으로 잘못 가리켰다.** LLM 이 죽었다고 말한 검사가 하나도 없었다.
    //   이제 issues 로 올린다. 조치 경로도 생겼다(llm-health-check.mjs --repair).
    for (const m of codeModels) {
      const r = await probeCompletion('http://127.0.0.1:8000/v1/chat/completions', m, 20000);
      if (r.ok) info.push(`model-id ✓ ${m} 로 실제 추론 성공`);
      else if (r.down) issues.push(`LLM DEAD: :8000 이 20s 안에 토큰을 못 냈다 (${r.error}) — /v1/models 는 200 이어도 생성 스레드는 죽어 있을 수 있다. 조치: node scripts/llm-health-check.mjs --repair`);
      else issues.push(`MODEL-ID 거부: '${m}' 로 추론 요청이 실패 — ${r.error} → .env.local 의 VLLM_MODEL/LOCAL_LLM_MODEL 을 서버가 받는 값으로 맞추세요`);
    }
  } catch (e) {
    // 여기도 조용히 삼키면 위와 같은 함정이다. 왜 못 쟀는지는 남긴다.
    issues.push(`LLM 프로브 자체가 실패 — ${String(e?.message ?? e).slice(0, 100)} (모델 기대집합을 못 읽었거나 .env.local 접근 불가)`);
  }

  // [2] cron verify-loop 결과 age
  try {
    const vdir = `${ROOT}/reports/verify`;
    const files = readdirSync(vdir).filter(f => f.startsWith('verify-') && f.endsWith('.json'));
    if (files.length === 0) info.push('verify-loop 결과 0건');
    else {
      const newest = files.map(f => ({ f, t: statSync(`${vdir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t)[0];
      const h = (Date.now() - newest.t) / 3600000;
      if (h > VERIFY_STALE_H) issues.push(`STALL: cron verify-loop 최신 ${newest.f} (${h.toFixed(1)}h 전) > ${VERIFY_STALE_H}h`);
      else info.push(`verify-loop 최신 ${h.toFixed(1)}h 전`);
    }
  } catch { info.push('reports/verify/ 없음'); }

  // [3] hung report-gen 프로세스
  //   2026-08-20: Get-CimInstance 고정이라 맥에선 catch 로 조용히 skip — hung 탐지가 통째로 없었다.
  {
    // 2026-08-21: 종전 findProcesses('generate-report-local') 는 문자열 부분매칭이라
    //   명령줄에 이름이 스치기만 한 프로세스(셸·모니터 명령)까지 생성기로 셌다.
    //   실측: 내 백그라운드 대기 셸이 'report-gen 2번째(세션 불명)' 로 집계됐다.
    //   판정을 report-running.findReportProcesses 한 곳으로 모은다.
    const procs = findReportProcesses();
    for (const p of procs) {
      const min = p.ageSec / 60;
      // 프로세스가 스스로 밝힌 세션의 예산을 쓴다. 못 읽으면 가장 너그러운 예산(미탐 > 오탐).
      const sm = p.command.match(/--session=([a-z]+)/);
      // 프로세스는 제작이 끝나도 '정시 발간' 때문에 발행 시각까지 대기한다(logs/report.log
      //   "[정시 발간] target 12:00 KST 까지 2556s wait"). 그래서 제작 예산(발동→발행)만으로 재면
      //   정상 대기 구간이 통째로 HUNG 오탐이 된다 — 실측 83분/90분에서 곧 발화할 참이었다.
      //   기준은 '언제까지 살아 있어야 정상인가' = 발행 예정 시각 + 업로드 여유다.
      const startMs = Date.now() - p.ageSec * 1000;
      let deadlineMin;
      if (sm && sessionBudgetMin(sm[1])) {
        const { waitMs } = getPublishTarget(sm[1], startMs);
        deadlineMin = (waitMs / 60000) + PUBLISH_GRACE_MIN;   // 시작→발행 + 업로드 여유
      } else {
        deadlineMin = maxSessionBudgetMin() + PUBLISH_GRACE_MIN;
      }
      const label = sm ? `${sm[1]} 발행+여유 ${Math.round(deadlineMin)}분` : `상한 ${Math.round(deadlineMin)}분(세션 불명)`;
      if (min > deadlineMin) issues.push(`HUNG: report-gen PID ${p.pid} ${min.toFixed(0)}분 실행 중 (> ${label}) — 발행 시각을 넘겨도 안 끝남, 멈춤 의심`);
      else info.push(`report-gen PID ${p.pid} 실행 중 (${min.toFixed(0)}분 / ${label})`);
    }
    if (procs.length === 0) info.push('report-gen 실행 프로세스 없음');
  }

  // [5] git wipe-risk — 미커밋/미푸시 코드가 cron checkout origin/master 에 wipe 될 위험.
  //     (2026-06-03 데이터손실 사건: fix 후 커밋+푸시 안 하면 다음 cron 이 silent revert.)
  try {
    // 2026-06-17: timeout 추가 — git fetch 네트워크 stall 시 probe 무한 hang 차단.
    const sh = (c, timeout = 0) => { try { return execSync(c, { cwd: _PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe','pipe','ignore'], ...(timeout ? { timeout } : {}) }).trim(); } catch { return ''; } };
    const WIPE = /^(scripts\/|src\/|public\/|messages\/|package\.json|data\/[^/]+\.json)/;
    const tracked = sh('git status --porcelain', 10000).split('\n').filter(Boolean)
      .filter(l => !l.startsWith('??') && WIPE.test(l.slice(3).replace(/^"|"$/g, '')));
    sh('git fetch --quiet origin master', 20000);
    const aheadTouch = sh('git diff --name-only origin/master..HEAD', 10000).split('\n').filter(Boolean).filter(p => WIPE.test(p));
    // 2026-08-20: 종전에는 "다음 cron 이 wipe" 를 무조건 단정했다. 그 checkout 은 윈도우용
    //   run-report.bat 에만 있고, 이 맥의 launchd 는 git 명령이 없는 run-report.sh 만 부른다.
    //   틀린 메커니즘은 사람을 엉뚱한 조치로 보내므로, 런처를 읽어서 실제 위험만 wipe 라 부른다.
    const wipes = launcherWipesWorktree();
    const how = wipes ? '다음 cron 이 이 변경을 되돌린다' : '이 플랫폼 런처는 되돌리지 않는다 — 유실 위험은 미백업뿐';
    const tag = wipes ? 'git wipe-risk' : 'git 미동기화';
    if (tracked.length) issues.push(`${tag} — 미커밋 tracked 변경 ${tracked.length}건 (${how}): ${tracked.map(l=>l.slice(3)).slice(0,5).join(', ')} → commit`);
    else if (aheadTouch.length) issues.push(`${tag} — 커밋했으나 미푸시 ${aheadTouch.length}파일 (${how}) → git push origin master`);
    else info.push('git 동기화 ✓ (origin/master 와 일치)');
  } catch { /* git 미가용 — skip */ }

  // [8] 자원 압력 — 메모리·스왑·열 (2026-08-21 신설).
  //     종전 검사 7종에 자원 항목이 하나도 없었다. 이 기기는 27B(31.7GB)+4B(5.2GB)+embed 를
  //     상주시키고(vmmap 실측) llm-local.ts 에 hard freeze 전력이 기록돼 있는데, 고갈을 보는
  //     눈이 없었다. GPU 를 쓰지 않는 소스(vm_stat·sysctl·조절기 로그)만 읽는다 —
  //     감시가 부하를 만들면 그건 감시가 아니다. 임계값은 data/resource-thresholds.json.
  try {
    const { mem, thermal, issues: resIssues } = await checkResourcePressure();
    const memLine = `여유 ${mem.freePct}% · 스왑 ${mem.swapPct}%(${mem.swapUsedMB}/${mem.swapTotalMB}MB) · 압축 ${mem.compressedGB}GB`;
    const thLine = thermal ? ` · 조절기 가동률 ${thermal.dutyPct}%(정지 ${thermal.pauses}회/최근창)` : '';
    if (resIssues.length) for (const i of resIssues) issues.push(`자원 압력 — ${i}`);
    else info.push(`자원 여유 ✓ (${memLine}${thLine})`);
  } catch (e) {
    // 판독 실패를 '이상 없음' 으로 삼키지 않는다 — 오늘 하루 그 패턴에 여러 번 당했다.
    issues.push(`자원 압력 판독 실패: ${String(e?.message).slice(0, 60)} — 감시 사각지대`);
  }

  // [9] 인수인계 백업 신선도 (2026-08-21 신설).
  //     HANDOFF.md 의 복구 절차 전제가 Google Drive 일일 백업인데, 실측 최신 백업이 23일 전이었다
  //     (Windows 기기 해체일에 멈춤 · 맥에 대체 스케줄 없음 · FLOWVIUM_BACKUP_DIR 미설정).
  //     백업은 '있다고 믿는 것' 이 가장 위험하다.
  try {
    const b = await backupStatus();
    // 원격을 '못 읽은' 것(권한 미부여)은 로컬 백업이 신선하고 복원 가능하면 결함이 아니다.
    // 20분마다 🚨 를 띄우면서 본문에 '정상' 이라고 쓰는 건 늑대소년이다 — 진짜 결함이 묻힌다.
    // 유실 위험의 실체는 '복원할 게 있느냐' 이고, 그건 로컬이 답한다. 원격은 이중화일 뿐.
    const localSafe = b.restorable && b.localAgeDays !== null && b.localAgeDays <= b.maxAgeDays;
    const remoteOnly = b.remoteUnknown && b.issues.every((i) => /원격 백업 상태 확인 불가/.test(i));
    if (b.issues.length && !(remoteOnly && localSafe)) {
      for (const i of b.issues) issues.push(`백업 — ${i}`);
    } else if (remoteOnly && localSafe) {
      info.push(`백업 ✓ 로컬 ${b.localNewest} ${b.localAgeDays}일 전 (복원가능 reports ${b.reportRows}행 · ${b.scheduledBy}) · 원격 미확인 — Drive 권한 미부여, 이중화만 결여`);
    } else {
      info.push(`백업 ✓ (원격 ${b.newest} ${b.ageDays}일 전 · 로컬 ${b.localNewest} ${b.localAgeDays}일 전, 복원가능 reports ${b.reportRows}행 · ${b.scheduledBy})`);
    }
  } catch (e) {
    issues.push(`백업 상태 판독 실패: ${String(e?.message).slice(0, 60)} — 감시 사각지대`);
  }

  // [10] 좀비 잡 (2026-08-22 신설).
  //      예약 백업 잡이 00:57 에 `✅ 완료` 를 찍고 5시간 더 살아 있었다 — 스레드풀 4칸과
  //      Drive 데몬을 붙든 채로, 같은 기기에서 보고서가 도는 동안. 위 검사 9종 중
  //      프로세스를 보는 건 [3] 뿐인데 그건 report-gen 전용이라 아무도 못 봤다.
  //      '주기 잡인데 주기보다 오래 산다' 는 원인과 무관하게 같은 신호다.
  try {
    const stale = findStaleJobs(listProcesses(), loadJobPolicy());
    if (stale.length) {
      for (const j of stale) {
        issues.push(`좀비 잡 — ${j.script} PID ${j.pid} 가 ${j.minutes}분째 (상한 ${j.limit}분). `
          + `할 일을 끝내고도 안 죽는 경우가 있다(취소 불가능한 fs 연산이 libuv 스레드풀을 점유). `
          + `확인: sample ${j.pid} 3 | grep uv__fs_work · 조치: kill -9 ${j.pid}`);
      }
    } else {
      info.push('좀비 잡 없음 ✓');
    }
  } catch (e) {
    issues.push(`좀비 잡 검사 실패: ${String(e?.message).slice(0, 60)} — 감시 사각지대`);
  }

  // [11] 라이브 DB 무결성 (2026-08-22 신설).
  //      내가 `git reset --hard` 로 추적 중이던 data/flowvium.db 를 커밋본으로 되돌려
  //      reports 205→48 · buy_candidates 4382→0 이 됐는데 검사 10종 중 아무도 못 봤다.
  //      여기 73행에서 DB 를 *열긴* 하지만 최신 보고서 한 줄만 읽는다.
  //      백업의 복원가능성([9])은 보면서 정작 라이브 DB 자체는 감시 밖이었다.
  //      판정 근거는 백업과의 대조다 — 백업은 git 이 못 건드리는 독립 사본이고
  //      라이브에서 떠간 것이라 정상이면 언제나 live ≥ backup 이다. 임계값을 손으로 안 정한다.
  try {
    const h = await dbHealth(ROOT);
    if (h.quickCheck !== 'ok') {
      issues.push(`DB 무결성 — quick_check=${h.quickCheck}. 파일이 손상됐거나 못 읽는다`);
    } else if (h.regressions.length) {
      const top = h.regressions.slice(0, 3).map((r) => `${r.table} ${r.live}<${r.backup}(-${r.lost})`).join(' · ');
      issues.push(`DB 회귀 — 라이브가 백업보다 적다: ${top}. `
        + `git reset/checkout 이 DB 를 되돌렸거나 데이터가 소실됐다. `
        + `복구: cp ${h.backupPath} data/flowvium.db (웹 재기동 필요)`);
    } else if (h.note) {
      info.push(`DB ✓ quick_check ok · ${h.note}`);
    } else {
      info.push(`DB ✓ quick_check ok (${h.ms}ms) · 백업 대비 회귀 없음 `
        + `(라이브 ${(h.liveBytes / 1048576).toFixed(0)}MB · 백업 ${(h.backupBytes / 1048576).toFixed(0)}MB)`);
    }
  } catch (e) {
    issues.push(`DB 무결성 검사 실패: ${String(e?.message).slice(0, 60)} — 감시 사각지대`);
  }

  // [12] 교정기 드리프트 (2026-08-22 신설).
  //      이 세션에서 근본원인 7건 중 5건이 같은 형태였다 —
  //      **증상을 고치는 코드가 이미 있었고 그게 원인을 몇 달간 가렸다.**
  //      통화 교정기 주석에는 2026-05-24 날짜가 박혀 있었다(석 달). 교정기가 있으면
  //      증상이 화면에 안 보이니 아무도 생산자를 고치지 않는다. 나는 손으로 찾았다.
  //      신호: **거의 매 보고서마다 발동하는 교정기는 교정 대상이 아니라 버그다.**
  //      임계값은 실측 간극에서 잡았다(92% 넷 = 전부 실제 버그 / 15% 이하 = 정상 산발).
  try {
    const days = 7;
    // 위 `db`(:75)는 :136 에서 이미 닫혔다 — [11] 처럼 자체 연결을 열고 반드시 닫는다.
    const cdb = new Database(`${ROOT}/data/flowvium.db`, { readonly: true });
    let drift = [];
    let totalReports = 0;
    try {
      totalReports = cdb.prepare(
        `SELECT COUNT(*) n FROM reports WHERE datetime(created_at) >= datetime('now','-' || ? || ' days')`,
      ).get(days)?.n ?? 0;
      const rows = cdb.prepare(
        `SELECT defect_type, report_id, llm_value FROM hallucination_history
         WHERE datetime(detected_at) >= datetime('now','-' || ? || ' days')`,
      ).all(days);
      // 최신 2개에서도 발동해야 표면화한다 — 고친 뒤에도 7일 창이 빌 때까지 울면 곧 무시된다.
      //   실측 근거: 통화 하드코딩을 고치자 바로 다음 보고서에서 교정 6→0 이 됐다.
      // 분모와 같은 보고서 집합을 넘긴다 — 따로 세면 경계에서 어긋난다(실측 "31/30보고서").
      const windowReportIds = cdb.prepare(
        `SELECT id FROM reports WHERE datetime(created_at) >= datetime('now','-' || ? || ' days')`,
      ).all(days).map((r) => r.id);
      const recentReportIds = cdb.prepare(
        'SELECT id FROM reports ORDER BY created_at DESC LIMIT 2',
      ).all().map((r) => r.id);
      drift = analyzeCorrectors(rows, { totalReports, reportIds: windowReportIds, recentReportIds }).filter((r) => r.flagged);
    } finally {
      cdb.close();
    }
    if (drift.length) {
      for (const d of drift.slice(0, 3)) {
        issues.push(`교정기 상시발동 — ${d.defectType} ${d.reportsHit}/${d.totalReports}보고서 `
          + `(검출 ${d.detections}, 고유입력 ${(d.diversity * 100).toFixed(0)}%). ${d.hint}. `
          + `교정은 드물어야 한다 — 매번이면 앞단이 틀린 것이다`);
      }
    } else {
      info.push(`교정기 ✓ 상시발동 없음 (최근 ${days}일 보고서 ${totalReports}개 기준)`);
    }
  } catch (e) {
    issues.push(`교정기 드리프트 검사 실패: ${String(e?.message).slice(0, 60)} — 감시 사각지대`);
  }

  return { issues, info };
}

async function report() {
  const ts = new Date().toISOString().slice(0, 19);
  const { issues, info } = await checkOnce();
  console.log(`\n[stall-check ${ts}]`);
  for (const i of info) console.log('  ✅', i);
  for (const i of issues) console.log('  🚨', i);
  console.log(issues.length === 0 ? '  → 종합: OK (stall 없음)' : `  → 종합: ${issues.length} STALL/회귀 감지`);
  return issues.length;
}

const watchArg = process.argv.find(a => a.startsWith('--watch='));
if (watchArg) {
  const sec = Math.max(60, parseInt(watchArg.split('=')[1], 10) || 300);
  console.log(`스톨 모니터 시작 — ${sec}초 주기 (Ctrl+C 종료)`);
  await report();
  setInterval(report, sec * 1000);
} else {
  process.exit((await report()) > 0 ? 1 : 0);
}

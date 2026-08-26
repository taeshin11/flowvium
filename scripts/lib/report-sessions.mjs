/**
 * report-sessions.mjs — 보고서 세션의 단일 소스.
 *
 * 배경: data/report-sessions.json 이 2026-06-04 에 "세션 단일 소스"로 선언됐으나
 *   generate-report-local.mjs 는 이 파일을 읽지 않고 같은 값을 코드 리터럴로 복제해 뒀다
 *   (getSession 의 6/11/15/20/23, getPublishTarget 의 07:00/12:00/16:00/21:30/00:00).
 *   그래서 JSON 을 고쳐도 파이프라인은 안 따라왔다. 여기서 실제로 읽어 쓴다.
 *
 * 설계:
 *   · 시각을 인자로 받는다(now). 순수 함수라 테스트에서 임의 시각을 넣을 수 있다.
 *   · 세션은 --session=<id> 로 명시 지정이 우선. 지정이 없을 때만 벽시계로 역산한다.
 *     역산은 이관 전 동작을 그대로 보존한다(windowFromKstHour). 회귀 없음.
 *   · publishKst / leadMinutes 는 JSON 이 쥔다. 코드에 시각을 박지 않는다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.REPORT_SESSIONS_PATH
  ?? resolve(HERE, '../../data/report-sessions.json');

let _cfg = null;
export function loadSessions() {
  if (_cfg) return _cfg;
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (!Array.isArray(raw.sessions) || !raw.sessions.length)
    throw new Error(`report-sessions: sessions 비어 있음 (${CONFIG_PATH})`);
  for (const s of raw.sessions) {
    for (const f of ['id', 'publishKst', 'windowFromKstHour']) {
      if (s[f] === undefined)
        throw new Error(`report-sessions: '${s.id ?? '?'}' 에 ${f} 없음 (${CONFIG_PATH})`);
    }
  }
  _cfg = raw;
  return raw;
}

export function sessionIds() { return loadSessions().sessions.map(s => s.id); }
export function getSessionConfig(id) {
  const s = loadSessions().sessions.find(x => x.id === id);
  if (!s) throw new Error(`report-sessions: 알 수 없는 세션 '${id}'. 가능: ${sessionIds().join(', ')}`);
  return s;
}

/** KST 시각(0~23)으로 세션 역산. windowFromKstHour 가 큰 것부터 내려오며 첫 매치. */
export function sessionForKstHour(kstHour) {
  const ss = [...loadSessions().sessions].sort((a, b) => b.windowFromKstHour - a.windowFromKstHour);
  for (const s of ss) if (kstHour >= s.windowFromKstHour) return s.id;
  // 어느 창에도 안 걸리면(예: 0~5시) 가장 늦은 창의 세션이 자정을 넘겨 이어지는 것으로 본다.
  return ss[0].id;
}

/**
 * 세션 결정. argv 에 --session=<id> 가 있으면 그것을 쓴다(스케줄러가 명시하는 정상 경로).
 * 없으면 벽시계 역산(수동 실행용 하위호환).
 */
export function resolveSession(argv = [], now = Date.now()) {
  const explicit = argv.find(a => a.startsWith('--session='))?.split('=')[1];
  if (explicit) { getSessionConfig(explicit); return explicit; }   // 없는 id 면 여기서 throw
  const kstHour = new Date(now + 9 * 3600000).getUTCHours();
  return sessionForKstHour(kstHour);
}

/** 발간 목표시각(UTC Date)과 남은 대기 ms. midnight 의 익일 처리는 기존 규칙을 그대로 옮겼다. */
export function getPublishTarget(session, now = Date.now()) {
  const cfg = getSessionConfig(session);
  const [ph, pm] = String(cfg.publishKst).split(':').map(Number);
  const kstNow = new Date(now + 9 * 3600000);
  const target = new Date(kstNow);
  target.setUTCHours(ph, pm, 0, 0);
  // 발간시각이 00:00 인 세션(midnight)은 전날 저녁에 트리거되므로 익일로 넘긴다.
  //   2026-06-06 off-by-one 수정 규칙 보존: 22시 이후에 계산할 때만 +1일.
  //   (0~6시에 재호출되면 이미 발간일 당일이라 그대로 — 두 시점이 같은 날짜를 낳아 결정론적)
  if (ph === 0 && pm === 0 && kstNow.getUTCHours() >= 22) target.setUTCDate(target.getUTCDate() + 1);
  return { target, waitMs: target.getTime() - kstNow.getTime() };
}

export function getReportKstDate(session, now = Date.now()) {
  return getPublishTarget(session, now).target.toISOString().slice(0, 10);
}

/** 스케줄러가 쓸 트리거 시각(KST HH:MM) = 발간시각 − leadMinutes. */
export function getTriggerKst(session) {
  const cfg = getSessionConfig(session);
  const lead = Number(cfg.leadMinutes ?? loadSessions().defaultLeadMinutes ?? 20);
  const [ph, pm] = String(cfg.publishKst).split(':').map(Number);
  let mins = ph * 60 + pm - lead;
  while (mins < 0) mins += 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** argv 에 --session=<id> 가 있는가 = 스케줄러가 부른 실행인가. */
export function isExplicitSession(argv = []) {
  return argv.some(a => a.startsWith('--session='));
}

/**
 * 정시 발간 대기 판정.
 *
 * 종전에는 "waitMs > 25분이면 수동 실행" 이라는 시간 임계값으로 갈랐다. 25분은 리드타임 20분
 * 시절의 상수라, 리드타임을 90분으로 올리자 예약 실행이 43분 일찍 끝나면 '수동'으로 오판해
 * 즉시 발간했다(2026-08-20 06:17 실측, target 07:00). 시간으로 의도를 추측하지 말고
 * '세션이 명시됐는가'라는 직접 신호로 가른다.
 *
 *  · 예약 실행: 리드타임까지 기다린다. 리드타임을 넘는 대기는 계산이 어긋난 것이므로 생략한다
 *    (무한정 매달리지 않는다).
 *  · 수동 실행: 설정값(manualMaxWaitMinutes, 기본 25)까지만. 종전 동작과 동일 — 회귀 없음.
 */
export function publishWaitDecision({ session, waitMs, explicit }) {
  if (waitMs <= 0) return { wait: false, capMs: 0, reason: 'target 경과 — 즉시 발간' };
  const cfg = getSessionConfig(session);
  const all = loadSessions();
  const capMin = explicit
    ? Number(cfg.leadMinutes ?? all.defaultLeadMinutes ?? 20)
    : Number(all.manualMaxWaitMinutes ?? 25);
  const capMs = capMin * 60_000;
  if (waitMs > capMs) {
    return { wait: false, capMs,
      reason: explicit
        ? `대기 ${Math.round(waitMs/60000)}분 > 리드타임 ${capMin}분 — 계산 불일치로 보고 즉시 발간`
        : `수동 실행 · 대기 ${Math.round(waitMs/60000)}분 > 상한 ${capMin}분 — 즉시 발간` };
  }
  return { wait: true, capMs, reason: explicit ? `예약 실행 · 리드타임 ${capMin}분 이내` : `수동 실행 · 상한 ${capMin}분 이내` };
}

/**
 * 세션의 제작 예산(분) = 발동 → 발행. 2026-08-20 신설.
 * check-stall 의 HUNG 판정이 쓰던 HUNG_MIN=20 은 이 값의 옛 사본이었고, 스케줄을 90분 앞당긴 뒤
 * 갱신되지 않아 정상 런을 100% 오탐했다. 상수를 새로 박지 않고 스케줄과 같은 소스에서 유도한다.
 */
export function sessionBudgetMin(id) {
  const c = getSessionConfig(id);
  if (!c) return null;
  const [th, tm] = c.triggerKst.split(':').map(Number);
  const [ph, pm] = c.publishKst.split(':').map(Number);
  let b = (ph * 60 + pm) - (th * 60 + tm);
  if (b <= 0) b += 1440;
  return b;
}

/** 어느 세션인지 모를 때 쓸 가장 너그러운 예산 — 오탐보다 미탐이 낫다(경보 소음이 진짜 경보를 가린다). */
export function maxSessionBudgetMin() {
  return Math.max(...sessionIds().map(sessionBudgetMin).filter(Number.isFinite));
}

/**
 * 다음 정기 보고서 실행까지 남은 분. (KST 트리거 기준, 자정 넘김 처리)
 *
 * 2026-08-26 신설. 비정기 안전망(shock/catchup)이 정기 실행 직전에 떠서 락을 잡으면
 *   정기 실행이 [SKIP] 된다. 그걸 판단하려면 "다음 정기가 언제인가"를 알아야 한다.
 */
export function minutesToNextScheduledRun(now = Date.now()) {
  const kstNow = new Date(now + 9 * 3600000);
  const nowMin = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
  let best = Infinity;
  for (const id of sessionIds()) {
    const t = getTriggerKst(id);
    if (typeof t !== 'string' || !/^\d{1,2}:\d{2}$/.test(t)) continue;
    const [h, m] = t.split(':').map(Number);
    let diff = (h * 60 + m) - nowMin;
    if (diff < 0) diff += 24 * 60;          // 오늘 지났으면 내일 같은 시각
    if (diff < best) best = diff;
  }
  return Number.isFinite(best) ? best : Infinity;
}

/**
 * 비정기 발간(shock/catchup)을 지금 시작해도 되는가.
 *
 * 사건(2026-08-26): 두 안전망이 20분마다 돌아 항상 :20 에 뜨는데 정기 트리거는 :30 이다.
 *   생성이 세션 예산(90분)까지 걸릴 수 있어 **정기 실행이 락 싸움에서 매번 진다.**
 *   실측 3일간 3회: 08-24/08-25 midnight [SKIP](shock 22:20), 08-26 morning [SKIP](catchup 05:20).
 *   특히 08-26 은 연쇄였다 — shock 이 midnight 를 굶기자 catchup 이 그 부재를 메우려다 morning 을 굶겼다.
 *
 * 규칙: 이 실행이 정기 트리거 시각까지 락을 붙들 것 같으면 시작하지 않는다.
 *   정기 실행이 곧 그 일을 하므로 안전망이 나설 이유가 없다.
 *   임계는 세션 예산에서 파생한다 — 숫자를 박으면 예산이 바뀔 때 갈린다.
 */
export function shouldDeferUnscheduled(now = Date.now()) {
  const mins = minutesToNextScheduledRun(now);
  const budget = maxSessionBudgetMin();
  if (mins < budget) {
    return { defer: true, minutesToNext: mins,
      reason: `정기 실행까지 ${mins}분 (세션 예산 ${budget}분) — 비정기가 락을 붙들면 정기가 SKIP 된다` };
  }
  return { defer: false, minutesToNext: mins, reason: `정기 실행까지 ${mins}분 — 여유 있음` };
}

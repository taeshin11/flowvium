/**
 * resource-pressure.mjs — 메모리·스왑·열 압력을 GPU 를 쓰지 않고 읽는다.
 *
 * 왜: check-stall 의 검사 7종([1]~[7])에 자원 항목이 하나도 없었다. 이 기기는 모델 두 개를
 *   상주시켜 37.6GB 를 쓰고(vmmap 실측) hard freeze 전력도 기록돼 있는데, 다운 직전까지
 *   아무도 모르는 상태였다. 감시가 부하를 만들면 안 되므로 vm_stat·sysctl·조절기 로그만 쓴다
 *   (macmon 은 IOReport 를 열고 조절기가 이미 물고 있어 쓰지 않는다).
 *
 * 임계값은 data/resource-thresholds.json 에서 읽는다 — 코드에 숫자를 박지 않는다.
 */
import { execFile } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

const CFG_PATH = process.env.RESOURCE_THRESHOLDS_PATH ?? resolve(ROOT, 'data/resource-thresholds.json');
const THERMAL_LOG = process.env.TEMP_LOG ?? resolve(process.env.HOME ?? '', 'flowvium_runtime/thermal.log');

let _cfg = null;
export function loadThresholds() {
  if (_cfg) return _cfg;
  return (_cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8')));
}

const run = (cmd, args) => new Promise((res) => {
  execFile(cmd, args, { timeout: 8000, maxBuffer: 4 << 20 }, (err, stdout) => res(err ? null : String(stdout)));
});

/** macOS 메모리 압력. 읽기 실패한 항목은 null — 모르는 값을 0 으로 만들지 않는다. */
export async function readMemory() {
  const [mp, sw, vs] = await Promise.all([
    run('memory_pressure', []),
    run('sysctl', ['vm.swapusage']),
    run('vm_stat', []),
  ]);
  const freePct = Number(String(mp ?? '').match(/free percentage:\s*(\d+)%/)?.[1] ?? NaN);
  const swMatch = String(sw ?? '').match(/total = ([\d.]+)M\s+used = ([\d.]+)M/);
  const swapTotalMB = swMatch ? Math.round(Number(swMatch[1])) : NaN;
  const swapUsedMB  = swMatch ? Math.round(Number(swMatch[2])) : NaN;
  // vm_stat 의 페이지 크기는 첫 줄에 있다 — 16KB 를 가정하지 않는다(기기마다 다르다).
  const pageSize = Number(String(vs ?? '').match(/page size of (\d+) bytes/)?.[1] ?? NaN);
  const compPages = Number(String(vs ?? '').match(/Pages occupied by compressor:\s*(\d+)/)?.[1] ?? NaN);
  return {
    freePct: Number.isFinite(freePct) ? freePct : NaN,
    swapUsedMB, swapTotalMB,
    swapPct: Number.isFinite(swapUsedMB) && swapTotalMB > 0 ? Math.round(swapUsedMB / swapTotalMB * 100) : NaN,
    compressedGB: Number.isFinite(pageSize) && Number.isFinite(compPages)
      ? +(compPages * pageSize / 2 ** 30).toFixed(1) : NaN,
  };
}

/**
 * 순수 계산: 이벤트 목록 → 가동률. 부수효과 없음(그래서 검증할 수 있다).
 *
 * 2026-08-22 정정. 종전엔 *이벤트 사이 구간* 만 셌다. 그래서 62초 정지 1회뿐인 유휴 창에서
 *   stop=62s / run=0 → 가동률 0% 라는 오탐이 났다(참값 98.3%).
 *   창 시작~첫 이벤트, 마지막 이벤트~현재를 아무 쪽에도 안 넣은 것이다.
 *   이벤트가 드물수록 결과가 틀렸다 — 평온할수록 경보가 울리는 계산이었다.
 *
 * 올바른 정의: 창 전체에서 *측정된 정지 구간* 을 뺀 나머지가 가동이다.
 *   · 창 이전에 시작된 정지는 창 시작으로 잘라 센다.
 *   · 재개가 없으면(지금도 정지 중) now 까지 센다.
 * @param {Array<[number,'stop'|'run']>} events 시간 오름차순
 */
export function computeDuty(events, windowMs, now = Date.now()) {
  const start = now - windowMs;
  const evs = [...events].filter((e) => e[0] <= now).sort((a, b) => a[0] - b[0]);
  let paused = 0, pauses = 0, openStop = null;
  // 정지 '횟수' 는 창과 겹치는 구간만 센다. 창 밖(더 과거) 정지까지 세면 시간은 0인데
  //   횟수만 수백으로 불어나 경보 문구가 거짓이 된다(실측으로 그렇게 나왔다).
  const countIfOverlaps = (from, to) => { if (Math.min(to, now) > Math.max(from, start)) pauses++; };
  for (const [t, kind] of evs) {
    if (kind === 'stop') { if (openStop === null) openStop = t; continue; }
    if (openStop !== null) {                       // run — 열린 정지를 닫는다
      paused += Math.max(0, Math.min(t, now) - Math.max(openStop, start));
      countIfOverlaps(openStop, t);
      openStop = null;
    }
  }
  if (openStop !== null) {                          // 아직 정지 중
    paused += Math.max(0, now - Math.max(openStop, start));
    countIfOverlaps(openStop, now);
  }
  const dutyPct = windowMs > 0 ? Math.max(0, Math.min(100, Math.round((windowMs - paused) / windowMs * 100))) : 100;
  return { dutyPct, pauses, pausedMs: paused, samples: evs.length };
}

/**
 * 최근 창의 조절기 가동률. 로그가 없으면 null(모른다).
 * 로그에서 정지/재개 이벤트만 뽑아 computeDuty 에 넘긴다 — 파싱과 계산을 분리한다.
 */
export async function readThermalDuty(logPath = THERMAL_LOG, windowMinutes = null) {
  if (!existsSync(logPath)) return null;
  const cfg = loadThresholds();
  const win = (windowMinutes ?? cfg.thermal.windowMinutes) * 60 * 1000;
  const since = Date.now() - win;
  const evs = [];
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (일시정지|재개)/);
    if (!m) continue;
    const t = new Date(m[1].replace(' ', 'T')).getTime();
    // 창 이전에 시작된 정지도 필요하다(computeDuty 가 창 시작으로 잘라 센다) → 창의 2배까지 본다.
    if (Number.isFinite(t) && t >= since - win) evs.push([t, m[2] === '재개' ? 'run' : 'stop']);
  }
  return computeDuty(evs, win);
}

/** 스냅샷 → 사람이 읽을 issue 배열. 임계 미만이면 빈 배열. */
export function assess(snap) {
  const cfg = loadThresholds();
  const out = [];
  const m = snap?.mem ?? {};
  const t = snap?.thermal;
  if (Number.isFinite(m.freePct) && m.freePct < cfg.memory.minFreePct)
    out.push(`메모리 여유 ${m.freePct}% (임계 ${cfg.memory.minFreePct}%) — 페이지아웃 급증 위험`);
  if (Number.isFinite(m.swapPct) && m.swapPct > cfg.memory.maxSwapPct)
    out.push(`스왑 ${m.swapPct}% 사용 (임계 ${cfg.memory.maxSwapPct}%) — 스왑 확장 임박`);
  if (Number.isFinite(m.compressedGB) && m.compressedGB > cfg.memory.maxCompressedGB)
    out.push(`압축 메모리 ${m.compressedGB}GB (임계 ${cfg.memory.maxCompressedGB}GB) — 실효 메모리 축소`);
  if (t && Number.isFinite(t.dutyPct) && t.dutyPct < cfg.thermal.minDutyPct)
    out.push(`조절기 가동률 ${t.dutyPct}% (임계 ${cfg.thermal.minDutyPct}%) · 최근 정지 ${t.pauses}회 — 열로 처리량 급락`);
  return out;
}

/** 한 번에: 읽고 판정한다. */
export async function checkResourcePressure() {
  const mem = await readMemory();
  const thermal = await readThermalDuty();
  return { mem, thermal, issues: assess({ mem, thermal }) };
}

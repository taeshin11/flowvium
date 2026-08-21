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
 * 최근 창의 조절기 가동률. 로그가 없으면 null(모른다).
 * 정지→재개 = 정지구간, 재개→정지 = 실행구간. 유휴(간격이 너무 긴 구간)는 제외한다.
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
    if (Number.isFinite(t) && t >= since) evs.push([t, m[2] === '재개' ? 'run' : 'stop']);
  }
  if (evs.length < 2) return { dutyPct: 100, pauses: 0, samples: evs.length };
  let run_ = 0, stop = 0;
  for (let i = 0; i < evs.length - 1; i++) {
    const d = evs[i + 1][0] - evs[i][0];
    if (d > 10 * 60 * 1000) continue;                 // 유휴 구간 — 조절과 무관
    if (evs[i][1] === 'run') run_ += d; else stop += d;
  }
  const total = run_ + stop;
  return {
    dutyPct: total ? Math.round(run_ / total * 100) : 100,
    pauses: evs.filter(e => e[1] === 'stop').length,
    samples: evs.length,
  };
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

/**
 * llm-memory.mjs — 모델 적재에 필요한 메모리를 *측정된 비율* 로 산정하고, 지금 그만큼이
 * 있는지 판정한다.
 *
 * 왜 필요한가 (2026-08-31 실측):
 *   llm-health-check 의 `--repair` 는 죽은 LLM 서버를 재기동한다. 그런데 이 기계에서
 *   모델 적재는 **가중치의 약 2배** 를 순간적으로 쓴다. 메모리가 빠듯할 때 재기동하면
 *   복구가 아니라 두 번째 OOM 을 만든다 — 고치려는 행위가 사고를 내는 형태다.
 *
 *   적재 배수는 추정이 아니라 두 서버에서 각각 측정했다 (`footprint -p`):
 *     :8001  Qwen3.5-4B-4bit   가중치  2.83 GB → phys_footprint_peak  6.99 GB  = 2.47x
 *                              (재기동 후 tiny 요청 1건만 처리 — 생성이 아니라 적재가 만든 피크)
 *     :8000  Qwen3.8-27B-8bit  가중치 27.48 GB → phys_footprint_peak 55    GB  = 2.00x
 *   안전판단이므로 둘 중 **큰 쪽(2.5x)** 을 기본 계수로 쓴다. 환경에서 조정 가능.
 *
 *   참고로 KV(프롬프트) 캐시는 원인이 아니다 — 같은 런에서 MLX 가 직접 찍은 값이
 *   `Prompt Cache: 1 sequences, 0.16 GB` 로 내내 고정이었다. `--prompt-cache-size 1` 이
 *   제 일을 하고 있다. 캐시를 줄이는 방향은 이 기계에서 헛짚는 것이다.
 */
import { execFileSync } from 'child_process';
import { readdirSync, statSync, readlinkSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';

/** 실측 최대 배수(2.47x, 4B 대조군)를 올림한 값. 안전판단이라 보수적으로 잡는다. */
export const DEFAULT_LOAD_FACTOR = 2.5;

/** vm_stat 의 페이지 통계를 바이트로 환산한다. */
export function parseVmStat(text) {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] || 16384);
  const num = (label) => {
    const m = new RegExp(`${label}:\\s+(\\d+)`).exec(text);
    return m ? Number(m[1]) * pageSize : 0;
  };
  const free = num('Pages free');
  const inactive = num('Pages inactive');
  const speculative = num('Pages speculative');
  const purgeable = num('Pages purgeable');
  // 즉시 회수 가능한 것만 센다. active·wired 는 남의 작업이므로 빼앗을 수 있다고 가정하지 않는다.
  return { pageSize, free, inactive, speculative, purgeable, reclaimable: free + inactive + speculative + purgeable };
}

/** 시스템에서 지금 회수 가능한 메모리(바이트). */
export function reclaimableBytes(runner = () => execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 10_000 })) {
  return parseVmStat(runner()).reclaimable;
}

/**
 * 모델 디렉터리의 실제 가중치 크기(바이트). HF 캐시는 snapshots/ 가 blobs/ 로 가는 심볼릭
 * 링크라서 `stat` 을 그대로 쓰면 0 이 나온다 — 링크를 따라간 실체를 재야 한다.
 * @param {string} dir 모델 스냅샷 디렉터리
 */
export function weightBytes(dir) {
  if (!dir || !existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (!/\.safetensors$/.test(name)) continue;
    const p = join(dir, name);
    try {
      const st = statSync(p); // statSync 는 링크를 따라간다
      total += st.size;
    } catch { /* 깨진 링크는 센서에서 제외 */ }
  }
  return total;
}

/** launchd plist 의 ProgramArguments 에서 --model 경로를 뽑는다(경로를 코드에 박지 않기 위해). */
export function modelPathFromPlist(plistPath, runner = (p) => execFileSync('/usr/bin/plutil', ['-p', p], { encoding: 'utf8', timeout: 15_000 })) {
  if (!existsSync(plistPath)) return null;
  const out = runner(plistPath);
  const lines = out.split('\n');
  const i = lines.findIndex((l) => /=> "--model"/.test(l));
  if (i < 0 || !lines[i + 1]) return null;
  const m = /=> "(.*)"/.exec(lines[i + 1]);
  return m ? m[1].replace(/\/+$/, '') : null;
}

/**
 * 재기동해도 되는가.
 *
 * 문턱이 **둘** 인 이유 — 처음에 하나(가중치×2.5)로 짰다가 테스트가 잡았다:
 *   27.48GB × 2.5 = 68.7GB 는 48GB 기계에서 영원히 만족되지 않는다. 그 기준이면 27B 재기동을
 *   항상 막는다. 그런데 08-31 09:52 재기동은 실제로 성공했다 — 적재 피크 55GB 는 phys_footprint
 *   라서 macOS 의 압축·스왑을 포함한다. 즉 2.5x 는 *물리 여유* 로 요구할 값이 아니었다.
 *   측정이 반증한 설계를 그대로 두면 복구 경로를 내가 막는 셈이라 나눴다:
 *
 *   ① 하드 차단 — 가중치조차 못 올리면 재기동은 확실히 실패한다. 이건 물리적 하한이다.
 *   ② 경고     — 적재 순간엔 실측 2.0~2.47배가 필요하다. 모자라면 압축·스왑으로 넘어가며
 *                느려지고 다른 프로세스를 밀어낸다. 막지는 않되 숫자를 남긴다.
 *
 * @param {{weights: number, reclaimable: number, releasing?: number, factor?: number}} o
 *        releasing — 재기동으로 곧 반납될 현 프로세스의 점유(바이트). kickstart -k 는 죽이고
 *                    다시 띄우므로 그 몫은 다시 쓸 수 있다.
 */
export function canReload({ weights, reclaimable, releasing = 0, factor = DEFAULT_LOAD_FACTOR }) {
  const have = reclaimable + releasing;
  const residentNeed = weights;          // ① 하드 하한
  const transientNeed = weights * factor; // ② 적재 순간(실측)
  if (!(weights > 0)) {
    return { ok: false, tight: true, have, residentNeed, transientNeed, factor, detail: '가중치 크기를 측정하지 못했다 — 판정 불가' };
  }
  const ok = have >= residentNeed;
  const tight = have < transientNeed;
  const base = `가중치 ${gb(weights)} / 가용 ${gb(have)} (회수가능 ${gb(reclaimable)} + 반납예정 ${gb(releasing)})`;
  return {
    ok,
    tight,
    have,
    residentNeed,
    transientNeed,
    factor,
    detail: !ok
      ? `가중치조차 올릴 수 없다 — ${base}`
      : tight
        ? `적재 순간 ${gb(transientNeed)} (실측 ${factor}배) 에 못 미친다 — 압축·스왑으로 넘어가며 느려진다. ${base}`
        : `여유 있음 — ${base}`,
  };
}

export const gb = (b) => `${(b / 1024 ** 3).toFixed(2)}GB`;

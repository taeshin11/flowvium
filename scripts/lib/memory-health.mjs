/**
 * memory-health.mjs — 이 기계가 **모델을 디스크에서 계속 다시 읽고 있는가**.
 *
 * 2026-09-06 사고: 영상 레인(:8001)에 27B 를 한 번 요청했더니 그 서버가 28GB 모델을
 *   한 벌 더 적재했다. 그때부터 기계가 계속 디스크로 밀려났다.
 *   실측 45초에 **2,175MB** 를 다시 읽었고(정상은 4MB), LLM 응답이 1.4초~115초를 널뛰었다.
 *   보고서 두 편과 쇼츠 네 회차가 거기서 죽었다.
 *
 * 무서운 점은 **증상이 원인을 가린다**는 것이다. 보이는 것은 "보고서가 느리다",
 *   "슬롯이 건너뛴다", "LLM 이 죽은 것 같다" 뿐이고 셋 다 따로 고치려 들게 된다.
 *   페이지 인을 재면 셋이 하나로 묶인다.
 *
 * 정상과 이상의 차이가 커서 짧게 재도 갈린다:
 *   정상 0.09MB/s · 스래싱 48MB/s — 500배다. 10초만 재도 충분하다.
 */
import { execSync } from 'child_process';

/** vm_stat 의 누적 페이지 인(바이트). */
function pageInBytes() {
  const out = execSync('vm_stat', { encoding: 'utf8' });
  const size = Number((out.match(/page size of (\d+)/) ?? [])[1] ?? 16384);
  const n = Number((out.match(/Pageins:\s+(\d+)/) ?? [])[1] ?? 0);
  return n * size;
}

/**
 * 초당 몇 MB 를 디스크에서 다시 읽고 있는가.
 * @param {number} sampleMs 재는 시간(기본 10초)
 */
export async function pageInRate(sampleMs = 10_000) {
  const a = pageInBytes();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = pageInBytes();
  return (b - a) / 1048576 / (sampleMs / 1000);
}

/** 이 값을 넘으면 스래싱으로 본다. 정상 0.09 · 이상 48 사이에서 넉넉히 잡았다. */
export const THRASH_MB_PER_SEC = Number(process.env.THRASH_MB_PER_SEC || 10);

/**
 * 스래싱인가. 넘으면 **한 번 더 재서** 확인한다 —
 * 큰 파일을 한 번 읽는 것(모델 최초 적재·백업)과 계속 읽는 것은 다르다.
 */
export async function thrashing({ sampleMs = 10_000 } = {}) {
  const first = await pageInRate(sampleMs);
  if (first < THRASH_MB_PER_SEC) return { thrashing: false, mbPerSec: first };
  const second = await pageInRate(sampleMs);
  return {
    thrashing: second >= THRASH_MB_PER_SEC,
    mbPerSec: Math.max(first, second),
    confirmed: second >= THRASH_MB_PER_SEC,
  };
}

/**
 * 각 레인이 **자기 모델만** 들고 있는가.
 * 한 서버가 두 모델을 물면 그게 오늘 난 사고다.
 * @returns {Array<{port:number, pid:number, rssGb:number}>}
 */
export function lanes(ports = [8000, 8001]) {
  const out = [];
  for (const port of ports) {
    let pid = 0;
    try { pid = Number(execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' }).split('\n')[0]); } catch { /* 없음 */ }
    if (!pid) { out.push({ port, pid: 0, rssGb: 0 }); continue; }
    let rssGb = 0;
    try { rssGb = Number(execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' }).trim()) / 1048576; } catch { /* noop */ }
    out.push({ port, pid, rssGb });
  }
  return out;
}

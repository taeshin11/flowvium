#!/usr/bin/env node
/**
 * llm-memory.test.mjs — "복구가 두 번째 사고를 내는" 경로를 막는가.
 *
 * 배경(2026-08-31 실측): 모델 적재는 가중치의 약 2배를 순간적으로 쓴다.
 *   :8001 2.83GB → peak 6.99GB (2.47x, tiny 요청 1건만 — 즉 적재가 만든 피크)
 *   :8000 27.48GB → peak 55GB (2.00x)
 * 48GB 기계에서 27B 를 재기동하면 순간 55GB 가 필요하다. 메모리가 빠듯할 때
 * `--repair` 가 그냥 재기동하면 복구가 아니라 OOM 을 하나 더 만든다.
 */
import { parseVmStat, canReload, weightBytes, modelPathFromPlist, DEFAULT_LOAD_FACTOR } from './llm-memory.mjs';

let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
const GB = 1024 ** 3;

// ── vm_stat 파싱 — active/wired 를 가용으로 세면 안 된다 ──────────────────────
{
  const sample = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                  100000.
Pages active:                                900000.
Pages inactive:                               50000.
Pages speculative:                            10000.
Pages throttled:                                  0.
Pages wired down:                            300000.
Pages purgeable:                               5000.`;
  const v = parseVmStat(sample);
  v.pageSize === 16384 ? ok('페이지 크기 파싱') : bad(`페이지 크기 ${v.pageSize}`);
  const want = (100000 + 50000 + 10000 + 5000) * 16384;
  v.reclaimable === want
    ? ok(`회수가능 = free+inactive+speculative+purgeable (${(want / GB).toFixed(2)}GB)`)
    : bad(`회수가능 계산 오류 ${v.reclaimable} != ${want}`);
  v.reclaimable < 900000 * 16384
    ? ok('active 를 가용으로 세지 않는다 — 남의 작업을 빼앗는다고 가정하지 않음')
    : bad('active 를 가용에 포함시켰다');
}

// ── 08-31 09:52 실제 재기동을 막으면 안 된다 (내 첫 설계가 여기서 반증됐다) ────
//   그때 가용은 회수가능 ~6GB + 반납예정 ~28GB = 34GB 였고 가중치는 27.48GB 였다.
//   재기동은 실제로 성공했다. 문턱을 가중치×2.5(=68.7GB)로 두면 이 성공한 복구를 막는다.
{
  const r = canReload({ weights: 27.48 * GB, reclaimable: 6 * GB, releasing: 28 * GB });
  r.ok
    ? ok(`실제 성공한 재기동을 허용한다 (${r.detail})`)
    : bad(`성공했던 복구를 막았다 — 문턱이 현실과 안 맞는다: ${r.detail}`);
  r.tight
    ? ok('다만 적재 순간엔 빠듯하다고 경고는 남긴다')
    : bad('34GB 가용에 55GB 적재 피크인데 빠듯하다고 알리지 않았다');
}

// ── 가중치조차 못 올리는 경우는 확실히 막는다 (물리적 하한) ────────────────────
{
  const r = canReload({ weights: 27.48 * GB, reclaimable: 2 * GB, releasing: 3 * GB });
  !r.ok
    ? ok(`가중치 미만이면 재기동 거부 (${r.detail})`)
    : bad(`확실히 실패할 재기동을 허용했다: ${r.detail}`);
}

// ── 여유가 충분하면 경고도 없어야 한다 ────────────────────────────────────────
{
  const r = canReload({ weights: 2.83 * GB, reclaimable: 20 * GB, releasing: 4 * GB });
  r.ok && !r.tight ? ok(`여유 충분 — 허용 + 경고 없음 (${r.detail})`) : bad(`과잉 경고/차단: ${r.detail}`);
}

// ── 반납예정분을 세지 않으면 항상 막힌다 (kickstart -k 는 죽이고 다시 띄운다) ──
{
  const withRelease = canReload({ weights: 10 * GB, reclaimable: 5 * GB, releasing: 22 * GB });
  const without = canReload({ weights: 10 * GB, reclaimable: 5 * GB, releasing: 0 });
  withRelease.ok && !without.ok
    ? ok('죽는 프로세스가 반납할 메모리를 가용에 포함한다')
    : bad(`반납예정 반영 안 됨: with=${withRelease.ok} without=${without.ok}`);
}

// ── 측정 실패 시 통과시키지 않는다 (모르면 진행하지 않는다) ────────────────────
{
  const r = canReload({ weights: 0, reclaimable: 999 * GB });
  !r.ok ? ok('가중치를 못 재면 판정 불가로 막는다') : bad('측정 실패인데 통과시켰다');
}

// ── 계수는 실측(2.47x)을 덮는 값이어야 한다 ───────────────────────────────────
{
  DEFAULT_LOAD_FACTOR >= 2.47
    ? ok(`기본 계수 ${DEFAULT_LOAD_FACTOR}x ≥ 실측 최대 2.47x`)
    : bad(`기본 계수 ${DEFAULT_LOAD_FACTOR}x 가 실측 2.47x 보다 작다 — 낙관적 추정`);
}

// ── HF 캐시는 심볼릭 링크다: 링크를 안 따라가면 0 이 나온다 ────────────────────
{
  const plist = `${process.env.HOME}/Library/LaunchAgents/com.spinai.flowvium-llm.plist`;
  const dir = modelPathFromPlist(plist);
  if (!dir) {
    console.log('  – plist 없음 — 이 기계 전용 검사 건너뜀');
  } else {
    const b = weightBytes(dir);
    b > 1 * GB
      ? ok(`plist 의 --model 경로에서 가중치 실측 ${(b / GB).toFixed(2)}GB (심볼릭 링크 추적됨)`)
      : bad(`가중치가 ${b} 바이트 — 링크를 안 따라갔거나 경로가 틀렸다: ${dir}`);
  }
}

console.log(fail === 0 ? '\n✅ llm-memory 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

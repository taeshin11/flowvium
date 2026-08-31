#!/usr/bin/env node
/**
 * llm-health-check.mjs — 보고서 생성 직전에 "LLM 이 토큰을 내놓는가" 를 확인하고,
 * 죽어 있으면 서비스를 한 번 되살린 뒤 다시 확인한다. 그래도 안 되면 **중단** 한다.
 *
 * 왜 중단이 옳은가 (2026-08-31 실측):
 *   종전에는 게이트가 통과시켜서 파이프라인이 죽은 서버로 들어갔고, 섹션마다 3600s 를
 *   태우고 빈 문자열을 받았다. 1런 4시간+, 그동안 파이프라인 락이 물려 video·warm·
 *   segments 잡이 전부 skip 됐다. 즉 "일단 진행" 이 아무것도 못 만들면서 다른 일까지
 *   막았다. 못 만들 것이 확정이면 빨리 죽는 편이 손해가 작다.
 *
 * 프로브가 큐에 밀려 오판하지 않게:
 *   :8000 은 동시처리 1건이다. 다른 생성이 진행 중이면 프로브는 그 뒤에 줄을 서고
 *   타임아웃 나는데, 그건 사망이 아니라 혼잡이다. 실제로 이 기계에서 확인했다
 *   (보고서 macro 생성 중 프로브 120s 타임아웃, 서버는 정상).
 *   그래서 재기동 전에 *다른 생성이 도는지* 먼저 본다. 돌고 있으면 재기동하지 않는다 —
 *   그건 남의 4시간짜리 작업을 죽이는 짓이다.
 *
 * 2026-08-31 — 이 파일의 인자 파서가 `--lane web`(공백)만 받고 `--lane=web`(이 저장소의
 *   나머지 스크립트가 전부 쓰는 형식: --locales=ko · --limit=12 · --refresh=8)은 **조용히
 *   무시하고** 기본값 report 로 떨어졌다. 실제로 `--lane=web` 을 주고 :8001 을 검사한 줄
 *   알았는데 :8000 을 보고 있었다.
 *   그리고 라벨 기본값이 레인과 무관해서, `--lane web --repair` 는 :8001 이 죽은 걸 보고
 *   :8000(27B)을 재기동했다 — 보고서 모델을 죽여서 웹 모델을 고치는 형태다.
 *   두 형식을 모두 받고, 모르는 플래그는 조용히 넘기지 않고 거부한다. 라벨은 레인에서 뽑는다.
 *
 * 사용:
 *   node scripts/llm-health-check.mjs            # 확인만. 정상 0, 비정상 1
 *   node scripts/llm-health-check.mjs --repair   # 비정상이면 1회 재기동 후 재확인
 *   node scripts/llm-health-check.mjs --lane=web # 웹 레인(:8001). --lane web 도 같다
 */
import { execFileSync } from 'child_process';
import { probeWithColdRetry } from './lib/llm-health.mjs';
import { resolveLlm, resolveLaunchdLabel } from './lib/llm-config.mjs';
import { canReload, reclaimableBytes, weightBytes, modelPathFromPlist } from './lib/llm-memory.mjs';

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['--lane', '--timeout-ms', '--reload-timeout-ms', '--label'];
const BOOL_FLAGS = ['--repair'];
const has = (f) => argv.includes(f);
/** `--k=v` 와 `--k v` 를 모두 받는다. 한쪽만 받으면 나머지는 조용히 기본값으로 떨어진다. */
const arg = (f, d) => {
  const eq = argv.find((a) => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
// 오타를 조용히 삼키지 않는다 — 이번 사고가 정확히 "무시된 플래그" 였다.
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const name = a.split('=')[0];
  if (BOOL_FLAGS.includes(name) || VALUE_FLAGS.includes(name)) {
    if (VALUE_FLAGS.includes(name) && !a.includes('=')) i++;   // 값 토큰은 건너뛴다
    continue;
  }
  console.error(`[llm-health] 알 수 없는 인자: ${a}\n  쓸 수 있는 것: ${[...BOOL_FLAGS, ...VALUE_FLAGS.map((f) => `${f}=…`)].join(' ')}`);
  process.exit(2);
}

const lane = arg('--lane', 'report');
if (!['report', 'web'].includes(lane)) {
  console.error(`[llm-health] 알 수 없는 레인 '${lane}' — report 또는 web`);
  process.exit(2);
}
const { url } = resolveLlm(lane);
const timeoutMs = Number(arg('--timeout-ms', process.env.LLM_PROBE_TIMEOUT_MS || 90_000));
// 재기동 직후에는 가중치 적재가 있으므로 더 길게 준다. 코드에 상한을 박지 않고 환경에서 조정 가능.
const reloadTimeoutMs = Number(arg('--reload-timeout-ms', process.env.LLM_RELOAD_TIMEOUT_MS || 600_000));
// 라벨은 레인에서 뽑는다 — 고정값이면 `--lane web --repair` 가 27B 를 죽인다(llm-config.mjs 참조).
const label = arg('--label', resolveLaunchdLabel(lane));

const log = (m) => console.log(`[llm-health] ${m}`);

/** 이 기계에서 지금 다른 생성이 도는가. 돈다면 프로브 실패는 혼잡이지 사망이 아니다. */
function otherGenerationRunning() {
  try {
    const out = execFileSync('/bin/ps', ['-Ao', 'pid,args'], { encoding: 'utf8', timeout: 10_000 });
    return out.split('\n').some((l) =>
      /generate-report-local\.mjs|make-issue-video\.mjs/.test(l) && !l.includes('llm-health-check'));
  } catch { return false; }
}

/** 지금 이 서비스가 붙잡고 있는 메모리(바이트). kickstart -k 로 곧 반납된다. */
function footprintOf(pid) {
  if (!pid) return 0;
  try {
    const out = execFileSync('/usr/bin/footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 20_000 });
    const m = /phys_footprint:\s+([\d.]+)\s*(MB|GB|KB|B)/.exec(out);
    if (!m) return 0;
    const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2]];
    return Number(m[1]) * mult;
  } catch { return 0; }
}

/** 이 라벨이 지금 물고 있는 PID (launchctl list 의 첫 컬럼). */
function pidOfLabel() {
  try {
    const listed = execFileSync('/bin/launchctl', ['list'], { encoding: 'utf8', timeout: 15_000 });
    const row = listed.split('\n').find((l) => l.trim().endsWith(`\t${label}`) || l.trim().endsWith(label));
    const pid = row ? Number(row.split('\t')[0]) : NaN;
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch { return 0; }
}

/**
 * launchd 잡이 실제로 등록돼 있는지, 그리고 메모리가 모델을 올릴 수는 있는지 확인한 뒤에만
 * 재기동한다. 없는 라벨을 kickstart 하면 조용히 실패하고, 메모리가 가중치에도 못 미치면
 * 재기동은 복구가 아니라 두 번째 사고다.
 */
function restartService() {
  const uid = process.getuid();
  const listed = execFileSync('/bin/launchctl', ['list'], { encoding: 'utf8', timeout: 15_000 });
  if (!listed.split('\n').some((l) => l.trim().endsWith(label))) {
    log(`❌ launchd 잡 '${label}' 이 등록돼 있지 않다 — 재기동 경로 없음`);
    return false;
  }

  // 메모리 판정. 경로·크기를 코드에 박지 않고 plist 의 --model 에서 실측한다.
  const plist = `${process.env.HOME}/Library/LaunchAgents/${label}.plist`;
  const dir = modelPathFromPlist(plist);
  const weights = weightBytes(dir || '');
  if (weights > 0) {
    const verdict = canReload({ weights, reclaimable: reclaimableBytes(), releasing: footprintOf(pidOfLabel()) });
    if (!verdict.ok) {
      log(`❌ 재기동 불가 — ${verdict.detail}`);
      return false;
    }
    log(verdict.tight ? `⚠️ ${verdict.detail}` : `메모리 ${verdict.detail}`);
  } else {
    log(`⚠️ 가중치 크기를 측정하지 못했다(${dir || 'model 경로 미검출'}) — 메모리 판정 없이 진행`);
  }

  execFileSync('/bin/launchctl', ['kickstart', '-k', `gui/${uid}/${label}`], { encoding: 'utf8', timeout: 60_000 });
  log(`재기동 요청 완료: ${label} (레인 ${lane} · ${url})`);
  return true;
}

const first = await probeWithColdRetry({ url, timeoutMs });
if (first.ok) {
  log(`${first.cold ? '✅ 정상(콜드)' : '✅ 정상'} — ${first.detail} (모델 ${first.model})`);
  process.exit(0);
}
// 진단을 먼저 정직하게 만든다. 종전에는 이 판정이 --repair 안에만 있어서, 보고서가 도는 중
// 프로브가 실패하면 로그에 "생성 스레드 사망 의심" 만 남았다(2026-08-31 11:24 실제로 그렇게 찍혔다).
// 사람이 그 줄만 보면 멀쩡한 서버를 죽이러 간다. 원인 후보가 둘이면 어느 쪽인지 로그가 말해야 한다.
const busy = otherGenerationRunning();
log(`⚠️ 불합격 [${first.stage}] ${first.detail} (${(first.ms / 1000).toFixed(1)}s, 레인 ${lane} url ${url})`);
if (busy) {
  log('  └ 다만 이 기계에서 다른 생성이 진행 중이다 — :8000 은 동시처리 1건이라 프로브가 큐에 밀린다.');
  log('    즉 혼잡일 가능성이 높다. 사망 판정은 그 작업이 끝난 뒤에 다시 볼 것.');
}

if (!has('--repair')) process.exit(1);

if (busy) {
  log('다른 생성 작업이 진행 중 — 혼잡이지 사망이 아니다. 재기동하지 않고 중단한다.');
  process.exit(1);
}

if (!restartService()) process.exit(1);

const second = await probeWithColdRetry({ url, timeoutMs: reloadTimeoutMs, coldTimeoutMs: reloadTimeoutMs });
if (second.ok) {
  log(`✅ 재기동으로 복구 — ${second.detail} (모델 ${second.model})`);
  process.exit(0);
}
log(`❌ 재기동 후에도 불합격 [${second.stage}] ${second.detail} — 이번 런은 중단한다`);
process.exit(1);

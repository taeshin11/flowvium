#!/usr/bin/env node
/**
 * shorts-spare.mjs — 예비 쇼츠를 한 편 미리 만들어 둔다. (2026-09-26 신설)
 *
 * 사장님: "시간이 지나서 못올린다는게 말이됨? 예비를 계속 뽑아놔야지"
 *   9/26 21:45 회차가 렌더 중 1시간 44분 멈춰 통째로 안 나갔다. 정규 렌더가 실패·지연되면
 *   video-publish 가 여기서 만든 예비를 올린다(lib/shorts-spare · video-publish 의 useSpare).
 *
 * 무엇을 만드나: **지금 2순위 이슈.** 1순위는 다음 정규 회차가 고를 것이라, 같은 걸 예비로 만들면
 *   정규가 내는 순간 예비가 무효가 되어 매시간 헛렌더를 한다. 그래서 ① 고르기만 돌려 1순위를 알고
 *   ② 그것을 빼고(SHORTS_EXCLUDE) 렌더한다.
 * 비용: Omni(크레딧) 생성은 끈다(FLOW_OMNI_FALLBACK=0) — 쓰일지 모르는 예비에 크레딧을 쓰지 않는다.
 * 막는 것: 쓸 수 있는 예비가 이미 있으면 · 보고서 생성 중이면 · 다른 렌더가 돌면(같은 작업 폴더) 쉰다.
 *
 * 사용: node scripts/shorts-spare.mjs   (cron-runner 가 매시간 부른다)
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, rmSync, mkdirSync, openSync, closeSync } from 'fs';
import { resolve, join } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { pickSpare, pruneSpares, spareDir } from './lib/shorts-spare.mjs';
import { acquireRunLock } from './lib/run-lock.mjs';
import { isReportPipelineRunning } from './lib/report-running.mjs';

const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[spare]', ...a);
if (process.env.SHORTS_SPARE === '0') { log('SHORTS_SPARE=0 — 끔'); process.exit(0); }

const DIR = spareDir();   // 로컬(2026-09-28) — lib/shorts-spare spareDir 머리말
const MAX_AGE_H = Number(process.env.SHORTS_SPARE_MAX_AGE_H || 6);
const { recentShortsIssues, normalizeIssueKey } = await import('./lib/db.mjs');
const pub = recentShortsIssues(24);
const isPublished = (k) => pub.has(normalizeIssueKey(k));

const pruned = pruneSpares({ dir: DIR, maxAgeH: MAX_AGE_H, isPublished });
if (pruned) log(`낡았거나 이미 나간 예비 ${pruned}편 지움`);
const have = pickSpare({ dir: DIR, maxAgeH: MAX_AGE_H, isPublished });
if (have) { log(`쓸 수 있는 예비가 있다 — "${have.meta.keyword}" (${Math.round((Date.now() - have.createdAt) / 60000)}분 전). 쉰다`); process.exit(0); }
if (await isReportPipelineRunning(ROOT)) { log('보고서 생성 중 — 다음 차례에 만든다'); process.exit(0); }
const lock = await acquireRunLock(resolve(ROOT, 'logs/video-publish.lock'), { waitMs: 0, label: 'spare' });
if (!lock.ok) { log(`다른 렌더가 돈다(${lock.holder?.label ?? '?'}) — 다음 차례에 만든다`); process.exit(0); }

const node = process.execPath;
const shorts = resolve(ROOT, 'scripts/video/make-shorts.mjs');
// ① 지금 1순위(다음 정규 회차가 고를 것)를 안다
const pick = spawnSync(node, [shorts, '--seconds', '40'], { cwd: ROOT, stdio: 'ignore', timeout: 5 * 60_000, killSignal: 'SIGKILL',
  env: { ...process.env, SHORTS_PICK_ONLY: '1' } });
let top = '';
try { top = readFileSync(resolve(ROOT, 'logs/last-issue.txt'), 'utf8').trim(); } catch { /* 없으면 빼지 않고 만든다 */ }
log(`1순위 "${top || '?'}"(고르기 exit ${pick.status}) — 그것을 빼고 2순위로 예비를 만든다`);

// ② 2순위로 렌더 — 정규 산출물을 덮지 않게 예비 폴더에
const LOG = resolve(ROOT, 'logs/shorts-spare.log');   // 렌더 출력(cron-runner 가 자식 출력을 버려 9/28 22:30 사유를 몰랐다)
const subCta = (await import('./lib/sub-cta.mjs')).subCtaFor((await import('./lib/db.mjs')).shortsPublishedCount()) ? '1' : '0';
// 2026-09-29: 한 이슈가 거절되면(00:50 "4장면 중 소재는 1장뿐") 그 이슈를 빼고 다시 — 정규 회차와 같은 방식.
const TRIES = Number(process.env.SHORTS_SPARE_TRIES || 3);
const exclude = top ? [top] : [];
const t0 = Date.now();
let made = null;
const lastIssue = () => { try { return readFileSync(resolve(ROOT, 'logs/last-issue.txt'), 'utf8').trim(); } catch { return ''; } };
for (let a = 1; a <= TRIES && !made; a++) {
  const out = join(DIR, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });
  const logFd = openSync(LOG, a === 1 ? 'w' : 'a');
  const r = spawnSync(node, [shorts, '--seconds', '40'], { cwd: ROOT, stdio: ['ignore', logFd, logFd], timeout: 20 * 60_000, killSignal: 'SIGKILL',
    env: { ...process.env, SHORTS_OUT_DIR: out, FLOW_OMNI_FALLBACK: '0', ...(exclude.length ? { SHORTS_EXCLUDE: exclude.join(',') } : {}),
      // 구독 권유 A/B — 예비도 같은 규칙(누적 편수 % 4). 실제로 붙었는지는 메타가 기록한다.
      SHORTS_SUB_CTA: subCta } });
  closeSync(logFd);
  if (r.status === 0 && existsSync(join(out, 'shorts-ko.mp4')) && existsSync(join(out, 'shorts-ko-meta.json'))) { made = out; break; }
  rmSync(out, { recursive: true, force: true });
  const tried = lastIssue();
  const tail = (() => { try { return readFileSync(LOG, 'utf8').trim().split('\n').filter((x) => /❌|Error|실패|못/.test(x)).slice(-1).join('').slice(0, 160); } catch { return ''; } })();
  log(`${a}번째 시도 실패 "${tried || '?'}"(exit ${r.status}${r.signal ? ` · ${r.signal}` : ''})${tail ? ` · ${tail}` : ''}`);
  if (r.signal || !tried || exclude.includes(tried)) break;   // 시간 초과·고른 이슈를 모름·같은 이슈 반복이면 그만
  exclude.push(tried);
}
if (made) {
  const kw = JSON.parse(readFileSync(join(made, 'shorts-ko-meta.json'), 'utf8')).keyword;
  log(`✅ 예비 "${kw}" 만들었다 (${Math.round((Date.now() - t0) / 1000)}초) — ${made}`);
} else {
  log(`예비를 못 만들었다 — 다음 차례에 다시 (전체: logs/shorts-spare.log)`);
}
lock.release();

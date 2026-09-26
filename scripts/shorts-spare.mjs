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
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { resolveMediaRoot } from './lib/media-root.mjs';
import { envValue } from './lib/footage.mjs';
import { pickSpare, pruneSpares } from './lib/shorts-spare.mjs';
import { acquireRunLock } from './lib/run-lock.mjs';
import { isReportPipelineRunning } from './lib/report-running.mjs';

const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[spare]', ...a);
if (process.env.SHORTS_SPARE === '0') { log('SHORTS_SPARE=0 — 끔'); process.exit(0); }

const media = resolveMediaRoot({ configured: envValue('MEDIA_ROOT'), localFallback: resolve(ROOT, 'reports/video') });
const DIR = join(media.root, 'spares');
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
const out = join(DIR, new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const r = spawnSync(node, [shorts, '--seconds', '40'], { cwd: ROOT, stdio: 'inherit', timeout: 20 * 60_000, killSignal: 'SIGKILL',
  env: { ...process.env, SHORTS_OUT_DIR: out, FLOW_OMNI_FALLBACK: '0', ...(top ? { SHORTS_EXCLUDE: top } : {}),
    // 구독 권유 A/B — 예비도 같은 규칙(누적 편수 % 4). 실제로 붙었는지는 메타가 기록한다.
    SHORTS_SUB_CTA: (await import('./lib/sub-cta.mjs')).subCtaFor((await import('./lib/db.mjs')).shortsPublishedCount()) ? '1' : '0' } });
const okFiles = existsSync(join(out, 'shorts-ko.mp4')) && existsSync(join(out, 'shorts-ko-meta.json'));
if (r.status === 0 && okFiles) {
  const kw = JSON.parse(readFileSync(join(out, 'shorts-ko-meta.json'), 'utf8')).keyword;
  log(`✅ 예비 "${kw}" 만들었다 (${Math.round((Date.now() - t0) / 1000)}초) — ${out}`);
} else {
  rmSync(out, { recursive: true, force: true });
  log(`예비를 못 만들었다(exit ${r.status}${r.signal ? ` · ${r.signal}` : ''}) — 다음 차례에 다시`);
}
lock.release();

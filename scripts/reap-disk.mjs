#!/usr/bin/env node
/**
 * reap-disk.mjs — 이미 올려서 역할이 끝난 산출물과 중간물을 거둔다.
 *
 * 사용자(2026-09-03): "이미 만들어서 올린 것들은 굳이 갖고 있을 필요 없으니까
 *   나중에 롱폼 만드는데 필요한 거 아니면 다 정리해서 용량 확보도 해야 되고"
 *
 * 남기는 것과 지우는 것을 가르는 기준은 **다시 만들 수 있는가**다:
 *   · 롱폼 제작 자산(anchor·brand·broll·cards) — 다시 못 만들거나 만들기 비싸다 → 남긴다.
 *   · 완성 영상 — 이미 유튜브에 있다. 원본이 필요하면 거기서 받는다 → 지운다.
 *   · 중간물(playwright 잔재·렌더 작업본·검증 스크린샷) — 매번 새로 생긴다 → 지운다.
 *
 * 왜 스크립트인가: 손으로 지우면 다음 주에 또 쌓인다. 실측으로 playwright 잔재만 550MB 였다.
 *   (브라우저가 안 닫히던 것과 같은 뿌리다 — reap-zombies.mjs 가 프로세스를, 이쪽이 파일을 본다.)
 *
 * 기본은 미리보기다. 지우려면 --confirm 이 필요하다.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ROOT } from './lib/project-root.mjs';
import { resolveMediaRoot } from './lib/media-root.mjs';

const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const CONFIRM = a.includes('--confirm');
// 완성 영상은 따로 뺄 수 있게 한다. 유튜브에서 내린 편은 **로컬 사본이 유일본**이라
//   중간물과 같은 무게로 다룰 수 없다(2026-09-03: 영어 편들을 채널에서 지웠다).
const KEEP_VIDEOS = a.includes('--keep-videos');
const KEEP_DAYS = Number(arg('--keep-days', 3));   // 이보다 새 것은 아직 쓰일 수 있다.

const MEDIA = resolveMediaRoot().root;
const GB = (n) => (n / 1073741824);

function sizeOf(p) {
  try {
    const st = statSync(p);
    if (!st.isDirectory()) return st.size;
    let s = 0;
    for (const e of readdirSync(p)) s += sizeOf(join(p, e));
    return s;
  } catch { return 0; }
}
const ageDays = (p) => { try { return (Date.now() - statSync(p).mtimeMs) / 86400000; } catch { return 0; } };

/** 롱폼 제작 자산 — 절대 건드리지 않는다. */
const KEEP = new Set(['anchor', 'brand', 'broll', 'cards']);

const targets = [];
const add = (path, why, { minAge = 0 } = {}) => {
  if (!existsSync(path)) return;
  if (ageDays(path) < minAge) return;
  const bytes = sizeOf(path);
  if (bytes <= 0) return;
  targets.push({ path, why, bytes });
};

// ① 이미 올린 완성 영상. 유튜브에 있으므로 로컬 사본은 역할이 끝났다.
for (const f of readdirSync(MEDIA)) {
  if (KEEP.has(f)) continue;
  if (KEEP_VIDEOS) continue;
  if (!/\.(mp4|mov|webm)$/i.test(f)) continue;
  // 방금 만든 것은 아직 업로드 전일 수 있다.
  add(join(MEDIA, f), '완성 영상(유튜브에 있음)', { minAge: KEEP_DAYS / 24 });
}

// ② playwright 잔재. 브라우저가 정상 종료되지 않으면 남는다(실측 550MB).
for (const f of readdirSync(tmpdir())) {
  if (/^playwright-artifacts-/.test(f)) add(join(tmpdir(), f), 'playwright 잔재', { minAge: 0.02 });
  if (/^(pip-unpack-|pip-build-env-|pip-install-)/.test(f)) add(join(tmpdir(), f), 'pip 잔재', { minAge: 1 });
  if (/^flowvium-(shorts|video)/.test(f)) add(join(tmpdir(), f), '렌더 중간물', { minAge: 0.02 });
}

// ③ 검증용 스크린샷·렌더 작업본. 매 회차 새로 생긴다.
// 폴더째 나이를 보면 안 된다 — 새 파일 하나만 들어와도 폴더 mtime 이 오늘이 되어
//   그 안의 오래된 파일 500여 개가 통째로 살아남는다(실측: 3일 초과 529개 · 115MB 가 안 잡혔다).
//   파일 단위로 본다.
{
  const shots = join(ROOT, 'logs/screenshots');
  if (existsSync(shots)) {
    for (const f of readdirSync(shots)) add(join(shots, f), '검증 스크린샷', { minAge: KEEP_DAYS });
  }
}
for (const d of ['reports/video', 'reports/preview']) {
  const p = join(ROOT, d);
  if (!existsSync(p)) continue;
  // 최신 몇 개는 남긴다 — 직전 회차를 사람이 확인할 수 있어야 한다.
  const entries = readdirSync(p).map((f) => ({ f, p: join(p, f), t: (() => { try { return statSync(join(p, f)).mtimeMs; } catch { return 0; } })() }))
    .sort((x, y) => y.t - x.t);
  for (const e of entries.slice(3)) add(e.p, `${d} 지난 회차`, { minAge: KEEP_DAYS });
}

if (!targets.length) { console.log('거둘 것 없음 ✓'); process.exit(0); }

targets.sort((x, y) => y.bytes - x.bytes);
const total = targets.reduce((s, t) => s + t.bytes, 0);
console.log(CONFIRM ? '정리 실행' : `미리보기 — 지우려면 --confirm (보존: ${[...KEEP].join(', ')})`);
const byWhy = new Map();
for (const t of targets) byWhy.set(t.why, (byWhy.get(t.why) ?? 0) + t.bytes);
for (const [why, b] of [...byWhy].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${GB(b).toFixed(2)}GB  ${why}`);
}
console.log(`  ─────────\n  ${GB(total).toFixed(2)}GB  합계 (${targets.length}건)`);
if (!CONFIRM) { console.log('\n큰 것 몇 개:'); targets.slice(0, 6).forEach((t) => console.log(`  ${(t.bytes / 1048576).toFixed(0)}MB  ${t.path.replace(ROOT, '.')}`)); process.exit(0); }

let done = 0;
for (const t of targets) {
  try { rmSync(t.path, { recursive: true, force: true }); done += t.bytes; }
  catch (e) { console.log(`  ⚠ ${t.path.slice(-50)}: ${e.message.slice(0, 40)}`); }
}
console.log(`\n✅ ${GB(done).toFixed(2)}GB 회수`);

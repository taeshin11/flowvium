#!/usr/bin/env node
/**
 * refresh-flowvium-card.mjs — 쇼츠 끝 flowvium.net 2초 카드를 오늘 사이트 화면으로 다시 굽는다. (2026-09-30)
 *   카드 위쪽 띠가 **사이트 보고서 화면 캡처**라 날짜·지수가 박힌다 — 고정 파일로 두면 몇 주 뒤엔 옛 숫자가 나간다.
 *   아침보고서 뒤(cron 07:45 KST)에 한 번. 임시 파일로 만들어 재고(길이·규격·밝기) 맞을 때만 바꿔 끼운다 —
 *   렌더 중인 쇼츠가 반쯤 쓴 파일을 붙이지 않게(같은 폴더 안 rename 은 한 번에 바뀐다).
 */
import { spawnSync } from 'child_process';
import { existsSync, renameSync, rmSync } from 'fs';
import { resolve } from 'path';
import ffmpegPath from 'ffmpeg-static';
import { ROOT } from './lib/project-root.mjs';

const OUT = resolve(ROOT, 'assets/outro/flowvium-card.mp4');
const TMP = resolve(ROOT, 'assets/outro/.flowvium-card.tmp.mp4');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[flowvium-card]', ...a);
rmSync(TMP, { force: true });
// 카드 띠: 추천 기록의 **실제** 최고 적중(앞뒤가 맞는 기록만, lib/best-hit). 없으면 사이트 화면으로.
let HIT = null;
try {
  const { openDb } = await import('./lib/db.mjs');
  const { pickBestHit } = await import('./lib/best-hit.mjs');
  HIT = pickBestHit(openDb().prepare(`SELECT r.ticker, r.name, r.generated_at, o.evaluated_at, o.outcome, o.pnl_pct,
    r.entry_low, r.entry_high, r.price_at_gen, o.high_seen, o.low_seen
    FROM recommendation_outcomes o JOIN recommendations r ON r.id = o.recommendation_id`).all());
  log(HIT.best ? `실제 최고 적중 ${HIT.best.ticker} +${HIT.best.pnl}% (평가 ${HIT.evaluated}건 중)` : '쓸 만한 적중 기록이 없다 — 사이트 화면으로');
} catch (e) { log(`추천 기록을 못 읽었다 — 사이트 화면으로: ${String(e?.message ?? e).slice(0, 80)}`); }
const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/video/make-outro-clip.mjs'), '--card', '--brand', 'flowvium', '--out', TMP],
  { cwd: ROOT, encoding: 'utf8', timeout: 5 * 60_000, killSignal: 'SIGKILL', env: { ...process.env, ...(HIT?.best ? { FLOWVIUM_HIT: JSON.stringify(HIT) } : {}) } });
if (r.status !== 0 || !existsSync(TMP)) { log(`만들지 못했다(exit ${r.status}) — 어제 카드를 그대로 쓴다: ${String(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`); process.exit(1); }
const info = String(spawnSync(ffmpegPath, ['-hide_banner', '-i', TMP], { encoding: 'utf8' }).stderr);
const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(info);
const sec = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
const size = /,\s(\d{3,4})x(\d{3,4})[,\s]/.exec(info);
const hz = /(\d+) Hz/.exec(info)?.[1];
const y = /YAVG=([\d.]+)/.exec(String(spawnSync(ffmpegPath, ['-hide_banner', '-ss', '1', '-i', TMP, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' }).stderr))?.[1];
const bad = [
  !(sec >= 1.8 && sec <= 2.3) && `길이 ${sec.toFixed(2)}초`,
  !(size && size[1] === '1080' && size[2] === '1920') && `규격 ${size?.[0] ?? '?'}`,
  hz !== '44100' && `음성 ${hz ?? '?'}Hz`,
  !(Number(y) > 10 && Number(y) < 245) && `밝기 ${y ?? '?'}`,
].filter(Boolean);
if (bad.length) { rmSync(TMP, { force: true }); log(`재 보니 안 맞다(${bad.join(' · ')}) — 어제 카드를 그대로 쓴다`); process.exit(1); }
renameSync(TMP, OUT);
log(`✅ 바꿔 끼웠다 — ${sec.toFixed(2)}초 · 1080x1920 · ${hz}Hz · 밝기 ${Number(y).toFixed(0)}`);

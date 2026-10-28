#!/usr/bin/env node
/**
 * make-evergreen-short.mjs — 상시 쇼츠(날짜·가격 없는 주식 상식) 한 편을 만들어 예비 풀에 넣는다. (2026-10-28 신설)
 *
 * Mac mini2(사장님 위임) 10/28: "쇼츠는 테크이슈와 같은 규칙 — 36시간치 상시 쇼츠를 예비로.
 *   PER·금리 인하·거래량 같은 날짜·가격 없는 설명. 정규 렌더가 실패하거나 뉴스 파이프라인이 멎었을 때만."
 *   뉴스 예비(lib/shorts-spare)는 6시간이면 버린다 — 늦은 뉴스는 가치가 없어서. 이건 언제 나가도 맞는 말이라 기한이 없다.
 * 대본: data/evergreen-shorts.json(사람이 쓰고 agy 가 감수) → lib/evergreen-check 를 못 넘으면 안 만든다.
 * 그림: agy generate_image(사장님 지정 — 그림은 agy). 뉴스가 아니라 개념 그림이라 쓸 수 있다(lib/agy-image 머리말:
 *   뉴스 장면엔 숫자를 지어 그려 못 쓴다). 그래도 글자·숫자 없는 그림만 달라고 하고, 만든 뒤 눈으로 본다.
 *   그림은 풀과 따로 캐시한다 — 풀의 편은 나가면 지워지지만 다시 만들 때 그림을 또 그리지 않게.
 * 합성: make-shorts 와 같은 라이브러리·같은 순서(음성 → 잡음 관문 → 캡션 오버레이 → 장면 → 끝 카드 → 배경음 → 최종 음량).
 *   뉴스 고르기·기사 사진·브리핑은 없다.
 * 풀: reports/video/evergreen-pool/<id>/ (shorts-ko.mp4·-thumb.jpg·-meta.json) — video-publish 의 useSpare 가 뉴스 예비가 없을 때 꺼낸다.
 *
 * 사용: node scripts/video/make-evergreen-short.mjs --id per        # 한 편
 *       node scripts/video/make-evergreen-short.mjs --fill 15       # 풀이 15편이 될 때까지(이미 나간 주제·풀에 있는 주제는 건너뜀)
 */
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, renameSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ROOT } from '../lib/project-root.mjs';
import { ffmpegOpts } from '../lib/ffmpeg-timeout.mjs';
import { loadEnvLocal } from '../lib/llm-config.mjs';
import { measure as measureLoudness, normalize as normalizeLoudness } from '../lib/loudness.mjs';
import { mixBgm } from '../lib/bgm-mix.mjs';
import { licensedBeds } from '../lib/bgm-beds.mjs';
import { cuesFromAlignment, fillGaps } from '../lib/subtitle.mjs';
import { synthesizeKoreanAuto } from '../lib/tts-korean.mjs';
import { SHORTS as G, shortsOverlayHtml, mediaFilter, audioArgs, LAYOUT } from '../lib/shorts-layout.mjs';
import { checkEvergreen } from '../lib/evergreen-check.mjs';
import { evergreenDir, listSpares } from '../lib/shorts-spare.mjs';
import { generateImage } from '../lib/agy-image.mjs';
import { cutHead, shortsThumbHtml, dataUrlOf, THUMB_BG } from '../lib/shorts-thumb.mjs';
import { isReportPipelineRunning } from '../lib/report-running.mjs';

loadEnvLocal();
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
// 로그는 화면과 logs/evergreen-fill.log 둘 다 — 크론(cron-runner)은 잡 출력을 버린다(10/28: 정기 실행이 무엇을 했는지 아무 데도 없었다).
const log = (...a) => {
  const line = [new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[evergreen]', ...a].join(' ');
  console.log(line);
  try { appendFileSync(resolve(ROOT, 'logs/evergreen-fill.log'), `${line}\n`); } catch { /* 기록 실패는 렌더를 막지 않는다 */ }
};
const DATA = JSON.parse(readFileSync(resolve(ROOT, 'data/evergreen-shorts.json'), 'utf8'));
const POOL = evergreenDir();
const IMG_CACHE = resolve(ROOT, 'reports/video/evergreen-img');
const KEY_PREFIX = '주식 상식:';
const RESET_FILE = resolve(ROOT, 'logs/agy-image-reset.json');

/** 이미 나간 상시 쇼츠 id — 같은 설명을 두 번 올리지 않는다. 대장은 키를 정규화해 적는다(db normalizeIssueKey: '주식상식per'). */
function publishedIds({ recentShortsIssues, normalizeIssueKey }) {
  const pub = recentShortsIssues(24 * 3650);
  return new Set(DATA.items.map((x) => x.id).filter((id) => pub.has(normalizeIssueKey(`${KEY_PREFIX}${id}`))));
}

async function render(item) {
  const chk = checkEvergreen(item);
  if (!chk.ok) { log(`❌ ${item.id} 대본 규칙: ${chk.why.join(' · ')}`); return false; }
  const WORK = join(tmpdir(), 'flowvium-evergreen', item.id);
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const scenes = item.scenes.map((s) => ({ ...s }));

  // ── 그림 ── 캐시가 있으면 그대로(같은 대본이면 같은 그림)
  const imgDir = join(IMG_CACHE, item.id);
  mkdirSync(imgDir, { recursive: true });
  for (let i = 0; i < scenes.length; i++) {
    const f = join(imgDir, `s${i}.jpg`);
    if (!existsSync(f)) {
      let r = null;
      for (let a = 1; a <= 2 && !r?.ok; a++) {
        r = await generateImage({ prompt: `${DATA.style}. Scene: ${scenes[i].image}.`, out: f, aspect: '16:9' });
        if (!r.ok) log(`  그림 ${i + 1} 실패(${a}/2): ${r.reason}`);
        // 10/28 실측: 할당량이 차면(429, 몇 시간 뒤 리셋) 남은 편이 전부 그림 단계에서 실패한다 — 16편 × 2번을 헛돌았다.
        //   리셋 전엔 될 수 없으니 채우기를 멈추고 다음 실행(evergreen-fill)에 맡긴다.
        if (r.quotaExhausted) throw Object.assign(new Error(r.reason), { quota: true, resetAfterMs: r.resetAfterMs });
      }
      if (!r?.ok) { log(`❌ ${item.id} 그림 ${i + 1} 을 못 만들었다 — 이 편은 거른다(빈 화면으로 내지 않는다)`); return false; }
      log(`  그림 ${i + 1} ${r.width}x${r.height} 밝기 ${r.yavg.toFixed(0)} · ${r.seconds}초`);
    }
    scenes[i].media = f;
  }

  // ── 음성 ── make-shorts 3절과 같다(멜로 + 숫자·약어 한글화 + 귀검증)
  const out = synthesizeKoreanAuto(scenes.map((s) => s.say), { outPrefix: `${WORK}/q`, log });
  scenes.forEach((s, i) => { s.audio = out[i].path; s.alignment = out[i].alignment; s.dur = out[i].durationSec; });
  const { assertNoVoBurst } = await import('../lib/vo-burst.mjs');
  const bad = assertNoVoBurst(scenes.map((s) => ({ path: s.audio, alignment: s.alignment })));
  if (bad.length) { log(`❌ ${item.id} 대사 잡음 관문: ${bad.map((b) => b.path.split('/').pop()).join(', ')}`); return false; }
  const totalSec = scenes.reduce((n, s) => n + s.dur, 0);
  log(`  음성 ${totalSec.toFixed(1)}초 (${scenes.map((s) => s.dur.toFixed(1)).join('·')})`);

  // ── 캡션 오버레이 ── make-shorts 5절과 같은 값(12자·2줄·4초)
  let thumbMeta = null;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: G.W, height: G.H } });
    for (let i = 0; i < scenes.length; i++) {
      const cues = fillGaps(cuesFromAlignment(scenes[i].alignment, { maxChars: 12, maxLines: 2, maxDur: 4.0 }), 1.2);
      scenes[i].cues = cues.length ? cues : [{ start: 0, end: scenes[i].dur, text: scenes[i].say.slice(0, 24) }];
      scenes[i].ov = [];
      for (let k = 0; k < scenes[i].cues.length; k++) {
        await page.setContent(shortsOverlayHtml({ hook: scenes[i].hook, caption: scenes[i].cues[k].text }));
        const f = `${WORK}/ov${i}_${k}.png`;
        await page.screenshot({ path: f, omitBackground: true });
        scenes[i].ov.push(f);
      }
    }
    // 세로 썸네일 — 첫 그림 + 제목(make-shorts 와 같은 꼴, lib/shorts-thumb). 제목은 lib/evergreen-check 가 38자 안으로 묶었다.
    //   배경을 남긴다 — 썸네일 관문(video-publish)이 같은 그림에 고친 글로 다시 굽는다.
    const head = cutHead(item.title);
    thumbMeta = { head, source: item.title };
    copyFileSync(scenes[0].media, `${WORK}/${THUMB_BG}`);
    await page.setViewportSize({ width: 1080, height: 1920 });
    await page.setContent(shortsThumbHtml({ dataUrl: dataUrlOf(scenes[0].media), head }));
    await page.screenshot({ path: `${WORK}/thumb.png` });
  } finally { await browser.close(); }

  // ── 장면 합성 ── make-shorts 6절과 같다(정지 그림 + 큐 오버레이 + 소리)
  const parts = [];
  for (let i = 0; i < scenes.length; i++) {
    const { dur, cues } = scenes[i];
    let chain = mediaFilter('0:v', 'v0', { motion: false });
    cues.forEach((c, k) => {
      const from = Math.max(0, c.start).toFixed(2);
      const to = Math.min(dur, k === cues.length - 1 ? dur : c.end).toFixed(2);
      chain += `;[v${k}][${k + 1}:v]overlay=0:0:enable='between(t,${from},${to})'[v${k + 1}]`;
    });
    const part = `${WORK}/p${i}.mp4`;
    const r = spawnSync(ffmpegPath, ['-v', 'error', '-loop', '1', '-t', String(dur), '-i', scenes[i].media,
      ...scenes[i].ov.flatMap((f) => ['-i', f]), '-i', scenes[i].audio,
      '-filter_complex', chain, '-map', `[v${cues.length}]`, '-map', `${1 + scenes[i].ov.length}:a`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', ...audioArgs(), '-r', String(G.FPS), '-t', String(dur), '-y', part],
      ffmpegOpts({ stdio: ['ignore', 'ignore', 'pipe'] }));
    if (r.status !== 0) { log(`❌ ${item.id} 장면 ${i + 1} 합성 실패: ${String(r.stderr).slice(0, 200)}`); return false; }
    parts.push(part);
  }
  // 끝 카드 — 이 풀은 사이트(flowvium.net) 카드로 고정. 설명 영상 다음에 '전체 분석' 으로 이어진다.
  const pick = (await import('../lib/promo-card.mjs')).promoPath('flowvium', ROOT);
  if (pick.path && existsSync(pick.path)) parts.push(pick.path);
  const OUT = `${WORK}/shorts-ko.mp4`;
  writeFileSync(`${WORK}/list.txt`, parts.map((p) => `file '${p}'`).join('\n'));
  // 소리 규격이 어긋나도 copy 이어붙이기는 exit 0 이다(make-shorts 2026-09-14) — 처음부터 소리만 다시 인코딩한다.
  const cat = spawnSync(ffmpegPath, ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', `${WORK}/list.txt`, '-c:v', 'copy', ...audioArgs(), '-y', OUT],
    ffmpegOpts({ stdio: ['ignore', 'ignore', 'pipe'] }));
  if (cat.status !== 0) { log(`❌ ${item.id} 이어붙이기 실패: ${String(cat.stderr).slice(0, 200)}`); return false; }

  // 배경음 — make-shorts 와 같은 규칙(출처 있는 곡만, 내레이션보다 20dB 아래). 곡은 id 로 고른다(편마다 고정).
  const bgmDir = resolve(ROOT, 'assets/bgm');
  const { beds } = licensedBeds(bgmDir);
  if (beds.length) {
    const bed = beds[[...item.id].reduce((n, c) => n + c.charCodeAt(0), 0) % beds.length];
    const r = mixBgm({ input: OUT, bed: join(bgmDir, bed), output: `${WORK}/with-bgm.mp4`, workDir: WORK });
    if (r.ok) copyFileSync(`${WORK}/with-bgm.mp4`, OUT);
    log(r.ok ? `  음악 ${bed} (${r.gap.toFixed(1)}dB 아래)` : `  ⚠ 배경음 없이: ${r.reason}`);
  }
  {
    const target = Number(process.env.SHORTS_LUFS ?? -14);
    const r = normalizeLoudness(OUT, `${WORK}/final-loud.mp4`, target, { extraOut: ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', ...audioArgs()] });
    const after = r.ok ? measureLoudness(['-i', `${WORK}/final-loud.mp4`]) : null;
    if (r.ok && after && Math.abs(after.I - target) <= 1.5) { copyFileSync(`${WORK}/final-loud.mp4`, OUT); log(`  음량 ${after.I.toFixed(1)} LUFS`); }
    else log(`  ⚠ 음량 맞추기 실패 — 원래 크기: ${r.reason ?? after?.I}`);
  }
  spawnSync(ffmpegPath, ['-v', 'error', '-y', '-i', `${WORK}/thumb.png`, '-q:v', '3', `${WORK}/shorts-ko-thumb.jpg`], ffmpegOpts({ timeoutMs: 30000 }));

  // ── 메타 ── video-publish 가 읽는다. 뉴스 설명·태그(#속보·출처 표기)를 붙이지 않게 제목·설명·태그를 여기서 정한다.
  const desc = [
    item.title, '',
    ...item.scenes.map((s) => s.say), '',
    '그림은 AI로 만든 일러스트입니다. 특정 종목의 매수·매도를 권하는 내용이 아닙니다.', '',
    '#주식공부 #주식상식 #경제상식 #재테크 #Flowvium',
  ].join('\n');
  const meta = {
    evergreen: true, id: item.id, title: item.title, description: desc,
    tags: ['주식공부', '주식상식', '경제상식', '재테크', '주식 기초', 'Flowvium', ...item.title.split(/[\s,?]+/).filter((w) => w.length >= 2).slice(0, 4)],
    headlines: [item.title], hooks: scenes.map((s) => s.hook), bodies: [scenes.map((s) => s.say).join(' ')],
    keyword: `${KEY_PREFIX}${item.id}`, topic: '주식 상식', brief: false, synthetic: false, subCta: false,
    thumb: thumbMeta,   // 썸네일 글·원문 — 썸네일 관문(video-publish)
    promo: pick.path ? 'flowvium' : null, explore: false, layout: LAYOUT, opener: null, motion: 'still', trend: false,
    seconds: Number(totalSec.toFixed(1)), createdAt: new Date().toISOString(),
  };
  writeFileSync(`${WORK}/shorts-ko-meta.json`, JSON.stringify(meta, null, 2));

  // 풀에 넣는다 — 다 만든 뒤 한 번에 옮긴다(반쯤 쓴 폴더를 발행이 집지 않게).
  const dest = join(POOL, item.id);
  const stage = `${dest}.part`;
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const f of ['shorts-ko.mp4', 'shorts-ko-thumb.jpg', 'shorts-ko-meta.json', THUMB_BG]) if (existsSync(join(WORK, f))) copyFileSync(join(WORK, f), join(stage, f));
  rmSync(dest, { recursive: true, force: true });
  renameSync(stage, dest);
  rmSync(WORK, { recursive: true, force: true });
  log(`✅ ${item.id} → ${dest} · ${totalSec.toFixed(1)}초 + 끝 카드`);
  return true;
}

mkdirSync(POOL, { recursive: true });
// 대장을 못 읽으면 멈춘다 — '나간 것 없음'으로 넘기면 이미 올린 설명을 또 만든다.
const done = publishedIds(await import('../lib/db.mjs'));
const inPool = new Set(listSpares(POOL).filter((s) => !s.dir.endsWith('.part')).map((s) => s.meta.id));
const ID = arg('--id', null);
const FILL = Number(arg('--fill', 0));
if (ID) {
  const item = DATA.items.find((x) => x.id === ID);
  if (!item) { console.error(`없는 id: ${ID}`); process.exit(2); }
  if (done.has(ID) && !argv.includes('--force')) { log(`${ID} 는 이미 나갔다 — 다시 만들지 않는다(--force)`); process.exit(0); }
  process.exit((await render(item)) ? 0 : 1);
}
if (FILL > 0) {
  // 한 번에 하나만 — 10/28 오전 크론 따라잡기(재기동마다)·매시 실행·손 실행이 겹쳐 네다섯 개가 같은 그림 할당량을 나눠 쓰고
  //   같은 작업 폴더(tmp/flowvium-evergreen/<id>)를 함께 썼다. 앞 실행이 돌고 있으면 이번 것은 그냥 끝난다.
  const lk = await (await import('../lib/run-lock.mjs')).acquireRunLock(resolve(ROOT, 'logs/evergreen-fill.lock'), { label: 'evergreen-fill' });
  if (!lk.ok) process.exit(0);
  try {
    const { resetAt } = JSON.parse(readFileSync(RESET_FILE, 'utf8'));
    if (Date.now() < Date.parse(resetAt) && inPool.size < FILL) process.exit(0);   // 리셋 전 — 조용히(매시 돈다)
  } catch { /* 기록 없음 = 막힌 적 없음 */ }
  let have = inPool.size;
  log(`풀 ${have}편 · 목표 ${FILL}편 · 이미 나간 주제 ${done.size}개`);
  for (const item of DATA.items) {
    if (have >= FILL) break;
    if (inPool.has(item.id) || done.has(item.id)) continue;
    // 보고서 중엔 무거운 일을 하지 않는다(그림·음성·합성) — 끝날 때까지 기다리고, 2시간 넘으면 다음 실행에 맡긴다.
    for (let w = 0; await isReportPipelineRunning().catch(() => false); w++) {
      if (w >= 24) { log('보고서가 2시간 넘게 돈다 — 여기서 멈추고 다음 실행에 맡긴다'); process.exit(0); }
      if (w === 0) log('보고서 생성 중 — 끝날 때까지 기다린다');
      await new Promise((r) => setTimeout(r, 300_000));
    }
    try { if (await render(item)) have++; }
    catch (e) {
      if (!e.quota) throw e;
      // 다음에 그림을 부를 시각을 남긴다 — 매시 도는 채우기가 그 전엔 그림을 부르지 않는다.
      //   10/28 Mac mini2 합의: 창(약 12장)을 번갈아 쓴다 — 이쪽 다음 리셋 창은 まちのナゼ(실제 예비 부족) 몫이라
      //   **리셋 + 한 창(EVERGREEN_YIELD_H, 기본 3시간)** 뒤에 다시 잡는다. 리셋 시각을 모르면 1시간 + 한 창.
      const yieldMs = Number(process.env.EVERGREEN_YIELD_H ?? 3) * 3600e3;
      const at = new Date(Date.now() + (e.resetAfterMs ?? 3600e3) + yieldMs + 60e3).toISOString();
      writeFileSync(RESET_FILE, JSON.stringify({ resetAt: at, reason: e.message }));
      log(`그림 할당량 소진 — 여기서 멈춘다(${e.message}). ${at.slice(11, 16)}Z 뒤 첫 실행이 이어서 채운다`);
      break;
    }
  }
  const left = DATA.items.filter((x) => !done.has(x.id) && !existsSync(join(POOL, x.id))).length;   // 아직 안 만든 대본
  log(`풀 ${have}편${have >= FILL ? '' : left ? ` — 목표보다 ${FILL - have}편 모자란다(안 만든 대본 ${left}편 — 다음 실행이 이어서)` : ` — 목표보다 ${FILL - have}편 모자란다(대본이 바닥났다: data/evergreen-shorts.json 에 더 써야 한다)`}`);
  process.exit(0);
}
console.error('사용: --id <id> | --fill <편수>');
process.exit(2);

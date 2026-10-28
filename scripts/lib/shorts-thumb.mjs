/**
 * shorts-thumb.mjs — 쇼츠 세로 썸네일(1080×1920) 그리기. make-shorts·make-evergreen-short·video-publish(썸네일 관문)가 같이 쓴다.
 *
 * 2026-10-28 썸네일 관문(lib/thumb-gate): 제목은 video-publish 가 정하므로 채점·고쳐 굽기도 거기서 한다 —
 *   그러려면 같은 꼴을 다시 그릴 수 있어야 해서 make-shorts 안에 있던 꼴을 여기로 옮겼다.
 *   배경 사진은 렌더가 shorts-ko-thumb-bg.jpg 로 같이 남긴다(THUMB_BG). 없는 그림을 새로 만들지 않는다 — 그 회차가 실제로 쓴 사진.
 * 꼴의 역사(make-shorts 머리말에서 옮김):
 *   · 그림은 데이터로 박는다 — setContent 문서는 about:blank 라 file:// 이 막힌다(9/18 새까만 썸네일).
 *   · 한글을 음절마다 끊지 않는다 — 10/20 '논란 / 에…'(shorts-thumb-wrap.test 가 아래 .h 규칙을 그대로 떼어 잰다).
 *   · 제목은 낱말 경계에서 자른다 — 글자 수로 뚝 자르면 "한화시스템 UA" 가 나온다.
 */
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from './project-root.mjs';

export const THUMB_BG = 'shorts-ko-thumb-bg.jpg';

/** 썸네일 글 — [속보] 같은 말머리를 빼고, 24자를 넘으면 낱말 경계에서 자르고 말줄임표. */
export function cutHead(raw, max = 24) {
  let head = String(raw ?? '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim();
  if (head.length > max) {
    const cut = head.slice(0, max + 1);
    const sp = cut.lastIndexOf(' ');
    head = `${(sp > 10 ? cut.slice(0, sp) : cut.slice(0, max)).replace(/[,·…]$/, '')}…`;
  }
  return head;
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function shortsThumbHtml({ dataUrl, head }) {
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1920px;overflow:hidden;background:#05070f;
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif}
.bg{position:absolute;inset:0;background:url('${dataUrl}') center/cover no-repeat}
/* 위아래를 어둡게 깔아 글자가 뜨게 한다. 가운데(얼굴·현장)는 남긴다. */
.sh{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.86) 0%,rgba(0,0,0,.25) 34%,
  rgba(0,0,0,.20) 62%,rgba(0,0,0,.88) 100%)}
.h{position:absolute;left:54px;right:54px;top:130px;font-size:118px;font-weight:900;line-height:1.16;
  color:#ffd400;-webkit-text-stroke:14px #0a0a0a;paint-order:stroke fill;letter-spacing:-.01em;
  /* 한글을 음절마다 끊지 않는다 — 10/20 '논란 / 에…' '전공자 / 라…'(shorts-thumb-wrap.test). 한 낱말이 폭을 넘을 때만 자른다. */
  word-break:keep-all;overflow-wrap:anywhere}
.m{position:absolute;left:0;right:0;bottom:120px;text-align:center;font-size:44px;font-weight:900;
  color:#fff;letter-spacing:.3em;text-indent:.3em;opacity:.92;-webkit-text-stroke:6px #0a0a0a;paint-order:stroke fill}
</style><div class="bg"></div><div class="sh"></div>
<div class="h">${esc(head)}</div>
<div class="m">FLOWVIUM</div>`;
}

export function dataUrlOf(file) {
  const ext = (String(file).match(/\.(\w+)$/) || [])[1]?.toLowerCase() ?? 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

/** 배경 + 글 → out(.jpg 면 jpeg 90, 아니면 png). page 를 주면 그걸 쓰고, 없으면 크롬을 띄웠다 닫는다. */
export async function renderShortsThumb({ bg, head, out, page = null }) {
  let browser = null;
  if (!page) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  } else await page.setViewportSize({ width: 1080, height: 1920 });
  try {
    await page.setContent(shortsThumbHtml({ dataUrl: dataUrlOf(bg), head }));
    await page.screenshot(/\.jpe?g$/i.test(out) ? { path: out, type: 'jpeg', quality: 90 } : { path: out });
    return out;
  } finally { await browser?.close(); }
}

/**
 * 쇼츠 썸네일 관문(lib/thumb-gate) — video-publish 가 업로드 직전에 부른다(제목이 거기서 정해진다).
 *   배경(shorts-<locale>-thumb-bg.jpg)과 메타의 썸네일 글이 있어야 고쳐 굽는다. 없으면(옛 예비) 채점만.
 *   고른 판을 원래 썸네일 자리에 덮어 업로드·보관이 그 판을 쓰게 하고, 고쳐 구운 중간 판은 지운다.
 * @returns {Promise<object|null>} gateSummary + rounds(로그용). 썸네일이 없으면 null.
 */
export async function gateShortsThumb({ thumb, srcDir, locale = 'ko', meta = {}, title, log = () => {}, gateOpts = {} }) {
  const { existsSync: ex, copyFileSync: cp, rmSync: rm } = await import('node:fs');
  const { join } = await import('node:path');
  const { runThumbGate, gateSummary, agyJudge, claudeJudge } = await import('./thumb-gate.mjs');
  if (!thumb || !ex(thumb)) return null;
  const bg = join(srcDir, THUMB_BG.replace('shorts-ko', `shorts-${locale}`));
  const head = meta.thumb?.head ?? null;
  const canFix = !!head && ex(bg);
  if (!canFix) log(`[썸네일 관문] 다시 그릴 재료 없음(${head ? '배경' : '썸네일 글'}) — 채점만`);
  const made = [];
  const g = await runThumbGate({
    image: thumb, text: head ?? '(썸네일 글 모름)', title: String(title).replace(/\s*#Shorts\b/i, '').trim(), kind: 'shorts', maxChars: 24,
    source: [meta.thumb?.source, ...(meta.headlines ?? []), title].filter(Boolean).join(' '),
    textRule: '3~6낱말·24자 안, 큰 노란 글씨 한두 줄',
    rerender: canFix ? async (t) => { const out = join(srcDir, `shorts-${locale}-thumb-g${made.length + 1}.jpg`); made.push(out); return renderShortsThumb({ bg, head: t, out }); } : async () => null,
    // 맞춤 썸네일은 막지 않는 두 번째 확인이라 ChatGPT 를 쓰지 않는다(10/28 Mac mini3 — 대기열 첨부 한도를 FlowVium 이 다 썼다).
    judges: { agy: agyJudge, claude: claudeJudge }, need: ['agy', 'claude'],
    log, ...gateOpts,
  });
  if (g.image !== thumb) cp(g.image, thumb);
  for (const f of made) rm(f, { force: true });
  return { ...gateSummary(g), log: g.rounds.map((r) => ({ text: r.text, scores: r.scores, ms: r.ms })) };
}

/**
 * 쇼츠 첫 화면 관문 — 10/28 저녁 Mac mini2(사장님 최종 기준): 쇼츠 피드는 **영상 첫 화면**(i.ytimg oar2, 세로)을 보여 주고
 *   우리가 올리는 맞춤 썸네일은 가로 자리(검색·채널, maxresdefault)에만 쓰인다(10/28 iRwCmpkvBTg 등 실측).
 *   그래서 막는 관문은 0.5초 화면이고, 맞춤 썸네일은 두 번째 확인(기록만, 막지 않음)이다.
 *   첫 화면은 여기서 고쳐 구울 수 없다(영상 장면) — 한 판 매기고 끝. 상식 편은 채우기가 첫 장면 그림을 다시 그려 다시 굽는다.
 *   기준 그림: 우리 쇼츠 중 실제로 잘 된 첫 화면(8.5)·안 된 첫 화면(5) — assets/thumb-anchors(10/28 조회수 48~96h 기준 위·아래 10%).
 */
export const SHORTS_ANCHORS = { high: resolve(ROOT, 'assets/thumb-anchors/shorts-high.jpg'), low: resolve(ROOT, 'assets/thumb-anchors/shorts-low.jpg') };

export async function openingFrame(video, dest, at = 0.5) {
  const ffmpeg = (await import('ffmpeg-static')).default;
  const ran = spawnSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', video, '-frames:v', '1', '-q:v', '3', dest], { timeout: 30000 });
  return ran.status === 0 && existsSync(dest) ? dest : null;
}

export async function gateShortsOpening({ video, title, meta = {}, log = () => {}, gateOpts = {} }) {
  const { runThumbGate, gateSummary } = await import('./thumb-gate.mjs');
  const out = String(video).replace(/\.mp4$/i, '-open.jpg');
  if (!(await openingFrame(video, out))) return { passed: false, flagged: '첫 화면을 못 뗐다' };
  try {
    const anchors = existsSync(SHORTS_ANCHORS.high) && existsSync(SHORTS_ANCHORS.low) ? SHORTS_ANCHORS : null;
    const g = await runThumbGate({ image: out, text: String(meta.hooks?.[0] ?? ''), title: String(title).replace(/\s*#Shorts\b/i, '').trim(),
      kind: 'shorts-open', source: '', maxFixes: 0, anchors, rerender: async () => null, lazy: ['chatgpt'],   // ChatGPT 는 agy·Claude 가 7 이상일 때만(대기열 첨부 한도)
      textRule: '첫 화면 위쪽 큰 글(훅) 3~6낱말', log: (m) => log(m.replace('[썸네일 관문]', '[첫 화면 관문]')), ...gateOpts });
    return { ...gateSummary(g), log: g.rounds.map((r) => ({ text: r.text, scores: r.scores, ms: r.ms })) };
  } finally { rmSync(out, { force: true }); }
}

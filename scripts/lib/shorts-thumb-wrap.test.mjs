#!/usr/bin/env node
/**
 * shorts-thumb-wrap.test.mjs — 쇼츠 세로 썸네일 제목이 낱말 한가운데서 줄바꿈되지 않는가. 2026-10-20 신설.
 *
 * 10/20 14:10 쇼츠(qhZwjB8KB5Q) 썸네일 실물: "'친일파 글씨' 논란 / 에…유홍준 "전공자 / 라…" — '논란에' '전공자라' 가 쪼개졌다.
 *   원인: make-shorts 의 썸네일 .h 규칙에 word-break 가 없다. 크롬 기본은 한글을 **음절마다** 끊을 수 있어
 *   폭이 차는 자리에서 낱말 중간을 자른다. 자막 띠는 wrapLines 가 미리 접어(pre-line) 이 문제가 없었다.
 * 잰다: make-shorts 의 실제 .h 규칙을 그대로 떼어 크롬에 그리고, 줄이 바뀌는 자리마다 앞 글자가 공백·말줄임표·문장부호인지.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
const rule = /\n\.h\{[^}]*\}/.exec(src)?.[0];
if (!rule) { bad('[0] make-shorts 에서 썸네일 .h 규칙을 못 찾았다'); process.exit(1); }

const { chromium } = await import('playwright');
// 크롬이 없는 곳(CI 깨끗한 clone — 브라우저를 안 깐다)에서는 잴 수 없다 → 전제조건 스킵(test-env). 10/20 CI 가 여기서 죽었다.
const { requires } = await import('./test-env.mjs');
await requires({ paths: [chromium.executablePath()] });
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  const heads = ['\'친일파 글씨\' 논란에…유홍준 "전공자라…', '민주당 경기도당 긴급회의, 추미애 \'재정…',
    '해루질 사고로 연평균 17명 사망…"해경…', 'SK하이닉스, 정부·금융권과 반도체 소부장…'];
  const bad0 = [];
  for (const h of heads) {
    await p.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1920px;font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif}${rule}</style>
<div class="h">${h.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`);
    // 글자마다 줄(top)을 재서, 줄이 바뀌는 자리의 앞 글자를 본다.
    const breaks = await p.evaluate(() => {
      const n = document.querySelector('.h').firstChild; const t = n.textContent; const out = []; let prevTop = null;
      for (let i = 0; i < t.length; i++) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
        const rect = [...r.getClientRects()].find((x) => x.width > 0); if (!rect) continue;
        if (prevTop != null && rect.top > prevTop + 20) out.push({ before: t[i - 1], at: t[i], i });
        prevTop = rect.top;
      }
      return out;
    });
    for (const k of breaks) if (!/[\s…,·'"」)]/.test(k.before)) bad0.push(`${h} — "${k.before}|${k.at}"`);
  }
  bad0.length === 0 ? ok(`[1] 썸네일 제목 ${heads.length}개 — 줄바꿈은 낱말 경계에서만`) : bad(`[1] 낱말 중간 줄바꿈: ${JSON.stringify(bad0)}`);
} finally { await b.close(); }
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

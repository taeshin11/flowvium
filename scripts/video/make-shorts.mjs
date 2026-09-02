#!/usr/bin/env node
/**
 * make-shorts.mjs — 세로(9:16) 쇼츠 한 편을 만든다.
 *
 * 왜 make-issue-video 와 나눴나 (2026-09-03, 사용자가 참고 쇼츠를 보여주며 "그렇게 해"):
 *   기존 렌더러는 1920×1080 가로 뉴스 패키지다 — 하단 자막 띠 하나, 화면 전체를 소재가 채운다.
 *   쇼츠는 기하가 통째로 다르다(위 훅 띠 / 가운데 소재 / 아래 캡션 띠). 가로 쪽에 분기를 심으면
 *   양쪽이 다 복잡해지고, 같은 세션에 방금 고친 것들(컷 배분·문장 분할·소재 적합도)을 흔든다.
 *   **라이브러리는 공유하고 합성만 나눈다** — 소재 검색·자막 분할·인용·업로드 메타는 그대로 쓴다.
 *
 * 구성(참고 화면 그대로):
 *     검은 띠  훅 2줄 — 1줄 흰색 / 2줄 노랑
 *     소재     레터박스(자르지 않는다). 우하단 「출처- …」
 *     검은 띠  캡션 — 형광 연두. 말하는 문장이 실시간으로 바뀐다.
 *
 * 사용:
 *   node scripts/video/make-shorts.mjs                 # 이슈 자동 선택
 *   node scripts/video/make-shorts.mjs --seconds 45
 *   node scripts/video/make-shorts.mjs --dry           # 대본·소재만 확인, 렌더 안 함
 */
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ROOT } from '../lib/project-root.mjs';
import { loadEnvLocal } from '../lib/llm-config.mjs';
import { topDistinctIssues } from '../lib/issue-cluster.mjs';
import { bestQuote } from '../lib/quote-card.mjs';
import { searchTerms, searchCommons, searchOpenverse, searchPexelsVideo, pickFootageMany, creditLine, titleRelevant } from '../lib/footage.mjs';
import { cuesFromAlignment, fillGaps } from '../lib/subtitle.mjs';
import { synthesizeKorean, koTtsReady } from '../lib/tts-korean.mjs';
import { SHORTS as G, shortsOverlayHtml, mediaFilter } from '../lib/shorts-layout.mjs';
import { resolveMediaRoot } from '../lib/media-root.mjs';

loadEnvLocal();
const argv = process.argv.slice(2);
const arg = (f, d) => {
  const eq = argv.find((a) => a.startsWith(`--${f}=`));
  if (eq) return eq.slice(f.length + 3);
  const i = argv.indexOf(`--${f}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const DRY = argv.includes('--dry');
const TARGET_SEC = Number(arg('seconds', 45));
const WORK = join(tmpdir(), 'flowvium-shorts');
mkdirSync(WORK, { recursive: true });
const log = (...a) => console.log(' ', ...a);

// ── 0. 준비 확인 — 조용히 영어 음성으로 떨어지면 안 된다 ────────────────────────
{
  const r = koTtsReady();
  if (!r.ok) { console.error(`❌ 한국어 TTS 준비 안 됨 — ${r.reason}`); process.exit(1); }
}

// ── 1. 소재가 될 이슈 하나 ──────────────────────────────────────────────────────
// 쇼츠는 한 편에 한 주제다. 여러 이슈를 담으면 45초 안에 아무것도 전달 못 한다.
const SRC = ['연합뉴스 정치', '연합뉴스 사회', '연합뉴스 국제', '연합뉴스 경제',
  '한국경제 정치', '한국경제 사회', '한국경제', '머니투데이',
  'Yahoo Finance', 'MarketWatch', 'CBS 톱뉴스', 'Politico 정치'];
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
const rows = db.prepare(
  `SELECT source, headline, summary, link FROM news_archive
   WHERE source IN (${SRC.map(() => '?').join(',')})
     AND datetime(captured_at) >= datetime('now','-24 hours')`,
).all(...SRC);
db.close();
if (!rows.length) { console.error('❌ 최근 24시간 기사가 없다'); process.exit(1); }

const stripHtml = (t) => String(t ?? '').replace(/<[^>]*>/g, ' ')
  .replace(/&(nbsp|#160);/g, ' ').replace(/&(quot|#34);/g, '"').replace(/&(amp|#38);/g, '&')
  .replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();

const issues = topDistinctIssues(rows, 8);
if (!issues.length) { console.error('❌ 이슈를 못 묶었다'); process.exit(1); }
// 매체가 많이 다룬 것 = 그날 실제로 큰 뉴스다. 그중 첫 번째를 쓴다.
const issue = issues[0];
const headlines = issue.headlines ?? [];
const texts = [...headlines, ...(issue.items ?? []).map((i) => stripHtml(i.summary)).filter(Boolean)];
const quote = bestQuote(texts);
log(`[이슈] "${issue.keyword}" · 매체 ${issue.sourceCount} · 기사 ${headlines.length}`);
log(`[헤드라인] ${headlines[0]?.slice(0, 60) ?? ''}`);
if (quote) log(`[인용] "${quote.text.slice(0, 40)}…" — ${quote.speaker ?? '?'}`);

// ── 2. 대본 — 짧고 훅이 강해야 한다 ─────────────────────────────────────────────
const { resolveLlm } = await import('../lib/llm-config.mjs');
const llm = { url: process.env.VIDEO_LLM_URL ?? resolveLlm('web').url, model: process.env.VIDEO_LLM_MODEL ?? 'mlx-community/Qwen3.5-4B-4bit' };
// 한국어는 초당 약 6.7자로 읽힌다(Piper 실측: 47자 / 7.0초).
const CPS = 6.7;
const budget = Math.round(TARGET_SEC * CPS);
const SCENES = 4;

const prompt = `너는 한국 뉴스 쇼츠 대본 작가다. 아래 헤드라인만 근거로 ${TARGET_SEC}초 세로 쇼츠 대본을 쓴다.

${texts.slice(0, 12).map((t) => `- ${t.slice(0, 160)}`).join('\n')}
${quote ? `\n(대표 발언: "${quote.text}"${quote.speaker ? ` — ${quote.speaker}` : ''})` : ''}

규칙:
- 오직 위 헤드라인에 있는 사실만 쓴다. 없는 숫자·인용·배경을 만들지 마라.
- **1번 장면이 훅이다.** 첫 세 어절에 가장 강한 사실을 박아라. "오늘은", "이번 소식은" 금지.
- **반드시 '-습니다/-입니다' 존댓말(합쇼체)로 쓴다.** 반말·해체 금지 —
  "예고했어", "나왔어", "한다" 같은 말투는 뉴스가 아니다. "예고했습니다", "나왔습니다".
- 아나운서가 읽는 문장. 짧게 끊어 읽되 어미는 존댓말을 지킨다.
- 숫자는 한글로 풀어 쓴다(TTS 오독 방지). 예: 17 billion → 백칠십억
- 한국이 잘한 이야기면 대놓고 자랑하라. "이게 대한민국입니다", "또 해냈습니다" 같은 말을 써도 좋다.
  단 **헤드라인에 있는 사실로만** — 없는 순위·기록·반응을 지어내면 거짓말이다.
- hook: 화면 위에 크게 박을 문구. **12자 이내**, 명사로 끝내라. 예: "삼성 세계 1위 탈환"
- visual: 그 장면 배경으로 찾을 검색어. **영어 2~3단어**.
  · 헤드라인에 나오는 **고유명사**를 우선 써라 — 회사·기관·도시 이름. 그게 제일 잘 맞는다.
    좋음: "Samsung Electronics", "Seoul National Assembly", "semiconductor wafer fab"
  · 막연한 일반어는 엉뚱한 사진을 부른다. 실측: "factory investment" 로 미국 아울렛 매장이 걸렸다.
    나쁨: "factory investment", "cluster designation", "hybrid material"
  · 검색어가 안 맞으면 그 장면은 그래픽 카드로 나간다 — 틀린 사진보다는 낫지만 밋밋하다.
- JSON 배열만 출력: [{"hook":"화면 문구(12자 이내)","say":"읽을 문장(${Math.round(budget / SCENES * 0.8)}~${Math.round(budget / SCENES * 1.2)}자)","visual":"english words"}]
- 장면 ${SCENES}개. 총 ${budget}자 안팎.`;

async function askLLM() {
  const r = await fetch(`${llm.url}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: llm.model, messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000, temperature: 0.5, chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
  const txt = (await r.json())?.choices?.[0]?.message?.content ?? '';
  const m = String(txt).match(/\[[\s\S]*\]/);
  if (!m) throw new Error(`JSON 없음 (${txt.length}자, 끝: …${txt.slice(-80)})`);
  return JSON.parse(m[0]).filter((x) => x?.say && x?.hook).slice(0, SCENES);
}

let scenes = [];
// 파싱 실패는 재시도로 다룬다 — 4B 가 가끔 내는 품질 문제이고, 한 번 깨졌다고 편을 버릴 이유가 없다.
for (let a = 1; a <= 3; a++) {
  try { scenes = await askLLM(); if (scenes.length >= 2) break; log(`[대본] 시도 ${a}: 장면 ${scenes.length}개 — 부족`); }
  catch (e) { log(`[대본] 시도 ${a}: ${e.message.slice(0, 100)}`); }
}
if (scenes.length < 2) { console.error('❌ 3회 시도해도 대본을 못 만들었다'); process.exit(1); }
log(`[대본] 장면 ${scenes.length}개 · ${scenes.reduce((n, s) => n + s.say.length, 0)}자`);
for (const s of scenes) log(`   · [${s.hook}] ${s.say.slice(0, 42)}…`);
if (DRY) { log('--dry — 여기까지'); process.exit(0); }

// ── 3. 음성 ─────────────────────────────────────────────────────────────────────
for (let i = 0; i < scenes.length; i++) {
  const r = synthesizeKorean(scenes[i].say, { outPath: `${WORK}/s${i}.wav` });
  scenes[i].audio = r.path;
  scenes[i].alignment = r.alignment;
  scenes[i].dur = r.durationSec;
  if (r.note) log(`  ⚠ ${i + 1} ${r.note}`);
  log(`[음성] ${i + 1} ${r.durationSec.toFixed(1)}초`);
}
const totalSec = scenes.reduce((n, s) => n + s.dur, 0);
log(`[음성] 합계 ${totalSec.toFixed(1)}초`);

// ── 4. 소재 ─────────────────────────────────────────────────────────────────────
const MAX_DL = 60 * 1024 * 1024;
async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FlowVium-shorts/1.0 (https://flowvium.net)' }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_DL) throw new Error(`너무 큼 ${(buf.length / 1048576).toFixed(0)}MB`);
  writeFileSync(dest, buf);
  return dest;
}

for (let i = 0; i < scenes.length; i++) {
  const terms = searchTerms({ visual: scenes[i].visual }, { max: 3 });
  let cands = [];
  for (const fn of [searchCommons, searchOpenverse, searchPexelsVideo]) {
    try { cands = cands.concat(await fn(terms, { limit: 10 })); } catch { /* 한 소스가 죽어도 나머지로 */ }
    // pickFootage 는 관련 결과가 없으면 **무관한 것으로 되돌린다**("틀린 사진이라도 회색 카드보다 낫다").
    //   가로 편에서는 57컷 중 한 장이라 그 판단이 맞다. 쇼츠는 컷이 4개뿐이고 한 장이 화면을
    //   통째로 6초간 차지한다 — 실측: "반도체 초호황" 장면에 미국 아울렛 매장이 깔렸다.
    //   그래서 여기서는 되돌리지 않는다. 무관한 그림보다 그라디언트 카드가 낫다.
    // titleRelevant(전체 일치)만으로는 부족하다. 실측: "SK Chairman" 이
    //   "Ilham Aliyev met with Chairman of the SK…" 에 걸려 미 국방장관 사진이 깔렸다 —
    //   낱말이 다 있어도 **흩어져 있으면 다른 뜻**이다.
    //   쇼츠는 컷이 4개라 한 장이 화면을 통째로 차지하므로, 낱말이 **붙어 있는지**까지 본다.
    const near = (title) => {
      const w = String(title ?? '').toLowerCase().split(/[^a-z0-9\u3131-\uD79D]+/).filter(Boolean);
      const at = terms.map((t) => w.indexOf(String(t).toLowerCase())).filter((x) => x >= 0);
      if (at.length < terms.length) return false;
      return Math.max(...at) - Math.min(...at) <= terms.length + 1;   // 사이에 한 낱말까지 허용
    };
    const relevant = cands.filter((c) => titleRelevant(c.title, terms) && near(c.title));
    const got = pickFootageMany(relevant, 1, { terms, preferFree: true });
    if (got.length) { scenes[i].pick = got[0]; break; }
  }
  if (scenes[i].pick) {
    const ext = /\.mp4(\?|$)/i.test(scenes[i].pick.url) ? 'mp4' : 'jpg';
    try {
      scenes[i].media = await download(scenes[i].pick.url, `${WORK}/m${i}.${ext}`);
      scenes[i].credit = scenes[i].pick.source ? `출처- ${scenes[i].pick.source}` : null;
      log(`[화면] ${i + 1} "${terms.join(' ')}" → ${(scenes[i].pick.title ?? '').slice(0, 40)} [${scenes[i].pick.source}]`);
    } catch (e) { log(`[화면] ${i + 1} 내려받기 실패: ${e.message.slice(0, 50)}`); }
  }
  if (!scenes[i].media) log(`[화면] ${i + 1} 소재 없음 — 카드로 간다`);
}

// ── 5. 오버레이 (장면마다 훅·캡션이 다르다) ─────────────────────────────────────
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: G.W, height: G.H } });
for (let i = 0; i < scenes.length; i++) {
  // 캡션은 그 장면에서 말하는 문장이다. 자막 큐를 쓰면 한 장면 안에서 여러 번 바뀌는데,
  //   쇼츠는 화면이 짧아 그게 오히려 산만하다 — 장면당 한 덩어리로 간다.
  // 캡션 폭 실측: 폰트 76px · 좌우 여백 44px → 가용 992px. 한글은 글자당 약 76px 이라 12자가 한계다.
  //   16자로 뒀더니 "…합니 / 다." 로 넘쳤다(첫 렌더에서 확인).
  const cues = fillGaps(cuesFromAlignment(scenes[i].alignment, { maxChars: 12, maxLines: 2, maxDur: 4.0 }), 1.2);
  // 캡션은 **말을 따라가야 한다.** 종전엔 장면당 첫 큐 하나를 8초 내내 띄웠는데,
  //   그러면 3초 뒤부터 화면 글자와 목소리가 어긋난다(첫 렌더 실측).
  //   큐마다 오버레이를 만들고 아래 합성에서 시간 구간으로 얹는다.
  scenes[i].cues = cues.length ? cues : [{ start: 0, end: scenes[i].dur, text: scenes[i].say.slice(0, 24) }];
  scenes[i].ov = [];
  for (let k = 0; k < scenes[i].cues.length; k++) {
    await page.setContent(shortsOverlayHtml({
      hook: scenes[i].hook,
      caption: scenes[i].cues[k].text,     // 줄바꿈을 지운다 — 라이브러리가 접어 준 대로 쓴다
      credit: scenes[i].credit,
      brand: 'FLOWVIUM',
    }));
    const f = `${WORK}/ov${i}_${k}.png`;
    await page.screenshot({ path: f, omitBackground: true });
    scenes[i].ov.push(f);
  }
}
// 소재가 없는 장면에 깔 카드.
//   **소재 영역 크기(1080×760)로 만든다.** 전체 화면 크기로 만들었더니 아래 합성에서 다시
//   레터박스돼 가운데 작은 어두운 사각형이 됐다(실측). 영역과 같은 크기면 꽉 찬다.
//   그리고 밋밋하지 않게 이슈 키워드를 크게 박는다 — 빈 그라디언트는 "만들다 만" 화면으로 보인다.
await page.setViewportSize({ width: G.W, height: G.media.height });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${G.W}px;height:${G.media.height}px}
body{background:radial-gradient(760px 560px at 50% 45%,#25406e 0%,rgba(0,0,0,0) 66%),
  linear-gradient(140deg,#080d1a,#16224061 55%,#080d1a);
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;
  display:flex;align-items:center;justify-content:center}
.k{font-size:150px;font-weight:900;color:rgba(255,255,255,.14);letter-spacing:-.03em;
  text-align:center;padding:0 60px;line-height:1.1}
</style><div class="k">${String(issue.keyword ?? '').slice(0, 10)}</div>`);
await page.screenshot({ path: `${WORK}/card.png` });
await browser.close();

// ── 6. 합성 ─────────────────────────────────────────────────────────────────────
const MEDIA = resolveMediaRoot({
  configured: process.env.MEDIA_ROOT,
  localFallback: resolve(ROOT, 'reports/video'),
  allowLocal: argv.includes('--local-media'),
});
const OUT = join(MEDIA.root, 'shorts-ko.mp4');
log(`[저장] ${MEDIA.root}`);

// 장면마다 따로 만들고 이어 붙인다 — 한 체인으로 묶으면 필터가 길어져 디버깅이 불가능해진다.
const parts = [];
for (let i = 0; i < scenes.length; i++) {
  const src = scenes[i].media ?? `${WORK}/card.png`;
  const isVid = /\.mp4$/i.test(src);
  const dur = scenes[i].dur;
  const part = `${WORK}/p${i}.mp4`;
  // 큐 오버레이를 시간 구간으로 차례차례 얹는다. enable 로 그 구간에만 보이게 한다.
  const cues = scenes[i].cues;
  const ovInputs = scenes[i].ov.flatMap((f) => ['-i', f]);
  let chain = mediaFilter('0:v', 'v0');
  cues.forEach((c, k) => {
    const from = Math.max(0, c.start).toFixed(2);
    const to = Math.min(dur, k === cues.length - 1 ? dur : c.end).toFixed(2);
    chain += `;[v${k}][${k + 1}:v]overlay=0:0:enable='between(t,${from},${to})'[v${k + 1}]`;
  });
  const audioIdx = 1 + scenes[i].ov.length;
  const a = [
    '-v', 'error',
    ...(isVid ? ['-stream_loop', '-1', '-t', String(dur), '-i', src] : ['-loop', '1', '-t', String(dur), '-i', src]),
    ...ovInputs,
    '-i', scenes[i].audio,
    '-filter_complex', chain,
    '-map', `[v${cues.length}]`, '-map', `${audioIdx}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-r', String(G.FPS), '-t', String(dur), '-y', part,
  ];
  const r = spawnSync(ffmpegPath, a, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    console.error(`❌ 장면 ${i + 1} 렌더 실패:\n${String(r.stderr).slice(0, 400)}`);
    process.exit(1);
  }
  parts.push(part);
  log(`[합성] ${i + 1}/${scenes.length}`);
}

writeFileSync(`${WORK}/list.txt`, parts.map((p) => `file '${p}'`).join('\n'));
const cat = spawnSync(ffmpegPath, ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', `${WORK}/list.txt`,
  '-c', 'copy', '-y', OUT], { stdio: ['ignore', 'ignore', 'pipe'] });
if (cat.status !== 0) { console.error(`❌ 이어붙이기 실패:\n${String(cat.stderr).slice(0, 400)}`); process.exit(1); }

const size = (readFileSync(OUT).length / 1048576).toFixed(1);
console.log(`\n✅ ${OUT}`);
console.log(`   ${totalSec.toFixed(1)}초 · ${size}MB · 장면 ${scenes.length}개 · ${G.W}×${G.H}`);

// 표기 의무. 라이선스가 요구하면 설명란에 넣어야 한다.
const credits = scenes.map((s) => (s.pick ? creditLine(s.pick) : null)).filter(Boolean);
if (credits.length) {
  const cf = join(MEDIA.root, 'shorts-ko-credits.txt');
  writeFileSync(cf, credits.join('\n'));
  console.log(`   ⚠ 표기 의무 ${credits.length}건 → ${cf}`);
}
// 업로드가 쓸 메타. 훅을 제목 후보로 넘긴다.
writeFileSync(join(MEDIA.root, 'shorts-ko-meta.json'), JSON.stringify({
  headlines, hooks: scenes.map((s) => s.hook), keyword: issue.keyword,
  seconds: Number(totalSec.toFixed(1)), createdAt: new Date().toISOString(),
}, null, 2));

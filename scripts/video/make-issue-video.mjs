#!/usr/bin/env node
/**
 * make-issue-video.mjs — 종합 이슈 영상 1편.
 *
 * 파이프라인:
 *   이슈 선정(issue-cluster) → 대본(로컬 LLM) → 앵커 음성 + 글자 타임스탬프(ElevenLabs)
 *   → 배경 화면(로컬 클립 / Pexels 영상 / Commons·Openverse 사진) → 자막(ASS) → ffmpeg 합성
 *
 * 설계 원칙(값비싸게 배운 것들):
 *   · 소재는 **매체 수**로 고른다 — 사람도 LLM 도 아닌 데이터가 정한다(issue-cluster).
 *   · 장면 길이는 **나레이션 실측 길이**로 맞춘다 — 고정 초는 음성과 화면을 어긋나게 한다.
 *   · 자막 시각은 **추정하지 않는다** — ElevenLabs 글자 타임스탬프를 그대로 쓴다(subtitle.mjs).
 *   · 배경은 움직인다 — 정지 카드만 쓰면 "PPT 읽는 것" 이 된다(2026-08-27 지적).
 *   · 배경 라이선스는 코드가 판정한다 — NC·ND·미상은 버린다(footage.mjs). 자동 발행이라
 *     한 편이 재사용 심사에 걸리면 채널 전체가 멈춘다.
 *   · 앵커 음성 ID 는 .env.local — 코드에 박으면 교체 때마다 코드를 고쳐야 한다.
 *   · TTS 무음은 실패로 잡는다(lib/tts.mjs) — 소리 없는 영상이 발행되면 안 된다.
 *
 * 사용: node scripts/video/make-issue-video.mjs --locale en [--seconds 90] [--out <mp4>]
 */
import Database from 'better-sqlite3';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import { resolve } from 'path';
import { ROOT } from '../lib/project-root.mjs';
import { synthesizeWithTimestamps } from '../lib/tts.mjs';
import { topDistinctIssues } from '../lib/issue-cluster.mjs';
import { cuesFromAlignment, toAss, fillGaps } from '../lib/subtitle.mjs';
import { fitScript } from '../lib/script-budget.mjs';
import { bestQuote, quoteCardHtml } from '../lib/quote-card.mjs';
import {
  searchTerms, sceneQueries, queryLadder, pickFootage, pickFootageMany, splitShots, creditLine, matchLocal,
  searchOpenverse, searchCommons, searchPexelsVideo,
} from '../lib/footage.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const locale = arg('--locale', 'en');
const isKo = locale === 'ko';
const TARGET_SEC = Number(arg('--seconds', '90'));
const OUT = resolve(ROOT, arg('--out', `reports/video/issue-${locale}.mp4`));
const WORK = resolve(ROOT, `reports/video/.work-${locale}`);
const BROLL = resolve(ROOT, 'assets/broll');
// 표기 의무 없는 소재(CC0·PD)를 우선한다. 크레딧이 편당 9~12건씩 쌓이고,
//   CC BY-SA 는 2차 생성물에까지 동일조건변경허락이 전파된다.
//   금지가 아니라 우선순위라 CC0 가 없으면 CC BY 도 쓴다.
const PREFER_FREE = !argv.includes('--allow-attribution');
const W = 1920, H = 1080, FPS = 30, XFADE = 0.45;
// 자막 밴드 기하. furniture 의 CSS 와 ASS 의 marginV 가 **같은 값을 봐야** 글자가 띠 안에 앉는다.
//   따로 두면 한쪽만 고쳤을 때 글자가 띠 밖으로 나가고, 그건 렌더 후에야 보인다.
//
// 밴드를 **화면 바닥에 붙인다**(2026-08-27). 종전엔 858~1010 으로 떠 있었는데,
//   생성 클립(Veo)의 "Veo" 워터마크가 우하단 y≈1041~1071 에 박혀 밴드 아래로 삐져나왔다.
//   바닥까지 내리면 그 자리를 덮는다 — 워터마크를 지우는 게 아니라 화면 구성으로 가리는 것이고,
//   생성 클립을 안 쓰는 편에서도 하단이 정돈돼 보인다.
const BAND = { top: 850, height: 1080 - 850, marginV: 56 };

/**
 * 낭독 속도(초당 글자). 대본 길이를 목표 초에서 역산하는 데만 쓴다 — 최종 길이는
 * 어차피 실측 오디오로 정해지므로 틀려도 영상이 깨지진 않고, 길이만 빗나간다.
 *   en 16.3 = 2026-08-27 2차 실측(1,679자 → 106.6초, Mark/multilingual_v2).
 *             1차(898자)에서 14.8 로 잡았다가 90초 목표에 106.6초가 나와 교정했다.
 *             짧은 대본일수록 장면 꼬리 여백 비중이 커져 낮게 나온다 — 긴 쪽 실측을 쓴다.
 *   ko  5.5 = **미실측 추정값.** 첫 한국어 편에서 실측해 고칠 것.
 */
const CHARS_PER_SEC = { en: 16.3, ko: 5.5 };

// ── 1. 소재: 최근 12시간 뉴스에서 매체 수 기준 상위 이슈 ─────────────────────
const REGION_SOURCES = isKo
  ? ['연합뉴스 정치', '연합뉴스 사회', '연합뉴스 연예', '연합뉴스 국제', '연합뉴스 경제', '한국경제 정치', '한국경제 사회', '한국경제']
  : ['NPR 톱뉴스', 'NPR 정치', 'NBC 톱뉴스', 'CBS 톱뉴스', 'Politico 정치', 'Variety 연예', 'Hollywood Reporter 연예', 'The Verge 테크'];

const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
const rows = db.prepare(
  `SELECT source, headline, link FROM news_archive
   WHERE source IN (${REGION_SOURCES.map(() => '?').join(',')})
     AND datetime(captured_at) >= datetime('now','-12 hours')`,
).all(...REGION_SOURCES);
db.close();

const issues = topDistinctIssues(rows, 3);
// 각 이슈의 대표 발언. "그 사건" 을 화면에 직접 띄우는 유일한 수단이다 —
//   아카이브 사진은 인물이 맞아도 그 기사가 아니고, SNS 원본은 재사용 심사에 걸린다.
//   방송사가 하듯 **인용을 다시 그린다**(quote-card).
for (const c of issues) c.quote = bestQuote(c.headlines ?? []);
if (issues.length === 0) { console.error('❌ 이슈 클러스터 없음 — 수집이 얇다'); process.exit(1); }
console.log(`  [소재] ${rows.length}건 중 이슈 ${issues.length}개`);
for (const c of issues) {
  console.log(`    "${c.keyword}" 매체 ${c.sourceCount} · 기사 ${c.items.length}`
    + (c.quote ? ` · 인용 "${c.quote.text.slice(0, 40)}…"` : ''));
}

// ── 2. 대본 ─────────────────────────────────────────────────────────────────
// 장면 수와 장면당 글자 수를 목표 초에서 역산한다. 하드코딩하면 --seconds 가 거짓말이 된다.
const SCENES = Math.min(9, Math.max(6, Math.round(TARGET_SEC / 11)));
// 예산보다 25% 넉넉히 요구한다. 넘치면 코드가 결정론으로 자를 수 있지만, 모자라면
//   모델에게 다시 부탁하는 수밖에 없다 — 비싼 쪽을 피해 넘치는 영역에 머문다.
const perScene = Math.round((TARGET_SEC * (CHARS_PER_SEC[isKo ? 'ko' : 'en'] ?? 14) * 1.25) / SCENES);
const [loChars, hiChars] = [Math.round(perScene * 0.8), Math.round(perScene * 1.2)];

const brief = issues.map((c, i) => {
  const heads = c.headlines.slice(0, 4).map((h) => `- ${h}`).join('\n');
  // 인용이 있으면 표시해 둔다 — 그 장면에 인용 카드를 띄울 것이므로 대본이 그 발언을 다뤄야 한다.
  const q = c.quote ? `\n(QUOTE ${i + 1}: "${c.quote.text}"${c.quote.speaker ? ` — ${c.quote.speaker}` : ''})` : '';
  return `[${i + 1}] ${heads}${q}`;
}).join('\n\n');

const buildPrompt = (nudge) => isKo ? `너는 한국 이슈 뉴스 채널의 대본 작가다. 아래 헤드라인만 근거로 ${TARGET_SEC}초 대본을 쓴다.

${brief}

규칙:
- 오직 위 헤드라인에 있는 사실만 쓴다. 없는 숫자·인용·배경을 만들지 마라.
- 한국 시청자 관점에서 쓴다. 한국과 관련되면 그 연결을 앞세운다.
- 아나운서가 읽는 문장. 문어체 금지, 구어체 뉴스 톤.
- 숫자는 한글로 풀어 쓴다(TTS 오독 방지). 예: 17 billion → 백칠십억
- entity: 이 장면의 **실제 대상**. 헤드라인에 나오는 인물·기관·장소의 정식 명칭을 영어로.
  시청자가 실제로 봐야 하는 대상이다. 예: "Lee Jae-myung", "National Assembly of Korea", "Gwanghwamun".
  실제 대상이 없는 장면(마무리 멘트 등)에서만 "" 로 둔다.
- visual: 남는 컷을 채울 일반 b-roll 검색어. **영어 2~3단어 한 덩어리**만. 인물명 말고 장소·사물.
  전 세계 아카이브에서 검색되므로 모호하면 엉뚱한 나라 사진이 걸린다.
  좋음: "Seoul National Assembly building", "Gwanghwamun square"
  나쁨: "handshake stage"(인도네시아 아이돌 행사가 걸렸다), "news desk"
- JSON 배열만 출력: [{"title":"화면 제목(12자 이내)","say":"읽을 문장(${loChars}~${hiChars}자)","entity":"Real Subject Name","visual":"english b-roll words"}]
- 장면 ${SCENES}개. 마지막 장면은 채널 마무리.${nudge ?? ''}`
  : `You write scripts for a US news-issue channel. Use ONLY the headlines below. Target ${TARGET_SEC} seconds.

${brief}

Rules:
- Use only facts present in the headlines. Do not invent numbers, quotes, or background.
- Write for a US audience. Lead with why it matters to Americans.
- Anchor-read sentences. Conversational broadcast tone, not written prose.
- Spell out figures for text-to-speech (e.g. "seventeen billion dollars", not "$17B").
- "entity": the REAL subject of this scene as it appears in the headlines — a person, organization
  or place. This is what viewers must actually see. Use the full proper name.
  Examples: "Dolly Parton", "United States Secret Service", "Ryman Auditorium".
  Leave it "" only when the scene names no real subject (e.g. the closing line).
- "visual": ONE English phrase of 2-3 words for generic b-roll, used to fill extra cuts.
  A PLACE, OBJECT or SCENE — not a person. Do NOT list comma-separated options.
  It is searched against a worldwide archive, so make it unambiguous and American —
  a generic phrase pulls the wrong country.
  Good: "US Capitol dome", "federal courtroom bench".
  Bad: "handshake stage" (matched an Indonesian idol event), "news desk", "open book".
- Output ONLY a JSON array: [{"title":"on-screen title (<=18 chars)","say":"line to read (${loChars}-${hiChars} chars)","entity":"Real Subject Name","visual":"english b-roll words"}]
- Exactly ${SCENES} scenes. Last scene closes the channel.${nudge ?? ''}`;

console.log(`  [대본] 목표 ${TARGET_SEC}초 → 장면 ${SCENES}개 × ${loChars}~${hiChars}자 · 로컬 LLM 호출…`);
// 보고서용 27B(:8000)와 경합하지 않도록 보조 모델(:8001)을 쓴다 — 대본은 헤드라인만 근거로 하는
//   제한된 과제라 소형이면 충분하고, 27B 는 디코딩이 3 tok/s 라 정기 발간을 굶길 수 있다.
// enable_thinking:false 가 핵심 — 없으면 추론 토큰이 예산을 다 먹고 content 가 **빈 문자열**로 온다.
const llm = { url: process.env.VIDEO_LLM_URL ?? 'http://127.0.0.1:8001/v1',
              model: process.env.VIDEO_LLM_MODEL ?? 'mlx-community/Qwen3.5-4B-4bit' };

async function askLLM(nudge) {
  const res = await fetch(`${llm.url}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: llm.model, messages: [{ role: 'user', content: buildPrompt(nudge) }],
                           max_tokens: 2400, temperature: 0.4, stream: false,
                           chat_template_kwargs: { enable_thinking: false } }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const txt = (await res.json())?.choices?.[0]?.message?.content ?? '';
  let arr;
  try {
    const m = String(txt).match(/\[[\s\S]*\]/);
    arr = JSON.parse(m ? m[0] : txt);
  } catch { throw new Error(`대본 파싱 실패: ${String(txt).slice(0, 200)}`); }
  return (arr ?? []).filter((x) => x?.say && x?.title).slice(0, SCENES);
}

// [길이 제어] 프롬프트로 길이를 지시하는 건 세 번 연속 빗나갔다(실측 2026-08-27):
//   60.7초 / 128.8초 / 36.8초 — 모두 목표 90초. **양방향으로** 못 믿는다.
//   그래서 닫힌 루프로 간다: 짧으면 다시 시키고(위로는 모델만 할 수 있다),
//   길면 fitScript 가 문장 경계에서 자른다(아래로는 코드가 결정론으로 할 수 있다).
const budgetChars = Math.round(TARGET_SEC * (CHARS_PER_SEC[isKo ? 'ko' : 'en'] ?? 14));
const FLOOR = 0.85;                       // 이보다 짧으면 재시도. 목표 90초 기준 76.5초.
const MAX_TRIES = 3;
let scenes = [], chars = 0;
for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
  const nudge = attempt === 1 ? '' : (isKo
    ? `\n- 직전 시도는 총 ${chars}자로 너무 짧았다. 이번엔 총 ${Math.round(budgetChars * 1.15)}자 이상 쓰라. 장면마다 2~3문장.`
    : `\n- Your previous attempt was only ${chars} characters, too short. Write at least ${Math.round(budgetChars * 1.15)} characters total this time — 2 to 3 sentences per scene.`);
  try { scenes = await askLLM(nudge); } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
  chars = scenes.reduce((n, x) => n + x.say.length, 0);
  if (scenes.length < 3) { console.log(`  [대본] 시도 ${attempt}: 장면 ${scenes.length}개 — 부족, 재시도`); continue; }
  if (chars >= budgetChars * FLOOR) break;
  console.log(`  [대본] 시도 ${attempt}: ${chars}자 < 하한 ${Math.round(budgetChars * FLOOR)}자 — 재시도`);
}
if (scenes.length < 3) { console.error(`❌ 장면 부족: ${scenes.length}`); process.exit(1); }
if (chars < budgetChars * FLOOR) {
  // 3번 시도해도 짧으면 그냥 간다 — 짧은 영상이 실패한 영상보다 낫다. 다만 조용히 넘기지 않는다.
  console.log(`  ⚠ ${MAX_TRIES}회 시도 후에도 ${chars}자 (하한 ${Math.round(budgetChars * FLOOR)}자) — 목표보다 짧게 나간다`);
}
// 길면 문장 경계에서 자른다. 장면은 버리지 않는다(이슈 하나가 통째로 사라진다).
const fit = fitScript(scenes, { budgetChars });
scenes = fit.scenes;
if (fit.trimmed) console.log(`  [대본] 예산 ${budgetChars}자 초과 → ${fit.before}자에서 ${fit.after}자로 (${fit.trimmed}장면 문장 절삭)`);
const scriptChars = scenes.reduce((n, x) => n + x.say.length, 0);
console.log(`  [대본] 장면 ${scenes.length}개 · ${scriptChars}자 (예산 ${budgetChars})`);

mkdirSync(WORK, { recursive: true });
mkdirSync(resolve(ROOT, 'reports/video'), { recursive: true });

// ── 3. 음성 + 글자 타임스탬프 ───────────────────────────────────────────────
for (let i = 0; i < scenes.length; i++) {
  const r = await synthesizeWithTimestamps(scenes[i].say, {
    locale, outPath: `${WORK}/s${i}.mp3`, model: 'eleven_multilingual_v2',
  });
  scenes[i].audio = r.path;
  scenes[i].alignment = r.alignment;
  scenes[i].dur = r.durationSec + 0.45;   // 꼬리 여백: 장면이 말끝에 딱 붙어 끊기면 급하게 들린다
  console.log(`  [음성] ${i + 1} ${scenes[i].dur.toFixed(1)}초`);
}
const totalSec = scenes.reduce((n, s) => n + s.dur, 0);

// ── 4. 배경 화면 ────────────────────────────────────────────────────────────
// 우선순위: 사람이 넣은 클립 → Pexels 동영상 → Commons/Openverse 사진 → 그라디언트 카드.
// 다운로드는 스트리밍 + 상한. 통째로 메모리에 올리면 4K 원본에서 프로세스가 부푼다.
// 1080p 30초 Pexels 클립이 46MB 라 40MB 문턱에 걸려 카드로 떨어졌다(실측).
const MAX_DL = 90 * 1024 * 1024;
async function download(url, dest) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'FlowVium-issue-video/1.0 (https://flowvium.net)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX_DL) throw new Error(`너무 큼 ${(len / 1048576).toFixed(0)}MB`);
  let seen = 0;
  const guard = new TransformStream({
    transform(chunk, ctrl) {
      seen += chunk.byteLength;
      if (seen > MAX_DL) throw new Error('스트림 상한 초과');
      ctrl.enqueue(chunk);
    },
  });
  await streamPipeline(Readable.fromWeb(r.body.pipeThrough(guard)), createWriteStream(dest));
  return dest;
}

const localFiles = existsSync(BROLL) ? readdirSync(BROLL) : [];
const credits = [];
// 한 화면이 12초 동안 안 바뀌면 그게 "PPT" 다. 장면당 여러 컷을 모아 나눈다.
const MAX_SHOTS = Number(process.env.VIDEO_MAX_SHOTS ?? 3);
const MIN_SHOT = 3.2;
const shots = [];                    // 화면 트랙. 음성/자막은 장면 단위, 화면은 컷 단위로 간다.
const usedQuotes = new Set();        // 같은 발언 카드를 두 번 띄우지 않는다
let shotSeq = 0;

for (let i = 0; i < scenes.length; i++) {
  // 뉴스 화면은 "그 사건" 이어야 한다 — 실제 대상(entity)을 먼저 찾고, 남는 컷을 일반 b-roll 로 채운다.
  const queries = sceneQueries(scenes[i]);
  const terms = queries[0] ?? searchTerms(scenes[i]);
  scenes[i].terms = terms;
  const want = splitShots(scenes[i].dur, MAX_SHOTS, MIN_SHOT);

  // 마무리 장면(마지막)은 **채널 자체 그래픽**으로 간다.
  //   실측(2026-08-27): "news anchor desk" 로 찾은 Pexels 클립에 "TOMATO NEWS"·"BREAKING NEWS"
  //   같은 **가짜 방송사 브랜딩이 화면에 박혀** 있어 우리 로고와 겹쳤다.
  //   스톡 뉴스룸 영상은 대부분 그렇다. 사인오프는 실제 방송도 자기 화면에서 한다.
  const isClosing = i === scenes.length - 1;

  // 이 장면이 다루는 이슈에 대표 발언이 있으면 **첫 컷을 인용 카드**로 잡는다.
  //   발언이 주인공인 화면이라 사진 위에 얹지 않고 화면 전체를 쓴다.
  const issueForScene = issues[Math.min(issues.length - 1, Math.floor(i * issues.length / scenes.length))];
  const quote = issueForScene?.quote && !usedQuotes.has(issueForScene.quote.text) ? issueForScene.quote : null;

  // 사람이 assets/broll 에 넣은 클립(Flow 생성물 포함). 라이선스 판단은 넣은 사람이 한 것으로 본다.
  // **entity 질의로만** 맞춘다 — queries.flat() 으로 하면 일반 b-roll 검색어가 걸려서
  //   실제 대상 사진을 밀어낸다(실측: "Secret Service" 장면에 국회의사당 클립이 깔렸다).
  const local = isClosing ? null : matchLocal(localFiles, queries[0] ?? []);

  // entity → visual 순으로, 각 질의는 넓은 것부터 좁은 것까지 내려간다.
  //   3단어 AND 매칭은 쉽게 0건이 된다(실측).
  let picks = [], usedQ = terms;
  if (!local && !isClosing) {
    outer:
    for (let qi = 0; qi < queries.length; qi++) {
      const base = queries[qi];
      // **실존 인물·기관은 아카이브 사진으로만 찾는다.** Pexels 는 모델 스톡이라
      //   "Dolly Parton" 을 물으면 분홍 머리 모델이 나온다(실측 2026-08-27).
      //   동영상이 사진보다 우선하도록 해놨더니 그 스톡이 실제 인물 사진을 밀어냈다.
      //   entity(qi=0)는 Commons/Openverse, 일반 b-roll(qi>0)은 Pexels 동영상 우선.
      const sources = qi === 0
        ? [searchCommons, searchOpenverse]
        : [searchPexelsVideo, searchCommons, searchOpenverse];
      for (const q of queryLadder(base)) {
        let cands = [];
        for (const fn of sources) {
          try { cands = cands.concat(await fn(q, { limit: 12 })); } catch { /* 한 소스가 죽어도 나머지로 */ }
          // terms 를 넘겨야 관련성 검사가 걸린다 — 안 넘기면 매체 종류만 보고 통과시킨다.
          const got = pickFootageMany(cands, want.length, { terms: q, preferFree: PREFER_FREE });
          if (got.length) { picks = got; usedQ = q; break outer; }
        }
      }
    }
    // 실제 대상으로 컷을 다 못 채웠으면 일반 b-roll 로 보충한다.
    if (picks.length && picks.length < want.length && queries[1]) {
      const seen = new Set(picks.map((x) => x.url));
      let extra = [];
      for (const fn of [searchPexelsVideo, searchCommons, searchOpenverse]) {
        try { extra = extra.concat(await fn(queries[1], { limit: 12 })); } catch { /* noop */ }
      }
      for (const p of pickFootageMany(extra.filter((x) => !seen.has(x.url)),
        want.length - picks.length, { terms: queries[1], preferFree: PREFER_FREE })) picks.push(p);
    }
  }

  // 컷 수를 실제로 확보한 그림 수에 맞춘다. 그림이 하나뿐이면 쪼개지 않는다 —
  //   같은 그림을 두 번 이어 붙이면 컷이 아니라 점프컷처럼 보인다.
  const nShots = local ? 1 : Math.max(1, Math.min(want.length, picks.length || 1));
  const durs = splitShots(scenes[i].dur, nShots, MIN_SHOT);

  const labels = [];
  for (let k = 0; k < durs.length; k++) {
    if (k === 0 && quote) {
      usedQuotes.add(quote.text);
      shots.push({ kind: 'quote', quote, dur: durs[k], zin: shotSeq % 2 === 0 });
      labels.push(`인용카드 "${quote.text.slice(0, 24)}…"`);
      shotSeq++;
      continue;
    }
    if (local) {
      shots.push({ kind: 'video', file: resolve(BROLL, local), dur: durs[k], zin: shotSeq % 2 === 0 });
      labels.push(`local:${local}`);
    } else if (picks[k]) {
      const pick = picks[k];
      const ext = pick.kind === 'video' ? 'mp4' : 'jpg';
      const file = `${WORK}/bg${shotSeq}.${ext}`;
      try {
        await download(pick.url, file);
        shots.push({ kind: pick.kind, file, dur: durs[k], zin: shotSeq % 2 === 0 });
        const cr = creditLine(pick);
        if (cr) credits.push(cr);
        labels.push(`${pick.width}px ${pick.license}`);
      } catch (e) {
        shots.push({ kind: 'card', file: null, dur: durs[k], zin: shotSeq % 2 === 0 });
        labels.push(`실패(${e.message.slice(0, 24)})→카드`);
      }
    } else {
      shots.push({ kind: isClosing ? 'signoff' : 'card', file: null, dur: durs[k], zin: shotSeq % 2 === 0 });
      labels.push(isClosing ? '채널 마무리' : '카드');
    }
    shotSeq++;
  }
  const ent = scenes[i].entity ? `대상="${scenes[i].entity}" ` : '';
  console.log(`  [화면] ${i + 1} ${ent}질의="${usedQ.join(' ')}" ${durs.length}컷 → ${labels.join(' / ')}`);
}

// ── 5. 자막 ─────────────────────────────────────────────────────────────────
// 장면 오프셋은 누적 길이. xfade 로 합쳐도 최종 길이가 sum(dur) 로 맞게 아래에서 보정한다.
let off = 0;
const cues = [];
for (const s of scenes) {
  // 2줄 밴드. 한 줄짜리 짧은 큐가 계속 깜빡이면 오히려 안 읽힌다 — 두 줄을 채워 체류를 늘린다.
  cues.push(...cuesFromAlignment(s.alignment, {
    maxChars: isKo ? 26 : 40, maxLines: 2, maxDur: 4.2, offset: off,
  }));
  off += s.dur;
}
// 장면 경계의 0.45초 꼬리 때문에 밴드만 남고 글자가 사라지는 구간이 생긴다(실측 t=48초).
// 짧은 빈틈은 앞 큐를 늘려 덮는다.
const filled = fillGaps(cues, 1.6);
writeFileSync(`${WORK}/subs.ass`, toAss(filled, {
  style: 'band',                     // 하단 밝은 띠 안의 어두운 글자 — 띠는 아래 furniture 가 그린다
  font: isKo ? 'Apple SD Gothic Neo' : 'Arial',
  fontSize: isKo ? 56 : 54,
  marginV: BAND.marginV, marginLR: 170,
}));
console.log(`  [자막] 큐 ${cues.length}개`);

// ── 6. 화면 위 그래픽(로워서드·채널명·스크림) — 투명 PNG 로 한 장씩 ─────────
// 레퍼런스(YTN "지금 이 뉴스"): 큰 제목 로워서드 없음. 상단에 작은 칩 두 개,
//   하단에 밝은 자막 밴드(얇은 괘선 위아래) 하나. 화면을 가리는 글자를 최대한 줄인다.
//   전면 스크림도 뺀다 — 칩과 밴드가 각자 배경을 갖고 있어서 필요 없다.
const KICK = isKo ? '지금 이 이슈' : 'TODAY’S ISSUE';
const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const furniture = () => `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;background:transparent}
body{font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;position:relative;overflow:hidden}
.kick{position:absolute;top:46px;left:46px;background:rgba(238,242,247,.94);color:#12171f;
  font-size:34px;font-weight:800;letter-spacing:.02em;padding:14px 26px;
  box-shadow:0 3px 16px rgba(0,0,0,.35)}
.right{position:absolute;top:46px;right:46px;text-align:right;
  /* 흰 글자 + 그림자만으로는 밝은 하늘 배경에서 묻힌다(실측: 프리뷰에서 우상단이 안 읽힘).
     방송사 로고처럼 어두운 받침을 깐다. */
  background:rgba(14,19,28,.62);padding:12px 22px;border-radius:3px}
.brand{font-size:34px;font-weight:900;letter-spacing:.24em;color:#fff}
/* 자막 밴드: 밝은 반투명 띠 + 위아래 얇은 괘선. 어두운 글자가 어떤 배경에서도 읽힌다. */
.band{position:absolute;left:0;right:0;top:${BAND.top}px;height:${BAND.height}px;
  background:rgba(231,237,244,.90);border-top:4px solid rgba(74,90,112,.85);
  border-bottom:4px solid rgba(74,90,112,.85)}
</style>
<div class="kick">${esc(KICK)}</div>
<div class="right"><div class="brand">FLOWVIUM</div></div>
<div class="band"></div>`;

/**
 * 마무리 화면. 채널 자체 그래픽이다.
 * 스톡 뉴스룸 클립에는 "TOMATO NEWS" 같은 **가짜 방송사 브랜딩이 박혀** 있어 쓸 수 없다(실측).
 */
const signoffBg = () => `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0}html,body{width:${W}px;height:${H}px}
body{background:radial-gradient(1400px 800px at 50% 42%,#1b2a48 0%,rgba(0,0,0,0) 66%),
  linear-gradient(150deg,#070b16,#111c33 55%,#070b16);
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;color:#eef3ff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding-bottom:${H - BAND.top + 30}px}
.w{font-size:132px;font-weight:900;letter-spacing:.30em;text-indent:.30em}
.r{margin-top:34px;width:150px;height:7px;background:linear-gradient(90deg,#ff4d5e,#c81e3a)}
.s{margin-top:34px;font-size:34px;color:#9fb2d4;letter-spacing:.22em}
</style><div class="w">FLOWVIUM</div><div class="r"></div>
<div class="s">${isKo ? '오늘의 이슈' : 'TODAY’S ISSUE'}</div>`;

// 배경이 없는 장면에 깔 카드. 이것도 켄번스로 움직인다 — 정지하면 딱 그 PPT 느낌이 난다.
const cardBg = (i) => `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0}html,body{width:${W}px;height:${H}px}
body{background:
  radial-gradient(1200px 700px at ${18 + (i % 3) * 30}% ${28 + (i % 2) * 34}%,#22304f 0%,rgba(0,0,0,0) 62%),
  linear-gradient(140deg,#070b16,#131c33 55%,#070b16)}
</style>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
// furniture 는 장면마다 달라지지 않는다(제목을 뺐으므로) — 한 장만 그려 전 장면이 공유한다.
await page.setContent(furniture());
await page.screenshot({ path: `${WORK}/fx.png`, omitBackground: true });
for (let i = 0; i < shots.length; i++) {
  if (shots[i].kind === 'quote') {
    await page.setContent(quoteCardHtml(shots[i].quote, { width: W, height: H, bandTop: BAND.top }));
    await page.screenshot({ path: `${WORK}/bg${i}.jpg`, type: 'jpeg', quality: 94 });
    shots[i] = { ...shots[i], kind: 'image', file: `${WORK}/bg${i}.jpg`, isQuote: true };
    continue;
  }
  if (shots[i].kind === 'signoff') {
    await page.setContent(signoffBg());
    await page.screenshot({ path: `${WORK}/bg${i}.jpg`, type: 'jpeg', quality: 94 });
    shots[i] = { ...shots[i], kind: 'image', file: `${WORK}/bg${i}.jpg`, isQuote: true };  // 켄번스 제외
    continue;
  }
  if (shots[i].kind !== 'card') continue;
  await page.setContent(cardBg(i));
  await page.screenshot({ path: `${WORK}/bg${i}.jpg`, type: 'jpeg', quality: 92 });
  shots[i] = { ...shots[i], kind: 'image', file: `${WORK}/bg${i}.jpg` };
}
await browser.close();

// ── 7. 장면별 mp4 ───────────────────────────────────────────────────────────
const ff = (args, label) => {
  const r = spawnSync(ffmpegPath, args, { encoding: 'utf8', maxBuffer: 8 << 20 });
  if (r.status !== 0) { console.error(`❌ ffmpeg ${label}:\n${String(r.stderr).slice(-900)}`); process.exit(1); }
};
/** 컷 하나를 렌더한다. bg 가 없으면(=카드) 그라디언트를 배경으로 쓴다. */
const renderShot = (i, sh) => {
  // 마지막 컷을 뺀 모든 컷은 XFADE 만큼 길게 만든다. 겹치는 만큼 되돌려받아
  // 최종 길이가 정확히 sum(dur) 이 된다 — 그래야 위에서 계산한 자막 오프셋이 맞는다.
  const len = sh.dur + (i < shots.length - 1 ? XFADE : 0);
  // 켄번스 방향을 컷마다 바꾼다(줌인/줌아웃). 전부 같은 방향이면 그것대로 기계처럼 보인다.
  // 인용 카드는 켄번스를 걸지 않는다 — 글자가 확대되며 흔들리면 읽기 힘들다.
  const z = sh.isQuote ? '1' : (sh.zin ? `min(1+0.0011*on,1.13)` : `max(1.13-0.0011*on,1.0)`);
  const bgChain = sh.kind === 'video'
    ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setpts=PTS-STARTPTS[bg]`
    // 투명 PNG 가 섞이면 검게 나온다 — 어두운 배경을 깔고 그 위에 올린다(실측: 첫 5초 검은 화면).
    : `[0:v]format=rgba,scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440[im];`
      + `color=c=0x0b1120:s=2560x1440[pad];[pad][im]overlay=0:0:format=auto,`
      + `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}[bg]`;
  const inputs = sh.kind === 'video'
    ? ['-stream_loop', '-1', '-t', len.toFixed(3), '-i', sh.file]
    : ['-framerate', String(FPS), '-loop', '1', '-t', len.toFixed(3), '-i', sh.file];
  // fx 입력에도 -loop/-t 를 준다. **없으면 오버레이가 통째로 사라진다** —
  //   단일 프레임 PNG 은 t=0 프레임 하나뿐이라 fade(alpha) 가 그걸 alpha=0 으로 만들고,
  //   overlay 의 eof_action=repeat 이 그 투명 프레임을 컷 내내 반복한다.
  ff([
    '-y', '-hide_banner', '-loglevel', 'error', ...inputs,
    '-framerate', String(FPS), '-loop', '1', '-t', len.toFixed(3), '-i', `${WORK}/fx.png`,
    '-filter_complex',
    `${bgChain};[1:v]format=rgba[fx];`
    + `[bg][fx]overlay=0:0:format=auto,format=yuv420p,trim=duration=${len.toFixed(3)},setpts=PTS-STARTPTS[v]`,
    '-map', '[v]', '-an', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
    '-pix_fmt', 'yuv420p', `${WORK}/v${i}.mp4`,
  ], `shot ${i}`);
};

/**
 * 이 컷의 배경에 실제 내용이 있는가.
 * 밝기가 아니라 **분산**으로 본다 — 밤 장면은 어두워도 정상이고, 빈 화면은 분산이 0 이다.
 * 실측(2026-08-27): 투명 PNG(서명 이미지)가 배경으로 깔려 첫 5초가 휘도 0 으로 나갔다.
 *   기존 가드는 액센트 바만 봐서 통과시켰다 — 오버레이는 정상이었기 때문이다.
 */
const shotHasContent = (i) => {
  const [cw, chh] = [32, 18];
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error',
    '-ss', (shots[i].dur * 0.5).toFixed(2), '-i', `${WORK}/v${i}.mp4`, '-frames:v', '1',
    '-vf', `crop=${W}:${BAND.top - 120}:0:60,scale=${cw}:${chh}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 1 << 20 });
  const px = r.stdout;
  if (!px || px.length < cw * chh) return true;      // 못 재면 통과시킨다 — 검사 실패로 영상을 버리지 않는다
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  const sd = Math.sqrt(px.reduce((a, b) => a + (b - mean) ** 2, 0) / px.length);
  return sd >= 4;                                    // 단색 화면은 0 에 수렴한다
};

let blanks = 0;
for (let i = 0; i < shots.length; i++) {
  renderShot(i, shots[i]);
  if (shots[i].isQuote || shotHasContent(i)) continue;
  // 빈 화면이면 카드로 갈아끼운다. 검은 컷이 발행되는 것보다 낫다.
  blanks++;
  const card = `${WORK}/card${i}.jpg`;
  if (!existsSync(card)) {
    const b2 = await chromium.launch();
    const p2 = await b2.newPage({ viewport: { width: W, height: H } });
    await p2.setContent(cardBg(i));
    await p2.screenshot({ path: card, type: 'jpeg', quality: 92 });
    await b2.close();
  }
  console.log(`  [빈컷] ${i + 1} 배경이 비었다(${shots[i].file?.split('/').pop() ?? '?'}) → 카드로 대체`);
  shots[i] = { ...shots[i], kind: 'image', file: card };
  renderShot(i, shots[i]);
}
if (blanks) console.log(`  [검사] 빈 컷 ${blanks}개 대체`);

// [가드] 화면 위 그래픽이 실제로 얹혔는가 — 하단 자막 밴드는 항상 있고 전폭이라 기준으로 쓴다.
//   (종전에는 좌측 빨간 액센트 바를 봤는데, 그 바를 화면에서 뺐다. 가드 기준을 같이 옮긴다.)
//   fade(alpha) 버그는 ffmpeg 이 exit 0 으로 끝나면서 화면만 조용히 비웠다 — exit code 로는 못 잡는다.
//   crop 은 **짝수 크기**로. 1x1 은 yuv420p 크로마 서브샘플링에서 0바이트를 낸다.
{
  const [cw, chh] = [40, 20];
  const probe = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error',
    '-ss', (shots[0].dur * 0.6).toFixed(2), '-i', `${WORK}/v0.mp4`, '-frames:v', '1',
    '-vf', `crop=${cw}:${chh}:20:${BAND.top + 30}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 4 << 20 });
  const px = probe.stdout;
  const need = cw * chh;
  if (!px || px.length < need) {
    console.error(`❌ 오버레이 검사 불가 — 프로브가 ${px?.length ?? 0}/${need} 바이트만 반환`);
    process.exit(1);
  }
  const mean = px.reduce((a, b) => a + b, 0) / need;
  // 밴드는 밝은 반투명 띠라 어떤 배경 위에서도 밝다. 얹히지 않았으면 배경 밝기가 그대로 나온다.
  if (mean < 140) {
    console.error(`❌ 오버레이 미적용 — 자막 밴드 자리 평균 휘도 ${mean.toFixed(0)} (기대 140 이상). `
      + 'fx 입력의 -loop/-t 또는 overlay 체인을 확인하라');
    process.exit(1);
  }
  console.log(`  [가드] 오버레이 확인 · 자막 밴드 휘도 ${mean.toFixed(0)}`);
}
console.log(`  [합성] ${shots.length}컷 렌더 (장면 ${scenes.length}개)`);

// ── 8. 최종: xfade 체인 + 음성 + 자막 굽기. 한 번만 인코딩한다 ───────────────
writeFileSync(`${WORK}/a.txt`, scenes.map((s) => `file '${s.audio}'`).join('\n'));
ff(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${WORK}/a.txt`,
    '-c', 'copy', `${WORK}/voice.mp3`], 'audio concat');

const vin = shots.flatMap((_, i) => ['-i', `${WORK}/v${i}.mp4`]);
let chain = '', prev = '0:v', acc = 0;
for (let i = 1; i < shots.length; i++) {
  acc += shots[i - 1].dur;
  const out = i === shots.length - 1 ? 'vx' : `x${i}`;
  chain += `[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${acc.toFixed(3)}[${out}];`;
  prev = out;
}
if (shots.length === 1) chain = '[0:v]null[vx];';
// ass 필터에 fontsdir 를 준다. fontconfig 기본 설정이 없다는 경고가 뜨는 빌드라
//   맡겨두면 어떤 폰트로 떨어질지 보장이 안 된다(한글이면 두부가 된다).
chain += `[vx]ass=${WORK}/subs.ass:fontsdir=/System/Library/Fonts[v]`;
ff(['-y', '-hide_banner', '-loglevel', 'error', ...vin, '-i', `${WORK}/voice.mp3`,
    '-filter_complex', chain, '-map', '[v]', '-map', `${shots.length}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', OUT], 'final');

// 중간 파일은 지운다 — 장면 mp4 는 편당 수십 MB 라 매일 돌리면 디스크를 먹는다.
for (const f of readdirSync(WORK)) if (/^(v\d+\.mp4|bg\d+\.(jpg|mp4))$/.test(f)) { try { rmSync(`${WORK}/${f}`); } catch { /* noop */ } }

const measured = spawnSync(ffmpegPath, ['-hide_banner', '-i', OUT], { encoding: 'utf8' }).stderr ?? '';
const dur = (measured.match(/Duration:\s*(\d+):(\d+):([\d.]+)/) ?? []).slice(1);
const realSec = dur.length ? (+dur[0] * 3600 + +dur[1] * 60 + +dur[2]) : totalSec;

if (credits.length) writeFileSync(`${WORK}/credits.txt`, credits.join('\n'));
console.log(`\n✅ ${OUT}`);
console.log(`   ${realSec.toFixed(1)}초 (목표 ${TARGET_SEC}) · ${(statSync(OUT).size / 1048576).toFixed(1)}MB`
  + ` · ${shots.length}컷/${scenes.length}장면 · 자막 ${cues.length}큐 · 소재: ${issues.map((c) => c.keyword).join(', ')}`);
console.log(`   실측 낭독속도 ${(scriptChars / (totalSec - scenes.length * 0.45)).toFixed(1)}자/초`
  + ` (설정값 ${CHARS_PER_SEC[isKo ? 'ko' : 'en']})`);

if (credits.length) console.log(`   ⚠ 표기 의무 ${credits.length}건 → ${WORK}/credits.txt (영상 설명란에 넣을 것)`);
else console.log('   표기 의무 0건 — 전부 CC0/PD');

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
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync, rmSync, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import { resolve, join, sep } from 'path';
import { tmpdir } from 'node:os';
import { ROOT } from '../lib/project-root.mjs';
import { synthesizeWithTimestamps, voiceGender } from '../lib/tts.mjs';
import { topDistinctIssues } from '../lib/issue-cluster.mjs';
import { cuesFromAlignment, toAss, fillGaps, fitScale } from '../lib/subtitle.mjs';
import { fitScript } from '../lib/script-budget.mjs';
import { ungroundedScenes, stripUngrounded } from '../lib/script-grounding.mjs';
import { bestQuote, quoteCardHtml } from '../lib/quote-card.mjs';
import { thumbText, thumbnailHtml, thumbLines } from '../lib/thumbnail.mjs';
import { searchMusic, pickTrack, musicCredit } from '../lib/music.mjs';
import { anchorBox, anchorSource, anchorFrameCss, genderMismatch } from '../lib/anchor.mjs';
import { resolveMediaRoot, ensureDir } from '../lib/media-root.mjs';
import {
  searchTerms, sceneQueries, queryLadder, pickFootage, pickFootageMany, splitShots, creditLine, matchLocal,
  grounded, isPlace, flatShare, isGraphicFrame, licenseUsable, envValue,
  searchOpenverse, searchCommons, searchPexelsVideo,
} from '../lib/footage.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const locale = arg('--locale', 'en');
const isKo = locale === 'ko';
const TARGET_SEC = Number(arg('--seconds', '90'));
// 영상·사진은 **구글드라이브에만** 둔다(2026-08-28 요구: 로컬 디스크 부족).
//   --local-media 를 줬을 때만 프로젝트 안에 쓴다. 드라이브가 죽었는데 조용히 로컬로
//   떨어지면 "옮겼다" 고 믿는 사이 디스크가 다시 찬다 — 그래서 기본은 실패다.
const MEDIA = resolveMediaRoot({
  configured: envValue('MEDIA_ROOT'),
  localFallback: resolve(ROOT, 'reports/video'),
  allowLocal: argv.includes('--local-media'),
});
console.log(`  [저장] ${MEDIA.where === 'drive' ? '구글드라이브' : MEDIA.where === 'configured' ? 'MEDIA_ROOT' : '로컬'} · ${MEDIA.root}`);
const MEDIA_ROOT = ensureDir(MEDIA.root);
const OUT = arg('--out') ? resolve(ROOT, arg('--out')) : join(MEDIA_ROOT, `issue-${locale}.mp4`);
// 중간물(컷별 mp4·프레임 png·mp3)은 **드라이브에 올리지 않는다.** 렌더 한 번에 수백 MB 가
//   생겼다 지워지는 것들이라, 클라우드에 동기화하면 대역폭과 드라이브 용량만 먹고
//   끝나면 어차피 지운다. 최종 산출물만 드라이브에 남는다.
//   로컬 임시 디렉터리는 렌더가 끝나면 비운다 — 디스크에 쌓이지 않는다.
const WORK = ensureDir(join(tmpdir(), `flowvium-video-${locale}`));
// 사람이 넣어 두는 소재도 드라이브에 둔다. 프로젝트 안 assets/ 는 하위호환으로 계속 본다.
const BROLL_DRIVE = join(MEDIA_ROOT, 'broll');
const BROLL = existsSync(BROLL_DRIVE) ? BROLL_DRIVE : resolve(ROOT, 'assets/broll');
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
// 밴드가 글자를 **감싸되 남는 공간이 없게** 잡는다. ASS 줄 높이는 대략 fontSize*1.2 다.
//   fs70 2줄 = 168px, 위여백 20 / 아래여백 26 → 밴드 866~1080.
//   종전 850~1080(230px)은 위쪽에 55px 이 비어 "여백이 많다" 는 지적을 받았다.
//   바닥까지 내려가는 건 유지한다 — Flow 생성 클립의 워터마크(y≈1041~1071)를 가려야 한다.
const BAND = { top: 866, height: 1080 - 866, marginV: 26 };

// 우측 앵커 박스. assets/anchor 에 파일이 있을 때만 켜진다 — 없으면 종전 전체화면 구성.
//   W·H·BAND 를 읽으므로 **그 선언 뒤에** 있어야 한다. 위로 올리면 TDZ 로 죽는데,
//   node --check 는 문법만 보므로 못 잡는다(2026-08-28 실제로 이렇게 죽었다).
// 실사를 못 찾은 장면에 깔 생성 배경. node scripts/flow-cards.mjs 로 미리 만든다.
const CARD_DIR = join(MEDIA_ROOT, 'cards');
//   영상이 있으면 영상을 쓴다 — 움직이는 배경이 정지 이미지보다 낫다.
const cardList = existsSync(CARD_DIR) ? readdirSync(CARD_DIR).sort() : [];
const cardVideos = cardList.filter((f) => /^card-\d+\.mp4$/i.test(f));
const cardImages = cardList.filter((f) => /^card-\d+\.(jpg|png)$/i.test(f));
const CARD_KIND = cardVideos.length ? 'video' : 'image';
const CARD_FILES = (cardVideos.length ? cardVideos : cardImages).map((f) => join(CARD_DIR, f));
const ANCHOR_DRIVE = join(MEDIA_ROOT, 'anchor');
const ANCHOR_DIR = existsSync(ANCHOR_DRIVE) ? ANCHOR_DRIVE : resolve(ROOT, 'assets/anchor');
// anchorSource 는 **파일명**을 돌려준다(디렉터리를 모른다). ffmpeg 에 넘길 땐 경로여야 한다 —
//   파일명 그대로 넘겼다가 소재를 전부 받고 렌더 직전에 "No such file" 로 죽었다(2026-08-28).
const anchorName = existsSync(ANCHOR_DIR)
  ? (anchorSource(readdirSync(ANCHOR_DIR), locale) ?? null) : null;
const anchorFile = anchorName ? resolve(ANCHOR_DIR, anchorName) : null;
if (anchorFile && !existsSync(anchorFile)) throw new Error(`앵커 파일 경로가 틀렸다: ${anchorFile}`);
const ABOX = anchorFile ? anchorBox({ width: W, height: H, bandTop: BAND.top }) : null;
// 앵커 박스가 먹는 우측 폭(+여백 40). 전면 카드(인용·마무리)는 이만큼 왼쪽으로 물러나야
//   글자가 박스 밑으로 들어가지 않는다. 박스가 없으면 0 이라 종전 구성 그대로다.
const SAFE_RIGHT = ABOX ? (W - ABOX.x + 40) : 0;

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
- **1번 장면이 훅이다.** 가장 강한 구체적 사실 하나로 시작하라 — 이름, 숫자, 결과.
  "오늘은", "이번 소식은" 같은 도입부 금지. 첫 여섯 어절이 계속 볼지를 결정한다.
- 숫자는 한글로 풀어 쓴다(TTS 오독 방지). 예: 17 billion → 백칠십억
- place: 이 사건이 **어디서** 일어났는가. 나라·도시·랜드마크를 영어로.
  모든 뉴스에는 장소가 있고, 스톡은 **장소의 실제 현지 영상**을 갖고 있다(인물은 모델 스톡뿐이다).
  예: "Seoul", "Gwanghwamun square", "Nepal Kathmandu". 장소가 정말 없을 때만 "".
- entity: 실제 대상 — 인물·기관의 **고유명사만** 영어로. 예: "Lee Jae-myung", "Samsung Electronics".
  "십대 소년", "원자력 규제기관" 같은 서술구 금지 — 아카이브에서 아무것도 안 걸린다. 없으면 "".
- visual: 남는 컷을 채울 일반 b-roll 검색어. **영어 2~3단어 한 덩어리**만. 인물명 말고 장소·사물.
  전 세계 아카이브에서 검색되므로 모호하면 엉뚱한 나라 사진이 걸린다.
  좋음: "Seoul National Assembly building", "Gwanghwamun square"
  나쁨: "handshake stage"(인도네시아 아이돌 행사가 걸렸다), "news desk"
- JSON 배열만 출력: [{"title":"화면 제목(12자 이내)","say":"읽을 문장(${loChars}~${hiChars}자)","place":"City or Country","entity":"Proper Name","visual":"english b-roll words"}]
- 장면 ${SCENES}개. 마지막 장면은 채널 마무리.${nudge ?? ''}`
  : `You write scripts for a US news-issue channel. Use ONLY the headlines below. Target ${TARGET_SEC} seconds.

${brief}

Rules:
- Use only facts present in the headlines. Do not invent numbers, quotes, or background.
- Write for a US audience. Lead with why it matters to Americans.
- Anchor-read sentences. Conversational broadcast tone, not written prose.
- **Scene 1 is the hook.** Open with the single most striking concrete fact — a name, a number,
  a consequence. No warm-up, no "today we look at", no "in the news". The first six words decide
  whether anyone keeps watching.
- Spell out figures for text-to-speech (e.g. "seventeen billion dollars", not "$17B").
- "place": WHERE this story happens — a country, city or landmark, in English.
  Every news story has a location, and stock libraries hold **real footage of places**
  (they only hold model stock of people). This is what makes the screen look like the event.
  Examples: "Nepal Kathmandu", "Washington DC", "Seoul". Leave "" only if truly location-less.
- "entity": the REAL subject — a person or organization, as a **proper name only**.
  Examples: "Dolly Parton", "United States Secret Service", "Meta".
  Do NOT write descriptive phrases like "teen boy", "nuclear regulator", "hundreds of missing
  Americans" — those match nothing in an archive. If there is no proper name, leave it "".
- "visual": ONE English phrase of 2-3 words for generic b-roll, used to fill extra cuts.
  A PLACE, OBJECT or SCENE — not a person. Do NOT list comma-separated options.
  It is searched against a worldwide archive, so make it unambiguous and American —
  a generic phrase pulls the wrong country.
  Good: "US Capitol dome", "federal courtroom bench".
  Bad: "handshake stage" (matched an Indonesian idol event), "news desk", "open book".
- Output ONLY a JSON array: [{"title":"on-screen title (<=18 chars)","say":"line to read (${loChars}-${hiChars} chars)","place":"City or Country","entity":"Proper Name","visual":"english b-roll words"}]
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
let groundNudge = '';                     // 지어낸 이름을 지적해 다음 시도에 넘긴다
// 사실 검증의 근거. 이 편이 다루는 모든 이슈의 헤드라인을 합친 것이다.
const ALL_HEADLINES = issues.flatMap((c) => c.headlines ?? []).join(' | ');
for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
  const nudge = (attempt === 1 ? '' : (isKo
    ? `\n- 직전 시도는 총 ${chars}자로 너무 짧았다. 이번엔 총 ${Math.round(budgetChars * 1.15)}자 이상 쓰라. 장면마다 2~3문장.`
    : `\n- Your previous attempt was only ${chars} characters, too short. Write at least ${Math.round(budgetChars * 1.15)} characters total this time — 2 to 3 sentences per scene.`)) + groundNudge;
  try { scenes = await askLLM(nudge); } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
  chars = scenes.reduce((n, x) => n + x.say.length, 0);
  if (scenes.length < 3) { console.log(`  [대본] 시도 ${attempt}: 장면 ${scenes.length}개 — 부족, 재시도`); continue; }
  // [사실 검증] 헤드라인에 없는 고유명사·숫자가 있으면 지어낸 것이다.
  //   실측(2026-08-28): 실시간 헤드라인 836건 어디에도 없는 "트럼프가 온타리오호를
  //   Lake America 로 개명" 이 대본에 들어가 영상까지 나왔다. 프롬프트의 금지 문구는
  //   지켜지지 않는다 — 코드가 봐야 한다. 지어낸 뉴스를 내보내는 건 되돌릴 수 없다.
  const fake = ungroundedScenes(scenes, ALL_HEADLINES);
  if (fake.length) {
    const shown = fake.map((f) => `장면${f.scene}: ${f.words.join(', ')}`).join(' · ');
    console.log(`  [대본] 시도 ${attempt}: 근거 없는 고유명사 — ${shown}`);
    groundNudge = isKo
      ? `\n- 직전 시도에 헤드라인에 없는 말이 있었다: ${fake.flatMap((f) => f.words).join(', ')}. 헤드라인에 실제로 있는 이름과 숫자만 쓰라.`
      : `\n- Your previous attempt used names/numbers that are NOT in the headlines: ${fake.flatMap((f) => f.words).join(', ')}. Use ONLY names and numbers that literally appear in the headlines above.`;
    if (attempt < MAX_TRIES) continue;
    // 마지막 시도에서도 남으면 **그 문장만** 덜어낸다. 한 낱말 때문에 그날 영상이
    //   통째로 안 나오는 건 과하다 — 지어낸 문장을 빼고 나머지로 간다.
    const strip = stripUngrounded(scenes, ALL_HEADLINES);
    scenes = strip.scenes.filter((x) => (x.say ?? '').trim().length > 0);
    chars = scenes.reduce((n, x) => n + x.say.length, 0);
    console.log(`  [대본] 근거 없는 문장 ${strip.removed}개 제거 → 장면 ${scenes.length}개 · ${chars}자`);
    if (scenes.length < 3) {
      console.error(`❌ 근거 없는 문장을 빼니 장면이 ${scenes.length}개뿐이다 — 낼 수 없다.`);
      process.exit(1);
    }
    break;
  }
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
// 산출물 디렉터리는 MEDIA_ROOT 가 만든다(위 ensureDir). 여기서 로컬을 또 만들지 않는다.

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

/**
 * 내려받은 그림이 사진인지 그래픽인지 **픽셀로** 본다.
 * 확장자·제목으로는 못 가른다 — JPG 로 저장된 로고가 실제로 화면을 채웠다(2026-08-28).
 * 판정 못 하면(ffmpeg 실패) null 을 낸다 — 모를 때 버리면 화면이 카드로 떨어진다.
 */
const probeFlat = (file, isVideo) => {
  const r = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', ...(isVideo ? ['-ss', '1'] : []), '-i', file,
    '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ], { maxBuffer: 1 << 20 });
  if (r.status !== 0 || !r.stdout?.length) return null;
  return flatShare(r.stdout);
};

const localFiles = existsSync(BROLL) ? readdirSync(BROLL) : [];
const credits = [];
// 한 화면이 12초 동안 안 바뀌면 그게 "PPT" 다. 장면당 여러 컷을 모아 나눈다.
const MAX_SHOTS = Number(process.env.VIDEO_MAX_SHOTS ?? 3);
const MIN_SHOT = 3.2;
const shots = [];                    // 화면 트랙. 음성/자막은 장면 단위, 화면은 컷 단위로 간다.
const usedQuotes = new Set();        // 같은 발언 카드를 두 번 띄우지 않는다
let thumbSrc = null;                 // 썸네일에 쓸 실사 사진(아카이브 이미지)
let thumbVideo = null;               // 썸네일에 쓸 **영상** 원본 — 사진보다 우선한다
let shotSeq = 0;

for (let i = 0; i < scenes.length; i++) {
  // 뉴스 화면은 "그 사건" 이어야 한다 — 실제 대상(entity)을 먼저 찾고, 남는 컷을 일반 b-roll 로 채운다.
  const issueForScene = issues[Math.min(issues.length - 1, Math.floor(i * issues.length / scenes.length))];
  const sourceText = (issueForScene?.headlines ?? []).join(' | ');
  const queries = sceneQueries(scenes[i]);
  // place 는 두 관문을 통과해야 화면이 된다.
  //   ① 근거(헤드라인)에 실제로 있는가 — 없으면 LLM 이 지어낸 말이다.
  //   ② 지리적 장소인가 — "Prison" 처럼 장소가 아닌 말은 스톡에서 **연출 영상**을 불러온다.
  // 통과 못 하면 질의를 버린다. entity(아카이브 실사) 로 내려가는 편이 훨씬 정확하다.
  if (scenes[i].place) {
    const pq = searchTerms({ visual: String(scenes[i].place) }, { max: 3 });
    const key = pq.join(' ').toLowerCase();
    const at = queries.findIndex((q) => q.join(' ').toLowerCase() === key);
    if (at >= 0) {
      const g = grounded(scenes[i].place, sourceText);
      const p = await isPlace(scenes[i].place);
      if (p === false) {
        // 장소가 아닌 말은 **버린다.** 스톡에 물으면 연출 영상(배우)이 나오고,
        //   그건 실존 인물 기사에서 그 사람으로 읽힌다 — 틀린 그림보다 나쁘다.
        queries.splice(at, 1);
        console.log(`  [화면] ${i + 1} 장소 "${scenes[i].place}" 버림 — 지리적 장소 아님`);
      } else if (!g) {
        // 헤드라인에 없는 장소는 **강등한다.** 지어낸 것일 수도 있지만("Lake Ontario"),
        //   맥락상 맞을 수도 있다("연준" → "Washington DC"). 둘을 코드가 못 가른다.
        //   버리면 8/8 장면이 아카이브 정지사진으로 떨어져 다시 슬라이드쇼가 된다(실측).
        //   entity 뒤로 미루면 실제 대상이 먼저 잡히고, 남는 컷만 이 장소로 채운다.
        queries.push(queries.splice(at, 1)[0]);
        console.log(`  [화면] ${i + 1} 장소 "${scenes[i].place}" 강등 — 헤드라인에 없음`);
      }
    }
  }
  // entity 질의가 어느 것인지 기억해 둔다 — 소스 분기의 기준이다(순서로 판단하면 place 유무에 흔들린다).
  const entityQ = scenes[i].entity
    ? queries.find((q) => q.join(' ').toLowerCase() === searchTerms({ visual: String(scenes[i].entity) }, { max: 4 }).join(' ').toLowerCase())
    : null;
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
  const quote = issueForScene?.quote && !usedQuotes.has(issueForScene.quote.text) ? issueForScene.quote : null;

  // 사람이 assets/broll 에 넣은 클립(Flow 생성물 포함). 라이선스 판단은 넣은 사람이 한 것으로 본다.
  // **entity 질의로만** 맞춘다 — queries.flat() 으로 하면 일반 b-roll 검색어가 걸려서
  //   실제 대상 사진을 밀어낸다(실측: "Secret Service" 장면에 국회의사당 클립이 깔렸다).
  const local = isClosing ? null : matchLocal(localFiles, queries[0] ?? []);

  // entity → visual 순으로, 각 질의는 넓은 것부터 좁은 것까지 내려간다.
  //   3단어 AND 매칭은 쉽게 0건이 된다(실측).
  let picks = [], usedQ = terms, pool = [];
  if (!local && !isClosing) {
    outer:
    for (let qi = 0; qi < queries.length; qi++) {
      const base = queries[qi];
      // 소스를 질의 성격으로 가른다.
      //   **인물·기관(entity)은 아카이브 사진으로만.** Pexels 는 모델 스톡이라 "Dolly Parton" 을
      //     물으면 분홍 머리 모델이 나온다(실측 2026-08-27) — 부고에 다른 사람 얼굴이 뜬다.
      //   **장소(place)와 b-roll 은 동영상 우선.** 장소는 스톡이 진짜 현지 영상을 갖고 있다.
      const isEntityQ = base === entityQ;
      const sources = isEntityQ
        ? [searchCommons, searchOpenverse]
        : [searchPexelsVideo, searchCommons, searchOpenverse];
      for (const q of queryLadder(base)) {
        let cands = [];
        // 인물 아카이브에서는 **1컷만** — 누구인지 보여주는 설정샷 하나면 된다.
        //   아카이브 사진 3장을 이어 붙이면 다시 슬라이드쇼가 된다.
        const wantHere = isEntityQ ? 1 : want.length;
        for (const fn of sources) {
          try { cands = cands.concat(await fn(q, { limit: 12 })); } catch { /* 한 소스가 죽어도 나머지로 */ }
          // terms 를 넘겨야 관련성 검사가 걸린다 — 안 넘기면 매체 종류만 보고 통과시킨다.
          const got = pickFootageMany(cands, wantHere, { terms: q, preferFree: PREFER_FREE });
          if (got.length) { picks = got; usedQ = q; pool = cands; break outer; }
        }
      }
    }
    // 실제 대상으로 컷을 다 못 채웠으면 일반 b-roll 로 보충한다.
    if (picks.length && picks.length < want.length) {
      const seen = new Set(picks.map((x) => x.url));
      // 보충은 **동영상 우선**. pickFootage 가 kind==='video' 를 앞세우므로 Pexels 가 먼저 잡힌다.
      const fill = queries[1] ?? queries[0];
      let extra = [];
      for (const fn of [searchPexelsVideo, searchCommons, searchOpenverse]) {
        try { extra = extra.concat(await fn(fill, { limit: 12 })); } catch { /* noop */ }
      }
      for (const p of pickFootageMany(extra.filter((x) => !seen.has(x.url)),
        want.length - picks.length, { terms: fill, preferFree: PREFER_FREE })) picks.push(p);
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
      let pick = picks[k];
      const ext = pick.kind === 'video' ? 'mp4' : 'jpg';
      const file = `${WORK}/bg${shotSeq}.${ext}`;
      try {
        await download(pick.url, file);
        // 로고·차트는 화면이 될 수 없다. 픽셀로 보고, 걸리면 같은 검색 결과의 다음 후보로 간다.
        //   여기서 안 거르면 남의 방송사 로고(CBS)가 우리 배경으로 깔린다(2026-08-28 실측).
        let tries = 0;
        while (tries < 3 && isGraphicFrame(probeFlat(file, pick.kind === 'video') ?? 0)) {
          const usedUrls = new Set(shots.map((x) => x.url).concat(picks.map((x) => x.url)));
          // 대체 후보도 **본선과 같은 기준**을 통과해야 한다. licenseUsable 만 보면
          //   350px 짜리가 배경으로 올라온다(실측 2026-08-28) — 라이선스는 화질이 아니다.
          const [alt] = pickFootageMany(
            pool.filter((c) => !usedUrls.has(c.url) && c.url !== pick.url),
            1, { terms: usedQ, preferFree: PREFER_FREE },
          );
          if (!alt) break;
          console.log(`  [화면] ${i + 1} 그래픽으로 판정 → 다음 후보 (${pick.width}px ${pick.license})`);
          pick = alt;
          picks[k] = alt;
          await download(alt.url, file);
          tries++;
        }
        shots.push({ kind: pick.kind, file, url: pick.url, dur: durs[k], zin: shotSeq % 2 === 0 });
        // 썸네일 배경: **첫 장면의 실사 사진**. 동영상은 프레임을 뽑아야 해서 사진을 우선한다.
        // 인용 카드가 1번 컷이면 사진이 안 잡히므로 장면을 한정하지 않는다.
        if (!thumbSrc && pick.kind === 'image') thumbSrc = file;
        // 아카이브 사진에는 회화·판화가 섞인다(실측 2026-08-28: 썸네일 배경이 19세기 수채화였다).
        //   스톡 **영상**은 전부 사진이므로, 영상이 있으면 그 프레임을 먼저 쓴다.
        if (!thumbVideo && pick.kind === 'video') thumbVideo = file;
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
  // 줄당 글자 수를 밴드 폭에 맞춘다. 실측(2026-08-27): fs54·40자면 가용 1580px 중 1080px 만 써
  //   밴드의 3분의 1이 놀았다. fs66·48자면 1584/1700 = 93% 를 채운다.
  //   한글은 글자 폭이 라틴의 약 2배라 절반으로 잡는다.
  cues.push(...cuesFromAlignment(s.alignment, {
    maxChars: isKo ? 25 : 46, maxLines: 2, maxDur: 4.2, offset: off,
  }));
  off += s.dur;
}
// 장면 경계의 0.45초 꼬리 때문에 밴드만 남고 글자가 사라지는 구간이 생긴다(실측 t=48초).
// 짧은 빈틈은 앞 큐를 늘려 덮는다.
const filled = fillGaps(cues, 1.6);
// 큐마다 글자 크기를 문장 길이에 맞춘다 — 줄 균형을 맞춰도 문장이 짧으면 가로가 빈다.
//   상한은 밴드 높이에서 역산한다(두 줄이 띠를 넘지 않게).
const SUB_FS = isKo ? 66 : 70;
const SUB_MAXCHARS = isKo ? 25 : 46;
writeFileSync(`${WORK}/subs.ass`, toAss(filled, {
  autoFit: true, maxChars: SUB_MAXCHARS,
  maxScale: fitScale({ bandTop: BAND.top, marginV: BAND.marginV, fontSize: SUB_FS, lines: 2 }),
  style: 'band',                     // 하단 밝은 띠 안의 어두운 글자 — 띠는 아래 furniture 가 그린다
  font: isKo ? 'Apple SD Gothic Neo' : 'Arial',
  fontSize: SUB_FS,
  marginV: BAND.marginV, marginLR: 110,
  // 밴드의 세로 중심. 1줄이든 2줄이든 글자 블록이 여기에 맞춰진다.
  vcenterY: BAND.top + BAND.height / 2,
}));
console.log(`  [자막] 큐 ${cues.length}개`);
if (ABOX) {
  // 앵커와 목소리의 성별이 어긋나면 **멈춘다.** 화면과 소리가 따로 노는 건
  //   렌더가 끝나고 사람이 봐야만 드러나고, 그때는 이미 업로드된 뒤다.
  const vg = await voiceGender(locale).catch(() => null);
  const bad = genderMismatch(anchorName, vg);
  if (bad && !argv.includes('--allow-voice-mismatch')) { console.error(`❌ ${bad}`); process.exit(1); }
  console.log(`  [앵커] ${anchorName} (${vg ?? '목소리 성별 미상'}) → ${ABOX.w}x${ABOX.h} @${ABOX.x},${ABOX.y}`);
}
else console.log('  [앵커] 없음 — assets/anchor 에 파일을 넣으면 켜진다');

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
${ABOX ? anchorFrameCss(ABOX) : ''}
.band{position:absolute;left:0;right:0;top:${BAND.top}px;height:${BAND.height}px;
  background:rgba(231,237,244,.90);border-top:4px solid rgba(74,90,112,.85);
  border-bottom:4px solid rgba(74,90,112,.85)}
</style>
<div class="kick">${esc(KICK)}</div>
<div class="right"><div class="brand">FLOWVIUM</div></div>
<div class="band"></div>${ABOX ? '<div class="anchor"></div>' : ''}`;

/**
 * 마무리 화면. 채널 자체 그래픽이다.
 * 스톡 뉴스룸 클립에는 "TOMATO NEWS" 같은 **가짜 방송사 브랜딩이 박혀** 있어 쓸 수 없다(실측).
 */
// box-sizing 이 없으면 padding 이 뷰포트 밖으로 밀려나 **가운데정렬이 안 움직인다** —
//   그래서 SAFE_RIGHT 를 줬는데도 로고가 앵커 박스 밑으로 들어갔다(2026-08-28 실측).
//   주석은 반드시 스타일 블록 **밖**에 둔다 — CSS 에는 줄주석이 없고, 파서가 그 뒤 블록을
//   통째로 버려서 리셋과 body 규칙이 함께 사라진다(이것도 2026-08-28 실측).
const signoffBg = () => `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px}
body{background:radial-gradient(1400px 800px at 50% 42%,#1b2a48 0%,rgba(0,0,0,0) 66%),
  linear-gradient(150deg,#070b16,#111c33 55%,#070b16);
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;color:#eef3ff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:0 ${SAFE_RIGHT}px ${H - BAND.top + 30}px 0}
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
    await page.setContent(quoteCardHtml(shots[i].quote, { width: W, height: H, bandTop: BAND.top, rightInset: SAFE_RIGHT }));
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
  // 실사를 못 찾은 자리. Flow(Nano Banana)로 미리 만들어 둔 배경이 있으면 그것을 쓴다 —
  //   그라디언트보다 화면이 산다. 없으면 종전 그라디언트로 간다(생성은 렌더 밖에서 한다).
  //   실사를 **대체하지는 않는다**: 여기까지 온 건 실사가 없다는 뜻이다.
  if (CARD_FILES.length) {
    shots[i] = { ...shots[i], kind: CARD_KIND, file: CARD_FILES[i % CARD_FILES.length] };
    continue;
  }
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
  // 앵커: 3:4 중앙 크롭 → 박스 크기로. 중앙 크롭은 Veo 워터마크(우하단 x≈1240~1268)를
  //   **자동으로 잘라낸다** — 1280x720 에서 3:4 크롭은 x 370~910 이라 그 자리가 없다.
  const anchorIn = ABOX ? ['-stream_loop', '-1', '-t', len.toFixed(3), '-i', anchorFile] : [];
  const anchorChain = ABOX
    ? `[2:v]crop='min(iw,ih*3/4)':ih:'(iw-min(iw,ih*3/4))/2':0,scale=${ABOX.w}:${ABOX.h},`
      + `fps=${FPS},setpts=PTS-STARTPTS[an];`
    : '';
  // fx 입력에도 -loop/-t 를 준다. **없으면 오버레이가 통째로 사라진다** —
  //   단일 프레임 PNG 은 t=0 프레임 하나뿐이라 fade(alpha) 가 그걸 alpha=0 으로 만들고,
  //   overlay 의 eof_action=repeat 이 그 투명 프레임을 컷 내내 반복한다.
  // 순서: 배경 → 앵커 → 그래픽(액자·밴드). 그래픽이 맨 위라 앵커 테두리가 그 위에 그려진다.
  ff([
    '-y', '-hide_banner', '-loglevel', 'error', ...inputs,
    '-framerate', String(FPS), '-loop', '1', '-t', len.toFixed(3), '-i', `${WORK}/fx.png`,
    ...anchorIn,
    '-filter_complex',
    `${bgChain};${anchorChain}[1:v]format=rgba[fx];`
    + (ABOX ? `[bg][an]overlay=${ABOX.x}:${ABOX.y}:format=auto[bga];[bga][fx]` : '[bg][fx]')
    + `overlay=0:0:format=auto,format=yuv420p,trim=duration=${len.toFixed(3)},setpts=PTS-STARTPTS[v]`,
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

// ── 배경음악 ────────────────────────────────────────────────────────────────
// "살짝만" — 존재를 의식하지 못할 정도. 나레이션이 항상 위에 있어야 한다.
//   MUSIC_DB(-26dB) 는 나레이션 대비 약 5% 크기다. 이보다 크면 말이 묻힌다.
const MUSIC_DB = Number(process.env.VIDEO_MUSIC_DB ?? -26);
let musicFile = null, musicInfo = null;
if (MUSIC_DB > -60) {
  try {
    const tracks = await searchMusic(process.env.VIDEO_MUSIC_QUERY ?? 'cinematic ambient');
    const t = pickTrack(tracks, { needSec: totalSec });
    if (t) {
      await download(t.url, `${WORK}/music.mp3`);
      musicFile = `${WORK}/music.mp3`;
      musicInfo = t;
      const cr = musicCredit(t);
      if (cr) credits.push(cr);
      console.log(`  [음악] ${(t.duration / 1000).toFixed(0)}초 · ${t.license} · "${String(t.title).slice(0, 34)}"`);
    } else console.log('  [음악] 쓸 만한 트랙 없음 — 음악 없이 간다');
  } catch (e) { console.log(`  [음악] 실패(${e.message.slice(0, 50)}) — 음악 없이 간다`); }
}

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
const voiceIdx = shots.length;
const musicIdx = voiceIdx + 1;
// 음악은 나레이션 **아래**로 깐다. 곡이 짧으면 반복하고, 영상 길이에 맞춰 자른 뒤
//   끝에서 2초 페이드아웃 — 뚝 끊기면 그 순간이 오히려 도드라진다.
const audioChain = musicFile
  ? `[${musicIdx}:a]volume=${MUSIC_DB}dB,afade=t=out:st=${Math.max(0, totalSec - 2).toFixed(2)}:d=2[bg];`
    + `[${voiceIdx}:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
  : null;
ff(['-y', '-hide_banner', '-loglevel', 'error', ...vin, '-i', `${WORK}/voice.mp3`,
    ...(musicFile ? ['-stream_loop', '-1', '-i', musicFile] : []),
    '-filter_complex', audioChain ? `${chain};${audioChain}` : chain,
    '-map', '[v]', '-map', audioChain ? '[a]' : `${voiceIdx}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', OUT], 'final');


// ── 썸네일 ──────────────────────────────────────────────────────────────────
// 클릭률이 조회수의 첫 관문이다. 영상에서 이미 내려받은 **실사 사진을 재사용**한다.
//   Flow 로 배경을 생성하는 길도 있다 — 실측(2026-08-28) 결과 Nano Banana 는
//   이 계정에서 **크레딧을 쓰지 않았다**(25030 → 25030, 이미지 생성 확인).
//   그래도 기본은 실사다. 뉴스 썸네일에 생성 이미지를 쓰면 "그 사건의 사진" 이 아니게 된다.
const THUMB = OUT.replace(/\.mp4$/, '-thumb.jpg');
try {
  // 배경: 인용 카드·사인오프가 아닌 **실제 화면** 하나. 사진이면 그대로, 동영상이면 프레임을 뽑는다.
  // 우선순위: 스톡 영상 프레임 → 아카이브 사진 → 완성된 컷.
  //   아카이브 사진은 회화가 섞일 수 있어 뒤로 민다.
  let bg = null;
  if (thumbVideo && existsSync(thumbVideo)) {
    bg = `${WORK}/thumb-frame.jpg`;
    spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
      '-ss', '1.2', '-i', thumbVideo, '-frames:v', '1',
      '-vf', `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720`, bg]);
    if (!existsSync(bg)) bg = null;
  }
  if (!bg) bg = thumbSrc;
  if (!bg) {
    const idx = shots.findIndex((sh) => !sh.isQuote);
    if (idx >= 0 && existsSync(`${WORK}/v${idx}.mp4`)) {
      bg = `${WORK}/thumb-frame.jpg`;
      spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
        '-ss', (shots[idx].dur * 0.4).toFixed(2), '-i', `${WORK}/v${idx}.mp4`, '-frames:v', '1',
        '-vf', `crop=${W}:${BAND.top}:0:0`, bg]);
    }
  }
  // **data URI 로 인라인한다.** setContent 로 만든 about:blank 페이지에서는 file:// 이 차단돼
  //   배경이 조용히 비었다(실측 2026-08-27: 썸네일이 검게 나왔다).
  let dataUri = null;
  if (bg && existsSync(bg)) {
    const buf = readFileSync(bg);
    const mime = /\.png$/i.test(bg) ? 'image/png' : 'image/jpeg';
    dataUri = `data:${mime};base64,${buf.toString('base64')}`;
  }
  const head = issues[0]?.headlines?.[0] ?? scenes[0]?.title ?? '';
  const b3 = await chromium.launch();
  const p3 = await b3.newPage({ viewport: { width: 1280, height: 720 } });
  await p3.setContent(thumbnailHtml({
    text: head, kicker: isKo ? '속보' : 'BREAKING', image: dataUri,
  }, { width: 1280, height: 720 }));
  await p3.screenshot({ path: THUMB, type: 'jpeg', quality: 92 });
  await b3.close();
  console.log(`  [썸네일] ${THUMB} · "${thumbLines(head).join(' / ')}" · 배경 ${dataUri ? (bg === thumbVideo || /thumb-frame/.test(String(bg)) ? '영상프레임' : '사진') : '없음'}`);
} catch (e) { console.log(`  ⚠ 썸네일 실패: ${e.message.slice(0, 60)}`); }


const measured = spawnSync(ffmpegPath, ['-hide_banner', '-i', OUT], { encoding: 'utf8' }).stderr ?? '';
const dur = (measured.match(/Duration:\s*(\d+):(\d+):([\d.]+)/) ?? []).slice(1);
const realSec = dur.length ? (+dur[0] * 3600 + +dur[1] * 60 + +dur[2]) : totalSec;

// 표기 의무는 **영상 옆에** 남긴다. 임시폴더에 두면 렌더 뒤 사라지고,
//   설명란에 붙일 사람이 찾을 수 없다.
const CREDITS = OUT.replace(/\.mp4$/, '-credits.txt');
// 표기 의무가 **없으면 파일을 지운다.** 안 지우면 지난 편의 출처가 그대로 남아,
//   이번 편에 없는 사진을 설명란에 적게 된다(2026-08-28: Billy Porter 사진이 그렇게 남았다).
//   "쓸 게 없으면 안 쓴다" 는 "지난 값이 남는다" 와 같은 뜻이다.
if (credits.length) writeFileSync(CREDITS, credits.join('\n'));
else { try { rmSync(CREDITS); } catch { /* 원래 없었으면 그만이다 */ } }
console.log(`\n✅ ${OUT}`);
console.log(`   ${realSec.toFixed(1)}초 (목표 ${TARGET_SEC}) · ${(statSync(OUT).size / 1048576).toFixed(1)}MB`
  + ` · ${shots.length}컷/${scenes.length}장면 · 자막 ${cues.length}큐 · 소재: ${issues.map((c) => c.keyword).join(', ')}`);
console.log(`   실측 낭독속도 ${(scriptChars / (totalSec - scenes.length * 0.45)).toFixed(1)}자/초`
  + ` (설정값 ${CHARS_PER_SEC[isKo ? 'ko' : 'en']})`);

if (credits.length) console.log(`   ⚠ 표기 의무 ${credits.length}건 → ${CREDITS} (영상 설명란에 넣을 것)`);
else console.log('   표기 의무 0건 — 전부 CC0/PD');

// 작업 폴더를 통째로 비운다. 여기 있는 것은 **전부 재생성 가능한 중간물**이다 —
//   컷 mp4·배경 이미지·장면별 mp3·자막 ass·오버레이 png. 남길 것(영상·썸네일·크레딧)은
//   이미 MEDIA_ROOT 에 따로 쓴다.
//   종전엔 v*.mp4 와 bg* 만 지워서 음성·자막·음악이 편당 7MB 씩 남았다(2026-08-28 실측).
//   **썸네일과 크레딧을 만든 뒤**에 지워야 한다 — 순서가 반대면 썸네일 배경이 이미 없다.
//   --out 을 작업 폴더 안으로 지정하면 영상까지 지워진다. 지우기 전에 확인한다.
if (OUT.startsWith(WORK + sep)) {
  console.log(`  작업 폴더 유지 — 출력이 그 안에 있다 (${OUT})`);
} else {
  try { rmSync(WORK, { recursive: true, force: true }); }
  catch (e) { console.log(`  ⚠ 작업 폴더 정리 실패: ${WORK} — ${e.message}`); }
}

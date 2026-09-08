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
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, readdirSync, copyFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ROOT } from '../lib/project-root.mjs';
import { stripByline, cleanHeadline, textLeftovers, unsourcedAffiliation } from '../lib/wire-text.mjs';
import { loadEnvLocal } from '../lib/llm-config.mjs';
import { topDistinctIssues } from '../lib/issue-cluster.mjs';
import { fitScript } from '../lib/script-budget.mjs';
import { bestQuote } from '../lib/quote-card.mjs';
import { searchTerms, searchCommons, searchOpenverse, searchArchiveVideo, searchKoglCommons, pickFootageMany, creditLine, titleRelevant, hasDistinctiveTerm, isRealFootage, koreanEntities, properNounsFrom, preferRecent, needsKoreaAnchor, looksKorean, isBarePlace, canSearchAlone, isVaguePlaceQuery } from '../lib/footage.mjs';
import { cuesFromAlignment, fillGaps } from '../lib/subtitle.mjs';
import { synthesizeKorean, synthesizeKoreanBatch, koTtsReady, qwenTtsReady } from '../lib/tts-korean.mjs';
import { SHORTS as G, shortsOverlayHtml, mediaFilter, tightenNumbers } from '../lib/shorts-layout.mjs';
import { isProudHeadline } from '../lib/video-meta.mjs';
import { isCoherentIssue, isSameStory, hasParticle, isTopicKeyword, itemsOnTopic, isPromotional } from '../lib/issue-coherence.mjs';
import { attributionIssues } from '../lib/attribution.mjs';
import { resolveMediaRoot } from '../lib/media-root.mjs';
import { searchGoogleImages, closeGoogleImages, googleCoolingDown } from '../lib/google-images.mjs';
import { recentShortsIssues, normalizeIssueKey, shortsPublishedCount } from '../lib/db.mjs';

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
  // Qwen 이 주력이고 Piper 가 대비책이다. **둘 다 없으면** 멈춘다 —
  //   여기서 통과시키면 tts-local(미국 남성)이 한국어를 읽는 영상이 나간다.
  const q = qwenTtsReady();
  const p = koTtsReady();
  if (!q.ok && !p.ok) {
    console.error(`❌ 한국어 TTS 가 하나도 준비 안 됨 — Qwen: ${q.reason} / Piper: ${p.reason}`);
    process.exit(1);
  }
  if (!q.ok) log(`⚠ Qwen 미준비(${q.reason}) — Piper 로 간다`);
}

// ── 1. 소재가 될 이슈 하나 ──────────────────────────────────────────────────────
// 쇼츠는 한 편에 한 주제다. 여러 이슈를 담으면 45초 안에 아무것도 전달 못 한다.
// 2026-09-03 사용자: "주제를 정치랑 경제만 하자."
//   사회면(연합뉴스 사회 528건)이 사고·재난·사건의 출처였다. 그쪽은 소재도 없고
//   (정부가 사고 현장을 공공누리로 풀지 않는다) 톤도 위험하다 —
//   실종자 6명 기사에 해동용궁사 관광 사진이 붙는 일이 실제로 났다.
//   정치·경제는 인물·기관 사진이 공공누리에 있어 소재가 맞는다.
//   스포츠·연예도 뺀다(원래 안 쓰고 있었지만 명시해 둔다).
const SRC = ['연합뉴스 정치', '연합뉴스 경제', '연합뉴스 국제',
  '한국경제 정치', '한국경제', '머니투데이',
  'Yahoo Finance', 'MarketWatch', 'SCMP Business',
  'Politico 정치', 'NPR 정치'];
// Seeking Alpha(407건/일)는 뺐다 — 양이 한국 기사를 압도하는데 클러스터가
//   "stocks"·"investors"·"tech" 같은 흔한 말로 뭉쳐 소재가 0건이었다. 한국어 채널에 신호가 안 된다.
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
const rows = db.prepare(
  `SELECT source, headline, summary, link FROM news_archive
   WHERE source IN (${SRC.map(() => '?').join(',')})
     AND datetime(captured_at) >= datetime('now','-24 hours')`,
).all(...SRC);
// 2026-09-06 사용자 "60분간격으로 하고 소재없으면 국뽕 주제로 해".
//   60분 주기면 하루 17회인데 최근 24시간에서 나오는 쓸 만한 이슈는 **11개**다(실측).
//   모자란 자리를 국뽕으로 채우려면 국뽕도 24시간 밖에서 가져와야 한다 —
//   수출·수주·세계 1위 같은 이야기는 하루 이틀 지나도 볼 만하다(사고·시세와 다르다).
//   평소 편성에는 안 쓰고, **다른 후보가 다 떨어졌을 때만** 여기서 꺼낸다.
const WIDE_HOURS = Number(process.env.SHORTS_PROUD_LOOKBACK_HOURS || 96);
const wideRows = db.prepare(
  `SELECT source, headline, summary, link FROM news_archive
   WHERE source IN (${SRC.map(() => '?').join(',')})
     AND datetime(captured_at) >= datetime('now', ?)
     AND datetime(captured_at) < datetime('now','-24 hours')`,
).all(...SRC, `-${WIDE_HOURS} hours`);
db.close();
if (!rows.length) { console.error('❌ 최근 24시간 기사가 없다'); process.exit(1); }

// 2026-09-06: 태그·주소만 걷어냈지 **기자 서명은 그대로 두고 있었다.**
//   요약이 `(서울=연합뉴스) 노선웅 기자 = …` 로 시작하는데 대본 모델이 그걸 기사 내용으로 읽어
//   "서울 연합뉴스 노선웅 기자는 천하람 대표…" 라는 장면이 나갔다(rn6_MMr4BEg, 내렸다).
const stripHtml = (t) => stripByline(String(t ?? '').replace(/<[^>]*>/g, ' ')
  .replace(/&(nbsp|#160);/g, ' ').replace(/&(quot|#34);/g, '"').replace(/&(amp|#38);/g, '&')
  .replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim());

// 후보를 넉넉히 뽑는다. 8개만 보면 이미 다룬 것을 걸렀을 때 금방 바닥난다(하루 5편).
// 2026-09-06 사용자 "뉴스 쏘스는 넓히지말고 ... 좀 더 세밀하게 찾아서 올려".
//   소스를 넓히지 않고 **더 잘게 나누기만** 해도 공급이 크게 는다. 같은 기사로 실측:
//     묶음 24개 → 쓸 만한 이슈 8개 · 60개 → 23개 · **120개 → 52개** (250개는 더 안 는다)
//   덩어리가 크면 서로 다른 사건이 한 묶음이 되어 응집도 검사에서 통째로 탈락한다.
//   잘게 나누면 각 묶음이 실제로 한 사건이 되어 살아남는다.
//   하루 17슬롯에 52개면 국뽕·전쟁으로 억지로 채우지 않아도 된다.
const issues = topDistinctIssues(rows, Number(process.env.SHORTS_ISSUE_POOL || 120));
if (!issues.length) { console.error('❌ 이슈를 못 묶었다'); process.exit(1); }
// 매체가 많이 다룬 것 = 그날 실제로 큰 뉴스다. 다만 **이미 내보낸 이슈는 건너뛴다**.
//   2026-09-03 실측: 07:38 / 09:42 / 10:02 세 편이 전부 같은 헤드라인이었다. 24시간 기사 풀은
//   몇 시간 사이에 거의 안 바뀌므로 issues[0] 은 하루 종일 같은 것을 가리킨다.
//   사용자 요구는 "하루 5편이면 그날 큰 뉴스 5개" 이고, 중복 쇼츠는 노출도 눌린다.
// --issue=<키워드> 로 특정 이슈를 다시 만들 수 있다. 잘못 나간 편을 같은 주제로 다시 낼 때 쓴다
//   (2026-09-03: 직책 검색 때문에 옛날 총리 사진이 붙은 편을 다시 만들어야 했다).
//   이때는 편성 대장을 보지 않는다 — 이미 다룬 이슈를 **일부러** 고르는 것이기 때문이다.
const FORCE_ISSUE = arg('issue', '');
const already = FORCE_ISSUE ? new Set() : recentShortsIssues(Number(process.env.SHORTS_DEDUP_HOURS || 24));

// 2026-09-04: **한국어 기사 위주로 고른다.**
//   실측 — 영어 헤드라인만 있는 "trump" 이슈로 만들었더니 대본이 깨졌다:
//     "트럼프는 키빈 워시가 할 일을 할 것이라고" → "당했습니다."  (뜻이 안 통한다)
//     훅도 "폭탄," "소통," "시장," 처럼 낱말 하나에 쉼표만 남았다.
//   4B 모델이 영어를 한국어로 옮기면서 무너진다. 한국어 기사로 만든 편(홈플러스·용혜인)은 멀쩡했다.
//   소재가 맞아도 대본이 깨지면 볼 수 없는 영상이다 — 소재보다 앞선 조건이다.
const koShare = (it) => {
  const hs = (it.headlines ?? []).slice(0, 6);
  if (!hs.length) return 0;
  return hs.filter((h) => /[가-힣]/.test(String(h))).length / hs.length;
};
const KO_MIN = Number(process.env.SHORTS_KO_MIN_SHARE || 0.6);
let fresh = issues.filter((it) => !already.has(normalizeIssueKey(it.keyword)));
{
  const koOnly = fresh.filter((it) => koShare(it) >= KO_MIN);
  if (koOnly.length) {
    if (koOnly.length !== fresh.length) log(`[편성] 한국어 기사 위주 이슈 ${koOnly.length}/${fresh.length} 만 남긴다(영어 원문은 대본이 깨진다)`);
    fresh = koOnly;
  } else {
    // 2026-09-04 사용자: "왜 제목 설명이 영어로 나갔어? 수정해."
    //   종전엔 한국어 이슈가 없으면 영어로 넘어갔다. 그 결과 한국어 채널에
    //   "Should Investors Ride the Silver… #Shorts" 가 나갔다(22:09 실측).
    //   제목·설명이 영어면 한국 시청자에게 안 걸리고, 대본도 4B 번역이라 깨진다.
    //   **거르는 편이 낫다** — 한 회차 빠지는 것보다 영어 영상이 채널에 남는 게 나쁘다.
    console.error('❌ 한국어 기사 이슈가 없다 — 이번 회차를 거른다(영어 영상을 내지 않는다).');
    console.error('   다음 슬롯에 한국 기사가 쌓이면 정상 발행된다.');
    process.exit(3);   // 3 = 낼 것이 없음(실패와 구분)
  }
}
if (already.size) {
  log(`[편성] 최근 24시간에 이미 다룬 이슈 ${already.size}건 — 남은 후보 ${fresh.length}/${issues.length}`);
}
// 2026-09-03 사용자: "제목과 설명이 같은 영상이 세 개나 올라갔지? 다음부터는 안그러게 해라."
//   처음엔 새 이슈가 없으면 1위로 돌아가게 뒀는데, 그게 바로 중복이 나는 길이다.
//   **거르는 편이 낫다** — 한 회차 건너뛰면 그날 4편이지만, 중복은 채널에 영구히 남고
//   유튜브가 노출까지 누른다. 되돌릴 수 없는 쪽을 피한다.
// 오늘 것이 다 떨어졌으면 **지난 며칠의 국뽕**에서 꺼낸다(사용자 지시).
//   국뽕만 꺼낸다 — 사고·시세·정치 공방은 하루 지나면 낡지만 수출·수주·1위는 덜 낡는다.
if (!fresh.length && wideRows.length) {
  // 넓은 풀은 기사가 많아(실측 3,684건) 24개로 뭉치면 덩어리가 커져 응집도에서 다 떨어진다.
  //   잘게 나눌수록 쓸 만한 게 늘어난다 — 실측: 40개→4건, 120개→26건, 250개→66건.
  const wideIssues = topDistinctIssues(wideRows, Number(process.env.SHORTS_WIDE_POOL || 250))
    .filter((it) => !already.has(normalizeIssueKey(it.keyword)))
    .filter((it) => (it.headlines ?? []).some(isProudHeadline));
  if (wideIssues.length) {
    fresh = wideIssues;
    log(`[편성] 오늘 새 이슈가 없다 — 최근 ${WIDE_HOURS}시간의 국뽕 ${fresh.length}건에서 고른다`);
  }
}
if (!fresh.length) {
  console.error(`❌ 새 이슈가 없다 — 후보 ${issues.length}개가 모두 최근 ${process.env.SHORTS_DEDUP_HOURS || 24}시간 안에 나갔다.`);
  console.error('   중복 발행 대신 이번 회차를 거른다. 다음 슬롯에 새 기사가 쌓이면 정상 발행된다.');
  process.exit(3);   // 3 = 낼 것이 없음(실패가 아니다). 호출부가 실패와 구분할 수 있게 한다.
}
// 2026-09-03 사용자 "사건과 관련있는 영상과 사진만 넣어".
//   Pexels(스톡)를 빼고 나니 이슈에 따라 **소재가 하나도 없는 날**이 생긴다 —
//   실측: "공공기관" 이슈에서 네 장면이 전부 회색 카드로 떨어졌다.
//   순서를 뒤집는다. 뉴스를 먼저 고르고 소재를 찾는 게 아니라,
//   **보여줄 수 있는 뉴스를 고른다.** 큰 뉴스 여럿 중 무엇을 낼지는 어차피 우리 선택이다.
//   비용: 후보당 검색 1회. 전부 훑지 않고 앞쪽 몇 개만 본다.
// 2026-09-03 하루 5편 → 8편. 뒤 회차일수록 앞 이슈가 대장에 쌓여 후보가 얕아지므로
//   탐색 범위를 넓힌다. 실측: 이슈 14개 중 소재가 있는 것은 6개였다 — 6개만 보면 뒤 회차가 굶는다.
const PROBE_N = Number(process.env.SHORTS_FOOTAGE_PROBE || 12);
/** 국뽕 대체 후보를 몇 개까지 뒤질지. 탐색마다 검색이 돌므로 무한정 뒤지지 않는다. */
const PROUD_PROBE_N = Number(process.env.SHORTS_PROUD_PROBE || 6);
/**
 * 숫자가 매일 바뀌는 주제. 사진에 그날 수치가 찍혀 있어 날짜가 다르면 화면이 거짓말을 한다.
 * (2026-09-05 코스피 편에서 실제로 그랬다 — 화면 2,702·5,438 vs 자막 6,687.)
 */
// 2026-09-05: "뉴욕증시" 가 목록에 없어 구글을 불렀고 **두 번이나 봇 차단을 유발**했다
//   (19:00 회차와 20:45 백필). 시세 주제는 어차피 그날 사진이 아니면 못 쓴다 —
//   부르지 않으면 틀린 지수도 막고 차단도 덜 당한다.
const TIME_SENSITIVE = /(코스피|코스닥|뉴욕증시|증시\s*마감|환율|원\/달러|원달러|유가|국제유가|금값|다우|나스닥|S&P|비트코인|가상자산|국채|국고채\s*금리)/;
/** 편성 때 구글을 몇 번까지 부를지. 한 번에 5초쯤 걸리므로 무한정 부르지 않는다. */
let GOOGLE_PROBES_LEFT = Number(process.env.SHORTS_GOOGLE_PROBE || 5);
/** 이 이슈가 한국 기사인가. 장면 쪽 KO_ISSUE 와 같은 판정을 편성 시점에도 쓴다. */
let KO_TEXT = false;
async function footageScore(it) {
  KO_TEXT = /[가-힣]/.test(String((it.headlines ?? []).slice(0, 3).join(' ')));
  // 2026-09-06: **재는 잣대와 쓰는 잣대가 또 어긋났다.** 소재의 1순위를 기사 사진으로 바꿨는데
  //   여기(편성 점수)는 여전히 아카이브·구글만 셌다. 그래서 기사 사진이 1장뿐인 주제를
  //   1순위로 골라 세 번 연속 회차를 걸렀다(한일 미래路 편).
  //   실측: 같은 시각 후보들의 기사 사진 수 — 미래路 1장 · 여의나루역 5장.
  //   기사 사진은 한 이슈에 0.3초면 세어진다. 여기서 먼저 센다.
  try {
    const { issueImages } = await import('../lib/article-image.mjs');
    const { itemsOnTopic } = await import('../lib/issue-coherence.mjs');
    const lead = (it.headlines ?? [])[0] ?? '';
    const imgs = await issueImages(itemsOnTopic(lead, it.items ?? [], it.keyword), { max: 6 });
    const usable = imgs.filter((c) => isRealFootage(c));
    if (usable.length) return { n: usable.length, terms: [it.keyword], probed: [], viaArticle: true };
  } catch { /* 못 세면 아래 아카이브 점수로 간다 */ }
  // 헤드라인의 영문 고유명사 = 아카이브에서 찾을 수 있는 이름. 한글만 있는 이슈는 애초에 자료가 없다.
  // 2026-09-03: 클러스터의 **모든** 헤드라인에서 개체명을 뽑고 있었다.
  //   실측: "etf" 이슈에서 "국힘"(정당)으로 6건이 잡혀 "소재 있음"이 됐는데,
  //   정작 영상 주제는 Healthcare ETF 비교였다 — 전혀 다른 기사의 소재를 세고 있었다.
  //   영상이 다루는 것은 대표 헤드라인 몇 개다. 그것만으로 센다.
  const text = String((it.headlines ?? []).slice(0, 3).join(' '));
  // 한국 뉴스는 영문 고유명사가 거의 없다. 한국어 개체명으로 찾는 게 본선이고 영문은 보조다.
  //   실측: 아카이브가 "홈플러스 스페셜 대구점.jpg"·"…용혜인 기본소득당 대표 예방.webm" 을 들고 있다.
  // 2026-09-03: 탐색기가 **낱말 하나**로 세고 있었다. 장면 검색은 두 낱말을 요구하는데
  //   여기만 규칙이 달라, "부산" 하나로 관광 사진 8건을 세고 "소재 있음"으로 판정했다.
  //   그래서 실종자 6명 기사가 편성됐고, 정작 화면에는 해동용궁사 앞바다 사진이 세 장면에 깔렸다.
  //   **재는 잣대와 쓰는 잣대가 다르면 재는 의미가 없다.** 장면 검색과 같은 규칙으로 센다.
  // 2026-09-04: koreanEntities(빈도순 낱말)는 "모두"·"외국인" 같은 흔한 말을 내놓았고
  //   그걸로 16건을 세어 엉뚱한 이슈를 편성했다. 문맥이 뒷받침하는 고유명사만 쓴다.
  const ko = properNounsFrom(text, { max: 4 });
  const queries = [];
  for (let x = 0; x < ko.length && queries.length < 4; x++) {
    for (let y = x + 1; y < ko.length && queries.length < 4; y++) queries.push([ko[x], ko[y]]);
  }
  const en = [...new Set((text.match(/[A-Z][A-Za-z]{2,}/g) ?? []))].slice(0, 3);
  if (en.length >= 2 && hasDistinctiveTerm(en)) queries.push(en);
  // 단독으로 찾아도 되는 낱말(사람 이름·회사·기관 고유명)은 단독 질의를 **앞에** 둔다.
  //   짝만 요구하면 "용혜인 의원직" 같은 조합이 되어 아무것도 안 걸린다(실측 0건).
  const solo = ko.filter((k) => canSearchAlone(k)).map((k) => [k]);
  const usable = [...solo, ...queries.filter((q) => q.length >= 2 && !isBarePlace(q))];
  if (!usable.length) return { n: 0, terms: [], probed: [] };
  let best = { n: 0, terms: usable[0], probed: [] };
  // 2026-09-05: 여기서 **실제로 결과가 나온 질의**를 알아내고도 그냥 버렸다.
  //   장면 검색은 헤드라인에서 고유명사를 다시 뽑느라 "법무 ETF" 같은 엉뚱한 조합을 만들었고,
  //   네 장면이 전부 같은 폴백(국회 건물)으로 떨어졌다 — 눈으로 확인했다.
  //   검증된 질의를 들고 나가서 장면에 나눠 준다. 재는 잣대와 쓰는 잣대를 맞추는 것과 같은 이치다.
  const probed = [];
  for (const q of usable) {
    try {
      let r = [];
      for (const fn of [searchKoglCommons, searchCommons]) {
        try { r = r.concat(await fn(q, { limit: 8 }) ?? []); } catch { /* 다음 소스 */ }
      }
      // 2026-09-05: 여기서 "법무 7건" 을 세고 편성했는데 장면 검색은 0건이었다.
      //   장면은 koAnchor(한국 자료만)와 near(낱말이 붙어 있는가)를 더 본다.
      //   **재는 잣대가 무르면 못 쓸 이슈를 고른다** — 파일 위쪽에 같은 교훈이 이미 적혀 있는데
      //   그때는 낱말 수만 맞추고 필터는 안 맞췄다. 이번엔 필터까지 같게 한다.
      const koA = KO_TEXT || needsKoreaAnchor(q);
      const nearQ = (title) => {
        const w = String(title ?? '').toLowerCase().split(/[^a-z0-9\u3131-\uD79D]+/).filter(Boolean);
        const at = q.map((t) => w.indexOf(String(t).toLowerCase())).filter((x) => x >= 0);
        if (at.length < q.length) return false;
        return Math.max(...at) - Math.min(...at) <= q.length + 1;
      };
      const n = r.filter((c) => isRealFootage(c) && titleRelevant(c.title, q)
        && nearQ(c.title) && (!koA || looksKorean(c.title))).length;
      if (n > 0) probed.push({ q, n });
      if (n > best.n) best = { n, terms: q, probed };
      if (best.n >= 2) break;
    } catch { /* 한 질의가 죽어도 나머지로 */ }
  }
  best.probed = probed.sort((a, b) => b.n - a.n).map((x) => x.q);

  // 2026-09-05 사용자 "사진은 구글에 있겠지 왜없어?" — 맞는 지적이다.
  //   여기(편성)는 아카이브만 뒤지는데 장면 단계는 구글도 쓴다. **재는 소스와 쓰는 소스가 달랐다.**
  //   그래서 09:00 회차가 "한화에어로 → 0건" 으로 깎고 중기부를 골랐다.
  //   같은 낱말을 구글에 넣으면 8건이 나온다(실측: 한화에어로·김승원·코스피 모두 0건 → 8건).
  //   앞서 필터는 맞췄는데 소스를 안 맞춘 것이 남아 있었다.
  //   비용 때문에 **아카이브가 0건일 때만**, 그리고 회차당 몇 번만 부른다(한 번에 약 5초).
  // 시세 주제는 그날 사진이 필요한데 여기(개수만 세는 탐색)로는 날짜를 알 수 없다.
  //   구글 지름길을 주면 "소재 있음" 으로 편성됐다가 장면에서 전부 버려져 카드만 남는다.
  //   그런 주제는 아카이브 점수 그대로 두고 다른 주제에 자리를 내준다.
  if (TIME_SENSITIVE.test(String((it.headlines ?? [])[0] ?? ''))) return best;
  if (best.n === 0 && process.env.GOOGLE_CSE_CX && GOOGLE_PROBES_LEFT > 0) {
    GOOGLE_PROBES_LEFT -= 1;
    const kw = String(it.keyword ?? '').trim();
    if (kw && /[가-힣]/.test(kw)) {
      try {
        const g = await searchGoogleImages([kw], { limit: 8, countOnly: true });
        const n = g.filter((c) => isRealFootage(c)).length;
        if (n > 0) { best = { n, terms: [kw], probed: [[kw]], viaGoogle: true }; }
      } catch { /* 구글이 막혀도 아카이브 결과로 간다 */ }
    }
  }
  return best;
}
let issue = fresh[0];
/** 편성 단계가 **실제로 결과를 확인한** 질의들. 장면마다 돌려 쓴다(전 장면 같은 그림 방지). */
let PROBED = [];
/** 브리핑(여러 이슈 묶음)용 예비 후보 — 응집도 필터 이전의 목록. */
let BRIEF_POOL = [];
/** 최근 24시간에 낸 헤드라인. 중복 편성과 브리핑 제목 순서에 쓴다. */
let RECENT_HEADS = [];
/** 반응 약한 갈래인가. 성적을 못 읽으면 아무도 약하지 않다(판단하지 않는다). */
let IS_WEAK = () => false;
/** 헤드라인 자극도. 브리핑 순서(=썸네일)를 정하는 데도 쓴다. */
let AROUSAL = () => 0;
/** 썸네일로 세우면 안 되는 헤드라인인가(남을 규정하는 인용). */
let UNSAFE_THUMB = () => false;
if (FORCE_ISSUE) {
  const want = normalizeIssueKey(FORCE_ISSUE);
  const hit = issues.find((it) => normalizeIssueKey(it.keyword) === want);
  if (!hit) {
    console.error(`❌ 지정한 이슈 "${FORCE_ISSUE}" 가 최근 24시간 후보에 없다.`);
    console.error(`   있는 것: ${issues.map((i) => i.keyword).join(', ')}`);
    process.exit(3);
  }
  issue = hit;
  log(`[편성] --issue 지정 → "${issue.keyword}" (편성 대장 무시)`);
} else {
  // 2026-09-05: 묶음이 **한 사건인지** 먼저 본다. "대통령" 키워드로 수출 기록·이창동 영화·
  //   두테르테 체포영장이 한 묶음이 됐고, 대본 네 장면이 서로 다른 이야기를 했다(내렸다).
  //   직함은 어느 기사에나 있어 그것만으로 묶으면 이슈가 아니다.
  // 같은 기사가 **다른 키워드로** 다시 나가는 것도 막는다. 원장은 키워드로만 보는데,
  //   12:00 에 "아파트" 로 낸 기사가 여기서 "홍지선" 으로 다시 1순위가 됐다(실측).
  try {
    const { recentShortsHeadlines } = await import('../lib/db.mjs');
    RECENT_HEADS = recentShortsHeadlines(24);
  } catch { /* 못 읽어도 편성은 계속한다 — 키워드 원장이 1차 방어다 */ }
  const dupBefore = fresh.length;
  fresh = fresh.filter((c) => !isSameStory((c.headlines ?? [])[0] ?? '', RECENT_HEADS));
  if (fresh.length !== dupBefore) log(`[편성] 이미 낸 기사와 같은 사건 ${dupBefore - fresh.length}건 제외`);

  const before = fresh.length;
  // 조사가 붙어 깨진 키워드는 편성 기준이 될 수 없다(2026-09-06 실측: "ai가").
  //   그런 키워드로는 사진도 못 찾고 자막에도 이상하게 나온다.
  // 주제가 될 수 없는 말(연결어미·부사)은 키워드가 아니다 — "앞두고" 로 편성돼
  //   추석 한우와 러시아·우크라이나 기사가 한 묶음이 됐다(2026-09-06 실측).
  // 상품 출시·할인 행사는 뉴스가 아니라 홍보다(2026-09-06: 우리은행 적금 + CU 할인 편을 내렸다).
  const promoBefore = fresh.length;
  const kept = fresh.filter((c) => !isPromotional((c.headlines ?? [])[0] ?? ''));
  if (kept.length) {   // 전부 홍보성이면 어쩔 수 없다 — 거르는 건 아래 관문에 맡긴다
    fresh = kept;
    if (fresh.length !== promoBefore) log(`[편성] 홍보성 기사 ${promoBefore - fresh.length}건 제외`);
  }

  // 앞선 시도에서 실패한 이슈는 뺀다(호출부가 SHORTS_EXCLUDE 로 넘긴다).
  const excluded = String(process.env.SHORTS_EXCLUDE || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (excluded.length) {
    const eBefore = fresh.length;
    fresh = fresh.filter((c) => !excluded.includes(c.keyword));
    BRIEF_POOL = BRIEF_POOL.filter((c) => !excluded.includes(c.keyword));
    if (fresh.length !== eBefore) log(`[편성] 앞서 실패한 이슈 ${eBefore - fresh.length}건 제외 (${excluded.join(', ')})`);
  }

  const tBefore = fresh.length;
  fresh = fresh.filter((c) => isTopicKeyword(c.keyword));
  if (fresh.length !== tBefore) log(`[편성] 주제가 아닌 키워드 ${tBefore - fresh.length}건 제외`);

  const pBefore = fresh.length;
  fresh = fresh.filter((c) => !hasParticle(c.keyword, c.headlines ?? []));
  if (fresh.length !== pBefore) log(`[편성] 조사가 붙어 깨진 키워드 ${pBefore - fresh.length}건 제외`);

  // 브리핑용 예비 후보는 **응집도를 걸러내기 전**에 남긴다.
  //   브리핑은 이슈마다 헤드라인 하나·사진 하나만 쓰므로 묶음 내부가 섞여 있어도 상관없다.
  //   실측(2026-09-06): 응집도까지 걸면 후보 3개, 안 걸면 15개 — 브리핑 성사 여부가 갈렸다.
  try {
    const { shortsPerformance } = await import('../lib/db.mjs');
    const { weakCategories, categoryOf } = await import('../lib/topic-score.mjs');
    const weak = weakCategories(shortsPerformance({ minAgeHours: 8 }));
    if (weak.size) {
      const isWeak = (c) => weak.has(categoryOf((c.headlines ?? [])[0] ?? ''));
      IS_WEAK = isWeak;   // 아래 소재 기준 재선택에서도 같은 판단을 쓴다
      const back = fresh.filter(isWeak);
      if (back.length && back.length < fresh.length) {
        fresh = [...fresh.filter((c) => !isWeak(c)), ...back];
        issue = fresh[0];
        log(`[편성] 반응 약한 갈래 ${[...weak].join('·')} ${back.length}건을 뒤로 민다(성적 기반)`);
      }
    }
  } catch (e) { log(`[편성] 성적 반영 건너뜀: ${String(e.message).slice(0, 50)}`); }
  // 2026-09-07 사용자 "기사도 고 자극 기사만 써" · "썸네일이 너무 저자극 부분이 나온듯".
  //   실측은 밝혀 둔다 — 자극도와 **조회수**는 같이 가지 않았다(정치갈등이 오히려 조회수 꼴찌).
  //   움직이는 건 반응이고, 밋밋한 쪽(단체 소식·기업 실적)은 반응률 바닥이 확실하다.
  //   그래서 순위가 아니라 **바닥만 잘라 낸다.** 전부 잘리면 자르지 않는다 — 회차를 잃지 않는다.
  try {
    const { arousal, AROUSAL_FLOOR } = await import('../lib/topic-score.mjs');
    const { shortsPerformance } = await import('../lib/db.mjs');
    const perf = shortsPerformance({ minAgeHours: 8 });
    const score = (c) => arousal((c.headlines ?? [])[0] ?? '', perf);
    const hot = fresh.filter((c) => score(c) >= AROUSAL_FLOOR);
    if (hot.length >= 2 && hot.length < fresh.length) {
      const cut = fresh.filter((c) => score(c) < AROUSAL_FLOOR)
        .map((c) => `${c.keyword}(${score(c).toFixed(1)})`).slice(0, 4);
      log(`[편성] 자극도 바닥 ${fresh.length - hot.length}건 제외 — ${cut.join(' · ')}`);
      fresh = hot;
    }
    // 센 것부터 본다. 브리핑이면 **1번이 썸네일**이 되므로 이 순서가 곧 첫 화면이다.
    //   다만 **남을 규정하는 인용**이 든 헤드라인은 앞자리에서 뺀다 —
    //   2026-09-07 실측: "이진숙, '여자 히틀러' 김민석 발언 모욕죄 고소" 가 1번이 됐는데
    //   훅은 발화자를 밝혔지만 사진은 그 말을 **들은** 사람이었다. 글로는 맞고 그림으로는 틀렸다.
    //   버리지는 않는다 — 뒷 장면에서는 내레이션이 맥락을 붙여 준다.
    const { unsafeAsThumbnail } = await import('../lib/attribution.mjs');
    const unsafe = (c) => unsafeAsThumbnail((c.headlines ?? [])[0] ?? '');
    fresh.sort((a, b) => (unsafe(a) ? 1 : 0) - (unsafe(b) ? 1 : 0) || score(b) - score(a));
    if (fresh.length && unsafe(fresh[0])) log('[편성] 남는 후보가 전부 인용 낙인이다 — 그대로 간다');
    issue = fresh[0];
    AROUSAL = score;
    UNSAFE_THUMB = unsafe;
  } catch (e) { log(`[편성] 자극도 반영 건너뜀: ${String(e.message).slice(0, 50)}`); }

  BRIEF_POOL = fresh.slice();
  // 2026-09-06: 브리핑에 **중기중앙회 강소기업 선정**이 섞여 나왔다.
  //   약한 갈래를 거르는 건 1순위 이슈에만 걸려 있었고 브리핑 풀에는 안 걸려 있었다.
  //   브리핑은 장면마다 다른 뉴스이므로 **장면 하나하나가 각각 그 관문을 지나야** 한다.
  {
    const kept = BRIEF_POOL.filter((c) => !IS_WEAK(c));
    if (kept.length >= 3 && kept.length < BRIEF_POOL.length) {
      log(`[편성] 브리핑 후보에서 반응 약한 갈래 ${BRIEF_POOL.length - kept.length}건을 뺀다`);
      BRIEF_POOL = kept;
    }
  }
  fresh = fresh.filter((c) => isCoherentIssue(c.keyword, c.headlines ?? []));
  if (fresh.length !== before) log(`[편성] 한 사건으로 안 보이는 묶음 ${before - fresh.length}건 제외 — 남은 후보 ${fresh.length}`);
  // ⚠ `issue` 는 이 블록 **앞에서** fresh[0] 로 이미 정해졌다. 여기서 후보를 걸러 놓고
  //   issue 를 다시 가리키지 않으면, 아래 점수 매기기에서 아무도 점수를 못 받았을 때
  //   **걸러낸 후보가 그대로 나간다** — 실측으로 중복 기사가 그 경로로 통과했다.
  // 2026-09-06: 응집도로 후보가 0이 되면 **브리핑 기회 없이** 바로 걸렀다.
  //   브리핑은 이슈마다 헤드라인 하나·사진 하나만 쓰므로 응집도가 필요 없다 —
  //   여기서 끊지 말고 예비 풀로 넘긴다. 사용자 "소재가 모자라면 여러 개에 좀 붙여서 올려도 되잖아".
  if (!fresh.length && BRIEF_POOL.length >= 3) {
    fresh = BRIEF_POOL.slice();
    log(`[편성] 한 사건으로 묶이는 이슈가 없다 — 브리핑 후보 ${fresh.length}건으로 간다`);
  }
  issue = fresh[0];
  if (!fresh.length) {
    console.error('❌ 한 사건으로 묶이는 이슈가 없다 — 이번 회차를 거른다.');
    console.error('   서로 다른 사건을 한 영상에 담느니 거른다.');
    process.exit(3);
  }

  // 백필(거른 회차 메우기)은 국뽕 주제를 **먼저** 본다 — 사용자 지시.
  //   평소에는 뉴스 가치 순서를 그대로 두고, 메우는 자리에서만 순서를 바꾼다.
  if (process.env.SHORTS_PREFER_PROUD === '1') {
    const proudFirst = fresh.filter((c) => (c.headlines ?? []).some(isProudHeadline));
    if (proudFirst.length) {
      fresh = [...proudFirst, ...fresh.filter((c) => !proudFirst.includes(c))];
      issue = fresh[0];
      log(`[편성] 백필 — 국뽕 주제 ${proudFirst.length}건을 앞으로 당긴다`);
    } else log('[편성] 백필 — 국뽕 주제가 없다. 평소 순서로 간다');
  }

  // 2026-09-06 사용자 "조회수 안나오는 주제들은 하지마".
  //   실측: 조회수는 주제별로 잘 안 갈린다(1157~1574). 갈리는 건 **반응률**이고 25배 벌어진다.
  //   정치갈등 1.81% · 수출수주 1.13% · 외교안보 0.96% · 부동산 0.90% · 사건사고 0.88%
  //   · 시장종목 0.52% · **지역·기관 0.35%**(전남대 산학연 3편).
  //   약한 갈래는 **버리지 않고 뒤로 민다** — 표본이 얇고 그날 그 주제뿐일 수도 있다.
  //   짐작이 아니라 DB 에 쌓인 성적에서 온다. 성적이 없으면 아무것도 하지 않는다.

  const scored = [];
  for (const cand of fresh.slice(0, PROBE_N)) {
    const sc = await footageScore(cand);
    const { n, terms, probed } = sc;
    scored.push({ cand, n, terms, probed });
    log(`[소재탐색] "${cand.keyword}" (${terms.join(' ') || '영문 고유명사 없음'}) → ${n}건${sc.viaArticle ? ' (기사 사진)' : sc.viaGoogle ? ' (구글)' : ''}`);
    if (n >= 2) break;   // 두 장면 이상 채울 수 있으면 충분하다. 더 찾느라 시간 쓰지 않는다.
  }
  // 2026-09-06: 여기서 **사진 개수만 보고** 다시 정렬했더니, 바로 위에서 뒤로 민
  //   약한 갈래가 1순위로 되돌아왔다. 1순위 "종부세" 에 사진이 없자 "소진공" 이 올라와
  //   기업 홍보성 기사가 나갔다(675jm0NfDpo, 내렸다).
  //   사진은 필요조건이지 선택 기준이 아니다 — **약한 갈래는 사진이 많아도 뒤**다.
  // 2026-09-06: 여기서 **사진 개수만 보고** 다시 정렬했더니, 바로 위에서 뒤로 민
  //   약한 갈래가 1순위로 되돌아왔다. 1순위 "종부세" 에 사진이 없자 "소진공" 이 올라와
  //   기업 홍보성 기사가 나갔다(675jm0NfDpo, 내렸다).
  //   사진은 **필요조건이지 선택 기준이 아니다.** 약한 갈래는 사진이 많아도 쓰지 않는다 —
  //   사용자가 "조회수 안나오는 주제들은 하지마" 라고 했다. 그럴 땐 아래 국뽕 경로로 간다.
  // 2026-09-08: 여기서 **사진이 많은 순으로 정렬**하고 있었다.
  //   어제 "사진은 필요조건이지 선택 기준이 아니다" 라고 적어 놓고 이 줄은 그대로 뒀다.
  //   실측: 후보 대부분이 서로 다른 사진 1~3장이다(美노동절 1 · 한미일 2 · 강건호 3).
  //   그래서 뉴스 가치와 무관하게 사진 3장짜리가 2장짜리를 이겼고,
  //   "1순위는 소재가 없어 …로 바꾼다" 가 최근 로그에만 18번 찍혔다.
  //   scored 는 fresh(자극도 순) 그대로다 — **정렬하지 않고 앞에서부터** 쓸 만한 것을 고른다.
  //   네 장면에 필요한 최소 사진은 2장이다(카드 관문: 서로 다른 사진 >= ceil(4/2)).
  const ENOUGH = 2;
  // 2026-09-07: 여기서 또 **앞 단계 판단을 덮어썼다.** 썸네일로 세우면 안 될 헤드라인을
  //   앞에서 뒤로 밀어 놨는데, 사진이 있다는 이유로 이 줄이 다시 1순위로 끌어올렸다.
  //   어제 약한 갈래로 같은 일을 겪고 IS_WEAK 를 넣었는데 UNSAFE_THUMB 는 빠져 있었다.
  //   조건이 늘 때마다 이 줄에도 같이 걸어야 한다.
  // 2026-09-07: 예비 경로가 **위험한 편을 그대로 내보냈다.**
  //   08:15 백필이 "이진숙, '여자 히틀러' 김민석 발언 모욕죄 고소" 를 냈다(fqSk1I5o9ag, 내렸다).
  //   안전한 후보에 사진이 없자 `?? scored.find(...)` 가 낙인 인용을 1순위로 되살린 것이다.
  //   약한 갈래는 되살려도 되지만(밋밋할 뿐이다) **낙인 인용은 다르다** —
  //   그 자리에 세우면 남의 얼굴 위에 그 표현이 얹힌다. 회차를 거르는 편이 낫다.
  //   사진이 한 장뿐이라고 **1순위를 버리지 않는다.** 아래 브리핑 경로가
  //   그 뉴스를 1번 장면(=썸네일)에 세우고 나머지 장면을 다른 뉴스로 채운다.
  //   실측: "美노동절"(사진 1장)을 버리고 "지지율"(2장)로 갈아타고 있었다 —
  //   더 센 뉴스를 사진 한 장 차이로 잃는 것은 손해다.
  //   ENOUGH 는 브리핑이 못 만들어졌을 때를 위한 2차 기준으로만 남긴다.
  const okCand = (x, min) => x.n >= min && !UNSAFE_THUMB(x.cand);
  const usable = scored.find((x) => okCand(x, 1) && !IS_WEAK(x.cand))   // 자극도 1순위 중 사진이 있는 것
    ?? scored.find((x) => okCand(x, 1))                                 // 약한 갈래라도 사진이 있으면
    ?? scored.find((x) => x.n >= ENOUGH);                               // 그것도 없으면 사진 수로
  if (usable) {
    issue = usable.cand;
    PROBED = usable.probed ?? [];
    if (issue !== fresh[0]) log(`[편성] 1순위 "${fresh[0].keyword}" 는 소재가 없어 "${issue.keyword}" 로 바꾼다`);
  } else {
    const weakButUsable = scored.find((x) => x.n > 0);
    if (weakButUsable) log(`[편성] 소재가 있는 건 반응 약한 갈래뿐("${weakButUsable.cand.keyword}") — 쓰지 않고 다른 길로 간다`);
    // 2026-09-05 사용자 "소재없으면 최신 국뽕소재로라도 내".
    //   앞 후보들에 소재가 없다고 회차를 거르지 않는다 — **소재가 있는 국뽕 주제로 바꿔** 낸다.
    //   국뽕 판정은 제목 앞머리에 쓰던 것과 같은 기준이다(video-meta.isProudHeadline).
    //   빈 영상을 내는 것과는 다르다. 여기서도 소재를 찾지 못하면 아래 관문이 회차를 거른다.
    // 2026-09-05: 처음엔 `!scored.some(...)` 로 **아직 안 뒤진 후보만** 봤다.
    //   19:00 회차는 후보가 2건뿐이었고 둘 다 이미 뒤져서 국뽕 대체가 실행조차 안 됐다.
    //   범위를 좁힐 이유가 없었다 — 전체에서 국뽕을 찾는다.
    const proud = fresh.filter((c) => (c.headlines ?? []).some(isProudHeadline));
    if (proud.length) {
      log(`[편성] 앞 후보에 소재가 없다 — 국뽕 후보 ${proud.length}건을 뒤진다`);
      for (const cand of proud.slice(0, PROUD_PROBE_N)) {
        const { n, terms, probed } = await footageScore(cand);
        log(`[소재탐색·국뽕] "${cand.keyword}" (${terms.join(' ') || '고유명사 없음'}) → ${n}건`);
        if (n > 0) {
          issue = cand;
          PROBED = probed ?? [];
          log(`[편성] 국뽕 주제 "${issue.keyword}" 로 낸다 — 거르는 것보다 낫다`);
          break;
        }
      }
    }
    if (issue === fresh[0] && !(scored[0]?.n > 0)) {
      // 왜 못 찾았는지 갈라서 남긴다 — "국뽕이 없다" 와 "검색 자체가 막혔다" 는 다르다.
      //   19:00 회차는 구글 봇 확인 쿨다운이라 **어떤 주제도** 소재가 없었는데,
      //   로그만 보면 국뽕이 없어서인 줄 알게 된다.
      log(googleCoolingDown()
        ? '⚠ 구글 쿨다운 중 — 어떤 주제도 소재를 못 찾는다. 이 회차는 거르고 백필에 맡긴다'
        : '⚠ 국뽕 후보에도 소재가 없다 — 1순위로 간다(카드면 아래 관문이 거른다)');
    }
  }
}
// 장면 수. 브리핑 판단이 이 값을 쓰므로 **그보다 앞에서** 정한다
//   (2026-09-06: 뒤에 두었다가 "Cannot access 'SCENES' before initialization" 으로 브리핑이 통째로 건너뛰어졌다).
const SCENES = 4;

// ── 여러 이슈를 묶는 "브리핑" 편 (2026-09-06 신설) ─────────────────────────────
//   사용자 "소재가 모자라면 여러 개에 좀 붙여서 올려도 되잖아".
//   한 이슈에 사진이 한두 장뿐이면 그 편은 회색 카드가 절반을 넘어 걸러진다(오늘 세 번 그랬다).
//   그럴 때는 **장면마다 다른 이슈**를 넣는다. 각 장면의 사진은 그 이슈 기사에서 오므로
//   장면-사진 대응이 애초에 맞는다 — 한 이슈를 억지로 늘리는 것보다 오히려 정확하다.
//   기준: 1순위 이슈의 사진이 2장 미만이면 브리핑으로 간다.
let BRIEF = null;
if (!FORCE_ISSUE) {
  try {
    const { issueImages } = await import('../lib/article-image.mjs');
    const { itemsOnTopic } = await import('../lib/issue-coherence.mjs');
    const shots = async (it) => {
      const lead = (it.headlines ?? [])[0] ?? '';
      const imgs = await issueImages(itemsOnTopic(lead, it.items ?? [], it.keyword), { max: 4 });
      return imgs.filter((c) => isRealFootage(c));
    };
    const lead = await shots(issue);
    if (lead.length < 2) {
      const picks = [{ it: issue, imgs: lead }];
      for (const cand of (BRIEF_POOL.length ? BRIEF_POOL : fresh)) {
        if (picks.length >= SCENES) break;
        if (cand === issue) continue;
        const im = await shots(cand);
        if (im.length) picks.push({ it: cand, imgs: im });
      }
      // 1순위에 사진이 없으면 그 자리도 다른 이슈로 채운다 — 브리핑은 순서에 매이지 않는다.
      if (!picks[0].imgs.length) picks.shift();
      if (picks.length >= 3 && picks.every((p) => p.imgs.length)) {
        BRIEF = picks.slice(0, SCENES);
        // 2026-09-06 사용자 "제목은 뉴스 중 제일 조회수 높을 만한거로 하지?".
        //   브리핑의 첫 뉴스가 제목이 되고 첫 화면이 썸네일이 된다 — 둘 다 여기서 정해진다.
        //   편성 순위가 아니라 **재어 둔 반응률**로 앞뒤를 정한다.
        try {
          const { shortsPerformance } = await import('../lib/db.mjs');
          const { expectedRate } = await import('../lib/topic-score.mjs');
          const perf = shortsPerformance({ minAgeHours: 8 });
          if (perf.length) {
            const rate = (p) => expectedRate((p.it.headlines ?? [])[0] ?? '', perf);
            // 2026-09-06: 17:59 에 네팔 대홍수를 냈는데 19:00 브리핑의 **제목도 네팔**이 됐다.
            //   같은 사건은 아니고 그 재난의 다른 전개라 편성에서 막을 근거는 약하다.
            //   다만 **제목이 연달아 같은 소재**로 보이는 건 피한다 — 순서만 뒤로 민다.
            //   빼는 게 아니라 미는 것이므로 소재가 줄지 않는다.
            const recentWords = new Set(RECENT_HEADS.flatMap((h) => String(h)
              .split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2).map((w) => w.toLowerCase())));
            const echoes = (p) => {
              const t = String((p.it.headlines ?? [])[0] ?? '').split(/[^가-힣A-Za-z0-9]+/)
                .filter((w) => w.length >= 2).map((w) => w.toLowerCase());
              let hit = 0; for (const w of t) if (recentWords.has(w)) hit += 1;
              return hit >= 2;   // 두 낱말 이상 겹치면 방금 낸 이야기로 읽힌다
            };
            // 2026-09-07: 1번 장면이 **쇼츠 썸네일**이 된다. 사용자가 "저자극 부분이 나온듯" 이라 했다.
            //   갈래 평균 반응률(rate)보다 **그 헤드라인 자체의 자극도**가 앞이다 —
            //   같은 갈래여도 "폭발음 여러번" 과 "협약 체결" 은 첫 화면에서 하늘과 땅이다.
            BRIEF.sort((a, b) => (UNSAFE_THUMB(a.it) ? 1 : 0) - (UNSAFE_THUMB(b.it) ? 1 : 0)
              || (echoes(a) ? 1 : 0) - (echoes(b) ? 1 : 0)
              || AROUSAL(b.it) - AROUSAL(a.it) || rate(b) - rate(a));
            log(`[편성] 브리핑 순서를 성적으로 정한다 — 1번 "${((BRIEF[0].it.headlines ?? [])[0] ?? '').slice(0, 34)}" (${(rate(BRIEF[0]) * 100).toFixed(2)}%)`);
          }
        } catch (e) { log(`[편성] 브리핑 순서 조정 건너뜀: ${String(e.message).slice(0, 40)}`); }
        log(`[편성] 1순위 사진이 ${lead.length}장뿐 — **${BRIEF.length}개 이슈를 묶어 브리핑으로** 낸다`);
        for (const p of BRIEF) log(`   · ${((p.it.headlines ?? [])[0] ?? '').slice(0, 46)} (사진 ${p.imgs.length})`);
      }
    }
  } catch (e) { log(`[편성] 브리핑 판단 건너뜀: ${String(e.message).slice(0, 50)}`); }
}

// 2026-09-06: 헤드라인을 **손대지 않고** 대본 프롬프트에 넣었다. 그래서 브리핑 자막이
//   "[영상] 네팔과 한국 구호대가 중국인 1명을" 로 나갔다(o_yaH_4l7b0, 내렸다).
//   `[영상]`·`[단독]` 같은 편집 표시와 `&#039;` 같은 엔티티는 기사 내용이 아니다.
const headlines = (BRIEF
  ? BRIEF.map((p) => (p.it.headlines ?? [])[0] ?? '')
  : issue.headlines ?? []).map(cleanHeadline).filter(Boolean);
// 2026-09-06: 묶음이 "한 사건" 판정을 통과해도 **묶음 안에 다른 기사가 남는다.**
//   "한국인" 묶음이 네팔 구조 3건으로 응집도를 통과했는데, 같은 묶음에 사조대림 참치액과
//   비에날씬 유산균이 함께 있었다. 대본이 "사조대림이 한국인 절반이 먹은 참치액에 대해" 를
//   네팔 구조 사진 위에 읽었다.
//   사진 쪽에는 itemsOnTopic 이 걸려 있었는데 **대본 쪽에는 걸려 있지 않았다.**
//   대표 헤드라인과 이어지지 않는 기사는 대본에도 넣지 않는다.
const onTopicHeads = BRIEF ? headlines
  : itemsOnTopic(headlines[0] ?? '', (issue.headlines ?? []).map((h) => ({ headline: h })), issue.keyword)
    .map((x) => x.headline);
if (!BRIEF && onTopicHeads.length && onTopicHeads.length < headlines.length) {
  log(`[대본] 이 회차와 다른 이야기인 헤드라인 ${headlines.length - onTopicHeads.length}건을 뺀다`);
  headlines.length = 0; headlines.push(...onTopicHeads);
}
const onTopicItems = BRIEF ? (issue.items ?? []) : itemsOnTopic(headlines[0] ?? '', issue.items ?? [], issue.keyword);
const texts = [...headlines, ...onTopicItems.map((i) => stripHtml(i.summary)).filter(Boolean)];
const quote = bestQuote(texts);
// 2026-09-06 사용자 "올릴수없는게 말이되니? 고쳐서라도 올려야지".
//   회차를 버리는 대신 **다른 이슈로 다시 시도**할 수 있어야 한다. 호출부가 재시도하려면
//   이번에 무엇을 시도했는지 알아야 한다 — 출력을 흘려보내(inherit) 읽을 수 없으므로 파일로 남긴다.
try { writeFileSync(resolve(ROOT, 'logs/last-issue.txt'), String(issue.keyword ?? ''), 'utf8'); } catch { /* noop */ }
log(`[이슈] "${issue.keyword}" · 매체 ${issue.sourceCount} · 기사 ${headlines.length}`);
log(`[헤드라인] ${headlines[0]?.slice(0, 60) ?? ''}`);
if (quote) log(`[인용] "${quote.text.slice(0, 40)}…" — ${quote.speaker ?? '?'}`);

// ── 2. 대본 — 짧고 훅이 강해야 한다 ─────────────────────────────────────────────
const { resolveLlm } = await import('../lib/llm-config.mjs');
const llm = { url: process.env.VIDEO_LLM_URL ?? resolveLlm('web').url, model: process.env.VIDEO_LLM_MODEL ?? 'mlx-community/Qwen3.5-4B-4bit' };
// 한국어는 초당 약 6.7자로 읽힌다(Piper 실측: 47자 / 7.0초).
const CPS = 6.7;
const budget = Math.round(TARGET_SEC * CPS);

const briefPrompt = () => `너는 한국 뉴스 쇼츠 대본 작가다. 아래 **서로 다른 뉴스 ${headlines.length}건**을
${TARGET_SEC}초 세로 쇼츠 하나로 묶어 전한다. 장면 하나에 뉴스 하나씩, 순서대로.

${(BRIEF ?? []).map((p2, i) => {
  const h = headlines[i] ?? '';
  // 2026-09-06: 브리핑 프롬프트가 **헤드라인만** 줬다. 두 문장을 채우려면 모델이 없는 내용을
  //   지어낼 수밖에 없다 — "한국인 근무 발전소서 발견" 이 "한국인 근무자 2명도 구출되었습니다"
  //   가 돼서 나갔다(Xfa26lCv6cM, 내렸다). 실종 수색 중인 사람을 구출됐다고 한 것이다.
  //   기사 본문을 함께 준다. 쓸 내용이 있으면 지어낼 이유가 줄어든다.
  const body = stripHtml((p2.it.items ?? []).map((x) => x.summary).find(Boolean) ?? '').slice(0, 220);
  return `${i + 1}. ${h.slice(0, 160)}${body ? `\n   (기사: ${body})` : ''}`;
}).join('\n') || headlines.map((h, i) => `${i + 1}. ${h.slice(0, 160)}`).join('\n')}

규칙:
- **장면 ${headlines.length}개. i번째 장면은 i번째 뉴스만 다룬다.** 뉴스를 섞지 마라.
- 오직 위에 적힌 사실만 쓴다. 없는 숫자·인용·배경을 만들지 마라.
- **일어나지 않은 일을 일어난 것처럼 쓰지 마라.** 수색 중이면 수색 중이고, 실종이면 실종이다.
  실측으로 나간 오류: 실종 수색 중인 한국인을 "구출되었습니다" 라고 했다.
- 앵커 어투. 어미는 '-습니다/-입니다'. 반말·해체 금지. 한 문장을 짧게.
- **남의 주장은 누가 했는지 밝혀라.** 사람을 규정하는 말(카르텔·농단·3인방 …)은 발화자와 함께.
- 정당·기관·인물 이름은 헤드라인에 적힌 그대로 옮겨라.
- 숫자와 단위는 붙여 쓴다("6800억원", "18문"). 자릿수 사이를 띄우지 마라.
- hook: 화면에 크게 박을 문구, **12자 이내**. 장면마다 다른 말로 시작하라.
  · **낱말을 쉼표로 나열하지 마라.** 실측으로 나간 나쁜 예: "영문, 프랑스, 국빈방문" / "이민, 소형선박, 영국해협"
  · 좋음: "프랑스 국빈방문" · "영국해협 이민 협약" · "첨단분야 협력" — 뜻이 통하는 한 덩어리로.
- JSON 배열만 출력: [{"hook":"문구","say":"읽을 문장(${Math.round(budget / headlines.length * 0.8)}~${Math.round(budget / headlines.length * 1.2)}자)","visual":""}]
- 장면 ${headlines.length}개. 총 ${budget}자 안팎.`;

const prompt = `너는 한국 뉴스 쇼츠 대본 작가다. 아래 헤드라인만 근거로 ${TARGET_SEC}초 세로 쇼츠 대본을 쓴다.

${texts.slice(0, 12).map((t) => `- ${t.slice(0, 160)}`).join('\n')}
${quote ? `\n(대표 발언: "${quote.text}"${quote.speaker ? ` — ${quote.speaker}` : ''})` : ''}

규칙:
- 오직 위 헤드라인에 있는 사실만 쓴다. 없는 숫자·인용·배경을 만들지 마라.
- **남의 주장은 누가 했는지 밝혀라.** 정당·인물의 공격 표현을 채널의 말처럼 쓰지 마라.
  실측으로 나간 것: 훅에 "좌파 카르텔 인사 농단" 만 크게 떴고 그 아래는 상대 인물 사진이었다.
  · 나쁨: 좌파 카르텔 인사 농단   · 좋음: 국힘 "좌파 카르텔" / 野, 인사 농단 주장
  사람을 규정하는 말(카르텔·농단·3인방·몸통·적폐 …)은 **반드시 발화자와 함께** 쓴다.
- **정당·기관·인물 이름은 헤드라인에 적힌 그대로 옮겨라.** 줄이거나 바꾸지 마라.
  실측으로 나간 오기: "국민의힘"→"국민힘", "정부"→"청와대"(현 정부는 대통령실이다).
  뉴스 채널에서 이름을 틀리면 그 한 글자가 신뢰를 깎는다.
- **1번 장면이 훅이다.** 첫 세 어절에 가장 강한 사실을 박아라. "오늘은", "이번 소식은" 금지.
- **앵커 어투로 쓴다.** 사실을 **단정적으로** 전한다:
  · 좋음: "미국이 반도체 표적관세를 예고했습니다." "설비투자가 살아나고 있습니다."
  · 나쁨(전문·추측 어투 — 앵커는 이렇게 말하지 않는다):
    "~라고 합니다", "~한다고 합니다", "~하는데요", "~같습니다", "~인 것으로 보입니다",
    "~라는데요", "~죠", "~네요", "~거든요"
  · 나쁨(대화체 군더더기): "그런데", "사실은", "아무튼", "여러분", "자,"
- 어미는 '-습니다/-입니다' 로 맺는다. 반말·해체 금지.
- **한 문장을 짧게.** 한 문장에 사실 하나. 접속사로 길게 잇지 마라.
- 숫자와 단위는 **붙여 쓴다**: "6800억원", "천무 18문", "15일", "3척".
  자릿수 사이를 띄우지 마라 — "6 억 8 천만 원", "18 문" 처럼 쓰면 소리내어 읽을 때 끊긴다.
- 영어 단위는 한글로 바꾼다(TTS 오독 방지). 예: 17 billion → 백칠십억
- 한국이 잘한 이야기면 대놓고 자랑하라. "이게 대한민국입니다", "또 해냈습니다" 같은 말을 써도 좋다.
  단 **헤드라인에 있는 사실로만** — 없는 순위·기록·반응을 지어내면 거짓말이다.
- hook: 화면 위에 크게 박을 문구. **12자 이내**, 명사로 끝내라. 예: "삼성 세계 1위 탈환"
  · **훅마다 다른 말로 시작하라.** 실측: 다섯 훅이 전부 "중기부" 로 시작해 화면이 단조로웠고
    같은 훅("중기부 역할")이 두 번 나왔다. 같은 낱말로 시작하는 훅을 두 개 이상 쓰지 마라.
  · **1번 장면의 hook 은 썸네일이 된다**(쇼츠는 첫 화면이 썸네일이다).
    답을 다 말하지 말고 **궁금하게** 만들어라 — 숫자나 결과 한 조각만 보여주고 이유는 감춘다.
    좋음: "1.5조 수주, 어디서" / "코스피 6650, 왜" / "장관 후보 법안 0건"
    나쁨(다 말해버림): "한화오션이 컨테이너선 6척을 수주했습니다"
    나쁨(낚시 — 없는 사실): "충격", "경악", "난리", "세계가 놀랐다"
    ⚠ 궁금하게 만들되 **헤드라인에 있는 사실만** 쓴다. 없는 걸 암시하지 마라.
- visual: 그 장면 배경으로 찾을 검색어. **영어 2~3단어**.
  · 헤드라인에 나오는 **고유명사**를 우선 써라 — 회사·기관·도시 이름. 그게 제일 잘 맞는다.
    좋음: "Samsung Electronics", "Seoul National Assembly", "semiconductor wafer fab"
  · 막연한 일반어는 엉뚱한 사진을 부른다. 실측: "factory investment" 로 미국 아울렛 매장이 걸렸다.
    나쁨: "factory investment", "cluster designation", "hybrid material"
  · 검색어가 안 맞으면 그 장면은 그래픽 카드로 나간다 — 틀린 사진보다는 낫지만 밋밋하다.
- JSON 배열만 출력: [{"hook":"화면 문구(12자 이내)","say":"읽을 문장(${Math.round(budget / SCENES * 0.8)}~${Math.round(budget / SCENES * 1.2)}자)","visual":"english words"}]
- 장면 ${SCENES}개. **총 ${budget}자 안팎으로 채워라** — ${Math.round(budget * 0.6)}자보다 짧으면 다시 쓴다.
  각 장면의 say 를 한 문장으로 끝내지 말고, 사실이 더 있으면 두 문장까지 쓴다.`;

async function askLLM() {
  const activePrompt = BRIEF ? briefPrompt() : prompt;
  const r = await fetch(`${llm.url}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: llm.model, messages: [{ role: 'user', content: activePrompt }],
      // 2026-09-06: 온도 0.5 는 뉴스 대본에 높다. 사실 오류가 이어져 0.3 으로 내린다 —
      //   문장이 조금 밋밋해지는 대신 없는 말을 덜 만든다.
      max_tokens: 2000, temperature: Number(process.env.SHORTS_TEMP || 0.3), chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
  const txt = (await r.json())?.choices?.[0]?.message?.content ?? '';
  const m = String(txt).match(/\[[\s\S]*\]/);
  if (!m) throw new Error(`JSON 없음 (${txt.length}자, 끝: …${txt.slice(-80)})`);
  // 2026-09-05 사용자 "대본도 좀 잘 띄워서 읽게해보고".
  //   프롬프트의 "숫자는 한글로 풀어 쓴다(TTS 오독 방지)" 를 4B 가 **자릿수를 띄우는 것**으로
  //   받아들여 "6 억 8 천만 원", "천무 18 문", "4 억 3520 만 유로" 를 내놓는다.
  //   앞서 화면 글자만 고쳤는데 **TTS 는 이 원문을 그대로 읽는다** — 대본 자체를 정리한다.
  //   프롬프트도 같이 고쳤지만 4B 가 지킬 거라고 믿지 않는다. 코드가 보장한다.
  return JSON.parse(m[0]).filter((x) => x?.say && x?.hook).slice(0, BRIEF ? BRIEF.length : SCENES)
    .map((x) => ({ ...x, say: tightenNumbers(x.say), hook: tightenNumbers(x.hook) }));
}

let scenes = [];
// 파싱 실패는 재시도로 다룬다 — 4B 가 가끔 내는 품질 문제이고, 한 번 깨졌다고 편을 버릴 이유가 없다.
// 2026-09-05: 재시도 조건이 "장면 2개 이상" 뿐이라 **너무 짧은 대본이 그대로 통과**했다.
//   실측: 140자 → 16.6초 (목표 40초, 예산 268자). 쇼츠로 내기엔 짧고 담기는 내용도 적다.
//   길이도 조건에 넣는다. 세 번 시도해도 짧으면 그냥 간다 — 짧은 편이 거르는 것보다 낫다.
const MIN_CHARS = Math.round(budget * 0.6);
for (let a = 1; a <= 3; a++) {
  try {
    scenes = await askLLM();
    const chars = scenes.reduce((n, x) => n + String(x.say ?? '').length, 0);
    // 2026-09-05: 프롬프트가 "-습니다/-입니다 로 맺는다. 반말·해체 금지" 라고 시키는데
    //   4B 가 어겨 "구조됐다·이루어졌다·밝혔다" 로 나왔다. 앵커가 반말로 읽으면 딴 채널이 된다.
    //   길이와 같은 이치다 — 지시하되 **코드가 보장한다**.
    // 2026-09-05: 처음엔 "반말로 끝나면 불합격" 으로 했는데, **끝맺지 못한 문장**이 통과했다.
    //   네팔 편 자막이 "…예상조차 불가능해 조현" 으로 끊겼다(인명이 잘린 채 끝났다).
    //   기준을 뒤집는다 — **경어로 끝나야 합격**이다. 안 끝난 문장도 이걸로 걸린다.
    const plain = scenes.filter((x) => {
      const t = String(x.say ?? '').trim();
      if (!t) return true;
      // 2026-09-06: `습니다` 만 봤더니 **`합니다`·`됩니다`·`옵니다`가 전부 불합격**이었다
      //   (한일 미래路 편이 세 번 다시 쓰다 실패했다). 우리말 합쇼체는 '-ㅂ니다' 로 끝난다.
      //   그리고 헤드라인이 인용인 회차는 대사가 따옴표로 끝날 수 있다 — 그것도 맺은 것이다.
      if (/["'"'"'”’」』]$/.test(t)) return false;
      return !/([가-힣]니다|습니까|십시오)[.!?]?$/.test(t);
    }).length;
    // 2026-09-05: 훅이 "다우 0.5% 하락" 과 "다우 0.5% 내리" 로 거의 같게 나왔다.
    //   프롬프트에 "훅마다 다른 말로 시작하라" 를 넣었지만 4B 가 지키지 않는다 — 코드가 본다.
    //   낱말 집합이 절반 넘게 겹치면 같은 훅으로 친다.
    const hookWords = (h) => new Set(String(h ?? '').split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 1));
    let dupHooks = 0;
    for (let x = 0; x < scenes.length; x++) {
      for (let y = x + 1; y < scenes.length; y++) {
        const a = hookWords(scenes[x].hook); const b = hookWords(scenes[y].hook);
        if (!a.size || !b.size) continue;
        let hit = 0; for (const w of a) if (b.has(w)) hit += 1;
        if (hit / Math.min(a.size, b.size) > 0.5) dupHooks += 1;
      }
    }
    // 2026-09-06: 훅에 "좌파 카르텔 인사 농단" 이 인용 표시 없이 떴다. 한쪽 정당의 공격 표현인데
    //   화면만 보면 **채널이 그렇게 규정한 것**으로 읽힌다 — 그 아래는 상대 인물 사진이었다.
    //   어제 성적을 재보니 정치갈등이 반응률 1위였다(1.61%). 반응률만 좇으면 이런 편이 늘어난다.
    //   남의 주장은 누가 했는지 밝혀야 한다.
    // 2026-09-06: 훅 중복만 봤는데 **대사가 겹치는** 편이 나갔다 —
    //   3번과 4번이 "한 번의 어려움에 주저앉지 않고" 로 같은 말을 했다. 새 정보가 없다.
    const sayWords = (t) => new Set(String(t ?? '').split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2));
    let dupSays = 0;
    for (let x = 0; x < scenes.length; x++) {
      for (let y = x + 1; y < scenes.length; y++) {
        if (scenes[x].isOutro || scenes[y].isOutro) continue;
        const a = sayWords(scenes[x].say); const b = sayWords(scenes[y].say);
        if (a.size < 3 || b.size < 3) continue;
        let hit = 0; for (const w of a) if (b.has(w)) hit += 1;
        if (hit / Math.min(a.size, b.size) > 0.6) dupSays += 1;
      }
    }
    // 어미가 다 같으면 단조롭다 — "…고 밝혔습니다 / …고 했습니다 / …고 말했습니다" 가 이어졌다.
    const endings = scenes.filter((x) => !x.isOutro)
      .map((x) => (String(x.say ?? '').trim().match(/([가-힣]{2,6})[.!?]?$/) ?? [])[1] ?? '');
    const sameEnding = endings.length >= 3
      && new Set(endings.filter(Boolean)).size <= Math.max(1, Math.floor(endings.length / 2));

    const unattributed = attributionIssues(scenes);
    // 2026-09-06: 편집 표시·엔티티·기자 서명이 자막에 그대로 뜬 편을 세 번 내렸다.
    //   화면에 뜨면 바로 보이는 것들이다. 원문에서 걷어내되, 그래도 새어 나오면 다시 쓴다.
    const leftovers = scenes.flatMap((x) => [
      ...textLeftovers(x.hook), ...textLeftovers(x.say),
    ]);
    // 2026-09-07: 대본이 "더불어민주당은 **무소속** 한동훈에…" 라고 했다.
    //   원문 어디에도 '무소속' 이 없다 — 정당 소속을 지어낸 것이다.
    //   실존 정치인의 소속을 틀리는 건 뉴스 채널에서 신뢰의 문제다.
    //   이름 전체를 원문과 대조하는 방식은 오탐이 많아 못 썼지만(정상 5건 중 3건이 걸렸다),
    //   **정당 표기는 닫힌 집합**이라 좁고 정확하게 잡을 수 있다.
    const srcText = [...headlines, ...onTopicItems.map((i) => stripHtml(i.summary))].join(' ');
    const madeUp = scenes.flatMap((x) => [
      ...unsourcedAffiliation(x.hook, srcText), ...unsourcedAffiliation(x.say, srcText),
    ]);
    if (scenes.length >= 2 && chars >= MIN_CHARS && !plain && !dupHooks
        && !dupSays && !sameEnding && !unattributed.length && !leftovers.length && !madeUp.length) break;
    log(`[대본] 시도 ${a}: 장면 ${scenes.length}개 · ${chars}자${plain ? ` · 경어로 안 맺은 ${plain}장면` : ''}${dupHooks ? ` · 겹치는 훅 ${dupHooks}쌍` : ''}${dupSays ? ` · 겹치는 대사 ${dupSays}쌍` : ''}${sameEnding ? ' · 어미가 다 같다' : ''}${unattributed.length ? ` · 출처 없는 낙인 "${unattributed[0].slice(0, 18)}"` : ''}${leftovers.length ? ` · 자막에 남은 것: ${[...new Set(leftovers)].join('·')}` : ''}${madeUp.length ? ` · 원문에 없는 소속: ${[...new Set(madeUp)].join('·')}` : ''} — 다시 쓴다`);
  } catch (e) { log(`[대본] 시도 ${a}: ${e.message.slice(0, 100)}`); }
}
// 2026-09-08: 21:45 회차가 여기서 죽었다. 세 번 다 걸린 이유가 **"무소속" 한 낱말**이었다.
//   모델이 "무소속 한동훈" 을 고집했고, 원문에 그 말이 없어 매번 다시 쓰게 했다.
//   지우면 될 것을 세 번 다시 쓰다 회차를 잃었다 — **막는 것과 버리는 것은 다르다.**
//   근거 없는 소속은 문장에서 걷어내고 간다. "무소속 한동훈" → "한동훈" 은 안전하다.
{
  const srcAll = [...headlines, ...onTopicItems.map((i) => stripHtml(i.summary))].join(' ');
  let cleaned = 0;
  for (const sc of scenes) {
    for (const f of ['hook', 'say']) {
      const bad = unsourcedAffiliation(sc[f], srcAll);
      if (!bad.length) continue;
      let t = String(sc[f] ?? '');
      for (const w of bad) t = t.replace(new RegExp(`${w}\\s*`, 'g'), '');
      sc[f] = t.replace(/\s+/g, ' ').trim();
      cleaned += 1;
    }
  }
  if (cleaned) log(`[대본] 원문에 없는 소속을 ${cleaned}곳에서 걷어냈다(다시 쓰지 않고 지운다)`);
}
if (scenes.length < 2) { console.error('❌ 3회 시도해도 대본을 못 만들었다'); process.exit(3); }

// 2026-09-07: 검사는 세 번 다 잡았는데("겹치는 대사 6쌍") 3회 뒤 그냥 내보냈다.
//   그래서 **같은 문장을 네 번 반복하는 편**이 나갔다(i-IqSqXH7LA, 내렸다).
//   근본은 그 이슈에 사실이 하나뿐이라 네 장면을 채울 수 없다는 것이다 —
//   모델은 채우라니까 같은 말을 되풀이한다.
//   길이가 모자란 것과 **내용이 없는 것**은 다르다. 짧은 편은 내도 되지만,
//   같은 말을 네 번 하는 편은 안 된다. 겹치는 장면을 걷어내고, 남는 게 없으면 다른 이슈로 간다.
{
  const words = (t) => new Set(String(t ?? '').split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2));
  const kept = [];
  for (const sc of scenes) {
    if (sc.isOutro) { kept.push(sc); continue; }
    const a = words(sc.say);
    const dup = kept.some((k) => {
      if (k.isOutro) return false;
      const b = words(k.say);
      if (a.size < 3 || b.size < 3) return false;
      let hit = 0; for (const w of a) if (b.has(w)) hit += 1;
      return hit / Math.min(a.size, b.size) > 0.6;
    });
    if (dup) continue;
    kept.push(sc);
  }
  const before = scenes.filter((x) => !x.isOutro).length;
  const after = kept.filter((x) => !x.isOutro).length;
  if (after < before) {
    log(`[대본] 같은 말을 되풀이한 장면 ${before - after}개를 걷어낸다 (${before} → ${after})`);
    scenes = kept;
  }
  if (after < 2) {
    console.error(`❌ 서로 다른 이야기가 ${after}개뿐 — 이 이슈로는 쇼츠가 안 된다. 다른 이슈로 간다.`);
    process.exit(3);   // 3 = 낼 것이 없음 → 호출부가 다른 이슈로 재시도한다
  }
}
// 마지막 장면에 사이트 안내를 **말로** 붙인다. 화면에만 띄우면 보고 지나간다.
//   가로 편에는 있었는데 쇼츠에는 빠져 있었다(사용자 지적) — 40초짜리는 마무리가 없으면
//   그냥 뚝 끊긴다. 대본 길이 계산이 끝난 뒤에 붙여 예산 절삭에 잘리지 않게 한다.
// 길면 문장 경계에서 자른다. 장면은 버리지 않는다 — 이슈 하나가 통째로 사라진다.
//   실측: 예산 268자인데 500자가 와서 영상이 76.8초가 됐다(목표 40초).
//   프롬프트로 길이를 지시하는 건 가로 편에서 이미 세 번 빗나갔다 — 코드가 자른다.
{
  const before = scenes.reduce((n, x) => n + x.say.length, 0);
  const fit = fitScript(scenes, { budgetChars: budget });
  scenes = fit.scenes;
  if (fit.trimmed) log(`[대본] 예산 ${budget}자 초과 → ${before}자에서 ${fit.after}자로 (${fit.trimmed}장면 절삭)`);
}

// 2026-09-03 사용자 "flowvium.net 광고할땐 화면 컷 하나 만들지".
//   종전엔 마지막 장면 말끝에 문장만 붙였다 — 화면은 그 장면 소재 그대로라 광고인지 모른다.
//   **전용 장면**으로 뺀다. 소재 검색도 하지 않고(아래 isOutro) 채널 그래픽을 쓴다.
const SITE_URL = process.env.SITE_URL || 'flowvium.net';
// 2026-09-05: 대본에 라틴 문자를 그대로 두면 한국어 TTS 가 제멋대로 읽는다.
//   whisper(small)로 되들은 실측 — "flowvium.net" → **"플로우 비오모 소삼드톤 네트"**.
//   더 나쁜 건 회차마다 다르게 깨진다는 점이다("플러비움 닷대" 로 읽은 회차도 있다).
//   이 문장은 **모든 영상 끝에 나간다** — 매번 다른 소리가 나는 걸 두고 볼 수 없다.
//   한글로 적으면 "플로비옴 단넷" 으로 안정적이다(같은 방식으로 확인).
//   화면 그래픽에는 flowvium.net 이 그대로 크게 뜨므로 주소는 눈으로 전달된다.
const SITE_SPOKEN = process.env.SITE_SPOKEN || '플로비움 닷넷';
scenes.push({
  hook: '더 깊은 분석은',
  say: `오늘 다룬 이슈의 전체 분석과 실시간 시장 데이터는 ${SITE_SPOKEN}에서 보실 수 있습니다.`,
  visual: '',
  isOutro: true,
});
log(`[대본] 마무리 장면 추가 (${SITE_URL})`);
log(`[대본] 장면 ${scenes.length}개 · ${scenes.reduce((n, s) => n + s.say.length, 0)}자`);
for (const s of scenes) log(`   · [${s.hook}] ${s.say.slice(0, 42)}…`);
if (DRY) { log('--dry — 여기까지'); process.exit(0); }

// ── 3. 음성 ─────────────────────────────────────────────────────────────────────
// 기본은 Qwen3-TTS(Sohee, 아나운서 톤). 사용자가 네 후보를 듣고 'brief' 지시를 골랐다.
//   Piper 대비 억양이 두 배 넓지만(4.54→7.86반음) **합성이 실시간의 0.3~0.6배**로 느리다.
//   그래서 실패하면 Piper 로 떨어진다 — 느린 엔진 하나 때문에 그날 편을 통째로 잃지 않는다.
//   되돌아갈 때 조용히 넘기지 않는다: 목소리가 바뀐 것을 로그가 말해야 한다.
{
  const texts = scenes.map((s) => s.say);
  let out = null;
  try {
    const t0 = Date.now();
    out = synthesizeKoreanBatch(texts, { outPrefix: `${WORK}/q` });
    log(`[음성] Qwen3(Sohee·아나운서톤) ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  } catch (e) {
    log(`⚠ Qwen 합성 실패 — Piper 로 진행한다 (목소리가 달라진다): ${String(e.message).slice(0, 120)}`);
  }
  for (let i = 0; i < scenes.length; i++) {
    const r = out ? out[i] : synthesizeKorean(scenes[i].say, { outPath: `${WORK}/s${i}.wav` });
    scenes[i].audio = r.path;
    scenes[i].alignment = r.alignment;
    scenes[i].dur = r.durationSec;
    if (r.note) log(`  ⚠ ${i + 1} ${r.note}`);
    log(`[음성] ${i + 1} ${r.durationSec.toFixed(1)}초`);
  }
}
const totalSec = scenes.reduce((n, s) => n + s.dur, 0);
log(`[음성] 합계 ${totalSec.toFixed(1)}초`);

// ── 4. 소재 ─────────────────────────────────────────────────────────────────────
// 상한 200MB. 60MB 로 뒀더니 Pexels 4K 클립(115MB)이 걸려 카드로 떨어졌다(실측).
//   쇼츠는 컷이 5개뿐이라 한 장면을 카드로 잃는 손해가 크다. 내려받기는 몇 초면 끝난다.
const MAX_DL = 200 * 1024 * 1024;
/** 이미 쓴 사진의 내용 해시. 같은 사진이 두 장면에 깔리는 것을 막는다. */
const usedHashes = new Set();
async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FlowVium-shorts/1.0 (https://flowvium.net)' }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_DL) throw new Error(`너무 큼 ${(buf.length / 1048576).toFixed(0)}MB`);
  // 2026-09-04: **받은 것이 정말 그림인지 앞부분으로 확인한다.**
  //   09:00 정기 발행이 통째로 죽었다 — "mjpeg: unsupported coding type (c8)".
  //   korea.kr download.do 가 준 건 그림이 아니라 **PDF** 였다(file: PDF document, version 1.6).
  //   확장자·URL 로는 알 수 없다. 파일 앞 몇 바이트가 진실이다.
  const kind = (b) => {
    if (b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (b.slice(4, 8).toString('ascii') === 'ftyp') return 'mp4';
    if (b.slice(0, 4).toString('ascii') === '\u001aE\u00df\u00a3') return 'webm';
    return null;
  };
  const k = kind(buf);
  if (!k) {
    const head = buf.slice(0, 8).toString('ascii').replace(/[^\x20-\x7e]/g, '.');
    throw new Error(`그림이 아니다 (앞부분 "${head}")`);
  }
  // 2026-09-05: 서로 다른 URL 이 **같은 사진**을 준다. 언론사들이 같은 통신사 사진을 쓰기 때문이다.
  //   발행분의 1번·4번 장면 파일이 md5 까지 똑같았다(연합·매경 주소는 달랐다).
  //   usedMedia 는 URL 만 보므로 이걸 못 막는다. 내용으로 막는다.
  const sum = createHash('md5').update(buf).digest('hex');
  if (usedHashes.has(sum)) throw new Error('앞 장면과 같은 사진');
  usedHashes.add(sum);
  writeFileSync(dest, buf);
  // 2026-09-04: **받은 것이 실제로 쓸 수 있는 그림인지 확인한다.**
  //   09:00 정기 발행이 통째로 죽었다 —
  //     mjpeg: unsupported coding type (c8) / Error: 렌더 실패 (exit 1)
  //   korea.kr download.do 가 준 파일을 ffmpeg 가 못 읽었다. 검사 없이 쓴 게 원인이다.
  //   한 장이 나쁘면 그 장면만 포기하면 된다 — 편 전체를 죽일 일이 아니다.
  //   ffprobe 는 이 저장소에 없다(ffmpeg-static 만 있다). ffmpeg 로 **디코딩을 시켜 본다** —
  //   실제로 풀리는지가 우리가 알아야 할 전부다.
  const probe = spawnSync(ffmpegPath, ['-v', 'error', '-i', dest, '-frames:v', '1', '-f', 'null', '-'],
    { encoding: 'utf8', timeout: 30000 });
  if (probe.status !== 0) {
    try { unlinkSync(dest); } catch { /* noop */ }
    throw new Error(`디코딩 불가(${String(probe.stderr ?? '').split('\n')[0].slice(0, 60)})`);
  }
  return dest;
}

// 장면끼리 같은 그림을 쓰지 않는다. 2026-09-03 실측: 홈플러스 편에서 같은 매장 사진이
//   네 장면에 그대로 깔렸다 — 소재가 맞아도 같은 그림이 반복되면 정지 화면이나 다름없다.
// 2026-09-04: **한국 뉴스에는 한국 것만 붙인다.**
//   약칭이 계속 남의 것을 물어왔다 —
//     GCC → 이집트항공 A320(등록기호 SU-GCC) · FTA → 대만 총통 · IPO → 필리핀 유역
//     Invesco → 미식축구 경기장 · Vanguard → 화물선 · GAP → 프랑스 도시
//   낱말을 하나씩 막는 대신 조건을 뒤집는다: 한국어 기사를 다루는 편이면 결과 제목에도
//   한국 표시가 있어야 한다. 없으면 안 쓴다 — 카드가 남의 나라 사진보다 낫다.
const KO_ISSUE = /[가-힣]/.test(headlines.slice(0, 3).join(' '));
if (KO_ISSUE) log('[화면] 한국 기사 — 소재도 한국 것만 쓴다');
const usedMedia = new Set();

// ── 이 회차 기사들의 사진 (2026-09-05 신설) ──────────────────────────────────────
//   오늘 하루 구글 위젯으로 "그 기사" 를 찾다 봇 차단에 두 번 걸리고 회차 셋을 잃었다.
//   그런데 이슈를 묶는 뉴스 DB 에 **기사 링크가 전부 있다**(최근 24시간 38,821/38,821).
//   우리가 다루기로 고른 바로 그 기사들이다 — 이미 손에 든 주소를 두고 검색엔진에 묻고 있었다.
//   여기서 가져오면 봇 차단이 없고, 관련성을 추측할 필요도 없고(그 기사의 사진이다),
//   날짜도 확실하다. 실측 0.3초에 7장.
let ISSUE_IMAGES = [];
try {
  const { issueImages } = await import('../lib/article-image.mjs');
  // 묶음이 대체로 맞아도 그 안에 혼자 다른 이야기를 하는 기사가 있다 —
  //   추석 한우 묶음의 러시아·우크라이나 기사가 4번 장면 사진이 됐다(내렸다).
  //   기사 단위로 걸러 낸 뒤 사진을 모은다.
  const onTopic = itemsOnTopic(headlines[0] ?? '', issue.items ?? [], issue.keyword);
  if (onTopic.length !== (issue.items ?? []).length) {
    log(`[화면] 이 회차와 다른 이야기인 기사 ${(issue.items ?? []).length - onTopic.length}건 제외`);
  }
  const raw = await issueImages(onTopic, { max: 10 });
  const todayKst0 = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const sameDay = TIME_SENSITIVE.test(headlines[0] ?? '');
  ISSUE_IMAGES = raw
    .filter((c) => isRealFootage(c))
    .filter((c) => !sameDay || String(c.publishedAt ?? '').slice(0, 10) === todayKst0)
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
  log(`[화면] 이 회차 기사에서 사진 ${ISSUE_IMAGES.length}장 확보${sameDay ? ' (시세 주제 — 오늘 기사만)' : ''}`);
} catch (e) {
  log(`[화면] 기사 사진 수집 실패: ${String(e.message).slice(0, 60)}`);
}
for (let i = 0; i < scenes.length; i++) {
  if (scenes[i].isOutro) { log(`[화면] ${i + 1} 마무리 — 채널 그래픽`); continue; }

  // ⚠ 2026-09-06: 이 블록을 "1순위" 라고 적어 놓고 **구글 바로 앞**에 뒀다. 그런데 아카이브
  //   검색이 그보다 먼저 돈다 — 실제로는 3순위였다. 그래서 09:00 회차가 기사 사진 2장을
  //   확보하고도 안 쓰고 "전통" 검색으로 **투호·지게·장독대**를 붙였다(차례상 물가 기사에).
  //   순서를 말로 적을 게 아니라 **자리로** 정해야 한다. 루프 맨 앞이다.
  // 브리핑이면 이 장면의 뉴스가 정해져 있다 — 그 뉴스 기사의 사진을 바로 쓴다.
  //   장면-사진 대응을 낱말 겹침으로 추측할 필요가 없다. 애초에 맞는 짝이다.
  if (!scenes[i].pick && BRIEF && BRIEF[i]) {
    for (const c of BRIEF[i].imgs) {
      if (usedMedia.has(c.url)) continue;
      usedMedia.add(c.url);
      try {
        const ext = /\.mp4(\?|$)/i.test(c.url) ? 'mp4' : 'jpg';
        scenes[i].media = await download(c.url, `${WORK}/m${i}.${ext}`);
        scenes[i].pick = c;
        scenes[i].credit = c.source ? `출처- ${c.source}` : null;
        log(`[화면] ${i + 1} 브리핑 ${i + 1}번 뉴스 사진 → ${c.source} · ${String(c.title ?? '').slice(0, 38)}`);
        break;
      } catch (e) { log(`[화면] ${i + 1} 건너뜀: ${e.message.slice(0, 36)}`); }
    }
  }

  if (!scenes[i].pick && ISSUE_IMAGES.length) {
    // 2026-09-06: 순서대로 아무거나 집었다. 그래서 훅이 "우리은행 7.5% 적금" 인 장면에
    //   **CU 편의점** 사진이 붙었다(내렸다). 이 회차 기사가 여럿이면 그중 어느 것이
    //   **이 장면의 이야기**인지 골라야 한다 — 장면의 훅·대사와 기사 제목을 맞춘다.
    const sceneWords = new Set(
      `${scenes[i].hook ?? ''} ${scenes[i].say ?? ''}`
        .split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2).map((w) => w.toLowerCase()));
    const overlap = (x) => {
      const t = String(x.title ?? '').split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2);
      let hit = 0; for (const w of t) if (sceneWords.has(w.toLowerCase())) hit += 1;
      return hit;
    };
    const pool = ISSUE_IMAGES.filter((x) => !usedMedia.has(x.url));
    // 겹치는 낱말이 많은 기사부터. 하나도 안 겹치면 그 장면 이야기가 아니다 — 쓰지 않는다.
    // 겹치는 낱말이 많은 것부터. 다만 **하나도 안 겹쳐도 버리지 않는다** —
    //   이 사진들은 이미 itemsOnTopic 으로 이 회차 기사만 남긴 것이다.
    //   2026-09-06: 안 겹치면 버리게 했더니 같은 이슈 사진을 두고 회색 카드가 나갔다.
    //   장면과 딱 맞는 게 없으면 그냥 이 회차 사진 중 하나를 쓴다 — 빈 화면보다 낫다.
    const ranked = pool.map((x) => ({ x, n: overlap(x) })).sort((a, b) => b.n - a.n);
    const c = ranked[0]?.x;
    if (c && ranked[0].n === 0) log(`[화면] ${i + 1} 장면과 딱 맞는 기사 사진은 없다 — 이 회차 사진으로 채운다`);
    if (c) {
      usedMedia.add(c.url);
      try {
        const ext = /\.mp4(\?|$)/i.test(c.url) ? 'mp4' : 'jpg';
        scenes[i].media = await download(c.url, `${WORK}/m${i}.${ext}`);
        scenes[i].pick = c;
        scenes[i].credit = c.source ? `출처- ${c.source}` : null;
        log(`[화면] ${i + 1} 기사 사진 → ${c.source} · ${String(c.title ?? '').slice(0, 40)}`);
      } catch (e) { log(`[화면] ${i + 1} 기사 사진 건너뜀: ${e.message.slice(0, 40)}`); }
    }
  }

  // 2026-09-05: 시세 주제인데 구글을 불러 **새 봇 차단을 자초했다**(22:00 회차, 질의 "뉴욕증시 금리인상").
  //   시세는 그날 사진만 쓸 수 있는데 구글 결과는 대개 지난 기사다 — 불러도 거의 버린다.
  //   기사 경로가 이미 오늘 사진을 줬으니 여기서 더 부를 이유가 없다.
  //   편성 단계에서는 이미 빼 뒀는데 장면 단계에 그대로 남아 있었다.
  const skipGoogle = TIME_SENSITIVE.test(headlines[0] ?? '');

  // LLM 이 visual 을 자주 비운다(실측: 4장면 중 3장면이 빈 회차가 반복됐다).
  //   프롬프트로 지시했지만 4B 는 지키지 않을 때가 있다 — **코드가 대비한다.**
  //   비면 그 장면의 훅과 이 편의 헤드라인에서 고유명사를 뽑아 쓴다(영문·숫자 토큰).
  let vis = String(scenes[i].visual ?? '').trim();
  // 2026-09-04: LLM 의 visual 을 무조건 먼저 쓰다가 틀린 그림이 붙었다 —
  //   중기부 기사인데 "Korea Trade Fair" 를 줘서 **공정거래위원회** 건물이 걸렸다.
  //   헤드라인에서 문맥으로 검증된 고유명사(중기부·이소영·양향자)가 있으면 그쪽을 먼저 쓴다.
  //   4B 가 지어낸 영어 어구보다, 기사에 실제로 있는 이름이 믿을 만하다.
  //   ⚠ 2026-09-04: 처음엔 고유명사로 **덮어썼는데** 전 장면이 카드가 됐다(중기부 편).
  //   "중기부" 같은 한글 기관명은 아카이브에 거의 없다. 덮지 말고 **먼저 시도할 후보**로만 둔다.
  const ownNouns = properNounsFrom(`${scenes[i].hook ?? ''} ${headlines.slice(0, 3).join(' ')}`, { max: 2 });
  if (!vis) {
    const pool = `${scenes[i].hook ?? ''} ${headlines.join(' ')}`;
    // 2026-09-03: 종전엔 영문 고유명사를 먼저 썼다. 한국 기사에는 영문이 드물게 섞이는데
    //   그 드문 하나가 뽑히면 엉뚱한 데로 간다 — 실측: 부산 예인선 사고 기사에서 "CCTV" 가 뽑혀
    //   네 장면 전부에 감시카메라와 **중국 CCTV 방송국 건물**이 깔렸다.
    //   같은 기사의 한국어 개체명(예인선·부산)으로는 8건이 잡히고 있었다.
    //   한글이 있는 기사면 **한국어 개체명을 먼저** 쓴다. 영문은 그다음이다.
    const ko = properNounsFrom(pool, { max: 3 });
    if (ko.length) {
      vis = ko.slice(0, 2).join(' ');
      log(`[화면] ${i + 1} visual 비어 있음 → 한국어 개체명 "${vis}" 사용`);
    } else {
      const proper = (pool.match(/[A-Z][A-Za-z]{2,}/g) ?? []).slice(0, 3);
      vis = proper.join(' ');
      if (vis) log(`[화면] ${i + 1} visual 비어 있음 → 헤드라인에서 "${vis}" 추출`);
    }
  }
  // 헤드라인 고유명사를 먼저, LLM 의 visual 을 그다음으로 시도한다.
  //   앞의 것이 아무것도 못 찾으면 뒤의 것으로 넘어간다 — 덮어쓰지 않는다.
  const termCandidates = [];
  // 편성이 결과를 확인한 질의를 **가장 먼저** 쓴다. 헤드라인에서 다시 뽑는 것보다 믿을 만하다.
  //   장면마다 다른 질의를 집어 같은 피사체가 반복되지 않게 한다 — 앞 회차에서 국회 건물이
  //   세 장면 연속으로 깔렸다. 질의가 하나뿐이면 어쩔 수 없이 같은 것을 쓴다.
  if (ownNouns.length) termCandidates.push(searchTerms({ visual: ownNouns.join(' ') }, { max: 3 }));
  if (vis) termCandidates.push(searchTerms({ visual: vis }, { max: 3 }));
  // 편성이 결과를 확인한 질의는 **맨 뒤**에 둔다.
  //   처음엔 맨 앞에 뒀는데 소재가 4/4 에서 1/4 로 떨어졌다(실측) — 편성 질의는 이슈 전체를
  //   대표할 뿐이라 장면별 내용과는 멀다. 앞의 것들이 다 실패했을 때 회색 카드 대신 쓴다.
  //   장면마다 다른 것을 집어 같은 그림이 연속되지 않게 한다.
  if (PROBED.length) termCandidates.push(PROBED[i % PROBED.length]);
  const terms = termCandidates[0] ?? [];
  // 질의가 비면 **검색하지 않는다.** titleRelevant 는 질의어가 없으면 전부 통과시키므로
  //   (그 자체는 옳다 — 근거 없이 버리면 안 되니까) 빈 질의로 부르면 아무 사진이나 1순위로 들어온다.
  //   실측: LLM 이 visual 을 비운 회차에서 벨라루스 등대 사진이 네 장면에 전부 깔렸다.
  // 검색어가 흔한 말뿐이어도 검색하지 않는다. 2026-09-03 실측: "National Assembly" 로
  //   탄자니아·방글라데시·파키스탄·남아공 국회가 전부 통과했다 — 낱말은 맞지만 그 나라가 아니다.
  if (!terms.length) { log(`[화면] ${i + 1} 검색어 없음 — 검색 생략(아래에서 재사용/카드)`); }
  else if (!hasDistinctiveTerm(terms)) { log(`[화면] ${i + 1} "${terms.join(' ')}" 흔한 말뿐 — 검색 생략(엉뚱한 나라가 잡힌다)`); }
  else {
  let cands = [];
  // 2026-09-03 사용자 "왤케 영상이 아니고 다 사진만 나오냐".
  //   종전 순서가 Commons(사진) → Openverse(사진) → Pexels(동영상) 이라 사진이 늘 먼저 잡혔다.
  //   쇼츠는 정지 화면이 6초씩 이어지면 바로 지루해진다 — **동영상을 먼저** 찾는다.
  // 2026-09-03 사용자 "픽셀 쓰지마" / "사건과 관련있는 영상과 사진만 넣어".
  //   Pexels 를 뺐다. 스톡은 질의에 **어울리는** 그림을 주지 그 사건을 주지 않는다 —
  //   용혜인 의원 논란에 경복궁·군중 영상이 깔렸다. 움직이지만 그 사건이 아니다.
  //   남는 것은 실제 인물·기관·장소가 찍힌 아카이브다. 정지 사진이 늘겠지만(켄번스로 움직인다)
  //   "그 사건"이라는 조건이 "움직인다"보다 앞선다.
  //   Archive 를 먼저 두는 이유: 여기에만 실제 영상 파일이 있다.
  // 공공누리(정부·지자체가 직접 찍어 푼 사진)를 **먼저** 본다 — 현직 인물·실제 행사이고
  //   상업 이용이 허용된다(출처 표시 조건). 없으면 아카이브로 내려간다.
  for (const fn of [searchKoglCommons, searchArchiveVideo, searchCommons, searchOpenverse]) {
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
    // 적합도 검사는 **아카이브 소스에만** 건다.
    //   2026-09-03 실측: 동영상을 먼저 찾게 바꿨는데도 사진만 나왔다. 원인은 이 필터였다 —
    //   Pexels 의 title 은 설명이 아니라 URL(https://www.pexels.com/video/…)이라
    //   낱말 매칭이 통째로 실패해 **동영상이 전부 걸러졌다.**
    //   Pexels 는 큐레이션된 스톡이라 검색 자체가 질의에 맞는 것을 준다. 느슨한 결과를
    //   채워 넣는 쪽은 Commons·Openverse 다 — 필터가 필요한 곳은 거기다.
    // Pexels 를 뺐으므로 '큐레이션 소스는 면제' 예외도 없앤다 — 이제 모든 후보가 같은 검사를 받는다.
    //   그 예외가 있는 한 스톡은 무조건 통과했다. 남겨두면 다시 새는 구멍이 된다.
    //   isRealFootage: 문장·도표·국기·로고는 현장이 아니다(실측으로 기재부 '문장 svg'가 뽑혔다).
    // 기관을 가리키는 질의면 결과가 한국 것이어야 한다 — 안 그러면 온타리오 농무부·탄자니아 국회가 붙는다.
    // 한 낱말짜리 질의는 뜻이 너무 넓다 — 지명이면 관광 사진, 보통명사면 동음이의어가 온다.
    // 지명 말고는 죄다 일반어인 질의는 그 나라 아무 건물이나 부른다(임시정부 청사가 그렇게 붙었다).
    if ((terms.length < 2 && !canSearchAlone(terms[0])) || isBarePlace(terms) || isVaguePlaceQuery(terms)) {
      log(`[화면] ${i + 1} "${terms.join(' ')}" 는 낱말이 하나 — 검색 생략(뜻이 너무 넓다)`);
      break;
    }
    const koAnchor = KO_ISSUE || needsKoreaAnchor(terms);
    const relevant = cands.filter((c) => !usedMedia.has(c.url) && isRealFootage(c)
      && titleRelevant(c.title, terms) && near(c.title)
      && (!koAnchor || looksKorean(c.title)));
    // 최신 자료를 앞으로. 아카이브에는 20년 전 사진이 그대로 남아 있다
    //   (실측: '총리' 로 2003년 고건 총리 사진이 잡혔다).
    const got = pickFootageMany(preferRecent(relevant), 1, { terms, preferFree: true });
    if (got.length) { scenes[i].pick = got[0]; break; }
  }
  // 2026-09-04: **구글 검색을 먼저 쓴다** — 한국어를 그대로 넣을 수 있어서다.
  //   아카이브는 영어로 옮겨 찾아야 해서 충돌이 끊이지 않았다
  //   (총리→2003년 고건 · 부산→해수욕장 · 전복→조개 · GAP→프랑스 도시).
  //   구글은 "중기부" 를 넣으면 중기부 사진을 준다.
  //   ⚠ 저작권: 여기 나오는 사진은 대개 언론사 것이다. 사용자 지시("출처만 적어")에 따르되
  //     통신사 도메인은 riskyDomain 으로 표시해 크레딧 파일에 남긴다.
  if (!scenes[i].pick && skipGoogle) {
    log(`[화면] ${i + 1} 시세 주제 — 구글은 부르지 않는다(그날 사진이 아니면 못 쓴다)`);
  }
  if (!scenes[i].pick && !skipGoogle && process.env.GOOGLE_CSE_CX) {
    // 2026-09-05: 고유명사 추출에만 기댔더니 "김승원 법무장관 후보자" 편에서 "법무" 가 뽑혔다.
    //   **이슈 키워드가 이 회차의 주제어다** — 편성이 그걸로 이 이슈를 골랐다. 앞에 세운다.
    //   구글은 한국어를 그대로 받으므로 "김승원" 이 가장 정확한 질의다.
    const nouns = properNounsFrom(`${scenes[i].hook ?? ''} ${headlines.slice(0, 3).join(' ')}`, { max: 2 })
      .filter((w) => /[가-힣]/.test(w));
    // 2026-09-05: 이슈 키워드만 넣었더니 **크로아티아 수출 계약** 대본에
    //   **한화에어로 폭발 사고(4~5명 사망)** 사진이 세 장면에 붙었다. 회사명만으로 찾으면
    //   그 회사의 가장 많이 퍼진 기사가 온다 — 이 회차가 무슨 이야기인지는 반영되지 않는다.
    //   성과 소식에 사망 사고 사진을 붙이는 것은 관광 사진을 재난 기사에 붙이는 것보다 나쁘다.
    //   **이 장면이 무엇을 말하는지**(훅)를 질의에 같이 넣는다.
    // properNounsFrom 은 문맥이 뒷받침하는 고유명사만 내놓는다(그 자체는 옳다 — 흔한 말로
    //   엉뚱한 이슈를 편성한 일이 있었다). 하지만 "크로아티아" 처럼 문맥 표지가 없는 지명은
    //   못 뽑는다. 구글은 자연어를 그대로 받으므로 **헤드라인의 핵심어**를 직접 쓴다.
    //   이슈 키워드(회사명)만으로는 그 회사의 가장 많이 퍼진 기사가 오기 때문이다.
    const HEAD_STOP = /^(그리고|하지만|이번|올해|지난|오늘|내일|관련|위해|대한|따른|모두|경우|가능|예정|계획|규모|임박|전망|밝혀|한다|했다|또는)$/;
    const headWords = `${headlines[0] ?? ''}`
      .split(/[^가-힣A-Za-z0-9]+/)
      .filter((w) => w.length >= 2 && /[가-힣]/.test(w) && !HEAD_STOP.test(w)
        && !issue.keyword.includes(w) && !w.includes(issue.keyword))
      .sort((a, b) => b.length - a.length);
    const hookNouns = properNounsFrom(String(scenes[i].hook ?? ''), { max: 2 })
      .filter((w) => /[가-힣]/.test(w));
    const koq = [...new Set([
      ...(/[가-힣]/.test(issue.keyword) ? [issue.keyword] : []),
      ...hookNouns,
      ...headWords,
      ...nouns,
    ])].slice(0, 2);
    if (koq.length) {
      try {
        const g = await searchGoogleImages(koq, { limit: 8 });
        // 질의에 걸렸다고 이 회차의 이야기인 것은 아니다 — 회사명만 맞고 내용은 사고 기사였다.
        //   결과 제목이 이 회차의 헤드라인·훅과 **말이 겹치는지** 본다. 하나도 안 겹치면 버린다.
        // 2026-09-05: 처음엔 "낱말이 하나라도 겹치면 통과" 로 했는데 **회사명 하나로 다 통과**했다.
        //   그래서 크로아티아 수출 대본에 폭발 사고 사진이 그대로 붙었다.
        //   이슈 키워드는 어차피 모든 결과에 들어 있다 — 그것을 **빼고** 겹치는지 본다.
        //   이 회차가 무슨 이야기인지(크로아티아·천무·수출)가 제목에 있어야 그 기사다.
        // 2026-09-05: "낱말 하나만 겹치면 통과" 가 아직 느슨했다. 중기부 APEC 회의 편에
        //   **"대검, 부산서 제32차 마약류 퇴치 국제협력회의"** 사진(검찰총장 직무대행 개회사)이
        //   두 장면에 붙었다 — 겹친 낱말이 "제32차" 하나뿐이었다.
        //   자막은 "이소영 중소벤처기업부 장관 후보자" 라고 말하는데 화면엔 다른 사람이 서 있다.
        //   **서수·숫자는 관련성의 근거가 아니다**(제32차·26개국·4일 …). 세지 않는다.
        //   그리고 낱말 하나로는 부족하다 — 이슈 키워드가 제목에 있거나, 뜻 있는 낱말이 둘 이상
        //   겹쳐야 그 기사로 본다.
        const ORDINAL = /^(제?\d+[차회기호년월일명건개국]*|\d+)$/;
        const tokens = (t) => String(t ?? '').split(/[^가-힣A-Za-z0-9]+/)
          .filter((w) => w.length >= 2 && !ORDINAL.test(w));
        //   "이슈 키워드가 제목에 있으면 통과" 라는 특례를 뒀다가 **같은 부처의 다른 사건**이
        //   줄줄이 통과했다(실측: "중기부, 플랫폼·제조 불공정에", "쿠폰 미환급…중기부, 야놀자 고발").
        //   부처 이름은 그 부처의 모든 기사에 있다 — 그것만으로는 이 회차의 기사가 아니다.
        //   특례를 없애고 **뜻 있는 낱말이 둘 이상** 겹치게 한다(키워드도 하나로 센다).
        const ownWords = new Set(
          tokens(`${issue.keyword} ${headlines.slice(0, 3).join(' ')} ${scenes[i].hook ?? ''}`)
            .map((w) => w.toLowerCase()));
        const shares = (title) => {
          const hit = new Set(tokens(title).map((x) => x.toLowerCase()).filter((x) => ownWords.has(x)));
          return hit.size >= 2;
        };
        // 구글 경로만 isRealFootage 검사를 안 받고 있었다 — 아카이브 경로에는 걸려 있다.
        //   같은 기준을 적용한다. 도표·로고·문서는 어느 소스에서 왔든 현장이 아니다.
        // 2026-09-05: 코스피 마감 편에서 화면엔 2,702 와 5,438 이, 자막엔 6,687 이 떴다.
        //   시세 기사 사진은 **그날 지수판**을 찍은 것이라 날짜가 다르면 숫자가 다르다.
        //   실측: "코스피" 검색 결과 6건이 전부 8월 기사였다(오늘 9/5).
        //   시청자는 화면의 숫자를 지수로 읽는다 — 틀린 지수는 관광 사진보다 나쁘다.
        //   시세·환율처럼 숫자가 매일 바뀌는 주제는 **그날 기사**만 쓴다. 없으면 안 쓴다.
        const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
        const sameDayOnly = TIME_SENSITIVE.test(headlines[0] ?? '');
        const fresh2 = g.filter((c) => !usedMedia.has(c.url) && isRealFootage(c) && shares(c.title)
          && (!sameDayOnly || String(c.publishedAt ?? '').slice(0, 10) === todayKst));
        if (sameDayOnly && g.length && !fresh2.length) {
          log(`[화면] ${i + 1} 시세 주제 — 오늘 기사 사진이 없다(옛 지수가 화면에 뜬다). 안 쓴다`);
        }
        // 시세가 아니어도 **새 기사 사진이 낫다.** 인물·정책 사진도 오래되면 그 사람이 그 자리에
        //   없거나 배경이 달라진다(전에 "총리" 검색에 2003년 고건 총리가 걸린 적이 있다).
        //   날짜를 모르는 것은 뒤로 미루되 버리지는 않는다 — 날짜가 없다고 틀린 사진은 아니다.
        fresh2.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
        if (g.length && !fresh2.length) log(`[화면] ${i + 1} 구글 ${g.length}건 모두 이 회차 이야기가 아니다 — 버린다`);
        // 2026-09-04: 첫 후보만 잡고 끝냈다가, 그게 PDF 면(korea.kr download.do 는 보도자료 문서다)
        //   그 장면이 그대로 카드로 떨어졌다 — 실측 4장면 100% 카드.
        //   **받아보고 되는 것을 고른다.** 안 되면 다음 후보로.
        for (const c of fresh2) {
          usedMedia.add(c.url);
          try {
            const ext = /\.mp4(\?|$)/i.test(c.url) ? 'mp4' : 'jpg';
            scenes[i].media = await download(c.url, `${WORK}/m${i}.${ext}`);
            scenes[i].pick = c;
            scenes[i].credit = c.source ? `출처- ${c.source}` : null;
            log(`[화면] ${i + 1} 구글 "${koq.join(' ')}" → ${c.source}${c.riskyDomain ? ' ⚠통신사' : ''} · ${String(c.title ?? '').slice(0, 44)}`);
            break;
          } catch (e) { log(`[화면] ${i + 1} 구글 후보 건너뜀: ${e.message.slice(0, 40)}`); }
        }
      } catch (e) { log(`[화면] ${i + 1} 구글 검색 실패: ${String(e.message).slice(0, 40)}`); }
    }
  }

  // 첫 후보(헤드라인 고유명사)로 못 찾았으면 **LLM 의 visual** 로 한 번 더.
  //   2026-09-04: 고유명사로 덮어쓰기만 했다가 전 장면이 카드가 됐다("중기부"는 아카이브에 없다).
  //   덮지 않고 순서대로 시도한다 — 믿을 만한 것 먼저, 그다음이 4B 가 지어낸 어구.
  // 2026-09-05: 후보가 두 개일 때 만든 코드라 [1] 하나만 봤다. 이제 후보가 셋이다
  //   (편성이 확인한 질의 · 헤드라인 고유명사 · LLM 의 visual) — 남은 것을 순서대로 다 시도한다.
  //   하나만 보고 포기하면 뒤에 있는 멀쩡한 질의가 그냥 버려진다.
  for (let k = 1; k < termCandidates.length && !scenes[i].pick; k++) {
    const alt = termCandidates[k];
    if (!alt?.length) continue;
    if (alt.length < 2 && !canSearchAlone(alt[0])) continue;
    if (isBarePlace(alt) || isVaguePlaceQuery(alt)) continue;
    let cands2 = [];
    for (const fn of [searchKoglCommons, searchCommons, searchOpenverse]) {
      try { cands2 = cands2.concat(await fn(alt, { limit: 8 }) ?? []); } catch { /* 다음 소스 */ }
    }
    const koA = KO_ISSUE || needsKoreaAnchor(alt);
    const rel2 = cands2.filter((c) => !usedMedia.has(c.url) && isRealFootage(c)
      && titleRelevant(c.title, alt) && (!koA || looksKorean(c.title)));
    const p2 = pickFootageMany(preferRecent(rel2), 1, { terms: alt, preferFree: true });
    if (p2.length) { scenes[i].pick = p2[0]; log(`[화면] ${i + 1} 대체 질의 "${alt.join(' ')}" 로 찾음`); }
  }

  // 영문 질의로 못 찾았으면 **한국어 개체명**으로 한 번 더. 그 사건에 제일 가까운 자료가
  //   한국어 제목으로 들어 있는 경우가 많다(실측: 용혜인 의원 영상 .webm).
  if (!scenes[i].pick) {
    // 2026-09-03: 낱말 **하나**로는 찾지 않는다. 한국어 단어 하나는 너무 여러 뜻을 가진다 —
    //   실측: "전복"(배가 뒤집힘) → 방파제 횟집의 전복·해삼 사진,
    //         "수색"(수색 작업) → 적십자 구조견 사진, "구조" → 단백질 구조 그림.
    //   두 낱말이 함께여야 뜻이 좁혀진다("예인선 부산", "부산 해경").
    //   좁힐 낱말이 없으면 찾지 않는다 — 회색 카드가 엉뚱한 사진보다 낫다.
    const koWords = properNounsFrom(`${scenes[i].hook ?? ''} ${headlines.join(' ')}`, { max: 4 });
    const koPairs = [];
    // 단독으로 찾아도 되는 낱말이 먼저다 — 이름 하나가 짝보다 잘 맞는다.
    for (const k of koWords) if (canSearchAlone(k) && koPairs.length < 3) koPairs.push([k]);
    for (let x = 0; x < koWords.length && koPairs.length < 5; x++) {
      for (let y = x + 1; y < koWords.length && koPairs.length < 5; y++) koPairs.push([koWords[x], koWords[y]]);
    }
    for (const pair of koPairs) {
      const kw = pair.join(' ');
      let ko = [];
      for (const fn of [searchKoglCommons, searchCommons, searchOpenverse]) {
        try { ko = ko.concat(await fn(pair, { limit: 8 })); } catch { /* 다음 소스로 */ }
      }
      const rel = ko.filter((c) => !usedMedia.has(c.url) && isRealFootage(c) && titleRelevant(c.title, pair)
        && (!KO_ISSUE || looksKorean(c.title)));
      const pick = pickFootageMany(preferRecent(rel), 1, { terms: pair, preferFree: true });
      if (pick.length) {
        scenes[i].pick = pick[0];
        log(`[화면] ${i + 1} 영문 실패 → 한국어 "${kw}" 로 찾음`);
        break;
      }
    }
  }
  // 2026-09-05: 구글 경로는 **이미 내려받아** media 까지 채운다. 그런데 여기서 같은 주소를
  //   한 번 더 받고 있었다 — 내용 해시로 중복을 막자마자 "앞 장면과 같은 사진" 으로 드러났다.
  //   두 번 받을 이유가 없다. 아직 파일이 없을 때만 받는다.
  if (scenes[i].pick && !scenes[i].media) {
    usedMedia.add(scenes[i].pick.url);
    const ext = /\.mp4(\?|$)/i.test(scenes[i].pick.url) ? 'mp4' : 'jpg';
    try {
      scenes[i].media = await download(scenes[i].pick.url, `${WORK}/m${i}.${ext}`);
      scenes[i].credit = scenes[i].pick.source ? `출처- ${scenes[i].pick.source}` : null;
      log(`[화면] ${i + 1} "${terms.join(' ')}" → ${(scenes[i].pick.title ?? '').slice(0, 40)} [${scenes[i].pick.source}]`);
    } catch (e) {
      // 실패한 후보를 pick 에 남겨 두면 뒤 단계가 '이미 골랐다'고 보고 건너뛴다 — 비운다.
      log(`[화면] ${i + 1} 내려받기 실패: ${e.message.slice(0, 50)}`);
      scenes[i].pick = null;
    }
  }
  }
  if (!scenes[i].media) {
    // 2026-09-03 사용자 "마지막엔 영상 사진도 아예없네".
    //   못 찾았다고 바로 카드로 떨어뜨리지 않는다. 같은 편 안의 다른 장면 소재를 다시 쓴다 —
    //   같은 이슈를 다루는 편이라 맥락이 어긋나지 않고, 빈 카드보다 훨씬 낫다.
    // 2026-09-04: 재사용을 무제한으로 두니 **같은 사진이 네 장면에 그대로** 깔렸다(중기부 편 실측).
    //   정지 화면이나 다름없다. 한 소재는 최대 두 장면까지만 쓰고, 그 뒤는 카드로 간다.
    //   빈 카드보다 낫다는 판단은 '한 번 더'까지만 참이다.
    const REUSE_MAX = Number(process.env.SHORTS_REUSE_MAX || 2);
    const useCount = (m) => scenes.filter((x) => x.media === m).length;
    const donor = scenes.slice(0, i).reverse().find((x) => x.media && !x.isOutro && useCount(x.media) < REUSE_MAX);
    if (donor) {
      scenes[i].media = donor.media;
      scenes[i].credit = donor.credit;
      log(`[화면] ${i + 1} 소재 없음 — 앞 장면(${scenes.indexOf(donor) + 1}) 소재 재사용 (${useCount(donor.media)}/${REUSE_MAX})`);
    } else {
      log(`[화면] ${i + 1} 소재 없음 — 카드로 간다`);
    }
  }
}

closeGoogleImages();

// 2026-09-05: **전 장면이 카드면 내지 않는다.**
//   07:00 편이 네 장면 모두 카드로 나가 회색 화면만 남았다(사용자가 보고 내리라고 했다).
//   소재를 하나도 못 찾았다는 건 그 주제를 보여줄 수 없다는 뜻이다 — 그런 편은 영상이 아니다.
//   한 장이라도 있으면 낸다(나머지는 재사용·카드로 메운다).
{
  // 서로 다른 사진이 몇 장인지 센다 — 같은 사진 두 번은 한 장이다.
  //   (`x.media` 가 있는 장면을 세면 재사용도 media 가 있어 부풀려진다.)
  //
  // 2026-09-06: 이 값을 **검사 전에 한 번만 세어 두고** 마지막 관문에서 그대로 썼다.
  //   그 사이 중복 제거와 CLIP 이 사진을 빼 가는데도 숫자는 그대로였다.
  //   로그는 "소재 3/4" 라고 말했지만 실제로 남은 건 1장이었고, 회색 카드 두 장이 나갔다
  //   (kCPGFKllwfI, 내렸다). **셀 때마다 다시 센다.**
  const distinctMedia = () => new Set(scenes.filter((x) => !x.isOutro && x.media).map((x) => x.media)).size;
  // ── 발행 전 마지막 관문: 사진이 이 회차 이야기인가 (2026-09-06 신설) ──────────────
  //   규칙(제목 겹침·날짜·도표 패턴)으로는 끝이 없었다 — 여덟 번을 눈으로 잡아 내렸다.
  //   한국어 CLIP 에게 묻는다. 판정 못 하면(모델 없음·느림) 막지 않는다.
  // 같은 장면을 다른 매체가 찍은 사진은 URL·픽셀이 달라 해시로 못 잡는다.
  //   실측: 이재명 편 네 장면 중 셋이 같은 자리·같은 옷이었다(31초 내내 정지 화면).
  try {
    const { clipDuplicates } = await import('../lib/clip-gate.mjs');
    const withMedia = scenes.map((x, k) => ({ k, x })).filter((r) => !r.x.isOutro && r.x.media);
    const dup = clipDuplicates(withMedia.map((r) => r.x.media));
    for (const i of dup) {
      const r = withMedia[i];
      log(`[화면] ${r.k + 1} 앞 장면과 거의 같은 사진 — 뺀다`);
      r.x.media = null; r.x.pick = null; r.x.credit = null;
    }
  } catch (e) { log(`[화면] 사진 중복 검사 건너뜀: ${String(e.message).slice(0, 40)}`); }

  try {
    const { clipCheck } = await import('../lib/clip-gate.mjs');
    const cand = scenes.map((x, k) => ({ k, x })).filter((r) => !r.x.isOutro && r.x.media);
    if (cand.length) {
      // 브리핑은 장면마다 다른 뉴스다 — 회차 대표 헤드라인 하나로 재면 전부 어긋난 것으로 나온다.
      //   장면별로 그 뉴스의 헤드라인과 견준다.
      const verdict = BRIEF
        ? cand.flatMap((r) => {
          const topic = (BRIEF[r.k]?.it?.headlines ?? [])[0] ?? headlines[0] ?? issue.keyword;
          const one = clipCheck([{ image: r.x.media }], topic);
          return one.length ? [{ ...one[0], index: cand.indexOf(r) }] : [];
        })
        : clipCheck(cand.map((r) => ({ image: r.x.media })), headlines[0] ?? issue.keyword);
      // 2026-09-06: 미끼가 넓어 멀쩡한 사진 둘을 버리고 빈 화면이 나갔다(태극기·한복 → "민속 도구").
      //   미끼는 좁혔지만, **절반 넘게 걸리면 판정 자체를 의심**한다 —
      //   그럴 땐 모델이 주제를 못 잡은 것이지 사진이 다 틀린 게 아니다. 그때는 막지 않는다.
      // 2026-09-06: "절반 넘게 걸리면 판정을 무시한다" 는 예외가 **배너까지 되살렸다.**
      //   그 예외는 모델이 주제를 못 잡았을 때를 위한 것이다. 배너·글자판은 주제와 무관하게
      //   화면에 깔면 안 되는 것이므로 이 예외에서 빼고 **언제나** 거른다.
      const isBanner = (v) => (v.formDecoy ?? 0) >= 0.2;
      const bad = verdict.filter((v) => !v.ok && !isBanner(v)).length;
      const softBail = verdict.length >= 2 && bad > verdict.length / 2;
      if (softBail) {
        log(`[화면] CLIP 이 주제 불일치로 ${verdict.length}장 중 ${bad}장을 걸렀다 — 판정이 미덥지 않아 배너만 뺀다`);
      }
      let dropped = 0;
      for (const v of verdict) {
        if (v.ok) continue;
        if (softBail && !isBanner(v)) continue;   // 주제 판정은 못 믿겠고, 배너는 그래도 뺀다
        const r = cand[v.index];
        log(`[화면] ${r.k + 1} CLIP 이 걸렀다 — 주제 ${v.topic} vs "${v.worstDecoy}" ${v.decoy}`);
        r.x.media = null; r.x.pick = null; r.x.credit = null;
        dropped += 1;
      }
      if (verdict.length) log(`[화면] CLIP 검사 ${verdict.length}장 중 ${dropped}장 제외`);
      // 2026-09-06: 걸러 낸 자리를 비워 뒀더니 **회색 카드**가 됐다(실측 4번 장면).
      //   통과한 사진 중에서 채운다 — 같은 사진이 두 번 나오는 편이 빈 화면보다 낫다.

    }
  } catch (e) {
    if (e.message !== 'skip-clip') log(`[화면] CLIP 검사 건너뜀: ${String(e.message).slice(0, 50)}`);
  }

  // 2026-09-06: 빈 자리 채우기를 CLIP 블록 **안에** 뒀더니 중복 제거로 뺀 자리는 안 채워져
  //   또 회색 카드가 나갔다(실측 4번 장면). 어느 검사가 뺐든 마지막에 한 번 채운다.
  {
    // 2026-09-08 사용자 "대본이랑 사진이 안맞는 부분도 있네".
    //   브리핑은 **장면마다 다른 뉴스**다. 빈 자리를 다른 장면 사진으로 채우면
    //   3번 장면이 3번 뉴스를 읽으면서 1번 뉴스 사진을 보여 준다 — 반드시 어긋난다.
    //   실측: 브리핑 59편 중 **26편(44%)** 에 재사용·카드가 섞여 있었다.
    //   한 이슈짜리 편은 모든 장면이 같은 사건이라 빌려와도 된다. 브리핑만 다르게 다룬다.
    if (BRIEF) {
      const lost = scenes.filter((x) => !x.isOutro && !x.media);
      if (lost.length) {
        log(`[화면] 브리핑에서 사진을 잃은 장면 ${lost.length}개를 뺀다(다른 뉴스 사진을 빌리지 않는다)`);
        scenes = scenes.filter((x) => x.isOutro || x.media);
      }
    } else {
      const good = scenes.filter((x) => !x.isOutro && x.media);
      const useCount = (m) => scenes.filter((x) => x.media === m).length;
      let filled = 0;
      for (const x of scenes) {
        if (x.isOutro || x.media) continue;
        const donor = good.find((g) => useCount(g.media) < 2);
        if (!donor) break;
        x.media = donor.media; x.credit = donor.credit;
        filled += 1;
      }
      if (filled) log(`[화면] 검사로 빈 자리 ${filled}곳을 통과한 사진으로 채운다`);
    }
  }

  // ── 썸네일 자리 고르기 (2026-09-07 사용자 "썸네일이 너무 저자극 부분이 나온듯") ──────
  //   쇼츠는 **첫 프레임이 썸네일**이다. 거기에 막대그래프가 올라가면 아무도 멈추지 않는다.
  //   실측: 같은 회차에서 그래프 사진은 도표일 확률 96.9%, 현장 사진들은 0.2% — 확실히 갈린다.
  //   도표를 버리지는 않는다(수출 추이엔 맞는 그림이다). **앞자리에서만 물린다.**
  try {
    const { clipCharts } = await import('../lib/clip-gate.mjs');
    const withMedia = scenes.map((x, k) => ({ k, x })).filter((r) => !r.x.isOutro && r.x.media);
    if (withMedia.length >= 2) {
      const chart = clipCharts(withMedia.map((r) => r.x.media));
      const first = chart[0] ?? 0;
      if (first >= 0.5) {
        const alt = chart.findIndex((c, i) => i > 0 && c < 0.3);
        if (alt > 0) {
          const a = withMedia[0].x; const b = withMedia[alt].x;
          // 브리핑은 장면마다 다른 뉴스다 — **대본까지 함께 옮겨야** 짝이 유지된다.
          //   사진만 바꾸면 1번이 1번 뉴스를 읽으면서 2번 사진을 보여 준다.
          const fields = BRIEF ? ['media', 'pick', 'credit', 'hook', 'say'] : ['media', 'pick', 'credit'];
          for (const f of fields) { const t = a[f]; a[f] = b[f]; b[f] = t; }
          log(`[화면] 첫 장면이 도표였다(${(first * 100).toFixed(0)}%) — ${alt + 1}번 사진과 자리를 바꾼다`);
        } else {
          log(`[화면] 첫 장면이 도표인데(${(first * 100).toFixed(0)}%) 바꿀 사진이 없다 — 그대로 간다`);
        }
      }
    }
  } catch (e) { log(`[화면] 썸네일 자리 점검 건너뜀: ${String(e.message).slice(0, 40)}`); }

  const total = scenes.filter((x) => !x.isOutro).length;
  // 2026-09-05: "하나도 없으면" 만 막았더니 **4장면 중 1장만 있는 편**이 통과했다.
  //   백필이 회색 카드 3장 + 임시정부 청사 사진 하나로 한 편을 냈다(내렸다).
  //   카드가 절반을 넘으면 그건 영상이 아니라 빈 화면이다. 절반은 채워야 낸다.
  const MIN_REAL = Math.max(1, Math.ceil(total / 2));
  const real = distinctMedia();   // 검사·채우기가 모두 끝난 **지금** 센다
  if (real < MIN_REAL) {
    console.error(`❌ ${total}장면 중 소재는 ${real}장뿐 — 회색 카드가 절반을 넘는다. 이번 회차를 거른다.`);
    console.error('   다음 슬롯이나 백필에서 소재가 잡히면 정상 발행된다.');
    process.exit(3);   // 3 = 낼 것이 없음
  }
  if (real < total) log(`[화면] 소재 ${real}/${total} — 나머지는 재사용·카드`);
}

// ── 소재 선택 기록 (2026-09-04, 사용자 "지켜보면서 고치자") ─────────────────────
//   매 회차 어떤 질의로 무엇이 붙었는지 한 줄씩 쌓는다.
//   며칠 지나면 "어떤 종류의 질의가 틀린 그림을 물어오는가" 를 눈짐작이 아니라 숫자로 볼 수 있다.
//   지금까지는 매번 영상을 열어 확인해야 했고, 그래서 두 번은 올린 뒤에야 알았다.
try {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    issue: issue.keyword,
    koIssue: KO_ISSUE,
    scenes: scenes.filter((x) => !x.isOutro).map((x) => ({
      hook: x.hook ?? null,
      picked: x.pick ? {
        title: String(x.pick.title ?? '').slice(0, 80),
        source: x.pick.source ?? null,
        risky: x.pick.riskyDomain ?? false,
      } : null,
      reused: !x.pick && !!x.media,
      card: !x.media,
    })),
  });
  appendFileSync(resolve(ROOT, 'logs/footage-picks.jsonl'), line + '\n');
} catch { /* 기록 실패가 발행을 막지는 않는다 */ }

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
// 마무리 장면 그래픽 — 사이트 주소를 크게. 이게 광고 컷이다.
await page.setViewportSize({ width: G.W, height: G.media.height });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${G.W}px;height:${G.media.height}px}
body{background:radial-gradient(820px 620px at 50% 42%,#1d3a6e 0%,rgba(0,0,0,0) 66%),
  linear-gradient(150deg,#070b16,#111c33 55%,#070b16);
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;color:#eef3ff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px}
.w{font-size:86px;font-weight:900;letter-spacing:.26em;text-indent:.26em;color:#fff}
.r{width:130px;height:7px;background:linear-gradient(90deg,#ff4d5e,#c81e3a)}
.u{font-size:74px;font-weight:900;color:#ffd400;letter-spacing:.02em;
  -webkit-text-stroke:5px #0a0a0a;paint-order:stroke fill}
.c{font-size:30px;color:#9fb2d4;letter-spacing:.06em}
</style>
<div class="w">FLOWVIUM</div><div class="r"></div>
<div class="u">${SITE_URL}</div>
<div class="c">전체 분석 · 실시간 시장 데이터</div>`);
await page.screenshot({ path: `${WORK}/outro.png` });

await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${G.W}px;height:${G.media.height}px}
body{background:radial-gradient(760px 560px at 50% 45%,#25406e 0%,rgba(0,0,0,0) 66%),
  linear-gradient(140deg,#080d1a,#16224061 55%,#080d1a);
  font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;
  display:flex;align-items:center;justify-content:center}
/* 2026-09-05: 여기에 **이슈 키워드를 그대로** 찍고 있었다. 그래서 화면에 "ipo" 라는
   원시 낱말이 크게 떠 있는 영상이 나갔다(사용자: "영상에 ipo만 떡하니 있는데?").
   키워드는 우리 내부 분류일 뿐 시청자에게는 아무 뜻이 없다.
   글자를 지우고 브랜드 마크만 은은하게 둔다 — 소재가 없을 때의 배경이지 정보가 아니다. */
.k{font-size:64px;font-weight:900;color:rgba(255,255,255,.10);letter-spacing:.32em;
  text-indent:.32em;text-align:center}
</style><div class="k">FLOWVIUM</div>`);
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
  const src = scenes[i].isOutro ? `${WORK}/outro.png` : (scenes[i].media ?? `${WORK}/card.png`);
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

// ── 배경음악 (2026-09-06 사용자 "좀 뉴스 스러운 배경음악 돌려쓸수있는거 없니?") ──────
//   CC0 음원을 받아 쓰는 길도 있지만(Pixabay·Creazilla) 이 채널은 이미 사진으로 저작권이
//   아슬아슬하다. **직접 만들어 쓰면 그 위험이 없다** — assets/bgm 에 두고 회차마다 돌려 쓴다.
//
//   섞는 방법이 중요하다. 만든 음악은 목소리 대역(300~3kHz)에 43%가 몰려 있어(실측)
//   그냥 얹으면 내레이션을 덮는다. 그래서:
//     ① 목소리 대역을 깎고(equalizer)  ② 말할 때 음악이 내려가게 한다(sidechaincompress)
//   음악이 없으면 그냥 넘어간다 — 배경음 때문에 회차를 잃지 않는다.
{
  const bgmDir = resolve(ROOT, 'assets/bgm');
  let beds = [];
  try { beds = readdirSync(bgmDir).filter((f) => /\.(wav|mp3|m4a)$/i.test(f)).sort(); } catch { /* 없으면 넘어간다 */ }
  if (beds.length) {
    // 편마다 다른 곡을 쓴다 — 발행 편수로 돌린다(무작위 아닌 결정론).
    const bed = join(bgmDir, beds[shortsPublishedCount() % beds.length]);
    const withBgm = `${WORK}/with-bgm.mp4`;
    const r = spawnSync(ffmpegPath, [
      '-v', 'error',
      '-i', OUT,
      '-stream_loop', '-1', '-i', bed,     // 영상 길이만큼 음악을 반복한다
      '-filter_complex',
      // 음악: 목소리 대역을 깎고 볼륨을 낮춘 뒤, 말소리를 기준으로 더킹한다.
      // 2026-09-06: 처음엔 볼륨만 0.16 을 곱했다. **안 들렸다** — 실측으로 배경 구간이 -49dB 였다.
      //   원인이 셋 겹쳤다: 원곡이 이미 -11dB, 거기에 -16dB, 다시 더킹.
      //   곡마다 음량도 제각각이라 곱셈으로는 맞출 수 없다 —
      //   **loudnorm 으로 일정 음량(-20 LUFS)에 맞춘 뒤** 섞고, 더킹도 덜 깊게 잡는다.
      `[1:a]loudnorm=I=${process.env.SHORTS_BGM_LUFS || -20}:TP=-2:LRA=7,`
      + 'equalizer=f=900:t=q:w=1.6:g=-6,equalizer=f=2200:t=q:w=1.6:g=-5,'
      + 'highpass=f=70,lowpass=f=9000[bed];'
      + '[0:a]asplit=2[v1][v2];'
      // ratio 8 → 4, threshold 0.05 → 0.10: 말할 때 음악이 사라지지 않고 낮아지기만 한다.
      + '[bed][v2]sidechaincompress=threshold=0.10:ratio=4:attack=20:release=400[ducked];'
      + '[v1][ducked]amix=inputs=2:duration=first:dropout_transition=0:weights=1 1,'
      + 'alimiter=limit=0.95[a]',
      '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      '-shortest', '-y', withBgm,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status === 0 && existsSync(withBgm)) {
      copyFileSync(withBgm, OUT);
      log(`[음악] ${beds[shortsPublishedCount() % beds.length]} 를 깔았다(-20 LUFS 로 맞춘 뒤 말할 때 더킹)`);
    } else {
      log(`[음악] 배경음 입히기 실패 — 음악 없이 간다: ${String(r.stderr).slice(0, 80)}`);
    }
  }
}

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

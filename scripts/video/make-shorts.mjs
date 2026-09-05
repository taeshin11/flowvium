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
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ROOT } from '../lib/project-root.mjs';
import { loadEnvLocal } from '../lib/llm-config.mjs';
import { topDistinctIssues } from '../lib/issue-cluster.mjs';
import { fitScript } from '../lib/script-budget.mjs';
import { bestQuote } from '../lib/quote-card.mjs';
import { searchTerms, searchCommons, searchOpenverse, searchArchiveVideo, searchKoglCommons, pickFootageMany, creditLine, titleRelevant, hasDistinctiveTerm, isRealFootage, koreanEntities, properNounsFrom, preferRecent, needsKoreaAnchor, looksKorean, isBarePlace, canSearchAlone } from '../lib/footage.mjs';
import { cuesFromAlignment, fillGaps } from '../lib/subtitle.mjs';
import { synthesizeKorean, synthesizeKoreanBatch, koTtsReady, qwenTtsReady } from '../lib/tts-korean.mjs';
import { SHORTS as G, shortsOverlayHtml, mediaFilter, tightenNumbers } from '../lib/shorts-layout.mjs';
import { isProudHeadline } from '../lib/video-meta.mjs';
import { resolveMediaRoot } from '../lib/media-root.mjs';
import { searchGoogleImages, closeGoogleImages } from '../lib/google-images.mjs';
import { recentShortsIssues, normalizeIssueKey } from '../lib/db.mjs';

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
db.close();
if (!rows.length) { console.error('❌ 최근 24시간 기사가 없다'); process.exit(1); }

const stripHtml = (t) => String(t ?? '').replace(/<[^>]*>/g, ' ')
  .replace(/&(nbsp|#160);/g, ' ').replace(/&(quot|#34);/g, '"').replace(/&(amp|#38);/g, '&')
  .replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();

// 후보를 넉넉히 뽑는다. 8개만 보면 이미 다룬 것을 걸렀을 때 금방 바닥난다(하루 5편).
const issues = topDistinctIssues(rows, Number(process.env.SHORTS_ISSUE_POOL || 24));
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
const TIME_SENSITIVE = /(코스피|코스닥|환율|원\/달러|원달러|유가|국제유가|금값|다우|나스닥|S&P|비트코인|가상자산|국고채\s*금리)/;
/** 편성 때 구글을 몇 번까지 부를지. 한 번에 5초쯤 걸리므로 무한정 부르지 않는다. */
let GOOGLE_PROBES_LEFT = Number(process.env.SHORTS_GOOGLE_PROBE || 5);
/** 이 이슈가 한국 기사인가. 장면 쪽 KO_ISSUE 와 같은 판정을 편성 시점에도 쓴다. */
let KO_TEXT = false;
async function footageScore(it) {
  KO_TEXT = /[가-힣]/.test(String((it.headlines ?? []).slice(0, 3).join(' ')));
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
  const scored = [];
  for (const cand of fresh.slice(0, PROBE_N)) {
    const sc = await footageScore(cand);
    const { n, terms, probed } = sc;
    scored.push({ cand, n, terms, probed });
    log(`[소재탐색] "${cand.keyword}" (${terms.join(' ') || '영문 고유명사 없음'}) → ${n}건${sc.viaGoogle ? ' (구글)' : ''}`);
    if (n >= 2) break;   // 두 장면 이상 채울 수 있으면 충분하다. 더 찾느라 시간 쓰지 않는다.
  }
  scored.sort((a, b) => b.n - a.n);
  if (scored[0]?.n > 0) {
    issue = scored[0].cand;
    PROBED = scored[0].probed ?? [];
    if (issue !== fresh[0]) log(`[편성] 1순위 "${fresh[0].keyword}" 는 소재가 없어 "${issue.keyword}" 로 바꾼다`);
  } else {
    // 2026-09-05 사용자 "소재없으면 최신 국뽕소재로라도 내".
    //   앞 후보들에 소재가 없다고 회차를 거르지 않는다 — **소재가 있는 국뽕 주제로 바꿔** 낸다.
    //   국뽕 판정은 제목 앞머리에 쓰던 것과 같은 기준이다(video-meta.isProudHeadline).
    //   빈 영상을 내는 것과는 다르다. 여기서도 소재를 찾지 못하면 아래 관문이 회차를 거른다.
    const proud = fresh.filter((c) => !scored.some((x) => x.cand === c)
      && (c.headlines ?? []).some(isProudHeadline));
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
      log('⚠ 국뽕 후보에도 소재가 없다 — 1순위로 간다(카드면 아래 관문이 거른다)');
    }
  }
}
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
  // 2026-09-05 사용자 "대본도 좀 잘 띄워서 읽게해보고".
  //   프롬프트의 "숫자는 한글로 풀어 쓴다(TTS 오독 방지)" 를 4B 가 **자릿수를 띄우는 것**으로
  //   받아들여 "6 억 8 천만 원", "천무 18 문", "4 억 3520 만 유로" 를 내놓는다.
  //   앞서 화면 글자만 고쳤는데 **TTS 는 이 원문을 그대로 읽는다** — 대본 자체를 정리한다.
  //   프롬프트도 같이 고쳤지만 4B 가 지킬 거라고 믿지 않는다. 코드가 보장한다.
  return JSON.parse(m[0]).filter((x) => x?.say && x?.hook).slice(0, SCENES)
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
    if (scenes.length >= 2 && chars >= MIN_CHARS) break;
    log(`[대본] 시도 ${a}: 장면 ${scenes.length}개 · ${chars}자 — 부족(최소 ${MIN_CHARS}자)`);
  } catch (e) { log(`[대본] 시도 ${a}: ${e.message.slice(0, 100)}`); }
}
if (scenes.length < 2) { console.error('❌ 3회 시도해도 대본을 못 만들었다'); process.exit(1); }
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
for (let i = 0; i < scenes.length; i++) {
  if (scenes[i].isOutro) { log(`[화면] ${i + 1} 마무리 — 채널 그래픽`); continue; }
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
    if ((terms.length < 2 && !canSearchAlone(terms[0])) || isBarePlace(terms)) {
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
  if (!scenes[i].pick && process.env.GOOGLE_CSE_CX) {
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
    if (isBarePlace(alt)) continue;
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
  const real = scenes.filter((x) => !x.isOutro && x.media).length;
  const total = scenes.filter((x) => !x.isOutro).length;
  if (!real) {
    console.error(`❌ ${total}장면 모두 소재 없음 — 회색 카드만 남는다. 이번 회차를 거른다.`);
    console.error('   다음 슬롯에 다른 주제가 잡히면 정상 발행된다.');
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

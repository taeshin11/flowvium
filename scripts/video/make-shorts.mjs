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
import { fitScript } from '../lib/script-budget.mjs';
import { bestQuote } from '../lib/quote-card.mjs';
import { searchTerms, searchCommons, searchOpenverse, searchArchiveVideo, searchKoglCommons, pickFootageMany, creditLine, titleRelevant, hasDistinctiveTerm, isRealFootage, koreanEntities, properNounsFrom, preferRecent, needsKoreaAnchor, looksKorean, isBarePlace, canSearchAlone } from '../lib/footage.mjs';
import { cuesFromAlignment, fillGaps } from '../lib/subtitle.mjs';
import { synthesizeKorean, synthesizeKoreanBatch, koTtsReady, qwenTtsReady } from '../lib/tts-korean.mjs';
import { SHORTS as G, shortsOverlayHtml, mediaFilter } from '../lib/shorts-layout.mjs';
import { resolveMediaRoot } from '../lib/media-root.mjs';
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
    log('⚠ 한국어 기사 이슈가 없다 — 영어 이슈로 간다(대본 품질 주의)');
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
async function footageScore(it) {
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
  if (!usable.length) return { n: 0, terms: [] };
  let best = { n: 0, terms: usable[0] };
  for (const q of usable) {
    try {
      let r = [];
      for (const fn of [searchKoglCommons, searchCommons]) {
        try { r = r.concat(await fn(q, { limit: 8 }) ?? []); } catch { /* 다음 소스 */ }
      }
      const n = r.filter((c) => isRealFootage(c) && titleRelevant(c.title, q)).length;
      if (n > best.n) best = { n, terms: q };
      if (best.n >= 2) break;
    } catch { /* 한 질의가 죽어도 나머지로 */ }
  }
  return best;
}
let issue = fresh[0];
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
    const { n, terms } = await footageScore(cand);
    scored.push({ cand, n, terms });
    log(`[소재탐색] "${cand.keyword}" (${terms.join(' ') || '영문 고유명사 없음'}) → ${n}건`);
    if (n >= 2) break;   // 두 장면 이상 채울 수 있으면 충분하다. 더 찾느라 시간 쓰지 않는다.
  }
  scored.sort((a, b) => b.n - a.n);
  if (scored[0]?.n > 0) {
    issue = scored[0].cand;
    if (issue !== fresh[0]) log(`[편성] 1순위 "${fresh[0].keyword}" 는 소재가 없어 "${issue.keyword}" 로 바꾼다`);
  } else {
    log('⚠ 후보 어디에도 관련 소재가 없다 — 1순위로 간다(카드 위주가 된다)');
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
- **1번 장면이 훅이다.** 첫 세 어절에 가장 강한 사실을 박아라. "오늘은", "이번 소식은" 금지.
- **앵커 어투로 쓴다.** 사실을 **단정적으로** 전한다:
  · 좋음: "미국이 반도체 표적관세를 예고했습니다." "설비투자가 살아나고 있습니다."
  · 나쁨(전문·추측 어투 — 앵커는 이렇게 말하지 않는다):
    "~라고 합니다", "~한다고 합니다", "~하는데요", "~같습니다", "~인 것으로 보입니다",
    "~라는데요", "~죠", "~네요", "~거든요"
  · 나쁨(대화체 군더더기): "그런데", "사실은", "아무튼", "여러분", "자,"
- 어미는 '-습니다/-입니다' 로 맺는다. 반말·해체 금지.
- **한 문장을 짧게.** 한 문장에 사실 하나. 접속사로 길게 잇지 마라.
- 숫자는 한글로 풀어 쓴다(TTS 오독 방지). 예: 17 billion → 백칠십억
- 한국이 잘한 이야기면 대놓고 자랑하라. "이게 대한민국입니다", "또 해냈습니다" 같은 말을 써도 좋다.
  단 **헤드라인에 있는 사실로만** — 없는 순위·기록·반응을 지어내면 거짓말이다.
- hook: 화면 위에 크게 박을 문구. **12자 이내**, 명사로 끝내라. 예: "삼성 세계 1위 탈환"
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
scenes.push({
  hook: '더 깊은 분석은',
  say: `오늘 다룬 이슈의 전체 분석과 실시간 시장 데이터는 ${SITE_URL} 에서 보실 수 있습니다.`,
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
async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FlowVium-shorts/1.0 (https://flowvium.net)' }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_DL) throw new Error(`너무 큼 ${(buf.length / 1048576).toFixed(0)}MB`);
  writeFileSync(dest, buf);
  return dest;
}

// 장면끼리 같은 그림을 쓰지 않는다. 2026-09-03 실측: 홈플러스 편에서 같은 매장 사진이
//   네 장면에 그대로 깔렸다 — 소재가 맞아도 같은 그림이 반복되면 정지 화면이나 다름없다.
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
  if (ownNouns.length) termCandidates.push(searchTerms({ visual: ownNouns.join(' ') }, { max: 3 }));
  if (vis) termCandidates.push(searchTerms({ visual: vis }, { max: 3 }));
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
    const koAnchor = needsKoreaAnchor(terms);
    const relevant = cands.filter((c) => !usedMedia.has(c.url) && isRealFootage(c)
      && titleRelevant(c.title, terms) && near(c.title)
      && (!koAnchor || looksKorean(c.title)));
    // 최신 자료를 앞으로. 아카이브에는 20년 전 사진이 그대로 남아 있다
    //   (실측: '총리' 로 2003년 고건 총리 사진이 잡혔다).
    const got = pickFootageMany(preferRecent(relevant), 1, { terms, preferFree: true });
    if (got.length) { scenes[i].pick = got[0]; break; }
  }
  // 첫 후보(헤드라인 고유명사)로 못 찾았으면 **LLM 의 visual** 로 한 번 더.
  //   2026-09-04: 고유명사로 덮어쓰기만 했다가 전 장면이 카드가 됐다("중기부"는 아카이브에 없다).
  //   덮지 않고 순서대로 시도한다 — 믿을 만한 것 먼저, 그다음이 4B 가 지어낸 어구.
  if (!scenes[i].pick && termCandidates.length > 1) {
    const alt = termCandidates[1];
    if (alt.length >= 2 && !isBarePlace(alt)) {
      let cands2 = [];
      for (const fn of [searchKoglCommons, searchCommons, searchOpenverse]) {
        try { cands2 = cands2.concat(await fn(alt, { limit: 8 }) ?? []); } catch { /* 다음 소스 */ }
      }
      const koA = needsKoreaAnchor(alt);
      const rel2 = cands2.filter((c) => !usedMedia.has(c.url) && isRealFootage(c)
        && titleRelevant(c.title, alt) && (!koA || looksKorean(c.title)));
      const p2 = pickFootageMany(preferRecent(rel2), 1, { terms: alt, preferFree: true });
      if (p2.length) { scenes[i].pick = p2[0]; log(`[화면] ${i + 1} 고유명사 실패 → visual "${alt.join(' ')}" 로 찾음`); }
    }
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
      const rel = ko.filter((c) => !usedMedia.has(c.url) && isRealFootage(c) && titleRelevant(c.title, pair));
      const pick = pickFootageMany(preferRecent(rel), 1, { terms: pair, preferFree: true });
      if (pick.length) {
        scenes[i].pick = pick[0];
        log(`[화면] ${i + 1} 영문 실패 → 한국어 "${kw}" 로 찾음`);
        break;
      }
    }
  }
  if (scenes[i].pick) {
    usedMedia.add(scenes[i].pick.url);
    const ext = /\.mp4(\?|$)/i.test(scenes[i].pick.url) ? 'mp4' : 'jpg';
    try {
      scenes[i].media = await download(scenes[i].pick.url, `${WORK}/m${i}.${ext}`);
      scenes[i].credit = scenes[i].pick.source ? `출처- ${scenes[i].pick.source}` : null;
      log(`[화면] ${i + 1} "${terms.join(' ')}" → ${(scenes[i].pick.title ?? '').slice(0, 40)} [${scenes[i].pick.source}]`);
    } catch (e) { log(`[화면] ${i + 1} 내려받기 실패: ${e.message.slice(0, 50)}`); }
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

#!/usr/bin/env node
/**
 * quote-card.test.mjs — 헤드라인에서 **인용 발언**을 뽑아 화면 카드로 만든다.
 *
 * 배경(2026-08-27): "트럼프 기사면 트럼프가 뭘 하는 사진을 넣든, X·페북·인스타에 있는 것도
 *   같이 넣어줘야 하지 않나?" — 맞는 지적이다. 아카이브의 취임 선서 사진은 **그 기사**가 아니다.
 *
 * 다만 SNS 원본을 긁는 대신 방송사가 실제로 하는 방식을 쓴다: **인용을 다시 그린다.**
 *   화면에 뜨는 건 트윗 스크린샷이 아니라 방송사가 만든 그래픽이다.
 *   · 저작권: 짧은 사실 진술의 인용이고, 보도 목적이며, 원본 이미지를 복제하지 않는다.
 *   · 유튜브 재사용 심사: 우리가 만든 그래픽이라 재사용이 아니다.
 *   · 화면: "그 사건" 이 화면에 직접 뜬다 — 일반 b-roll 보다 뉴스답다.
 *
 * 실측: 12시간 수집분 148건 중 **78건**에 인용부호나 says/said/told/posted 가 있다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./quote-card.mjs');

// ── 1. 큰따옴표 안의 발언을 뽑는다 ───────────────────────────────────────────
{
  const q = M.extractQuote('Dolly Parton theme park president says "we have a lot of plans in place"');
  if (q?.text === 'we have a lot of plans in place') ok(`인용 추출: "${q.text}"`);
  else bad(`추출 실패: ${JSON.stringify(q)}`);
  if (q?.speaker === 'Dolly Parton theme park president') ok(`화자 추출: ${q.speaker}`);
  else bad(`화자 이상: ${q?.speaker}`);
}

// ── 2. 곡선 따옴표·한국어도 처리한다 ─────────────────────────────────────────
{
  const q = M.extractQuote('이재명 대통령은 “국민이 먼저다”라고 말했다');
  if (q?.text === '국민이 먼저다') ok(`한국어 인용: "${q.text}"`);
  else bad(`한국어 실패: ${JSON.stringify(q)}`);
}

// ── 3. 작품명은 인용이 아니다 ────────────────────────────────────────────────
// 'Tim Curry, star of "The Rocky Horror Picture Show," dies at 80' 에서
//   따옴표 안은 발언이 아니라 **작품 제목**이다. 이걸 발언 카드로 띄우면 틀린 화면이 된다.
{
  const q = M.extractQuote('Tim Curry, star of "The Rocky Horror Picture Show," dies at 80');
  if (q === null) ok('작품 제목은 인용으로 보지 않는다 (says/said 류가 앞에 없음)');
  else bad(`작품명을 발언으로 오인: ${JSON.stringify(q)}`);
}


// ── 3b. 영화·작품 제목 걸러내기 (실측: 2,260건 스캔에서 섞여 나왔다) ─────────
// 'James Gunn says "Superman: Man of Tomorrow" …' 처럼 says 뒤에 **제목**이 오는 경우가 있다.
// 실제 발언은 문장 중간에서 인용돼 **소문자로 시작**한다. 제목은 각 단어가 대문자다.
// (한국어는 대소문자가 없으니 이 규칙을 적용하지 않는다.)
{
  if (M.extractQuote('James Gunn says "Superman: Man of Tomorrow" is coming') === null)
    ok('says 뒤 작품 제목은 인용이 아니다');
  else bad(`제목을 발언으로: ${JSON.stringify(M.extractQuote('James Gunn says "Superman: Man of Tomorrow" is coming'))}`);
  if (M.extractQuote('Producer said "Insidious 6" starts filming') === null) ok('짧은 대문자 제목 차단');
  else bad('짧은 제목 통과');
  // 소문자로 시작하는 진짜 발언은 통과.
  if (M.extractQuote('Trump said the war will "continue for as long as necessary"')?.text
      === 'continue for as long as necessary') ok('소문자로 시작하는 발언은 통과');
  else bad('진짜 발언을 버렸다');
  // 대문자로 시작해도 충분히 길면 주장으로 본다.
  const long = M.extractQuote('Burry says "Nvidia Will Not Distribute Enough To Shareholders" in note');
  if (long?.text.startsWith('Nvidia')) ok('대문자여도 6단어 이상이면 주장으로 본다');
  else bad('긴 주장을 버렸다');
  // 한국어는 대소문자가 없으므로 규칙 적용 제외.
  if (M.extractQuote('대통령은 “국민이 먼저다”라고 말했다')?.text === '국민이 먼저다') ok('한국어는 영향 없음');
  else bad('한국어 회귀');
}

// ── 4. 너무 짧은 조각은 버린다 ───────────────────────────────────────────────
{
  if (M.extractQuote('Officials cite "misconduct"') === null) ok('한 단어짜리는 카드가 안 된다');
  else bad('짧은 조각을 인용으로 만들었다');
}

// ── 5. 인용이 없으면 null ────────────────────────────────────────────────────
{
  if (M.extractQuote('Trump signs executive order on mail-in voting') === null) ok('인용 없으면 null');
  else bad('없는 인용을 만들었다');
  if (M.extractQuote('') === null && M.extractQuote(null) === null) ok('빈 입력 안전');
  else bad('빈 입력 이상');
}

// ── 6. 여러 헤드라인에서 가장 좋은 인용 하나 ─────────────────────────────────
{
  const heads = [
    'Trump signs executive order',
    'Tim Curry, star of "The Rocky Horror Picture Show," dies at 80',
    'Park president says "we have a lot of plans in place that will honor her legacy"',
  ];
  const best = M.bestQuote(heads);
  if (best?.text.startsWith('we have a lot of plans')) ok('가장 긴 실제 발언을 고른다');
  else bad(`선택 이상: ${JSON.stringify(best)}`);
  if (M.bestQuote(['no quotes here', 'none either']) === null) ok('인용이 없으면 null');
  else bad('없는 걸 골랐다');
  if (M.bestQuote([]) === null && M.bestQuote(null) === null) ok('빈 배열 안전');
  else bad('빈 배열 이상');
}

// ── 7. 카드 HTML — 화면에 얹을 수 있는 형태인가 ──────────────────────────────
{
  const html = M.quoteCardHtml({ text: 'we have a lot of plans', speaker: 'Park president', source: 'CBS' },
    { width: 1920, height: 1080 });
  if (/^<!doctype html>/i.test(html)) ok('HTML 문서');
  else bad('HTML 형식 아님');
  if (html.includes('we have a lot of plans') && html.includes('Park president')) ok('발언·화자 포함');
  else bad('내용 누락');
  // XSS/깨짐 방지 — 헤드라인은 외부 데이터다.
  const bad1 = M.quoteCardHtml({ text: '<script>x</script>', speaker: 'a&b' }, {});
  if (!bad1.includes('<script>') && bad1.includes('&amp;')) ok('HTML 이스케이프');
  else bad('이스케이프 실패 — 외부 데이터가 마크업으로 들어간다');
}


// ── 앵커 박스와 겹치지 않는다 ────────────────────────────────────────────────
//   실측(2026-08-28): 앵커를 켠 편에서 인용문이 "…for as long as nee" 에서 잘렸다.
//   전면 카드는 화면 전체를 쓰는데 앵커 박스는 그 위에 얹히므로, 카드가 스스로 비켜야 한다.
{
  const AB = { x: 1345, w: 519 };
  const inset = 1920 - AB.x + 40;                       // 615
  const html = M.quoteCardHtml({ text: 'x'.repeat(200) }, { width: 1920, rightInset: inset });
  const padR = Number(/padding:0 (\d+)px/.exec(html)?.[1] ?? -1);
  const maxW = Number(/max-width:(\d+)px/.exec(html)?.[1] ?? -1);
  const padL = 150;
  const rightEdge = Math.max(padL + maxW, 1920 - padR);
  if (padR < 0 || maxW < 0) bad(`패딩·최대폭을 못 읽었다 (padding=${padR}, max-width=${maxW})`);
  else if (rightEdge <= AB.x) ok(`카드 오른쪽 끝 ${rightEdge}px < 앵커 박스 ${AB.x}px`);
  else bad(`카드가 앵커 박스를 침범한다 — 끝 ${rightEdge}px ≥ 박스 ${AB.x}px (padding-right=${padR}, max-width=${maxW})`);
}

// 박스가 없으면 종전 폭 그대로다(축소 회귀 방지).
{
  const html = M.quoteCardHtml({ text: 'x'.repeat(200) }, { width: 1920 });
  const maxW = Number(/max-width:(\d+)px/.exec(html)?.[1] ?? -1);
  if (maxW === 1520) ok('앵커 없으면 종전 폭(1520px) 그대로');
  else bad(`앵커 없을 때 폭이 달라졌다 (got ${maxW}, 기대 1520)`);
}

// ── 2026-09-03: 인용이 거의 안 잡혀 인용 카드가 이슈 12개 중 1개뿐이었다 ─────────
//   사용자 지적("일반뉴스보면 x에서 막 퍼오던데")의 답은 X 를 퍼오는 게 아니라 —
//   그건 첨부 사진의 이용허락 문제가 남는다 — **인용을 더 많이 확보하는 것**이다.
//   방송사가 화면에 띄우는 X 카드도 대부분 문구만 가져와 다시 그린 것이고,
//   이 파이프라인은 그 방식(quote-card)을 이미 갖고 있다. 부족한 건 재료였다.
//
//   원인: extractQuote 가 **헤드라인만** 봤다. 헤드라인에 따옴표가 없으면 그 이슈는 인용 없이 간다.
//   그런데 news_archive.summary 에는 화자와 발언이 그대로 들어 있다(실측):
//     "윤홍근 제너시스BBQ 그룹 회장은 \"인공지능(AI)과 데이터를 기반으로…\""
//     "한국은행은 2일 \"9월 소비자물가 상승률은…\"이라고 예상했다."
//   그 컬럼을 SQL 에서 아예 안 읽고 있었다.
{
  const 실제요약 = [
    '(서울=연합뉴스) 한지훈 기자 = 한국은행은 2일 "9월 소비자물가 상승률은 근원 품목을 중심으로 기조적인 상승세를 이어갈 것"이라고 예상했다.',
    '(서울=연합뉴스) 김세린 기자 = 윤홍근 제너시스BBQ 그룹 회장은 "인공지능과 데이터를 기반으로 전 세계 어디에서나 일관된 맛을 내겠다"고 말했다.',
  ];
  for (const t of 실제요약) {
    const q = M.extractQuote(t);
    q?.text ? ok(`요약에서 발언 추출: "${q.text.slice(0, 34)}…"`) : bad(`요약에서 못 뽑았다: ${t.slice(0, 50)}`);
    // 화자가 "(서울=연합뉴스) 한지훈 기자 =" 통째로 잡히면 카드가 못 쓰게 된다
    if (q?.speaker) {
      !/연합뉴스|기자\s*=|^\(/.test(q.speaker)
        ? ok(`화자가 바이라인이 아니다: "${q.speaker}"`)
        : bad(`화자에 바이라인이 섞였다: "${q.speaker}"`);
      q.speaker.length <= 30 ? ok(`화자 길이 적정 (${q.speaker.length}자)`) : bad(`화자가 너무 길다(${q.speaker.length}자): "${q.speaker}"`);
    }
  }

  // bestQuote 는 여러 글을 받아 가장 쓸 만한 것을 고른다 — 헤드라인이 비어도 요약에서 나와야 한다
  const b = M.bestQuote(['따옴표 없는 평범한 헤드라인', ...실제요약]);
  b?.text ? ok('헤드라인에 인용이 없어도 요약에서 찾는다') : bad('요약을 안 봤다');
}

console.log(fail ? `\n❌ quote-card ${fail} 실패` : '\n✅ quote-card 전부 통과');
process.exit(fail ? 1 : 0);

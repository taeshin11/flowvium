#!/usr/bin/env node
/**
 * 사건과 무관한 그림을 막는 두 규칙 (2026-09-03, 사용자 "사건과 관련있는 영상과 사진만 넣어").
 * 실측으로 통과했던 것들을 그대로 넣어 다시 통과하지 못하는지 본다.
 */
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
const { hasDistinctiveTerm, isRealFootage, titleRelevant } = await import('./footage.mjs');

// ── 흔한 말만 있으면 검색하지 않는다 ────────────────────────────────────────────
{
  !hasDistinctiveTerm(['National', 'Assembly'])
    ? ok('"National Assembly" — 검색 안 함 (탄자니아·파키스탄 국회가 잡히던 검색어)')
    : bad('흔한 말만인데 검색을 허용한다');
  !hasDistinctiveTerm(['Ministry', 'Government', 'Office'])
    ? ok('"Ministry Government Office" — 검색 안 함') : bad('흔한 말 조합을 통과시킨다');

  hasDistinctiveTerm(['Seoul', 'National', 'Assembly'])
    ? ok('"Seoul National Assembly" — Seoul 이 구별해 준다') : bad('Seoul 을 못 알아본다');
  hasDistinctiveTerm(['Samsung', 'Electronics']) ? ok('"Samsung Electronics"') : bad('기업명을 막는다');
  hasDistinctiveTerm(['용혜인']) ? ok('한국어 인명') : bad('한국어 인명을 막는다');
  !hasDistinctiveTerm([]) ? ok('빈 검색어는 당연히 안 함') : bad('빈 검색어를 통과시킨다');
}

// ── 도표·문장·로고는 현장이 아니다 ──────────────────────────────────────────────
{
  const cases = [
    [{ title: 'Emblem of the Ministry of Strategy and Finance (English).svg', url: 'x/a.svg' }, false, '문장 svg'],
    [{ title: 'Tanzanian National Assembly chart.svg', url: 'x/b.svg' }, false, '도표 svg'],
    [{ title: 'Flag of South Korea', url: 'x/c.png' }, false, '국기'],
    [{ title: 'Korea-Seoul-Yeouido-National Assembly Building-07.jpg', url: 'x/d.jpg' }, true, '실제 건물 사진'],
    [{ title: 'Yoon speech at press briefing', url: 'x/e.mp4' }, true, '실제 영상'],
  ];
  for (const [c, want, label] of cases) {
    isRealFootage(c) === want ? ok(`${label}: ${want ? '통과' : '차단'}`) : bad(`${label} 판정 틀림`);
  }
}

// ── 기존 전체일치 규칙은 그대로여야 한다 (회귀) ─────────────────────────────────
{
  titleRelevant('Korea-Seoul-Yeouido-National Assembly Building-07.jpg', ['Seoul', 'National', 'Assembly'])
    ? ok('전체일치 규칙 유지') : bad('전체일치가 깨졌다');
  !titleRelevant('National Assembly of Bangladesh (06).jpg', ['Seoul', 'National', 'Assembly'])
    ? ok('Seoul 이 없으면 방글라데시 국회는 탈락') : bad('엉뚱한 나라가 통과한다');
}


// ── 직책으로 찾으면 역대 아무나 나온다 (2026-09-03, 사용자 "총리얘기하면서 왜 옛날 총리가 나오냐") ──
// 실측: "총리" 로 Commons 를 찾으면 고건(2003년 총리)·이완구 전 총리(2015) 가 나온다.
//   직책은 수십 년치 인물이 공유한다. 사람을 특정하려면 **이름**이어야 한다.
//   "김민석"(현 총리)으로 찾으면 실제 사진이 나온다 — 자료가 없는 게 아니라 질의가 틀렸던 것이다.
{
  !hasDistinctiveTerm(['총리']) ? ok('"총리" 단독 검색 안 함 (고건·이완구가 나오던 질의)') : bad('직책만으로 검색한다');
  !hasDistinctiveTerm(['대통령']) ? ok('"대통령" 단독 검색 안 함') : bad('대통령을 통과시킨다');
  !hasDistinctiveTerm(['장관', '정부']) ? ok('"장관 정부" 조합도 안 함') : bad('직책 조합을 통과시킨다');
  hasDistinctiveTerm(['김민석']) ? ok('사람 이름은 통과 — 현직 총리 사진이 실제로 있다') : bad('사람 이름을 막는다');
  hasDistinctiveTerm(['김민석', '총리']) ? ok('이름+직책은 통과(이름이 특정해 준다)') : bad('이름이 있는데 막는다');
}

// ── 전직 인물 사진은 지금 뉴스가 아니다 ────────────────────────────────────────
{
  const cases = [
    [{ title: '이완구 전 총리 (headshot).png', url: 'x/a.png' }, false, '전 총리'],
    [{ title: 'Former Prime Minister Kim', url: 'x/b.jpg' }, false, 'Former'],
    [{ title: '前 대통령 방문', url: 'x/c.jpg' }, false, '前'],
    [{ title: '대한민국 국무총리 김민석 2026', url: 'x/d.jpg' }, true, '현직 인물'],
    [{ title: 'Homeplus Dongchon branch', url: 'x/e.jpg' }, true, '인물 아닌 것은 그대로'],
  ];
  for (const [c, want, label] of cases)
    isRealFootage(c) === want ? ok(`${label}: ${want ? '통과' : '차단'}`) : bad(`${label} 판정 틀림`);
}

console.log(fail === 0 ? '\n✅ footage-relevance 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

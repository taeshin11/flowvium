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

console.log(fail === 0 ? '\n✅ footage-relevance 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

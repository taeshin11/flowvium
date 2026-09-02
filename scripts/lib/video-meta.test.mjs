#!/usr/bin/env node
/**
 * video-meta.test.mjs — 업로드 제목·설명·태그가 로케일에 맞는가, 국뽕이 사실을 넘지 않는가.
 *
 * 배경(2026-09-03): 채널을 한국어로 돌렸는데 video-publish.mjs 안에 제목·설명이
 *   **영어로 하드코딩**돼 있었다 — "In this update:" · "Daily US politics and economy" ·
 *   "#USNews #Politics". 한국어 영상 설명란에 그게 그대로 붙는다.
 *   태그는 더 나빴다: `[A-Za-z0-9']` 로 잘라서 **한글이 통째로 사라진다.**
 *
 * 국뽕(사용자 "제목에 국뽕 섞을수있으면 섞어")의 선:
 *   섞는다 = 헤드라인 여러 건 중 한국 성과를 말하는 것을 **앞세운다**.
 *   섞는다 ≠ 없는 말을 붙인다. 그래서 제목 문자열은 언제나 헤드라인 원문의 부분집합이어야 한다.
 */
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };

const M = await import('./video-meta.mjs');

// ── 국뽕: 있으면 앞세운다 ────────────────────────────────────────────────────────
{
  const heads = [
    '국채금리 상승에 코스피 하락 마감',
    '삼성전자, HBM 세계 1위 탈환… SK하이닉스 제쳐',
    '미 연준 9월 동결 전망 우세',
  ];
  const { ordered, proud } = M.orderForTitle(heads, true);
  ordered[0] === heads[1] ? ok('한국 성과 헤드라인을 맨 앞으로') : bad(`앞세우지 않았다: ${ordered[0]}`);
  proud ? ok('국뽕 표시 true') : bad('proud 가 false');
  ordered.length === heads.length ? ok('나머지를 버리지 않는다') : bad(`${ordered.length}건만 남았다`);
}

// ── 없으면 억지로 만들지 않는다 ─────────────────────────────────────────────────
{
  const heads = ['미 연준 9월 동결 전망 우세', '국제유가 1% 상승', '뉴욕증시 혼조 마감'];
  const { ordered, proud } = M.orderForTitle(heads, true);
  !proud && ordered[0] === heads[0]
    ? ok('성과 헤드라인이 없으면 순서 그대로 (없는 걸 지어내지 않는다)')
    : bad(`순서를 흔들었다: proud=${proud} first=${ordered[0]}`);
}

// ── 한국 신호 없이 성과 신호만 있으면 국뽕이 아니다 ──────────────────────────────
{
  const heads = ['미 연준 동결 전망', '엔비디아 사상 최고가 돌파'];   // 성과지만 한국이 아니다
  const { proud } = M.orderForTitle(heads, true);
  !proud ? ok('한국이 주체가 아니면 국뽕으로 안 본다') : bad('남의 성과를 국뽕으로 잡았다');
}

// ── 제목은 언제나 헤드라인 원문에서만 나온다 ────────────────────────────────────
{
  const heads = ['삼성전자, HBM 세계 1위 탈환', '코스피 2% 상승'];
  const t = M.buildTitle(heads, true);
  const joined = heads.join(' — ');
  t.split(' — ').every((part) => heads.some((h) => h.includes(part) || part.includes(h)))
    ? ok(`제목이 헤드라인 원문으로만 구성 ("${t}")`)
    : bad(`지어낸 문구가 섞였다: "${t}" (원문: ${joined})`);
  t.length <= 100 ? ok(`유튜브 제목 상한 준수 (${t.length}자)`) : bad(`${t.length}자 — 100자 초과`);
}

// ── 설명: 로케일 문구·해시태그 ──────────────────────────────────────────────────
{
  const heads = ['코스피 상승', '연준 동결'];
  const ko = M.buildDescription(heads, true);
  const en = M.buildDescription(heads, false);
  /오늘 다룬 이슈/.test(ko) && !/In this update/.test(ko)
    ? ok('한국어 설명에 영어 문구가 없다') : bad('한국어 설명에 영어가 남았다');
  /#뉴스|#경제/.test(ko) && !/#USNews/.test(ko)
    ? ok('한국어 해시태그') : bad('미국 해시태그가 그대로다');
  /In this update/.test(en) && /#USNews/.test(en)
    ? ok('영어는 종전 그대로(회귀 없음)') : bad('영어 설명이 깨졌다');
  /공공 도메인|CC0/.test(ko) ? ok('소재 라이선스 고지 유지') : bad('라이선스 고지를 잃었다');
}

// ── 태그: 한글이 사라지면 안 된다 ───────────────────────────────────────────────
{
  const heads = ['삼성전자 HBM 세계 1위 탈환', '코스피 상승 마감'];
  const ko = M.buildTags(heads, ['반도체'], true);
  ko.some((t) => /[가-힣]/.test(t))
    ? ok(`한국어 태그가 남는다 (${ko.slice(0, 5).join(', ')})`)
    : bad(`한글이 전부 사라졌다: ${JSON.stringify(ko)}`);
  ko.includes('반도체') ? ok('편성 키워드를 유지한다') : bad('키워드를 잃었다');
  // 조사가 붙은 채로 태그가 되면 "코스피가" 같은 게 남는다
  !ko.some((t) => /(은|는|이|가|을|를)$/.test(t) && t.length > 2)
    ? ok('조사를 떼고 태그를 만든다') : bad(`조사가 붙었다: ${JSON.stringify(ko)}`);
  ko.length <= 14 ? ok(`태그 상한 준수 (${ko.length}개)`) : bad(`${ko.length}개 — 너무 많다`);

  const en = M.buildTags(['Fed holds rates steady', 'Samsung wins order'], ['chips'], false);
  en.includes('Fed') && en.includes('Samsung') ? ok('영어는 고유명사 추출 유지') : bad(`영어 태그가 깨졌다: ${JSON.stringify(en)}`);
}

// ── 국뽕 앞머리 (2026-09-03, 사용자 "더 국뽕스럽게 최대한 만들어. 오글거리게") ─────
//   선은 하나다: **사실을 주장하지 않는다.** "세계가 놀랐다" 는 안 된다 — 놀랐는지 모른다.
//   "또 해냈습니다" 는 감탄이라 검증 대상 명제가 아니다.
{
  const proudHeads = ['삼성전자, HBM 세계 1위 탈환… SK하이닉스 제쳐', '코스피 2% 상승'];
  const plainHeads = ['미 연준 9월 동결 전망 우세', '국제유가 1% 상승'];

  const t0 = M.buildTitle(proudHeads, true, 0);
  /🇰🇷/.test(t0) ? ok(`국뽕이면 앞머리를 붙인다 ("${t0.slice(0, 30)}…")`) : bad(`앞머리가 없다: ${t0}`);
  !/🇰🇷/.test(M.buildTitle(plainHeads, true, 0)) ? ok('국뽕이 아니면 안 붙인다') : bad('아무 데나 붙였다');

  // 회전 — 하루 5편인데 같은 앞머리가 계속 붙으면 더 싸구려로 보인다
  const set = new Set([0, 1, 2, 3, 4].map((i) => M.buildTitle(proudHeads, true, i).split(' ')[1]));
  set.size >= 3 ? ok(`앞머리가 회전한다 (${set.size}종)`) : bad(`회전이 안 된다: ${[...set].join(',')}`);
  M.buildTitle(proudHeads, true, 7) === M.buildTitle(proudHeads, true, 7)
    ? ok('같은 씨앗이면 같은 제목(결정론)') : bad('무작위라 재현이 안 된다');

  // 앞머리를 붙여도 100자를 넘지 않는다
  const long = ['가'.repeat(70) + ' 세계 1위 한국', '나'.repeat(70)];
  M.buildTitle(long, true, 0).length <= 100
    ? ok(`앞머리를 붙여도 100자 이내 (${M.buildTitle(long, true, 0).length}자)`)
    : bad(`${M.buildTitle(long, true, 0).length}자 — 유튜브에서 잘린다`);

  // 앞머리를 뺀 나머지는 여전히 헤드라인 원문이어야 한다 — 감탄은 붙이되 사실은 못 지어낸다
  // 앞머리는 두 어절짜리도 있다("또 해냈습니다"). 한 어절만 걷으면 이 검사가 헛돈다 —
  //   실제로 처음 실행에서 그렇게 실패했다. 원문 헤드라인이 어디서 시작하는지로 자른다.
  const body = t0.slice(t0.indexOf(proudHeads[0]));
  proudHeads.some((h) => body.startsWith(h))
    ? ok('앞머리 뒤는 헤드라인 원문 그대로')
    : bad(`본문이 헤드라인과 다르다: "${body.slice(0, 40)}"`);

  // 확인할 수 없는 반응을 앞머리에 넣지 않는다
  const allPrefixes = [0, 1, 2, 3, 4].map((i) => M.buildTitle(proudHeads, true, i));
  !allPrefixes.some((t) => /놀랐|충격|난리|경악|들썩/.test(t.split('—')[0]))
    ? ok('앞머리에 확인 불가한 반응 주장이 없다')
    : bad(`검증 못 하는 반응을 주장한다: ${allPrefixes.find((t) => /놀랐|충격/.test(t))}`);
}

console.log(fail === 0 ? '\n✅ video-meta 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

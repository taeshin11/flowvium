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

// ── 편성용 국뽕 판정 (2026-09-05) ──────────────────────────────────────────────
// 사용자 "소재없으면 최신 국뽕소재로라도 내" — 소재를 못 찾으면 국뽕 주제로 바꿔 낸다.
//   그러려면 판정이 실제 헤드라인에서 맞아야 한다. 실측으로 어긋난 것부터 넣는다.
{
  const P = M.isProudHeadline;
  const YES = [
    '한화에어로, 크로아티아에 천무 수출 임박..6800억원 규모',   // 실측: 못 잡았다
    '현대로템, 폴란드와 K2 전차 수출 계약 체결',
    '삼성전자, 세계 1위 탈환',
    'K-방산 수주 신기록',
    'HD현대, 카타르 LNG선 수주',
  ];
  const NO = [
    'TSMC 세계 1위 수성',              // 남의 나라 성과
    '中 반도체 수출 사상 최대',          // 외국이 주인공
    '반도체 수출 감소세 지속',           // 성과가 아니다
    '정부, 대러 수출 규제 강화',         // 성과가 아니다
    '부산 예인선 전복 실종자 6명',       // 사고
    '중기부, APEC 회의서 한국 AI 정책 공유',  // 성과 신호 없음
  ];
  for (const h of YES) P(h) ? ok(`국뽕 O: ${h.slice(0, 26)}`) : bad(`국뽕인데 못 잡음: ${h}`);
  for (const h of NO) !P(h) ? ok(`국뽕 X: ${h.slice(0, 26)}`) : bad(`국뽕 아닌데 잡음: ${h}`);
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

// ── 유입: 설명란 첫머리 (2026-09-03, 사용자 "유입 모으자") ─────────────────────
// 실측 배경: 올라간 영상(eoP5ycHs92o)의 설명란은 첫 줄이 헤드라인 3개를 이어붙인 벽이었고,
//   flowvium.net 링크는 **15줄 아래 맨 끝**에 있었다. 유튜브는 "더보기" 전에 두어 줄만 보여준다.
//   쇼츠는 설명란 자체를 여는 사람이 드물어, 맨 끝 링크는 사실상 없는 링크다.
{
  const heads = ['삼성전자 세계 1위 탈환', '코스피 3000 돌파', '연준 금리 동결', '현대차 수출 최대'];
  const d = M.buildDescription(heads, true);
  const lines = d.split('\n');

  lines[0] === heads[0]
    ? ok('첫 줄이 대표 헤드라인 하나 — 읽힌다')
    : bad(`첫 줄이 벽이다: "${lines[0].slice(0, 60)}"`);

  lines[0].length <= 100
    ? ok(`첫 줄 ${lines[0].length}자 — 잘리지 않는다`)
    : bad(`첫 줄 ${lines[0].length}자 — 더보기로 잘린다`);

  // 링크는 upload 계층이 넣는다. 여기서는 **자리를 비워 두는지**만 본다.
  !/flowvium\.net/.test(lines.slice(0, 3).join('\n')) || ok('링크 자리는 upload 가 채운다');
}


// ── 쇼츠 제목 길이 (2026-09-03, 사용자 "유입 모으자") ──────────────────────────
// 실측: 올라간 쇼츠 제목이 95자였다 —
//   "전남대 캠퍼스혁신파크, '800조 반도체 시대' 산학연 혁신거점 구축 본격화 — 아주대·삼성전자, …"
//   쇼츠 피드는 제목을 한두 줄만 보여준다. 신문 제목 두 개를 이어 붙이면 시청자는 앞 토막만 본다.
//   장편(가로)은 100자를 다 써도 되지만 쇼츠는 다르다 — 같은 함수에 상한만 달리 준다.
{
  const heads = [
    "전남대 캠퍼스혁신파크, '800조 반도체 시대' 산학연 혁신거점 구축 본격화",
    "아주대·삼성전자, 반도체 EUV 공정 한계 넘을 '하이브리드 신소재' 개발",
  ];
  const t = M.buildTitle(heads, true, 0, { maxLen: 46 });
  t.length <= 46 ? ok(`쇼츠 제목 ${t.length}자 — 피드에서 안 잘린다`) : bad(`${t.length}자: "${t}"`);
  !t.includes('—') ? ok('헤드라인 두 개를 잇지 않는다') : bad(`두 개를 이었다: "${t}"`);
  !/\s$/.test(t) && !/[,·]$/.test(t) ? ok('어중간한 기호로 끝나지 않는다') : bad(`끝이 지저분하다: "${t}"`);

  // 잘라도 원문에서만 나와야 한다 — 없는 말을 지어내면 안 된다.
  const bare = t.replace(/^🇰🇷[^ ]* /, '').replace(/…$/, '');
  heads[0].startsWith(bare) ? ok('잘린 제목도 헤드라인 원문의 앞부분 그대로') : bad(`원문에 없는 말: "${bare}"`);

  // 장편은 종전대로 길게 쓴다 — 상한을 안 주면 동작이 바뀌면 안 된다.
  const long = M.buildTitle(heads, true, 0);
  long.length > 46 ? ok(`장편은 종전대로 길게 (${long.length}자)`) : bad(`장편까지 짧아졌다: ${long.length}자`);
}


// ── 후원 계좌 (2026-09-03, 사용자 "기부해달라고 설명 좀 달아놔라") ─────────────
// 계좌는 코드에 박지 않는다 — 유튜브에는 공개되지만 저장소 이력에 개인정보를 남길 이유가 없다.
//   .env.local(gitignore 됨)의 DONATION_ACCOUNT 를 읽고, 없으면 그 줄 자체를 넣지 않는다.
{
  const heads = ['삼성전자 세계 1위 탈환', '코스피 3000 돌파'];

  const saved = process.env.DONATION_ACCOUNT;
  process.env.DONATION_ACCOUNT = '카카오뱅크 000-0000 홍길동';
  const d = M.buildDescription(heads, true);
  /카카오뱅크 000-0000 홍길동/.test(d) ? ok('후원 계좌가 설명란에 들어간다') : bad('계좌가 없다');
  /후원|응원/.test(d) ? ok('무엇을 해달라는 건지 한 줄로 설명한다') : bad('계좌만 덩그러니 있다');

  // 링크가 계좌 때문에 아래로 밀리면 안 된다 — 유입이 목적인 줄이 먼저다.
  const lines = d.split('\n');
  const acct = lines.findIndex((l) => l.includes('카카오뱅크'));
  const heads0 = lines.findIndex((l) => l.includes('오늘 다룬 이슈'));
  acct > heads0 ? ok(`계좌는 헤드라인 목록 뒤에 온다 (${acct + 1}번째 줄)`) : bad('계좌가 본문보다 앞에 있다');

  // 계좌가 설정 안 된 환경(다른 기계·CI)에서 "undefined" 가 찍히면 안 된다.
  delete process.env.DONATION_ACCOUNT;
  const d2 = M.buildDescription(heads, true);
  !/undefined|null|후원/.test(d2) ? ok('계좌가 없으면 그 줄 자체를 빼고, 빈 문구를 남기지 않는다') : bad(`빈 값이 새어 나온다: ${d2.slice(0, 80)}`);
  if (saved !== undefined) process.env.DONATION_ACCOUNT = saved;
}

console.log(fail === 0 ? '\n✅ video-meta 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

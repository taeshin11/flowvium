#!/usr/bin/env node
/**
 * footage.test.mjs — 화면에 **실제 그림**을 깔되, 못 쓰는 라이선스를 걸러내는가.
 *
 * 배경(2026-08-27): "영상이 PPT 읽는 것 같다. 인스타·X·페이스북 영상 좀 따와서 조합해라."
 *   정지 카드 6장이 문제인 건 맞다. 다만 SNS 원본 영상을 그대로 얹는 건 두 가지를 동시에 건다 —
 *   저작권, 그리고 유튜브의 재사용 콘텐츠 심사(채널 단위 집행). 이 채널은 자동 발행이라
 *   한 편이 걸리면 채널 전체가 멈춘다. 그래서 **라이선스가 확인된 소스만** 자동 경로에 태우고,
 *   권리 판단이 필요한 클립은 사람이 assets/broll 에 직접 넣는 경로로 분리한다.
 *
 * 핵심은 "무엇을 쓰지 말지"를 코드가 알고 있어야 한다는 것:
 *   · NC(비상업) — 채널이 수익화되면 위반이다.
 *   · ND(변경금지) — 켄번스로 확대·크롭하면 파생물이라 위반이다.
 *   · 라이선스 미상 — 모르면 안 쓴다. 기본값이 '허용'이면 언젠가 사고가 난다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./footage.mjs');

// ── 1. 라이선스 게이트 ───────────────────────────────────────────────────────
{
  const allow = ['cc0', 'pdm', 'by', 'by-sa', 'Public domain', 'CC BY 4.0', 'CC BY-SA 3.0'];
  const deny  = ['by-nc', 'by-nd', 'by-nc-sa', 'by-nc-nd', 'CC BY-NC 2.0', 'CC BY-ND 4.0', '', null, undefined, 'unknown', 'Fair use'];
  const a = allow.filter(l => !M.licenseUsable(l));
  const d = deny.filter(l => M.licenseUsable(l));
  if (a.length === 0) ok(`상업 이용 가능 ${allow.length}종 통과`);
  else bad(`잘못 거절: ${JSON.stringify(a)}`);
  if (d.length === 0) ok(`NC·ND·미상 ${deny.length}종 차단`);
  else bad(`잘못 허용: ${JSON.stringify(d)}`);
}

// ── 1b. 실제 소스가 뱉는 문자열 (2026-08-27 실측) ────────────────────────────
{
  // Commons 는 CC 표기 외에 PD 계열 태그를 그대로 준다. Openverse 는 "by-sa 2.5" 처럼 소문자.
  const real = ['CC BY-SA 3.0', 'CC0', 'Public domain', 'by-sa 2.5', 'by 2.0', 'PD-USGov', 'PD-US-expired',
                'Pexels License', 'Pixabay License'];
  const blocked = real.filter(l => !M.licenseUsable(l));
  if (blocked.length === 0) ok(`실측 라이선스 ${real.length}종 통과`);
  else bad(`실측인데 차단됨 → 화면이 조용히 빈다: ${JSON.stringify(blocked)}`);

  // ND 는 소문자 형태로도 막혀야 한다 (Openverse 기본 응답에 by-nd 2.0 이 대량으로 섞여 나온다).
  if (!M.licenseUsable('by-nd 2.0') && !M.licenseUsable('by-nc-sa 4.0')) ok('소문자 nd/nc 차단');
  else bad('소문자 nd/nc 통과');
}

// ── 2. 검색어 ───────────────────────────────────────────────────────────────
// 2026-08-27 실측으로 뒤집힌 가정: 처음엔 "visual 을 그대로 믿는다" 로 짰다. 그런데 4B 가
//   visual 에 "wooden rocking chair, vintage microphone, star-studded stage, floral arrangement"
//   처럼 쉼표로 4개를 나열했고, 9단어 질의는 Commons/Openverse 둘 다 **0건**이었다.
//   같은 소재를 2~3단어("wooden rocking chair")로 줄이면 12건이 나온다.
//   → LLM 이 무엇을 뱉든 검색 가능한 형태로 **코드가** 줄인다. 프롬프트만 고치면 다음에 또 샌다.
{
  const t = M.searchTerms({ visual: 'wooden rocking chair, vintage microphone, star-studded stage, floral arrangement' });
  if (t.length <= 3) ok(`나열형 visual → ${t.length}단어로 축약 (${t.join(' ')})`);
  else bad(`안 줄었다: ${JSON.stringify(t)}`);
  if (!t.some(w => /[,.;]/.test(w))) ok('구두점이 검색어에 남지 않는다');
  else bad(`구두점 잔류: ${JSON.stringify(t)}`);

  const t2 = M.searchTerms({ visual: 'US Capitol dome at dusk' });
  if (!t2.some(w => w.toLowerCase() === 'at') && t2.length <= 3) ok('visual 에서도 불용어를 뺀다');
  else bad(`불용어 잔류: ${JSON.stringify(t2)}`);

  const t3 = M.searchTerms({ title: 'Court Blocks the Order', say: 'A federal judge blocked it today.' });
  if (t3.length > 0 && !t3.some(w => ['the', 'a', 'it'].includes(w.toLowerCase())))
    ok('visual 이 없으면 제목에서 뽑는다');
  else bad(`키워드 이상: ${JSON.stringify(t3)}`);

  if (M.searchTerms({}).length === 0) ok('빈 장면 → 빈 배열(카드 폴백)');
  else bad('빈 장면인데 검색어를 만든다');
}

// ── 2b. 질의 사다리 — 넓은 것부터 좁은 것까지 순서대로 ────────────────────────
// 3단어가 0건이면 2단어, 그것도 0건이면 1단어. 한 번 던지고 포기하면 화면이 카드로 떨어진다.
{
  const L = M.queryLadder(['wooden', 'rocking', 'chair']);
  if (L.length === 3 && L[0].length === 3 && L[1].length === 2 && L[2].length === 1)
    ok('3 → 2 → 1 단어로 좁혀진다');
  else bad(`사다리 이상: ${JSON.stringify(L)}`);
  if (L.every(q => q[0] === 'wooden')) ok('가장 중요한 첫 단어는 끝까지 남는다');
  else bad(`첫 단어 유실: ${JSON.stringify(L)}`);
  if (M.queryLadder([]).length === 0 && M.queryLadder(null).length === 0) ok('빈 입력 안전');
  else bad('빈 입력에서 사다리가 생긴다');
}


// ── 2c. 실제 대상 우선 (2026-08-27 사용자 지적) ──────────────────────────────
//
// "뉴스니까 실제 인터넷에서 검색되는 실제 사진이나 영상도 좀 있어야 한다."
// 맞다. 생성 b-roll 이나 일반 스톡은 "그 사건" 이 아니다. Dolly Parton 부고에는
//   국회의사당이 아니라 **Dolly Parton 사진**이 필요하다.
//
// 내가 프롬프트에 "사람 이름 쓰지 마라(아카이브에 없다)" 고 박아둔 게 틀렸다.
//   실측: Commons+Openverse 에서 Dolly Parton 20건 / Donald Trump 20건 / Secret Service 20건이
//   **전부 상업 이용 가능 라이선스**로 나온다.
//
// 그래서 장면마다 두 종류의 질의를 갖는다:
//   entity — 헤드라인의 실제 대상(인물·기관·장소). 이게 있으면 **먼저** 쓴다.
//   visual — 일반 b-roll. entity 로 못 찾았을 때, 그리고 2·3번째 컷을 채울 때 쓴다.
{
  const q = M.sceneQueries({ entity: 'Dolly Parton', visual: 'concert stage lights', title: 'Dolly Legacy' });
  if (q.length === 2 && q[0].join(' ') === 'Dolly Parton') ok(`entity 가 먼저: ${JSON.stringify(q.map(x => x.join(' ')))}`);
  else bad(`순서 이상: ${JSON.stringify(q.map(x => x.join(' ')))}`);
  if (q[1].join(' ').includes('concert')) ok('visual 이 뒤따른다');
  else bad(`visual 누락: ${JSON.stringify(q)}`);

  const noEnt = M.sceneQueries({ visual: 'ballot box' });
  if (noEnt.length === 1 && noEnt[0].join(' ') === 'ballot box') ok('entity 가 없으면 visual 만');
  else bad(`entity 없는 경우 이상: ${JSON.stringify(noEnt)}`);

  // 인물명은 불용어 제거·축약에서 살아남아야 한다 — "of" 같은 건 빼되 이름은 지킨다.
  const q2 = M.sceneQueries({ entity: 'United States Secret Service' });
  if (q2[0].length >= 2 && q2[0].join(' ').toLowerCase().includes('secret')) ok(`기관명 보존: ${q2[0].join(' ')}`);
  else bad(`기관명 손상: ${JSON.stringify(q2)}`);

  if (M.sceneQueries({}).length === 0) ok('둘 다 없으면 빈 배열');
  else bad('빈 장면에서 질의를 만든다');
}


// ── 2d. 장소 우선 (2026-08-28 지적: "네팔 얘기면 네팔 실제 현장영상") ────────
//
// 실측 문제: LLM 이 entity 로 고유명사 대신 서술구를 뱉었다 —
//   "hundreds of missing Americans", "young Roma woman", "teen boy", "nuclear regulator".
//   네팔 참사 기사인데 **"Nepal" 이 어디에도 없어** 네팔 영상이 나올 수가 없었다.
//
// 모든 뉴스에는 **장소**가 있다. 장소는 스톡 동영상이 실제로 잘 갖고 있는 것이기도 하다
//   (인물은 모델 스톡뿐이지만, 카트만두·히말라야는 진짜 현지 영상이 있다).
// 그래서 질의 순서를 place → entity → visual 로 둔다.
{
  const q = M.sceneQueries({ place: 'Nepal Kathmandu', entity: 'rescue team', visual: 'mountain village' });
  if (q[0].join(' ').includes('Nepal')) ok(`장소가 먼저: ${JSON.stringify(q.map((x) => x.join(' ')))}`);
  else bad(`순서 이상: ${JSON.stringify(q.map((x) => x.join(' ')))}`);
  if (q.length === 3) ok('place · entity · visual 세 갈래');
  else bad(`갈래 수 ${q.length}`);

  // 장소가 없으면 종전대로 entity → visual.
  const q2 = M.sceneQueries({ entity: 'Dolly Parton', visual: 'concert stage' });
  if (q2[0].join(' ') === 'Dolly Parton' && q2.length === 2) ok('장소 없으면 종전 동작');
  else bad(`회귀: ${JSON.stringify(q2.map((x) => x.join(' ')))}`);

  // 같은 문자열이 중복되면 한 번만.
  const q3 = M.sceneQueries({ place: 'Nepal', entity: 'Nepal', visual: 'Nepal' });
  if (q3.length === 1) ok('중복 질의는 하나로');
  else bad(`중복 ${q3.length}갈래`);

  if (M.sceneQueries({ place: 'Nepal' }).length === 1) ok('장소만 있어도 동작');
  else bad('장소 단독 실패');
}

// ── 3. 후보 고르기 — **적합도가 먼저다** ────────────────────────────────────
//
// 2026-08-27 실측으로 뒤집힌 설계: 처음엔 "가로·고해상도 우선" 으로 정렬했다. 그랬더니
//   검색엔진이 매긴 적합도 순위를 코드가 뭉개 버렸다.
//     "presidential protection detail" → 8936px 짜리 해안선 도면("Detail Of Shore Protection")
//     "Secret Service 조사" 장면        → 19세기 아동 초상화
//   Commons·Openverse 는 이미 적합도 순으로 준다. 그 순서를 존중하고, 크기는 **동점일 때만** 본다.
//
// 그리고 minWidth 1280 이 정답을 잘라냈다 —
//   "Secret Service agents conducting investigation" 이 1255px 로 25px 모자라 탈락했다.
//   1920 렌더에서 1255px 은 1.5배 확대라 조금 무를 뿐이고, **틀린 그림보다 낫다.**
{
  const cands = [
    { id: 'nc',   rank: 0, width: 3840, height: 2160, license: 'by-nc', url: 'x' },
    { id: 'tiny', rank: 1, width:  620, height:  480, license: 'cc0',   url: 'x' },
    { id: '세로',  rank: 2, width: 1080, height: 1920, license: 'cc0',   url: 'x' },
    { id: '적합',  rank: 3, width: 1400, height:  900, license: 'by',    url: 'x' },
    { id: '거대',  rank: 9, width: 8000, height: 4500, license: 'cc0',   url: 'x' },
  ];
  const p = M.pickFootage(cands, {});
  if (p?.id === '적합') ok('적합도 상위를 고른다 (거대한 저순위에 밀리지 않는다)');
  else bad(`고른 것: ${p?.id} — 해상도가 적합도를 이겼다`);

  const tie = [
    { id: '작음', rank: 2, width: 1300, height: 800, license: 'cc0', url: 'x' },
    { id: '큼',   rank: 2, width: 2600, height: 1600, license: 'cc0', url: 'x' },
  ];
  if (M.pickFootage(tie, {})?.id === '큼') ok('순위가 같으면 큰 쪽');
  else bad('동점에서 작은 쪽을 골랐다');

  if (M.pickFootage([{ id: 'a', rank: 0, width: 1255, height: 830, license: 'cc0', url: 'x' }], {})?.id === 'a')
    ok('1255px 는 쓴다 (1280 문턱이 정답을 잘랐던 회귀)');
  else bad('1255px 를 버렸다');

  if (M.pickFootage([{ id: 'a', rank: 0, width: 620, height: 480, license: 'cc0', url: 'x' }], {}) === null)
    ok('너무 작은 것(620px)은 버린다');
  else bad('620px 를 채택했다');

  if (M.pickFootage([{ id: 'nc', rank: 0, width: 3840, height: 2160, license: 'by-nc', url: 'x' }], {}) === null)
    ok('쓸 수 있는 후보가 없으면 null (카드로 폴백)');
  else bad('NC 만 있는데 골랐다');

  if (M.pickFootage([], {}) === null && M.pickFootage(null, {}) === null) ok('빈 후보 안전');
  else bad('빈 후보에서 non-null');

  // 동영상은 사진을 이긴다 — 사용자가 "사진 말고 영상" 을 요구했다.
  const mixed = [
    { id: '사진', kind: 'image', rank: 0, width: 4000, height: 2500, license: 'cc0', url: 'x' },
    { id: '영상', kind: 'video', rank: 4, width: 1920, height: 1080, license: 'cc0', url: 'x' },
  ];
  if (M.pickFootage(mixed, {})?.id === '영상') ok('동영상이 사진보다 우선');
  else bad('사진을 골랐다');
}


// ── 3b. 한 장면에 여러 컷 ────────────────────────────────────────────────────
// "PPT 같다" 의 정체는 정지 화면이 아니라 **한 화면이 12초 동안 안 바뀌는 것**이다.
// 실제 뉴스 패키지는 한 나레이션 구간에 서너 컷이 지나간다. 그래서 장면당 후보를 여러 개 뽑는다.
// 같은 그림을 두 번 쓰면 컷이 아니라 깜빡임이므로 **중복은 배제**한다.
{
  const c = [
    { id: 'a', rank: 0, width: 2000, height: 1200, license: 'cc0', url: 'u1' },
    { id: 'b', rank: 1, width: 1800, height: 1000, license: 'by',  url: 'u2' },
    { id: 'nc', rank: 2, width: 4000, height: 2000, license: 'by-nc', url: 'u3' },
    { id: 'c', rank: 3, width: 1600, height: 900,  license: 'cc0', url: 'u4' },
    { id: 'dup', rank: 4, width: 1600, height: 900, license: 'cc0', url: 'u1' },
  ];
  const many = M.pickFootageMany(c, 3, {});
  if (many.length === 3) ok(`3컷 뽑는다: ${many.map(x => x.id).join(',')}`);
  else bad(`개수 ${many.length}: ${JSON.stringify(many.map(x => x.id))}`);
  if (many.map(x => x.id).join(',') === 'a,b,c') ok('적합도 순서를 유지하고 NC 는 건너뛴다');
  else bad(`순서/필터 이상: ${many.map(x => x.id).join(',')}`);
  if (new Set(many.map(x => x.url)).size === many.length) ok('같은 그림을 두 번 쓰지 않는다');
  else bad('중복 URL 포함');
  if (M.pickFootageMany(c, 99, {}).length === 3) ok('있는 만큼만 준다');
  else bad('없는 걸 만들어낸다');
  if (M.pickFootageMany([], 3, {}).length === 0 && M.pickFootageMany(null, 3, {}).length === 0) ok('빈 입력 안전');
  else bad('빈 입력 이상');
  // 단수 API 는 복수 API 의 첫 번째와 같아야 한다 — 두 경로가 갈리면 언젠가 어긋난다.
  if (M.pickFootage(c, {})?.id === M.pickFootageMany(c, 1, {})[0]?.id) ok('단수/복수 선택이 일치');
  else bad('단수와 복수가 다른 걸 고른다');
}

// ── 3c. 컷 나누기 — 너무 짧은 컷은 깜빡임이다 ────────────────────────────────
{
  if (M.splitShots(12, 3, 3.0).length === 3) ok('12초를 3컷으로');
  else bad(`12초/3컷 실패: ${JSON.stringify(M.splitShots(12, 3, 3.0))}`);
  const short = M.splitShots(7, 3, 3.0);
  if (short.length === 2 && short.every(d => d >= 3.0)) ok(`7초는 2컷까지만 (최소 3초 보장): ${JSON.stringify(short)}`);
  else bad(`짧은 장면 분할 이상: ${JSON.stringify(short)}`);
  const one = M.splitShots(4, 3, 3.0);
  if (one.length === 1 && Math.abs(one[0] - 4) < 1e-9) ok('4초는 1컷');
  else bad(`4초 분할 이상: ${JSON.stringify(one)}`);
  const sum = M.splitShots(13.7, 4, 3.0);
  if (Math.abs(sum.reduce((a, b) => a + b, 0) - 13.7) < 1e-6) ok('합이 원래 길이와 정확히 같다 (음성과 어긋나면 안 된다)');
  else bad(`합 불일치: ${sum.reduce((a, b) => a + b, 0)}`);
}


// ── 3d. 관련성·매체종류 걸러내기 (2026-08-27 실제 채택 목록에서 뽑은 사례) ────
//
// 라이선스와 해상도만 보면 "쓸 수 있는 그림" 은 되지만 "그 뉴스의 그림" 은 안 된다.
// 실제로 이런 것들이 채택됐다:
//   "mail truck"      → Die Post(핀란드) / Postiauto(스위스) / AFT227 at Liangxiangximen(중국 버스)
//   "courtroom bench" → "Drawing of an overview of the courtroom…" (법정 스케치)
//   "studio desk"     → "Studio 2 48-track desk" (녹음 콘솔)
//
// 두 가지 일반 규칙으로 거른다. 특정 입력을 겨냥한 분기가 아니라 모든 후보에 같이 적용된다.
//   ① 제목이 질의어와 한 단어도 겹치지 않으면 카테고리 수준의 매칭이지 그 주제가 아니다.
//   ② 스케치·회화·지도·도표는 **자료화면이 아니다.** 뉴스 화면에 넣으면 삽화로 보인다.
{
  const T = M.titleRelevant;
  if (!T('Die Post.jpg', ['mail', 'truck'])) ok('제목에 질의어가 없으면 버린다 (Die Post ↔ mail truck)');
  else bad('Die Post 를 통과시켰다');
  if (!T('AFT227 at Liangxiangximen (20200914140857).jpg', ['mail', 'truck'])) ok('중국 버스 차단');
  else bad('중국 버스 통과');
  if (T('United States Capitol dome at night.jpg', ['capitol', 'dome', 'night'])) ok('겹치면 통과');
  else bad('정상 후보를 버렸다');
  // 부분일치가 아니라 단어로 본다 — "use" 는 "Museum" 안에 글자로는 들어 있다.
  if (!T('Auckland Museum Collections', ['use'])) ok('우연한 부분일치는 무시(단어 경계로 본다)');
  else bad('부분일치로 통과시켰다');
  // 판단 근거가 없으면(질의어 없음) 거르지 않는다. 제목이 비면 겹칠 수가 없으니 버린다.
  if (T('', ['capitol']) === false && T('anything', []) === true) ok('빈 입력 처리');
  else bad('빈 입력 처리 이상');

  const I = M.isIllustration;
  const arts = ['Drawing of an overview of the courtroom.jpg', 'Sketch of the defense table.png',
                'Sanborn Fire Insurance Map from Nashville.jpg', 'Portrait of a young girl (painting)',
                'Coat of arms of Togo.svg', 'Diagram of the postal system'];
  const photos = ['United States Capitol dome at night.jpg', 'US Secret Service outside the White House.jpg',
                  'Ballot box 1897.jpg'];
  const missed = arts.filter((t) => !I(t));
  const wrong = photos.filter((t) => I(t));
  if (missed.length === 0) ok(`삽화·지도·도면 ${arts.length}종 차단`);
  else bad(`삽화를 통과시켰다: ${JSON.stringify(missed)}`);
  if (wrong.length === 0) ok('사진은 통과');
  else bad(`사진을 삽화로 오판: ${JSON.stringify(wrong)}`);
}

// ── 3e. pickFootage 가 위 두 규칙을 실제로 적용하는가 ───────────────────────
{
  const c = [
    { id: '스케치', rank: 0, width: 8000, height: 5000, license: 'cc0', url: 'u1', title: 'Drawing of an overview of the courtroom' },
    { id: '무관',   rank: 1, width: 4000, height: 2500, license: 'cc0', url: 'u2', title: 'Die Post' },
    { id: '정답',   rank: 2, width: 1600, height: 1000, license: 'cc0', url: 'u3', title: 'Federal courtroom bench interior' },
  ];
  const p = M.pickFootage(c, { terms: ['courtroom', 'bench'] });
  if (p?.id === '정답') ok('스케치와 무관 후보를 건너뛰고 정답을 고른다');
  else bad(`고른 것: ${p?.id}`);
  // terms 를 안 주면 관련성 검사는 건너뛰지만, **매체 종류 판정은 항상 적용된다** —
  //   스케치는 질의어와 무관하게 자료화면이 아니다.
  if (M.pickFootage(c, {})?.id === '무관') ok('terms 없어도 스케치는 거른다 (관련성 검사만 건너뜀)');
  else bad(`terms 미지정 동작 이상: ${M.pickFootage(c, {})?.id}`);
  // 전부 걸러지면 null 이 아니라 **차선책**을 준다 — 카드로 떨어지는 것보다 낫다.
  const onlyBad = [{ id: 'x', rank: 0, width: 2000, height: 1200, license: 'cc0', url: 'u9', title: 'Die Post' }];
  if (M.pickFootage(onlyBad, { terms: ['mail', 'truck'] })?.id === 'x') ok('전부 걸러지면 차선책으로 되돌린다');
  else bad('전부 걸러 카드로 떨어뜨렸다');
}


// ── 3f. 사진이 아닌 파일 (2026-08-27 실측: 검은 화면 5초가 발행될 뻔했다) ─────
//
// "Dolly Parton" 질의에 **"Dolly Parton Signature.png"**(1051x430, 투명 배경 서명)가 1순위로
//   뽑혀 영상 첫 5초가 통째로 검게 나왔다(휘도 0). 투명 PNG 는 배경 없이 합성되면 검다.
//
// Commons 관행상 **사진은 JPEG, 도형·로고·서명·다이어그램은 PNG/SVG** 다.
//   확장자를 매체 종류 신호로 쓴다 — 금지가 아니라 **후순위**로 둔다(사진이 없으면 쓰는 게 낫다).
{
  const G = M.isGraphicFile;
  if (G('https://x/Dolly_Parton_Signature.png') && G('https://x/Flag.svg') && G('https://x/anim.gif'))
    ok('png·svg·gif 는 그래픽으로 본다');
  else bad('그래픽 판정 실패');
  if (!G('https://x/photo.jpg') && !G('https://x/photo.jpeg?utm_source=a') && !G('https://x/p.webp'))
    ok('jpg·jpeg·webp 는 사진 (쿼리스트링 포함)');
  else bad('사진을 그래픽으로 오판');

  const c = [
    { id: '서명', rank: 0, width: 1051, height: 430, license: 'Public domain', url: 'https://x/Sig.png', title: 'Dolly Parton Signature' },
    { id: '사진', rank: 2, width: 1920, height: 1080, license: 'by 3.0', url: 'https://x/live.jpg', title: 'Dolly Parton live' },
  ];
  if (M.pickFootage(c, { terms: ['Dolly', 'Parton'] })?.id === '사진') ok('서명 PNG 보다 사진 JPEG 를 고른다');
  else bad('서명 PNG 를 골랐다 — 검은 화면이 나간다');

  // 2026-08-27 정정: 처음엔 "그래픽만 있으면 차선책으로 쓴다" 로 짰다. 실물을 보고 뒤집었다 —
  //   서명 PNG 를 어두운 배경에 얹으니 **검은 잉크가 어두운 배경에 묻혀** 화면이 통째로 죽었다.
  //   서명·로고·도표는 어떤 배경에서도 자료화면이 안 된다. 그라디언트 카드가 낫다.
  //   컷이 하나 줄어드는 건 감수한다 — splitShots 가 확보한 그림 수에 맞춰 컷을 정한다.
  const only = [{ id: 'g', rank: 0, width: 1600, height: 900, license: 'cc0', url: 'https://x/a.png', title: 'x' }];
  if (M.pickFootage(only, {}) === null) ok('그래픽만 있으면 쓰지 않는다 (카드로 간다)');
  else bad('그래픽을 자료화면으로 썼다 — 화면이 죽는다');
  if (M.pickFootage(only, { allowGraphics: true })?.id === 'g') ok('명시적으로 허용하면 쓴다');
  else bad('허용해도 안 쓴다');

  if (M.isIllustration('Signature of Dolly Parton') && M.isIllustration('Autograph card'))
    ok('서명·사인은 자료화면이 아니다');
  else bad('서명을 통과시켰다');
}


// ── 3g. Pexels 화질 고르기 (2026-08-27 실측) ────────────────────────────────
// Pexels 는 같은 영상을 여러 해상도로 준다: 426x240 / 640x360 / 960x540 / 1280x720 /
//   1920x1080 / 2560x1440 / 3840x2160. **정렬 순서가 화질 순이 아니다** — 응답은
//   hd → uhd → sd → sd → uhd → sd → hd 처럼 뒤섞여 온다.
// 처음엔 "1280 이상 중 가장 작은 것" 을 골라 720p 를 집었다. 우리 영상은 1080p 다.
{
  const files = [
    { link: 'a', width: 1280, height: 720, file_type: 'video/mp4' },
    { link: 'b', width: 3840, height: 2160, file_type: 'video/mp4' },
    { link: 'c', width: 1920, height: 1080, file_type: 'video/mp4' },
    { link: 'd', width: 640, height: 360, file_type: 'video/mp4' },
  ];
  // 1080 을 채우되 4K 를 통째로 받지는 않는다 — 편당 24컷이면 내려받기가 부담이다.
  if (M.pickVideoFile(files, 1920)?.link === 'c') ok('1080p 를 고른다 (4K 를 통째로 받지 않는다)');
  else bad(`고른 것: ${M.pickVideoFile(files, 1920)?.link}`);
  // 1080 이 없으면 그 위에서 가장 작은 것.
  const noHd = files.filter((f) => f.width !== 1920);
  if (M.pickVideoFile(noHd, 1920)?.link === 'b') ok('1080 이 없으면 그 위 최소치');
  else bad(`대체 선택 이상: ${M.pickVideoFile(noHd, 1920)?.link}`);
  // 전부 작으면 그중 가장 큰 것 — 없는 것보다 낫다.
  if (M.pickVideoFile([files[0], files[3]], 1920)?.link === 'a') ok('전부 작으면 최대치');
  else bad('작은 것만 있을 때 처리 이상');
  if (M.pickVideoFile([], 1920) === null && M.pickVideoFile(null, 1920) === null) ok('빈 입력 안전');
  else bad('빈 입력 이상');
}


// ── 3h. 표기 의무 없는 소재 우선 (2026-08-27) ────────────────────────────────
//
// 사용자 우려: "저작권 걸린다". 정정할 부분이 있다 — 지금 소재는 이미 라이선스가 있어
//   저작권 문제가 아니고, 부담은 **표기 의무**다(CC BY/BY-SA 는 크레딧을 달아야 한다).
//   실제로 편당 9~12건이 쌓여 영상 설명란이 크레딧으로 채워진다.
//   그리고 CC BY-SA 소재로 2차 생성물을 만들면 **동일조건변경허락이 결과물까지 전파**된다.
//
// → CC0/PD 를 앞순위로 둔다. 표기 의무도 없고 파생물 제약도 없다.
//   금지가 아니라 **우선순위**다 — CC0/PD 가 없으면 CC BY 라도 쓰는 게 카드보다 낫다.
{
  const c = [
    { id: 'bysa', rank: 0, width: 4000, height: 2500, license: 'CC BY-SA 4.0', url: 'https://x/a.jpg', title: 'Dolly Parton live' },
    { id: 'cc0',  rank: 3, width: 1600, height: 1000, license: 'CC0',          url: 'https://x/b.jpg', title: 'Dolly Parton stage' },
  ];
  if (M.pickFootage(c, { terms: ['Dolly', 'Parton'], preferFree: true })?.id === 'cc0')
    ok('preferFree 면 CC0 를 먼저 (표기 의무 0)');
  else bad('CC0 를 두고 CC BY-SA 를 골랐다');
  if (M.pickFootage(c, { terms: ['Dolly', 'Parton'] })?.id === 'bysa')
    ok('기본값은 종전대로 적합도 우선');
  else bad('기본 동작이 바뀌었다');
  const onlyBySa = [c[0]];
  if (M.pickFootage(onlyBySa, { preferFree: true })?.id === 'bysa')
    ok('CC0 가 없으면 CC BY-SA 라도 쓴다 (카드보다 낫다)');
  else bad('CC0 없다고 버렸다');
  if (M.attributionFree('CC0') && M.attributionFree('Public domain') && M.attributionFree('pdm 1.0'))
    ok('CC0·PD 는 표기 의무 없음');
  else bad('표기 의무 판정 실패');
  if (!M.attributionFree('CC BY 4.0') && !M.attributionFree('by-sa 3.0'))
    ok('CC BY 계열은 표기 의무 있음');
  else bad('CC BY 를 무의무로 판정');
}

// ── 4. 크레딧 — 표기 의무가 **있는 것만** 만든다 ────────────────────────────
//
// 실측(2026-08-27): 전 컷이 Pexels 인데 "표기 의무 14건" 이 찍혔다.
//   Pexels/Pixabay/Unsplash 라이선스는 **출처 표기 의무가 없다**. 없는 의무를 만들어
//   설명란을 채우면, 진짜 표기해야 할 CC BY 항목이 그 안에 묻힌다.
{
  const c = M.creditLine({ title: 'Capitol at Dusk', author: 'Jane Doe', license: 'CC BY-SA 3.0',
                           source: 'Wikimedia Commons', pageUrl: 'https://commons.example/x' });
  if (c && c.includes('Jane Doe') && c.includes('CC BY-SA 3.0')) ok('CC BY-SA 는 저작자·라이선스 표기');
  else bad(`크레딧 부실: ${c}`);
  if (M.creditLine({ license: 'cc0', title: 'x' }) === null) ok('CC0 는 표기 의무 없음 → null');
  else bad('CC0 인데 크레딧을 만든다');
  if (M.creditLine({ license: 'Public domain', title: 'x' }) === null) ok('PD 도 null');
  else bad('PD 크레딧 생성');
  for (const l of ['Pexels License', 'Pixabay License', 'Unsplash License']) {
    if (M.creditLine({ license: l, title: 'x', author: 'y' }) === null) ok(`${l} → 표기 의무 없음`);
    else bad(`${l} 인데 크레딧을 만든다 — 진짜 표기 대상이 묻힌다`);
  }
  if (M.attributionFree('Pexels License') && M.attributionFree('Pixabay License')) ok('스톡 자체 라이선스도 무의무로 인식');
  else bad('스톡 라이선스 판정 실패');
}

// ── 5. 로컬 클립 매칭 ────────────────────────────────────────────────────────
//
// 2026-08-27 실측 사고: "United States Postal Service" 장면과 "Donald Trump" 장면에
//   **us-capitol-dome.mp4**(국회의사당 생성 클립)가 깔렸다.
//   "United States" 의 **us**(2글자)가 파일명의 "us-" 에 부분일치한 것이다.
//   짧은 토막의 부분일치는 아무 데나 걸린다 — 단어 경계로 보고, 짧은 키워드는 무시한다.
{
  const files = ['capitol-dome-night.mp4', 'nashville-crowd.mp4', 'stock-market-floor.mov',
                 'us-capitol-dome.mp4', 'readme.txt'];
  if (M.matchLocal(files, ['capitol', 'dome']) === 'capitol-dome-night.mp4') ok('키워드 2개 겹치는 클립 선택');
  else bad(`매칭 결과: ${M.matchLocal(files, ['capitol', 'dome'])}`);

  // 실제 원인은 entity 가 아니라 visual 쪽이었다: visual "US mail truck" 의 **US**(2글자)가
  //   파일명 "us-capitol-dome.mp4" 의 "us-" 에 부분일치했다.
  if (M.matchLocal(files, ['US', 'mail', 'truck']) === null)
    ok('짧은 토막(US)의 부분일치로 엉뚱한 클립을 집지 않는다');
  else bad(`오매칭: ${M.matchLocal(files, ['US', 'mail', 'truck'])} — 우편 장면에 국회의사당`);
  if (M.matchLocal(files, ['United', 'States', 'Postal', 'Service']) === null) ok('기관명도 오매칭 없음');
  else bad('기관명 오매칭');

  if (M.matchLocal(files, ['Donald', 'Trump']) === null) ok('무관한 대상은 null');
  else bad(`오매칭: ${M.matchLocal(files, ['Donald', 'Trump'])}`);

  if (M.matchLocal(files, ['nashville']) === 'nashville-crowd.mp4') ok('단어 경계로 정확히 맞으면 매칭');
  else bad('정상 매칭 실패');

  if (M.matchLocal(files, ['zzz']) === null) ok('안 맞으면 null');
  else bad('아무거나 집었다');
  if (M.matchLocal(files, ['readme']) === null) ok('영상 확장자가 아니면 무시');
  else bad('txt 를 클립으로 집었다');
}

// ── 6. .env.local 에서 키를 읽는가 ───────────────────────────────────────────
// 실측: PEXELS_API_KEY 를 .env.local 에 넣었는데 파이프라인이 process.env 만 봐서
//   동영상 소스가 조용히 0건이었다. 키가 있는데 안 쓰이면 "소스가 없다" 와 구분이 안 된다.
{
  if (typeof M.envValue === 'function') {
    const v = M.envValue('PEXELS_API_KEY');
    if (v && v.length > 20) ok(`.env.local 에서 키를 읽는다 (${v.length}자)`);
    else bad(`키를 못 읽는다: ${JSON.stringify(v)}`);
  } else bad('envValue 없음');
}


// ── 근거 검증 (grounded) ─────────────────────────────────────────────────────
//   실측(2026-08-28): 트럼프·연준 편에 place="Lake Ontario" 가 나와 토론토가 깔렸다.
{
  const SRC = 'Trump touts "very big victory" in Iran but | Fed says claims are unfounded and untrue';
  const cases = [
    ['Iran', true,  '헤드라인에 있는 말'],
    ['Lake Ontario', false, '헤드라인에 없는 말'],
    ['iran', true,  '대소문자 무시'],
    ['Ira', false,  '부분일치는 통과시키지 않는다'],
  ];
  let bad_ = 0;
  for (const [t, want, why] of cases) {
    const got = M.grounded(t, SRC);
    if (got !== want) { bad(`grounded("${t}") = ${got}, 기대 ${want} — ${why}`); bad_++; }
  }
  if (!bad_) ok('근거 검증 4건');
  if (M.grounded('anything', '')) ok('근거 텍스트가 없으면 판단하지 않는다');
  else bad('근거 텍스트가 비었는데 false 를 냈다 — 모르는 것과 틀린 것은 다르다');
}

// ── 장소 검증 (isPlace) ──────────────────────────────────────────────────────
//   실측(2026-08-28): place="Prison" → Pexels 가 죄수복 입은 모델의 연출 영상을 냈다.
{
  const reply = (coords) => ({
    ok: true,
    json: async () => ({ query: { pages: { 1: coords ? { coordinates: [{ lat: 1, lon: 2 }] } : {} } } }),
  });
  const yes = await M.isPlace('Iran-fixture', { fetchImpl: async () => reply(true) });
  const no  = await M.isPlace('Prison-fixture', { fetchImpl: async () => reply(false) });
  if (yes === true) ok('좌표가 있으면 장소');
  else bad(`좌표가 있는데 ${yes} 를 냈다`);
  if (no === false) ok('좌표가 없으면 장소 아님');
  else bad(`좌표가 없는데 ${no} 를 냈다`);

  // 네트워크가 죽으면 null — "장소가 아니다" 로 단정하면 화면이 전부 카드로 떨어진다.
  const dead = await M.isPlace('Nowhere-fixture', { fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  if (dead === null) ok('네트워크 실패는 null (모른다)');
  else bad(`네트워크 실패에 ${dead} 를 냈다 — 모른다와 아니다를 섞으면 안 된다`);

  // 캐시: 같은 말을 두 번 물어도 네트워크는 한 번만.
  let calls = 0;
  const f = async () => { calls++; return reply(true); };
  await M.isPlace('Cached-fixture', { fetchImpl: f });
  await M.isPlace('Cached-fixture', { fetchImpl: f });
  if (calls === 1) ok('같은 말은 캐시에서 (호출 1회)');
  else bad(`캐시가 안 걸렸다 — 호출 ${calls}회`);
}


// ── 그래픽 판정 (flatShare / isGraphicFrame) ─────────────────────────────────
//   실측(2026-08-28): "Big Brother" 검색이 CBS 로고를, "The Big Bang Theory" 가 Disney
//   로고를 배경으로 물어왔다. 확장자는 .jpg 라 종전 필터를 그냥 통과했다.
{
  const g = (vals) => Uint8Array.from(vals);
  if (M.flatShare(g([0, 255, 128, 128])) === 0.5) ok('평탄면 비율 = 순흑·순백 / 전체');
  else bad(`평탄면 비율이 틀렸다 (got ${M.flatShare(g([0, 255, 128, 128]))}, 기대 0.5)`);
  if (M.flatShare(g([]))=== 0) ok('빈 프레임은 0');
  else bad('빈 프레임에 0 이 아닌 값');
  // tol: 8 이내는 순흑/순백으로 본다(JPEG 압축으로 정확히 0·255 가 되지 않는다).
  if (M.flatShare(g([5, 250, 128, 128])) === 0.5) ok('압축 오차 ±8 을 감안한다');
  else bad(`tol 이 안 먹었다 (got ${M.flatShare(g([5, 250, 128, 128]))})`);

  // 실측값으로 경계를 고정한다 — 임계값을 흔들면 이 표가 깨진다.
  const measured = [
    ['인용카드', 0.002, false], ['토론토 실사', 0.002, false], ['보스니아 강', 0.007, false],
    ['Peter Cullen 사진', 0.037, false], ['무대 실사', 0.050, false], ['연준 차트', 0.064, false],
    ['Disney 로고', 0.234, true], ['CBS 로고', 0.694, true],
  ];
  let miss = 0;
  for (const [name, share, want] of measured) {
    const got = M.isGraphicFrame(share);
    if (got !== want) { bad(`${name} (flat=${share}) → ${got}, 기대 ${want}`); miss++; }
  }
  if (!miss) ok(`실측 8건 전부 올바르게 갈린다 (실사 ≤.064 / 그래픽 ≥.234)`);
}

// ── 2026-09-02: 검색 결과가 질의와 무관해도 그대로 화면에 나갔다 ────────────────
//   눈검증에서 잡았다(youtu.be/ZqfPqLFtaJQ). "Palo Alto Networks" 를 말하는 장면 배경이
//   필리핀 거리 표지판 "I ♥ PALO ALTO ES" 였다.
//   실측 — Commons 에 limit 8 로 물으면 뒤쪽이 무관한 것으로 채워진다:
//     1. Palo Alto Networks Headquarters South Side 2018.jpg   ← 맞음
//     4. The Gathering 2019 - Juniper and Palo Alto equipment    ← 그런대로
//     7. Schimpanse, Pan troglodytes 3.JPG                       ← 침팬지
//     8. Calocochlia pan 01.JPG                                  ← 달팽이
//   장면당 3컷을 쓰므로 저 순위까지 실제로 내려간다. 순위만 믿고 **제목을 안 봤다.**
//   뉴스 화면에 무관한 그림이 뜨는 건 틀린 정보다 — 시청자는 그게 그 사건이라고 읽는다.
{
  const cands = [
    { title: 'Palo Alto Networks Headquarters South Side 2018.jpg', url: 'a.jpg' },
    { title: 'PaloAltoNetworks logo.svg', url: 'b.jpg' },
    { title: 'The Gathering 2019 - Juniper and Palo Alto equipment.jpg', url: 'c.jpg' },
    { title: 'Schimpanse, Pan troglodytes 3.JPG', url: 'd.jpg' },
    { title: 'Calocochlia pan 01.JPG', url: 'e.jpg' },
    { title: 'Palo, Leyte welcome sign.jpg', url: 'f.jpg' },
    // 라이브 대조에서 나온 실제 결과 — 절반 문턱(2/3)을 통과해 버렸다. 이게 이번 사고의 그림이다.
    { title: '238Palo-Alto Calamba, Laguna 23.jpg', url: 'g.jpg' },
  ];
  // 새 함수를 만들지 않는다 — titleRelevant 가 이미 있었고, 문제는 그 문턱이 `some`(1개)이었던 것이다.
  //   따로 만들면 같은 날 sentence-end 에서 정리한 "판정이 두 곳에 흩어져 어긋난다" 를 내가 재현한다.
  {
    const kept = cands.filter((c) => M.titleRelevant(c.title, ['Palo', 'Alto', 'Networks'])).map((c) => c.title);
    kept.some((t) => /Headquarters/.test(t)) ? ok('맞는 결과는 남긴다') : bad(`본사 사진을 버렸다: ${JSON.stringify(kept)}`);
    !kept.some((t) => /Schimpanse|Calocochlia/.test(t))
      ? ok('무관한 결과(침팬지·달팽이) 제거')
      : bad(`무관한 것이 남았다: ${JSON.stringify(kept)}`);
    !kept.some((t) => /Leyte/.test(t))
      ? ok('한 낱말만 겹치는 동명 지역(Palo, Leyte) 제거')
      : bad(`필리핀 지명이 남았다: ${JSON.stringify(kept)}`);
    !kept.some((t) => /Calamba/.test(t))
      ? ok('두 낱말 겹치는 동명 지명(Palo-Alto Calamba)도 제거 — 이게 실제 사고의 그림이다')
      : bad(`사고의 그림이 그대로 통과한다: ${JSON.stringify(kept)}`);
    kept.some((t) => /PaloAltoNetworks/.test(t))
      ? ok('띄어쓰기 없는 표기도 맞는 것으로 인식(PaloAltoNetworks)')
      : bad('붙여 쓴 제목을 못 알아본다');

    // 한 낱말 질의는 거를 근거가 약하다 — 과잉 차단으로 화면을 비우면 그게 더 나쁘다
    M.titleRelevant('Wall Street sign.jpg', ['Wall'])
      ? ok('한 낱말 질의는 과잉 차단하지 않는다') : bad('한 낱말인데 버렸다 — 화면이 빈다');

    // 종전 동작(낱말 하나만 겹치면 통과)으로 되돌아가면 이 검사가 잡는다
    !M.titleRelevant('Palo, Leyte welcome sign.jpg', ['Palo', 'Alto', 'Networks'])
      ? ok('1/3 매칭은 더 이상 통과하지 못한다') : bad('some 판정으로 되돌아갔다');
    !M.titleRelevant('238Palo-Alto Calamba, Laguna 23.jpg', ['Palo', 'Alto', 'Networks'])
      ? ok('2/3 매칭도 통과하지 못한다(절반 문턱으로 되돌아가면 여기서 잡힌다)')
      : bad('절반 문턱으로 되돌아갔다 — 필리핀 지명이 다시 화면에 나간다');
  }
}

console.log(fail ? `\n❌ footage ${fail} 실패` : '\n✅ footage 전부 통과');
process.exit(fail ? 1 : 0);

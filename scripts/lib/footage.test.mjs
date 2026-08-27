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

// ── 3. 후보 고르기 — 가로·고해상도·사용가능 라이선스 우선 ────────────────────
{
  const cands = [
    { id: 'nc',      width: 3840, height: 2160, license: 'by-nc', url: 'x' },
    { id: 'tiny',    width:  320, height:  240, license: 'cc0',   url: 'x' },
    { id: '세로',     width: 1080, height: 1920, license: 'cc0',   url: 'x' },
    { id: 'good',    width: 2400, height: 1350, license: 'by',    url: 'x' },
    { id: 'better',  width: 3840, height: 2160, license: 'cc0',   url: 'x' },
  ];
  const p = M.pickFootage(cands, { minWidth: 1280 });
  if (p?.id === 'better') ok('4K·CC0·가로 후보를 고른다');
  else bad(`고른 것: ${p?.id}`);

  if (M.pickFootage([{ id: 'nc', width: 3840, height: 2160, license: 'by-nc', url: 'x' }], {}) === null)
    ok('쓸 수 있는 후보가 없으면 null (카드로 폴백)');
  else bad('NC 만 있는데 골랐다');

  if (M.pickFootage([], {}) === null && M.pickFootage(null, {}) === null) ok('빈 후보 안전');
  else bad('빈 후보에서 non-null');
}

// ── 4. 크레딧 — CC BY / BY-SA 는 표기 의무가 있다 ─────────────────────────────
{
  const c = M.creditLine({ title: 'Capitol at Dusk', author: 'Jane Doe', license: 'CC BY-SA 3.0', source: 'Wikimedia Commons', pageUrl: 'https://commons.example/x' });
  if (c && c.includes('Jane Doe') && c.includes('CC BY-SA 3.0')) ok('저작자 · 라이선스 표기');
  else bad(`크레딧 부실: ${c}`);
  if (M.creditLine({ license: 'cc0', title: 'x' }) === null) ok('CC0/PD 는 표기 의무 없음 → null');
  else bad('CC0 인데 크레딧을 만든다');
}

// ── 5. 로컬 클립 매칭 — 사람이 넣어둔 파일을 키워드로 찾는다 ──────────────────
{
  const files = ['capitol-dome-night.mp4', 'nashville-crowd.mp4', 'stock-market-floor.mov', 'readme.txt'];
  const hit = M.matchLocal(files, ['capitol', 'dome']);
  if (hit === 'capitol-dome-night.mp4') ok('키워드 2개 겹치는 클립 선택');
  else bad(`매칭 결과: ${hit}`);
  if (M.matchLocal(files, ['zzz']) === null) ok('안 맞으면 null');
  else bad('아무거나 집었다');
  if (M.matchLocal(files, ['readme']) === null) ok('영상 확장자가 아니면 무시');
  else bad('txt 를 클립으로 집었다');
}

console.log(fail ? `\n❌ footage ${fail} 실패` : '\n✅ footage 전부 통과');
process.exit(fail ? 1 : 0);

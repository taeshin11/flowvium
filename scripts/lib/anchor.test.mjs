#!/usr/bin/env node
/**
 * anchor.test.mjs — 우측 앵커 박스 기하.
 *
 * 배경(2026-08-28): "오른쪽에 AI 아나운서가 나와서 말하도록 하자."
 *
 * 박스를 넣으면 화면 구성이 통째로 바뀐다. 검증해야 할 것:
 *   · 앵커 박스가 **자막 밴드를 덮지 않는다** — 덮으면 글자가 가려진다.
 *   · 배경 영상이 박스 뒤로 잘리지 않는다 — 박스는 위에 얹히는 것이다.
 *   · 앵커 소스가 없으면 **박스 없이** 종전 구성으로 간다(조용히 깨지지 않게).
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./anchor.mjs');

const BAND = { top: 866 };

// ── 1. 밴드를 덮지 않는다 ────────────────────────────────────────────────────
{
  const b = M.anchorBox({ width: 1920, height: 1080, bandTop: BAND.top });
  if (b.y + b.h <= BAND.top) ok(`박스 하단 ${b.y + b.h} ≤ 밴드 상단 ${BAND.top}`);
  else bad(`밴드를 덮는다: 박스 하단 ${b.y + b.h}`);
  if (b.x + b.w <= 1920) ok('화면 오른쪽을 넘지 않는다');
  else bad(`오른쪽 초과: ${b.x + b.w}`);
  if (b.x > 1920 * 0.55) ok(`오른쪽에 붙는다 (x=${b.x})`);
  else bad(`왼쪽으로 치우침: x=${b.x}`);
}

// ── 2. 세로로 긴 비율 — 사람이 서 있는 화면이다 ──────────────────────────────
{
  const b = M.anchorBox({ width: 1920, height: 1080, bandTop: BAND.top });
  if (b.h > b.w) ok(`세로가 길다 ${b.w}x${b.h}`);
  else bad(`가로가 길다 ${b.w}x${b.h}`);
}

// ── 3. 상단 칩과 겹치지 않는다 ───────────────────────────────────────────────
// 우상단에 FLOWVIUM 로고가 있다. 박스가 거기까지 올라가면 겹친다.
{
  const b = M.anchorBox({ width: 1920, height: 1080, bandTop: BAND.top, topSafe: 140 });
  if (b.y >= 140) ok(`상단 안전영역 확보 (y=${b.y})`);
  else bad(`로고와 겹친다: y=${b.y}`);
}

// ── 4. 소스가 없으면 박스도 없다 ─────────────────────────────────────────────
{
  if (M.anchorSource([], 'en') === null) ok('파일이 없으면 null');
  else bad('없는 파일을 가리킨다');
  if (M.anchorSource(['anchor-en.mp4', 'README.md'], 'en') === 'anchor-en.mp4') ok('로케일 파일 선택');
  else bad('로케일 매칭 실패');
  if (M.anchorSource(['anchor.mp4'], 'ko') === 'anchor.mp4') ok('로케일 없는 공용 파일 폴백');
  else bad('공용 파일 폴백 실패');
  if (M.anchorSource(['anchor-en.mp4'], 'ko') === null) ok('다른 로케일 전용 파일은 쓰지 않는다');
  else bad('영어 앵커를 한국어에 썼다');
  if (M.anchorSource(['README.md'], 'en') === null) ok('영상이 아니면 무시');
  else bad('md 를 앵커로 집었다');
}


// ── 목소리와 앵커의 성별 ─────────────────────────────────────────────────────
//   실측 사고(2026-08-28): 내레이션은 Mark(남성)인데 화면 앵커는 여성이었다.
//   영상 전체가 그대로 유튜브에 올라갔고, 사람이 보고서야 알았다.
//   앵커 클립은 목소리와 따로 만들어져서 **어디서도 안 걸린다** — 이름에 적고 대조한다.
{
  if (M.anchorGender('anchor-en-male.mp4') === 'male') ok('파일명에서 성별을 읽는다');
  else bad(`성별을 못 읽었다 (${M.anchorGender('anchor-en-male.mp4')})`);
  if (M.anchorGender('anchor-en.mp4') === null) ok('안 적혀 있으면 null');
  else bad('안 적혀 있는데 값을 냈다');

  const bad1 = M.genderMismatch('anchor-en-female.mp4', 'male');
  if (bad1 && /female/.test(bad1) && /male/.test(bad1)) ok('어긋나면 양쪽 값을 담아 알린다');
  else bad(`어긋남을 못 잡았다 (${bad1})`);
  if (M.genderMismatch('anchor-en-male.mp4', 'male') === null) ok('일치하면 통과');
  else bad('일치하는데 걸렸다');
  // 모르면 막지 않는다 — 모르는 것과 어긋난 것은 다르다.
  if (M.genderMismatch('anchor-en.mp4', 'male') === null) ok('앵커 성별 미상이면 통과');
  else bad('미상인데 막았다');
  if (M.genderMismatch('anchor-en-male.mp4', null) === null) ok('목소리 성별 미상이면 통과');
  else bad('목소리 미상인데 막았다');

  // 성별이 붙은 파일도 로케일 매칭이 되어야 한다(이름 규칙을 바꿨으므로).
  if (M.anchorSource(['anchor-en-male.mp4'], 'en') === 'anchor-en-male.mp4') ok('성별 접미사 파일도 찾는다');
  else bad('성별 접미사가 붙으면 못 찾는다');
  if (M.anchorSource(['anchor-ko-male.mp4'], 'en') === null) ok('다른 로케일은 여전히 안 쓴다');
  else bad('다른 로케일 파일을 썼다');
}

console.log(fail ? `\n❌ anchor ${fail} 실패` : '\n✅ anchor 전부 통과');
process.exit(fail ? 1 : 0);

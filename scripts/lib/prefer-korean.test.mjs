#!/usr/bin/env node
/**
 * prefer-korean.test.mjs — 한국 관련 제목을 앞세우되 **버리지는 않는가**.
 *
 * 배경(2026-09-15, 사용자 "사진 없는 회차가 왜 있냐"):
 *   한국어 이슈면 스톡 검색 결과를 `looksKorean(제목)` **하드 필터**로 걸렀다.
 *   커먼즈·오픈버스 제목은 대부분 영어라 거의 다 탈락한다 —
 *   실측: "코스피" 8건 중 한글 제목 0건 · "국회 본회의" 8건 중 2건.
 *   그래서 **회색 카드로 간 회차에서 스톡이 성공한 흔적이 로그 전수에 한 건도 없었다.**
 *
 *   회색 카드만 나오는 편은 시청률이 63.3%다(사진 있는 편 78~83%). 59편 중 11편(19%).
 *
 *   그 필터는 엉뚱한 사진을 막으려고 넣은 것이고(검찰총장 사진·임시정부 청사·투호 지게가
 *   실제로 나갔다) 그때는 CLIP 이 없었다. 지금은 CLIP 이 주제 불일치를 점수로 잡는다.
 *   **언어로 먼저 버리지 말고 CLIP 이 판정하게 한다.** 순서만 한국 쪽을 앞세운다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { preferKorean, looksKorean } = await import('./footage.mjs');

const list = [
  { title: 'Seoul National Assembly building', url: 'a' },
  { title: '국회 본회의장 전경', url: 'b' },
  { title: 'Generic office interior', url: 'c' },
  { title: '서울 여의도 야경', url: 'd' },
];

// [1] 하나도 버리지 않는다 — 이게 이 변경의 핵심이다
{
  const out = preferKorean(list, true);
  out.length === list.length
    ? ok(`${list.length}건이 그대로 남는다 (하드 필터였으면 ${list.filter(c => looksKorean(c.title)).length}건만 남았다)`)
    : bad(`항목이 사라졌다: ${list.length} → ${out.length}`);
}

// [2] 한국 관련이 앞에 온다 — 같은 값이면 그쪽이 맞을 확률이 높다
{
  const out = preferKorean(list, true);
  const firstNonKo = out.findIndex((c) => !looksKorean(c.title));
  const lastKo = out.map((c) => looksKorean(c.title)).lastIndexOf(true);
  (firstNonKo === -1 || lastKo < firstNonKo)
    ? ok(`한국 관련이 앞에 모인다 (${out.map((c) => (looksKorean(c.title) ? 'K' : '.')).join('')})`)
    : bad(`순서가 섞였다: ${out.map((c) => c.url).join('')}`);
}

// [3] 앵커가 꺼져 있으면 손대지 않는다
preferKorean(list, false).map((c) => c.url).join('') === 'abcd'
  ? ok('koAnchor=false 면 순서를 건드리지 않는다')
  : bad('앵커가 꺼졌는데도 순서를 바꾼다');

// [4] 빈 입력·null 에 안 죽는다 — 소재가 아예 없는 회차가 실제로 있다
{
  const a = preferKorean([], true), b = preferKorean(null, true), c = preferKorean(undefined, true);
  (a.length === 0 && b.length === 0 && c.length === 0)
    ? ok('빈 입력에 안 죽는다')
    : bad('빈 입력 처리가 없다');
}

// [5] 배선 확인 — 호출부가 하드 필터로 되돌아가지 않았는가
{
  const { readFileSync } = await import('fs');
  const { ROOT } = await import('./project-root.mjs');
  const src = readFileSync(`${ROOT}/scripts/video/make-shorts.mjs`, 'utf8');
  const hard = (src.match(/\|\|\s*looksKorean\(c\.title\)\)/g) ?? []).length;
  const soft = (src.match(/preferKorean\(/g) ?? []).length;
  (hard === 0 && soft >= 3)
    ? ok(`소재 선택 ${soft}곳이 모두 앞세우기로 바뀌었다 (하드 필터 ${hard}곳)`)
    : bad(`하드 필터가 ${hard}곳 남아 있다 (preferKorean ${soft}곳)`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

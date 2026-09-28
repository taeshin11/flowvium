#!/usr/bin/env node
/**
 * article-template.test.mjs — 서로 다른 기사가 같이 쓰는 공유 이미지(매체 템플릿)는 기사 사진이 아니다. 2026-09-29 신설.
 *
 * 9/29 예비 두 편 모두에 한국경제 「속보」 카드가 기사 사진으로 들어갔다. 실측: 한경 [속보] 기사 4건
 *   (DMZ 폭발원인 · 北매설 지뢰 · 北목함지뢰 · 손흥민 58호골)의 og:image 가 전부 `img.hankyung.com/photo/202609/02.45052196.1.jpg`.
 *   주소가 날짜 붙은 사진 경로라 isBrandImage(주소에 logo 류 단어)로 못 잡고, 한 이슈 안 "셋 이상" 규칙으로도 못 잡는다
 *   (한 이슈엔 한 번 나온다). 본문 등장 여부도 가르지 못했다(템플릿도 페이지에 9~10번 나온다).
 * → 실행을 넘어 기억한다: 이미지 주소 → 함께 나온 기사 제목들. **서로 다른 사건**(제목 단어 겹침이 낮은) 두 기사가
 *   같은 이미지를 쓰면 템플릿이다. 같은 사건의 다른 판(제목만 조금 다른)은 같은 사진을 써도 된다.
 */
import { sharedAcrossStories, noteImages } from './article-image.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 다른 사건끼리 공유 → 템플릿 · 같은 사건의 다른 판 → 아님
{
  const a = sharedAcrossStories(['[속보] 軍 "DMZ 폭발원인, 아군의 지뢰는 아닌 것으로 추정"', '[속보] 손흥민, A매치 한국인 최다 58호골…전설 차범근과 어깨 나란히']);
  const b = sharedAcrossStories(['외교부, 주한우크라대사대리 초치…"허위공보 유감표명" | 연합뉴스', '[속보] 외교부, 주한우크라대사대리 초치…"허위공보 유감표명"']);
  const c = sharedAcrossStories(['단 하나의 기사']);
  (a && !b && !c) ? ok('[1] 다른 사건 공유 → 템플릿 · 같은 사건 판 → 아님 · 한 건 → 아님') : bad(`[1] ${[a, b, c]}`);
}
// [2] 실행을 넘어 기억한다 — 첫 실행에선 한 번뿐이라 통과, 다른 사건에서 또 나오면 그때부터 거른다(그 이후 모든 실행)
{
  const store = {};
  const T = 'https://img.hankyung.com/photo/202609/02.45052196.1.jpg';
  const r1 = noteImages([{ url: T, title: '[속보] 軍 "DMZ 폭발원인, 아군의 지뢰는 아닌 것으로 추정"' }, { url: 'https://img/real1.jpg', title: '외교부 대사대리 초치' }], { store, now: 1000 });
  const r2 = noteImages([{ url: T, title: '[속보] 외교부, 주한우크라대사대리 초치…"허위공보 유감표명"' }], { store, now: 2000 });
  const r3 = noteImages([{ url: T, title: '[속보] 손흥민 58호골' }], { store, now: 3000 });
  (r1.map((x) => x.url).includes(T) && r2.length === 0 && r3.length === 0 && r1.length === 2)
    ? ok('[2] 처음 한 번은 통과 → 다른 사건에서 다시 나오자 거름 → 이후도 거름') : bad(`[2] ${JSON.stringify([r1.length, r2.length, r3.length])}`);
}
// [3] 기억은 무한히 자라지 않는다 — 30일 지난 항목은 지운다
{
  const store = { 'https://old.jpg': { titles: ['옛 기사 하나'], at: 0 } };
  noteImages([{ url: 'https://new.jpg', title: '새 기사' }], { store, now: 31 * 864e5 });
  (!store['https://old.jpg'] && store['https://new.jpg']) ? ok('[3] 30일 지난 기억은 지운다') : bad(`[3] ${Object.keys(store)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

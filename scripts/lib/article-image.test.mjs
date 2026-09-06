#!/usr/bin/env node
/**
 * article-image.test.mjs — 기사에서 가져온 og:image 가 **그 기사의 사진**인가.
 *
 * 배경(2026-09-06): 17:00 재제작(nlXnefkUqKM)의 두 번째 장면이
 *   "성공을 부르는 습관 / 한국경제" 라고 적힌 매체 기본 배너로 채워져 나갔다. 내렸다.
 *   주소가 `static.hankyung.com/img/logo/logo-news-sns.png` 였다 — **로고라고 주소에 적혀 있었다.**
 *   로고 걸러내기는 구글 검색 경로(footage.mjs)에만 있었고 기사 사진 경로에는 없었다.
 *   "같은 주소가 셋 이상이면 배너로 본다" 는 규칙만 있었는데, 한 번만 나오면 그냥 통과했다.
 */
import { isBrandImage } from './article-image.mjs';

let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };

// 실제로 나갔던 배너
[
  'https://static.hankyung.com/img/logo/logo-news-sns.png?v=20201130',
  'https://image.example.com/common/og-default.jpg',
  'https://cdn.example.com/assets/share-image.png',
  'https://img.example.com/img/noimage.gif',
  'https://www.example.com/images/placeholder-thumb.jpg',
].forEach((u) => {
  isBrandImage(u) ? ok(`배너로 거른다: ${u.slice(8, 52)}`) : bad(`배너를 통과시켰다: ${u}`);
});

// 진짜 기사 사진 — 실제로 쓴 주소들. 이걸 자르면 소재가 없어진다.
[
  'https://img1.yna.co.kr/photo/ap/2026/08/07/PAP20260807150101009_P4.jpg',
  'https://img7.yna.co.kr/etc/inner/KR/2026/09/02/AKR20260902156500062_01_i_P4.jpg',
  'https://img.hankyung.com/photo/202609/03.45523321.1.jpg',
  'https://image.yonhapnewstv.co.kr/etc/inner/KR/2026/09/06/PYH.jpg',
].forEach((u) => {
  !isBrandImage(u) ? ok(`기사 사진은 그대로 쓴다: ${u.slice(8, 48)}`) : bad(`멀쩡한 사진을 잘랐다: ${u}`);
});

console.log(fail === 0 ? '\n✅ article-image 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

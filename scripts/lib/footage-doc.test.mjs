#!/usr/bin/env node
/**
 * footage-doc.test.mjs — 문서 스캔을 사진으로 쓰지 않는가.
 *
 * 2026-09-15 실측: 주소 끝만 보던 탓에 문서 9건이 9건 다 통과했다.
 *   커먼즈는 PDF 를 `…/국회회의록….pdf/page1-800px-….pdf.jpg` 로 렌더한다 —
 *   끝은 .jpg 고 진짜 확장자는 제목과 주소 경로 안쪽에만 남는다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const { isRealFootage } = await import('./footage.mjs');

const docs = [
  { title: '국회회의록 20대 346회 17차 국회본회의.pdf',
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/%EA%B5%AD%ED%9A%8C.pdf/page1-800px-x.pdf.jpg' },
  { title: 'CNTS-00115191003 自由新聞 1948-06-16.pdf', url: 'https://x/a.jpg' },
  { title: '2020-02-26 (보도참고자료) 감염병의 예방', url: 'https://x/b.pdf/page1-800px-b.pdf.jpg' },
  { title: 'Some scan.djvu', url: 'https://x/c.jpg' },
];
docs.every((c) => !isRealFootage(c))
  ? ok(`문서 ${docs.length}건이 모두 걸러진다 (제목·주소 경로 양쪽)`)
  : bad(`문서가 통과한다: ${docs.filter(isRealFootage).map((c) => c.title).join(' / ')}`);

// 멀쩡한 사진은 그대로 — 새 규칙이 소재를 굶기면 안 된다
const photos = [
  { title: '현대차 믹스 트럭.jpg', url: 'https://x/truck.jpg' },
  { title: 'Seoul Metro Line 2 train.jpg', url: 'https://x/seoul.jpg' },
  { title: '국회 본회의장 전경.JPG', url: 'https://x/nat.JPG' },
];
photos.every(isRealFootage)
  ? ok(`사진 ${photos.length}건은 그대로 통과한다`)
  : bad(`멀쩡한 사진이 걸린다: ${photos.filter((c) => !isRealFootage(c)).map((c) => c.title).join(' / ')}`);

// 깨진 인코딩에 죽지 않는가 — decodeURIComponent 는 던진다
try {
  isRealFootage({ title: 'x.jpg', url: 'https://x/%E0%A4%A.jpg' });
  ok('깨진 퍼센트 인코딩에 안 죽는다');
} catch (e) { bad(`깨진 인코딩에 예외: ${e.message}`); }

// 2026-10-20 실물(3eus-sStXNE 4번 장면, 15초): 구글 경로가 '[표] 삼성전자 2012∼2026년 분기별 매출·영업이익 | 연합뉴스' 를 골랐다.
//   표 기사에는 사진이 없어 og:image 가 **통신사 로고**다 — 화면 15초가 연합뉴스 로고였다(3곳 모두 CUT, 프레임 눈확인).
//   '[그래픽]' 은 이미 막는다. 같은 관례의 '[표]' 말머리도 사진 기사가 아니다. 제목 중간의 '표'(발표·대표·투표)는 막지 않는다.
{
  const t1 = { title: '[표] 삼성전자 2012∼2026년 분기별 매출·영업이익 | 연합뉴스', url: 'https://img.yna.co.kr/x.jpg' };
  const keep = [{ title: '삼성전자 3분기 실적 발표 현장 | 연합뉴스', url: 'https://x/a.jpg' }, { title: '대표 기자회견', url: 'https://x/b.jpg' }, { title: '투표소 앞 줄 선 시민들', url: 'https://x/c.jpg' }];
  (!isRealFootage(t1) && keep.every((c) => isRealFootage(c)))
    ? ok("'[표]' 말머리 기사(사진 없음 → 로고)는 거르고, 발표·대표·투표는 둔다") : bad(`[표] 판정: ${isRealFootage(t1)} / 일반 ${keep.map(isRealFootage)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

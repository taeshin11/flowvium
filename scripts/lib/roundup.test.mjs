#!/usr/bin/env node
/**
 * roundup.test.mjs — 하루치 쇼츠를 묶은 롱폼 '뉴스 총정리'. 2026-10-06 신설.
 *
 * 사장님(10/06): "숏폼 내용 묶어서 롱폼도 좀 만들까? 뉴스채널들 차용해봐".
 * 차용(실측 10/06, 각 채널 /videos 최근 200편):
 *   SBS 8뉴스 다시보기 18~28천 뷰 — 제목 "'AI 활용 추정' 해킹에 …금융당국 긴급 점검회의 外 - SBS 8뉴스 다시보기 / 10/4(일)"
 *   YTN [뉴스START] 다시보기 15~47천 뷰 — "'AI 해킹'에 금융권 줄줄이 피해…긴급회의 [뉴스START] 다시보기 2026년 10월 05일"
 *   → 첫머리 = 가장 큰 뉴스 1건 + 外, 뒤에 프로그램 이름·날짜. 우리는 '가장 큰' 을 그날 조회수로 정한다(보도국 판단 대신 실측).
 * 장(chapter): 5분 넘는 참고형 영상은 챕터가 검색 '주요 순간' 을 연다(Metricool 2026). 유튜브 규칙: 0:00 시작·3개 이상·각 10초 이상.
 */
import { orderByViews, chapterLines, roundupTitle, cleanHeadline } from './roundup.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const shorts = [
  { video_id: 'a', headline: '5년간 국내 어선 사고 사망·실종자 478명…지난해만 110명', views: 900, published_at: '2026-10-05T03:39:00Z' },
  { video_id: 'b', headline: "李대통령 지지율 37.4%…민주 42.5%·국힘 38.4% '오차內'[리", views: 2100, published_at: '2026-10-05T06:32:00Z' },
  { video_id: 'c', headline: '은행에 10억 이상 맡긴 미성년 고객 52명 #Shorts', views: 1500, published_at: '2026-10-05T12:54:00Z' },
];
const o = orderByViews(shorts);
o.map((x) => x.video_id).join() === 'b,c,a' ? ok('[1] 조회수 큰 편부터(첫 장 = 그날 가장 큰 뉴스)') : bad(`[1] ${o.map((x) => x.video_id)}`);
cleanHeadline("李대통령 지지율 37.4%…민주 42.5%·국힘 38.4% '오차內'[리") === "李대통령 지지율 37.4%…민주 42.5%·국힘 38.4% '오차內'" ? ok('[2a] 잘린 꼬리 "[리" 제거') : bad(`[2a] ${cleanHeadline("李대통령 지지율 37.4%…민주 42.5%·국힘 38.4% '오차內'[리")}`);
cleanHeadline('은행에 10억 이상 맡긴 미성년 고객 52명 #Shorts') === '은행에 10억 이상 맡긴 미성년 고객 52명' ? ok('[2b] #Shorts 제거') : bad('[2b]');
// 3초 오프닝은 따로 장으로 못 둔다(10초 규칙) — 첫 뉴스 장에 포함해 0:00 으로.
const ch = chapterLines([{ title: 'A', start: 0 }, { title: 'B', start: 47.6 }, { title: 'C', start: 125.2 }]);
(ch[0] === '0:00 A' && ch[1] === '0:47 B' && ch[2] === '2:05 C') ? ok(`[3] 챕터 "${ch.join(' / ')}"`) : bad(`[3] ${JSON.stringify(ch)}`);
let threw = false; try { chapterLines([{ title: 'x', start: 0 }, { title: 'y', start: 5 }]); } catch { threw = true; }
threw ? ok('[3b] 3개 미만·10초 미만 장은 거부(유튜브가 챕터로 안 받는다)') : bad('[3b]');
const t = roundupTitle({ lead: o[0].headline, n: 3, date: '2026-10-05' });
// 10/08 개정(Mac mini2 제안·CTR 0.9~1.5%): 앞머리에 그날 핵심 이슈, '뉴스 총정리' 는 뒤로.
(/^李대통령 지지율/.test(t) && /外 2건 \| 10월 5일 뉴스 총정리$/.test(t) && t.length <= 100) ? ok(`[4] 제목 "${t}"`) : bad(`[4] ${t}`);
cleanHeadline("지지율 37.4% '오차內'[리얼미터]") === "지지율 37.4% '오차內'" ? ok('[2c] 끝 출처 꼬리표 제거') : bad('[2c]');
{
  // [5] 썸네일 글: agy 가 고른 줄·숫자가 실제 훅·제목에 있어야 한다(지어낸 말 금지). 아니면 1위 편 훅으로.
  const { thumbText } = await import('./roundup.mjs');
  const shorts2 = [{ title: '李대통령 지지율 37.4%…민주 42.5%', hooks: ['지지율 37.4%', '3주 만에 하락', '오차 범위'] }, { title: '어선 사고 사망 478명', hooks: ['어선 사고', '사망 478명'] }];
  const good = thumbText(shorts2, { pick: 1, line1: '어선 사고', line2: '사망 478명', number: '478명' }, 25);
  (good.line1 === '어선 사고' && good.number === '478명' && good.src === 'agy') ? ok(`[5a] agy 선택 채택 ${JSON.stringify(good)}`) : bad(`[5a] ${JSON.stringify(good)}`);
  const made = thumbText(shorts2, { pick: 0, line1: '대통령 탄핵', line2: '지지율 폭락', number: '99%' }, 25);
  (made.src === 'fallback' && made.line1 === '지지율 37.4%' && made.number === '37.4%') ? ok(`[5b] 지어낸 말이면 1위 편 훅·제목 숫자로 ${JSON.stringify(made)}`) : bad(`[5b] ${JSON.stringify(made)}`);
  const half = thumbText(shorts2, { pick: 1, line1: '어선 사고', line2: '사망 478명', number: '첫날' }, 25);
  (half.src === 'agy-lines' && half.line1 === '어선 사고' && half.number === '478명') ? ok(`[5d] 숫자만 틀리면 줄은 살리고 숫자는 제목에서 ${JSON.stringify(half)}`) : bad(`[5d] ${JSON.stringify(half)}`);
  const nonum = thumbText([{ title: '국감 첫날 소환조사', hooks: ['국감 첫날', '소환조사'] }], null, 19);
  (nonum.number === '19건') ? ok('[5c] 제목에 숫자가 없으면 꼭지 수') : bad(`[5c] ${JSON.stringify(nonum)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

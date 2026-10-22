#!/usr/bin/env node
/**
 * market-brief.test.mjs — 매일 시장 요약 롱폼(make-market-brief)의 순수 규칙. 2026-10-22 신설.
 *
 * 왜(사장님 10/22): "그날의 시장 소식 정리를 롱폼으로 — 아침 7시쯤엔 미국 증시 요약, 미국 장 시작 1시간 전엔 한국장·유럽장 요약.
 *   레퍼런스 https://youtu.be/JXM5LHwISVg (오선의 미국 증시, 구독 123만) 를 차용, 썸네일도."
 *   레퍼런스 실측(yt-dlp 10/22): 1920×1080 · 2분 13초 · 챕터 2개(① 전날 증시 요약 ② 오늘 주요 일정) · 하루 만에 조회 13,012.
 *   구성 = 검은 제목 카드 → 종목·이슈마다 사진 + 낭독 자막 → 일정 화면(시각·국가·지표). 썸네일 = 사진 전면 + 빨간 날짜 띠 + 흰 띠에 검은 큰 질문 + 우상단 채널 배지.
 *
 * 이 채널 롱폼의 과거(같은 자리에서 실패한 것 — 되풀이하지 않으려고 적는다):
 *   매일 '뉴스 총정리'(쇼츠 묶음) 조회 4·0·1, 주 1회 이슈 해설 49h 조회 9(쇼츠 중앙 ~1,000). 둘 다 이미 본 쇼츠의 재탕이었다.
 *   이번 것은 재탕이 아니라 **장 전 시각에 맞춘 새 정보**(전날 마감 숫자 + 오늘 일정)라 자리가 다르다 — 그래도 2주 재서 판정한다.
 *
 * 숫자 출처(10/22 실측으로 정했다):
 *   Yahoo 일봉은 마지막 칸이 비고(^KS11 10/21 종가 null) chartPreviousClose 는 '구간 첫날 전' 종가라(^DJI 51,621 ≠ 전날 52,495) 등락률을 틀리게 낸다.
 *   네이버 지수 API(m.stock.naver.com / api.stock.naver.com)는 거래소 종가·등락률·장 상태·거래 시각을 그대로 준다(코스피 10/21 5,735.66 +3.29% = 연합 기사).
 */
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./market-brief.mjs');

// [1] 미국 장 시작(뉴욕 09:30)의 한국 시각 — 서머타임이면 22:30, 아니면 23:30. 하드코딩한 시각은 11월에 한 시간 틀린다.
{
  const a = M.usOpenKst('2026-10-22'); const b = M.usOpenKst('2026-11-03');
  (a.hhmm === '22:30' && b.hhmm === '23:30') ? ok('[1] 미국 개장 = 22:30(서머타임) / 23:30(해제 뒤)') : bad(`[1] ${a.hhmm} / ${b.hhmm}`);
  const ms = M.usOpenKst('2026-10-22').ms;
  (new Date(ms).toISOString() === '2026-10-22T13:30:00.000Z') ? ok('[1b] 개장 시각 ms') : bad(`[1b] ${new Date(ms).toISOString()}`);
}
// [2] 네이버 지수 응답 → 이름·종가·등락률·상태·거래일(현지)
{
  const q = M.parseNaverIndex('.DJI', { closePrice: '52,856.09', fluctuationsRatio: '0.69', compareToPreviousClosePrice: '360.21', marketStatus: 'CLOSE', localTradedAt: '2026-10-21T16:36:48-04:00' });
  (q.name === '다우' && q.close === 52856.09 && q.pct === 0.69 && q.closed && q.day === '2026-10-21') ? ok('[2] 네이버 지수 읽기') : bad(`[2] ${JSON.stringify(q)}`);
  const n = M.parseNaverIndex('.DJI', { closePrice: '', fluctuationsRatio: 'x' });
  (n === null) ? ok('[2b] 숫자가 없으면 null(0 으로 채우지 않는다)') : bad(`[2b] ${JSON.stringify(n)}`);
}
// [3] 낭독·화면에 쓸 사실 줄 — 기사와 같은 꼴(쉼표 자리·소수 둘째·부호)로 써서 숫자 관문이 같은 수로 견준다
{
  const f = M.factLine({ name: '나스닥', close: 26702.86, pct: 1.05, change: 277.99 });
  (f === '나스닥 26,702.86 (+1.05%, +277.99)') ? ok('[3] 사실 줄 꼴') : bad(`[3] ${f}`);
  (M.factLine({ name: '코스피', close: 5552.74, pct: -3.73, change: -215.27 }) === '코스피 5,552.74 (-3.73%, -215.27)') ? ok('[3b] 하락 부호') : bad('[3b]');
}
// [4] 판(edition)마다 '그날 장' 이 맞는지 — 휴장·지연이면 만들지 않는다(어제 숫자를 오늘 것처럼 읽지 않는다)
{
  const us = [{ code: '.INX', closed: true, day: '2026-10-21' }, { code: '.IXIC', closed: true, day: '2026-10-21' }, { code: '.DJI', closed: true, day: '2026-10-21' }];
  const r1 = M.sessionCheck('us', us, { nowMs: Date.parse('2026-10-21T22:05:00Z') });   // KST 10/22 07:05
  r1.ok ? ok('[4] 미국판: 전날(뉴욕) 마감 셋 다 있음 → 만든다') : bad(`[4] ${r1.why}`);
  const r2 = M.sessionCheck('us', us.map((x) => ({ ...x, day: '2026-10-20' })), { nowMs: Date.parse('2026-10-21T22:05:00Z') });
  (!r2.ok && /2026-10-21/.test(r2.why)) ? ok('[4b] 미국판: 마감일이 어제가 아니면(휴장) 안 만든다') : bad(`[4b] ${JSON.stringify(r2)}`);
  const r3 = M.sessionCheck('us', us.map((x, i) => (i ? x : { ...x, closed: false })), { nowMs: Date.parse('2026-10-21T22:05:00Z') });
  (!r3.ok) ? ok('[4c] 미국판: 아직 장중인 지수가 있으면 안 만든다') : bad('[4c]');
  const kr = [{ code: 'KOSPI', closed: true, day: '2026-10-22' }, { code: 'KOSDAQ', closed: true, day: '2026-10-22' }];
  const r4 = M.sessionCheck('kreu', kr, { nowMs: Date.parse('2026-10-22T10:35:00Z') });   // KST 19:35
  r4.ok ? ok('[4d] 한국·유럽판: 오늘 한국 마감 → 만든다') : bad(`[4d] ${r4.why}`);
  const r5 = M.sessionCheck('kreu', kr.map((x) => ({ ...x, day: '2026-10-21' })), { nowMs: Date.parse('2026-10-22T10:35:00Z') });
  (!r5.ok) ? ok('[4e] 한국·유럽판: 오늘 한국장이 없었으면(휴장) 안 만든다') : bad('[4e]');
}
// [5] 판마다 돌아도 되는 시각 — 러너가 놓친 잡을 아무 때나 소급 실행한다(cron-runner startupCatchup). 시각이 지난 판은 안 만든다.
{
  const at = (iso) => Date.parse(iso);
  (M.inWindow('us', at('2026-10-21T22:05:00Z')).ok && !M.inWindow('us', at('2026-10-22T05:00:00Z')).ok) ? ok('[5] 미국판은 KST 06:30~11:00 에만') : bad('[5]');
  (M.inWindow('kreu', at('2026-10-22T10:35:00Z')).ok && !M.inWindow('kreu', at('2026-10-22T13:31:00Z')).ok) ? ok('[5b] 한국·유럽판은 KST 18:00 ~ 미국 개장 전에만') : bad('[5b]');
}
// [6] 일정 — 이번 판이 다룰 창(지금 ~ 다음 판) 안의 지표만, 한국 시각으로. 중요도 낮음은 뺀다.
{
  const ev = [
    { title: 'Unemployment Claims', country: 'USD', date: '2026-10-22T08:30:00-04:00', impact: 'Medium', forecast: '200K', previous: '199K' },
    { title: 'Natural Gas Storage', country: 'USD', date: '2026-10-22T10:30:00-04:00', impact: 'Low', forecast: '80B', previous: '67B' },
    { title: 'German Flash Manufacturing PMI', country: 'EUR', date: '2026-10-23T03:30:00-04:00', impact: 'Medium', forecast: '53.5', previous: '53.8' },
    { title: 'CPI y/y', country: 'JPY', date: '2026-10-22T19:30:00-04:00', impact: 'High' },
    { title: 'Bank Holiday', country: 'USD', date: '2026-10-22T00:00:00-04:00', impact: 'Holiday' },
  ];
  const rows = M.calendarRows(ev, { fromMs: Date.parse('2026-10-21T22:00:00Z'), toMs: Date.parse('2026-10-22T22:00:00Z') });
  (rows.length === 1 && rows[0].kst === '21:30' && rows[0].country === '미국' && rows[0].title === 'Unemployment Claims')
    ? ok('[6] 창 안 · 미국·유로 · 중간 이상만, 한국 시각') : bad(`[6] ${JSON.stringify(rows)}`);
}
// [7] 기사 고르기 — 판의 장 마감 기사만(같은 사건 종합판·속보판은 하나로)
{
  const rows = [
    { headline: '뉴욕증시, 스페이스X 호실적에 상승…나스닥 1.1%↑', captured_at: '2026-10-21T20:30:03Z' },
    { headline: '뉴욕증시, 스페이스X 실적에 기술주 강세…나스닥 1.1%↑(종합)', captured_at: '2026-10-21T21:25:00Z' },
    { headline: '스페이스X 호실적에 테슬라 합병설까지…증시 살린 \'머스크 마법\'[뉴욕마감]', captured_at: '2026-10-21T21:15:03Z' },
    { headline: '코스피 3.3% 급등한 5,735 마감…코스닥도 1.4%↑', captured_at: '2026-10-21T06:45:00Z' },
    { headline: '경찰, 천장마감재 붕괴로 노인 부상', captured_at: '2026-10-21T21:00:00Z' },
  ];
  const us = M.pickArticles('us', rows);
  (us.length === 2 && us.every((r) => /뉴욕/.test(r.headline)) && us.some((r) => /종합/.test(r.headline)))
    ? ok('[7] 미국판: 뉴욕 마감 기사, 종합판이 속보판을 대신한다') : bad(`[7] ${us.map((r) => r.headline).join(' / ')}`);
  const kr = M.pickArticles('kreu', rows);
  (kr.length === 1 && /코스피/.test(kr[0].headline)) ? ok('[7b] 한국·유럽판: 코스피 마감 기사만(재료 사건 기사 X)') : bad(`[7b] ${kr.map((r) => r.headline).join(' / ')}`);
}
// [8] 제목 — 앞머리에 무슨 영상인지(레퍼런스 【미국 증시 요약】) + 핵심 질문 + 날짜. 100자 안.
{
  const t = M.briefTitle({ edition: 'us', hook: 'AI 투자 우려는 끝났나?', date: '2026-10-22' });
  (t === '【미국 증시 요약】 AI 투자 우려는 끝났나? | 10월 22일(목)') ? ok('[8] 제목 꼴') : bad(`[8] ${t}`);
  (M.briefTitle({ edition: 'kreu', hook: 'x'.repeat(200), date: '2026-10-22' }).length <= 100) ? ok('[8b] 100자 안') : bad('[8b]');
  /【한국·유럽 증시 요약】/.test(M.briefTitle({ edition: 'kreu', hook: 'a', date: '2026-10-22' })) ? ok('[8c] 한국·유럽판 머리') : bad('[8c]');
}
// [9] 썸네일 날짜 띠 — 레퍼런스 꼴 "26년 10월 22일 (목)"
{
  (M.thumbDate('2026-10-22') === '26년 10월 22일 (목)') ? ok('[9] 썸네일 날짜 띠') : bad(`[9] ${M.thumbDate('2026-10-22')}`);
}
// [10] 예약 공개 — 한국·유럽판은 보고서(20:00~21:30) 전에 만들어 두고 '미국 개장 1시간 전' 에 공개한다.
//   유튜브 API 는 publishAt 이 있으면 privacyStatus 가 private 여야 한다(공개 시각에 public 으로 바뀐다).
{
  const { uploadRequestBody } = await import('./youtube.mjs');
  const b = uploadRequestBody({ title: 't', privacy: 'public', publishAt: '2026-10-22T12:30:00.000Z' });
  (b.status.privacyStatus === 'private' && b.status.publishAt === '2026-10-22T12:30:00.000Z') ? ok('[10] 예약 공개 = private + publishAt') : bad(`[10] ${JSON.stringify(b.status)}`);
  const c = uploadRequestBody({ title: 't', privacy: 'public' });
  (c.status.privacyStatus === 'public' && !('publishAt' in c.status)) ? ok('[10b] 예약 없으면 그대로') : bad(`[10b] ${JSON.stringify(c.status)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

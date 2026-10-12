#!/usr/bin/env node
/**
 * weekly-explainer.test.mjs — 주 1회 4~6분 이슈 해설(롱폼). 2026-10-12 신설.
 *
 * 사장님 결정(Mac mini2 경유 10/12): "수익이 제일 높을 만한 방향으로" → 롱폼 A안.
 *   매일 '뉴스 총정리'(쇼츠 이어 붙이기)를 접고 **주 1회 단일 이슈 4~6분 해설**로 바꾼다.
 *   근거(10/11 성적 점검): 총정리 조회 10/7 4 · 10/9 0 · 10/10 1. 쇼츠를 이어 붙인 영상은 볼 이유가 없다.
 *   ChatGPT·agy 둘 다 "하나의 이슈를 배경·쟁점·전망까지 푸는 해설" 을 권했다(롱폼 시청 시간 = 수익 조건).
 * 주제: 그 주 쇼츠에서 **여러 편으로 다룬 이슈**(쇼츠 상위 주제 묶음) — 후보는 agy 가 묶고, 순위는 코드가 조회수·기사 수로 매긴다.
 * 근거: 기사 **본문**(요약은 평균 79자라 5분 해설의 근거가 못 된다 — 실측). 숫자는 본문에 있는 것만(코드 검사) +
 *   agy 검증 패스가 근거 없는 문장을 뺀다. 빼고 나서 짧으면 **올리지 않는다**(빈 영상 금지와 같은 뜻).
 * 연결: 올린 뒤 묶음 쇼츠의 '관련 동영상' 을 이 해설로 건다(쇼츠 → 롱폼).
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const W = await import('./weekly-explainer.mjs');

// [1] 기사 본문 — 매체마다 틀이 달라(<p>·<br>) 문단 경계로 자르고, 한글 문장만 남긴다
const html = `<html><head><script>var a="광고 스크립트 안의 긴 한국어 문장은 본문이 아니므로 버려야 한다다.";</script></head><body>
<nav>홈 정치 경제 사회 국제 메뉴 메뉴 메뉴 메뉴 메뉴 메뉴 메뉴 메뉴 메뉴 메뉴</nav>
<div id="articletxt">국회 국정감사에서 여&middot;야가 한 목소리로 정부 농지전수조사의 부작용을 성토했다.<br>
<br>송미령 농림축산식품부 장관은 &ldquo;현장 의견을 충분히 듣고 보완하겠다&rdquo;고 말했다.<br>짧은 줄</div>
<p>(서울=연합뉴스) 김기자 기자 = 춘천시의회는 8일 본회의에서 농지 전수조사 피해 예방대책 촉구 결의안을 채택했다.</p>
<footer>저작권자 ⓒ 연합뉴스 무단 전재 재배포 금지 AI 학습 및 활용 금지 합니다.</footer></body></html>`;
const lines = W.articleLines(html);
(lines.length === 3 && lines[0].startsWith('국회 국정감사에서 여·야가') && lines[1].includes('“현장 의견을 충분히 듣고 보완하겠다”')
  && !lines.some((l) => /광고 스크립트|메뉴|저작권자|짧은 줄/.test(l)) && !lines[2].includes('김기자 기자 ='))
  ? ok('[1] 본문 문단만(스크립트·메뉴·꼬리 저작권·짧은 줄 제외, 엔티티 풀기, 기자 서명 떼기)') : bad(`[1] ${JSON.stringify(lines)}`);

// [2] 매체 공통 문구(두 기사 이상에 같은 줄)는 본문이 아니다 — 한경 "구글 검색 선호 출처로 추가…" 실측
const docs = W.dropSharedLines([
  ['구글 검색 선호 출처로 추가 Google 검색에서 한국경제 기사를 더 자주 볼 수 있습니다.', '농지 가격이 급락했다는 지적이 나왔습니다.'],
  ['구글 검색 선호 출처로 추가 Google 검색에서 한국경제 기사를 더 자주 볼 수 있습니다.', '민주당은 특별법을 추진합니다.'],
]);
(docs[0].length === 1 && docs[1].length === 1 && docs[1][0].startsWith('민주당')) ? ok('[2] 두 기사 이상에 같은 줄은 버린다') : bad(`[2] ${JSON.stringify(docs)}`);

// [3] 주제 순위 — agy 가 묶은 후보를 코드가 검사·순위. 쇼츠 2편 미만·기사 부족·없는 id 는 탈락.
const shorts = [
  { video_id: 'a', views: 1100, headline: '농지 전수조사 상담센터 운영' },
  { video_id: 'b', views: 1000, headline: '농지 특조법 특례 2∼3년 설정' },
  { video_id: 'c', views: 1900, headline: '누리호 15기 싣고 우주로' },
  { video_id: 'd', views: 1200, headline: '지뢰폭발 北 군사도발' },
  { video_id: 'e', views: 1100, headline: '정동영 北지뢰 사고' },
];
const cands = [
  { name: '농지 전수조사', keywords: ['농지'], shortIds: ['a', 'b', 'zz'] },
  { name: '누리호 발사', keywords: ['누리호'], shortIds: ['c'] },
  { name: '北 지뢰 도발', keywords: ['지뢰'], shortIds: ['d', 'e'] },
  { name: '키워드가 쇼츠에 없음', keywords: ['반도체'], shortIds: ['a', 'b'] },
];
const arts = { 농지: 34, 누리호: 40, 지뢰: 6, 반도체: 80 };
const r = W.rankIssues(cands, shorts, (kw) => Math.max(...kw.map((k) => arts[k] ?? 0)), { minShorts: 2, minArticles: 12 });
(r.length === 1 && r[0].name === '농지 전수조사' && r[0].shortIds.join() === 'a,b' && r[0].views === 2100)
  ? ok('[3] 쇼츠 2편 이상 + 키워드가 그 쇼츠에 실제로 있음 + 기사 12건 이상만 — 없는 id 는 버린다') : bad(`[3] ${JSON.stringify(r)}`);
// [3b] 기사가 많아도 하루에 몰린 단발이면 탈락(minDays) — 쇼츠 1편짜리도 받는다(실측: 같은 이슈 2편이 드물다)
const r2 = W.rankIssues(cands, shorts, (kw) => ({ n: Math.max(...kw.map((k) => arts[k] ?? 0)), days: kw.includes('누리호') ? 1 : 5 }), { minShorts: 1, minArticles: 12, minDays: 3 });
(r2.map((x) => x.name).join() === '농지 전수조사' && r2[0].days === 5)
  ? ok('[3b] 하루에 몰린 이슈(누리호 1일)는 탈락 · 여러 날 이어진 이슈만') : bad(`[3b] ${JSON.stringify(r2)}`);

// [4] 숫자는 근거에 있는 것만 — 작은 셈수(두세 가지)는 단위가 없으면 통과
const src = '농지 6만2천307필지 기본조사, 5만2천544필지 심층조사. 부적정 160억원. 특례 2~3년. 지지율 37.4%.';
const ug = (t) => W.ungroundedNumbers(t, src);
(ug('부적정 사례는 160억원입니다.').length === 0 && ug('지지율은 37.4%입니다.').length === 0
  && ug('부적정 사례는 200억원입니다.').join() === '200억원' && ug('지지율은 41%입니다.').join() === '41%'
  && ug('쟁점은 3가지입니다.').length === 0 && ug('2026년 3월에 시작됐습니다.').join() === '2026년,3월')
  ? ok('[4] 근거에 없는 숫자(단위 포함)를 잡는다 · 단위 없는 작은 셈수는 통과') : bad(`[4] ${ug('부적정 사례는 200억원입니다.')} / ${ug('2026년 3월에 시작됐습니다.')}`);

// [4d] 기사는 "9천763억원·6만2천307필지" 로 쓰고 대본은 "9763억원·62307필지" 로 쓴다 — 같은 수다(10/12 run2 오탐)
(W.ungroundedNumbers('5년간 총 9763억원에 달했습니다.', '5년간 9천763억원이 미집행됐다').length === 0
  && W.ungroundedNumbers('62307필지를 조사했습니다.', '6만2천307필지에 대한 기본조사').length === 0
  && W.ungroundedNumbers('5년간 총 9764억원입니다.', '5년간 9천763억원').join() === '9764억원'
  && W.ungroundedNumbers('생산량은 3471만t입니다.', '생산량은 3천471만t으로').length === 0 && W.flattenKoNumbers('3천471만') === '34710000')
  ? ok('[4d] 한글 자릿수(천·만)를 섞어 쓴 수도 같은 수로 본다 · 다른 수는 여전히 잡는다') : bad(`[4d] ${W.ungroundedNumbers('5년간 총 9763억원에 달했습니다.', '5년간 9천763억원이 미집행됐다')}`);
// [6b] 썸네일 줄이 조사·접속사로 끝나면 안 된다("농지 전수조사 및" — run2) · 제목은 한쪽 주장을 채널 질문으로 쓰지 않는다
(!W.thumbLineOk('농지 전수조사 및') && !W.thumbLineOk('태양광 전환 논란을') && W.thumbLineOk('농지 전수조사') && W.thumbLineOk('투기만 처분'))
  ? ok('[6b] 썸네일 줄 끝 조사·접속사 거름') : bad('[6b]');

// [4b] 숫자를 한글로 쓰면 [4] 를 빠져나간다(10/12 첫 대본 "칠일 열린 국감" · "지난 오월") — 한글 날짜·셈수는 따로 잡는다
(W.hangulNumerals('칠일 열린 국정감사에서 충돌했습니다.').join() === '칠일' && W.hangulNumerals('지난 오월 국회를 통과했습니다.').join() === '오월'
  && W.hangulNumerals('이번 일은 오늘 처음 알려졌습니다.').length === 0 && W.hangulNumerals('삼십육만 명이 참여했습니다.').join() === '삼십육만')
  ? ok('[4b] 한글로 쓴 날짜·수(칠일·오월·삼십육만)를 잡는다 · "이번 일·오늘" 은 통과') : bad(`[4b] ${W.hangulNumerals('이번 일은 오늘 처음 알려졌습니다.')}`);
// [4c] 채널 목소리의 당위·기대는 해설이 아니라 의견이다(10/12 첫 대본 7장 전부) — 누가 했는지 밝힌 인용은 통과
(W.isEditorial('투기 농지는 엄단하되 기준과 절차가 조속히 마련되어야 합니다.') && W.isEditorial('든든한 디딤돌이 되기를 기대합니다.') && W.isEditorial('개정안의 논의 과정을 지켜봐야 합니다.')
  && !W.isEditorial('춘천시의회는 피해 예방 대책을 마련해야 한다고 촉구했습니다.') && !W.isEditorial('정부는 특별조치법을 이달 중 발의할 예정입니다.'))
  ? ok('[4c] 출처 없는 당위·기대 문장을 잡는다 · 주체가 밝힌 주장은 통과') : bad('[4c]');

// [5] 분량 — 4~6분(멜로 실측 6.7자/초). 짧으면 올리지 않는다.
const b = W.scriptBudget();
(b.min >= 1700 && b.max <= 2700 && b.target > b.min && b.target < b.max) ? ok(`[5] 분량 ${b.min}~${b.max}자(목표 ${b.target})`) : bad(`[5] ${JSON.stringify(b)}`);

// [6] 제목 — "{이슈 질문/핵심} | 이번 주 이슈 해설" 100자 안, 해시태그·꼬리표 없음
const t = W.explainerTitle({ headline: '농지 전수조사, 왜 여야 모두 반발하나', date: '2026-10-12' });
(t.length <= 100 && t.startsWith('농지 전수조사, 왜') && t.includes('이슈 해설') && !/#/.test(t)) ? ok(`[6] 제목 "${t}"`) : bad(`[6] ${t}`);

// [7] 배선 — 크론이 매일 총정리 대신 주 1회 해설을 돌린다. 쇼츠→해설 관련 동영상 연결.
const cron = readFileSync(new URL('../cron-runner.mjs', import.meta.url), 'utf8');
const mk = readFileSync(new URL('../video/make-weekly-explainer.mjs', import.meta.url), 'utf8');
(!/label:\s*'daily-roundup'/.test(cron.replace(/^\s*\/\/.*$/gm, '')) && /label:\s*'weekly-explainer'/.test(cron))
  ? ok('[7a] 크론: daily-roundup 내리고 weekly-explainer') : bad('[7a] 크론 배선');
(/yt-related-video\.mjs/.test(mk) && /--target/.test(mk) && /yt-pin-comment\.mjs/.test(mk))
  ? ok('[7b] 올린 뒤 묶음 쇼츠 관련 동영상 → 해설 · 홍보 댓글') : bad('[7b] 연결 배선');
(/ungroundedNumbers/.test(mk) && /verifySentences|검증/.test(mk) && /scriptBudget\(\)/.test(mk))
  ? ok('[7c] 숫자 검사·검증 패스·분량 미달이면 안 올림') : bad('[7c] 관문 배선');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

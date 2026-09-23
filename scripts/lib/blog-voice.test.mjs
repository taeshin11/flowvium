#!/usr/bin/env node
/**
 * blog-voice.test.mjs — 보고서 문장을 블로그 말투로 바꿀 때 **숫자가 변하지 않는가**.
 *
 * 2026-09-18 신설. 사용자: "좀 블로그 글 스럽게 / 열심히 분석 및 정리한 글처럼".
 *   말투를 바꾸려면 다시 쓰는 수밖에 없는데, 다시 쓰다가 지수·등락률이 바뀌면
 *   그 글은 못 쓰는 글이 된다. 그래서 고쳐 쓴 문장은 **원문에 없는 숫자를 담을 수 없다**.
 */
import { numbersIn, addedNumbers, toPolite, rewriteBlock, stripWrappingQuotes } from './blog-voice.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}`));

// [1] 숫자 추출 — 천단위 쉼표와 부호를 지우고 값으로 본다
eq(numbersIn('KOSPI 6,715 (-0.0%)'), ['6715', '0'], '[1] 쉼표·부호를 지우고 숫자만 뽑는다');

// [2] 같은 값의 다른 표기는 새 숫자가 아니다
eq(addedNumbers('원화 1380원 +2.392873302328341%', '환율이 1,380원까지 밀리며 2.39% 올랐습니다'), [],
  '[2] 쉼표 표기와 반올림은 새 숫자로 치지 않는다');

// [3] 지어낸 숫자는 잡는다
eq(addedNumbers('나스닥 26,418(+1.7%)', '나스닥이 27,000선을 넘었습니다'), ['27000'],
  '[3] 원문에 없는 숫자를 잡아낸다');

// [4] 문어체 종결을 존댓말로 — LLM 이 없을 때의 바닥
/니다\.$/.test(toPolite('나스닥 지수가 상승했다.')) ? ok('[4] 했다 → 했습니다') : bad(`[4] ${toPolite('나스닥 지수가 상승했다.')}`);
/니다\.$/.test(toPolite('자금이 채권으로 이동하는 중이다.')) ? ok('[4b] 이다 → 입니다') : bad(`[4b] ${toPolite('자금이 채권으로 이동하는 중이다.')}`);

// [5] 숫자를 더한 응답은 버리고 원문을 쓴다
const src5 = '나스닥 26,418(+1.7%) 상승했다.';
const r5 = await rewriteBlock(src5, { call: async () => '나스닥이 27,000까지 올랐습니다.' });
r5.used === 'fallback' && !r5.text.includes('27,000') ? ok('[5] 숫자를 더하면 고쳐쓴 문장을 버린다') : bad(`[5] ${JSON.stringify(r5)}`);

// [6] 깨끗하면 고쳐쓴 문장을 쓴다
const r6 = await rewriteBlock(src5, { call: async () => '나스닥은 26,418로 1.7% 올랐습니다.' });
r6.used === 'llm' && /습니다/.test(r6.text) ? ok('[6] 숫자가 그대로면 고쳐쓴 문장을 쓴다') : bad(`[6] ${JSON.stringify(r6)}`);

// [7] LLM 이 죽어 있어도 글은 나온다
const r7 = await rewriteBlock(src5, { call: async () => { throw new Error('ECONNREFUSED'); } });
r7.used === 'fallback' && r7.text.length > 0 ? ok('[7] LLM 이 없어도 글이 나온다') : bad(`[7] ${JSON.stringify(r7)}`);

// [8] 빈 응답도 원문으로 떨어진다
const r8 = await rewriteBlock(src5, { call: async () => '   ' });
r8.used === 'fallback' ? ok('[8] 빈 응답은 버린다') : bad(`[8] ${JSON.stringify(r8)}`);

// [9] 생각 모드를 끄고 요청하는가 — 안 끄면 content 가 비어 열 덩어리가 전부 원문으로 떨어진다
import { llmCaller } from './blog-voice.mjs';
let sent = null;
const fakeOk = async (_u, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '좋습니다.' } }] }) }; };
const got9 = await llmCaller('web', { fetchImpl: fakeOk })('시험');
sent?.chat_template_kwargs?.enable_thinking === false ? ok('[9] enable_thinking=false 로 보낸다') : bad(`[9] ${JSON.stringify(sent?.chat_template_kwargs)}`);
got9 === '좋습니다.' ? ok('[9b] content 를 읽는다') : bad(`[9b] ${got9}`);

// [10] 생각만 하고 끝난 응답(reasoning 만)은 본문으로 쓰지 않는다
const fakeThink = async () => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', reasoning: 'Thinking Process: ...' } }] }) });
const got10 = await llmCaller('web', { fetchImpl: fakeThink })('시험');
got10 === '' ? ok('[10] reasoning 만 오면 빈 값으로 본다') : bad(`[10] ${JSON.stringify(got10)}`);

// [11] 단위가 생략된 압축 표기는 고쳐쓰기에 넘기지 않는다 — 숫자는 맞는데 뜻이 틀린다
import { isCompressed, polishTypography } from './blog-voice.mjs';
[['경보 상승 구간(30) — EM Equities 1주 -4.03% 급락 · USD/KRW +2.39% 급변', true],
 ['S&P500 계절성(9월, 1990~ 144표본): 1개월 중앙값 +0.7%', true],
 ['시장 폭 취약: 동일가중(RSP)이 시총가중 대비 20일 -3%p 열위 — 소수 대형주 주도', false],
 ['LC 시스템·질량분석기 독점 해자로 경기 방어적 성장.', false],
 ['미국 고용지표(Nonfarm Payrolls) 발표 — 연준 금리 결정에 미치는 영향', false],
 ['렌탈 모델 기반 안정적 현금흐름. 높은 ROE와 글로벌 확장.', false],
 ['52주 신고가 모멘텀과 높은 ROE로 경기 방어적 성장이 기대됩니다.', false],
].forEach(([src, want]) => isCompressed(src) === want
  ? ok(`[11] 압축표기 판정 ${want} — ${src.slice(0, 22)}…`)
  : bad(`[11] 압축표기 판정이 ${!want} 로 나왔다 — ${src.slice(0, 40)}`));

// [12] 숫자와 단위를 붙이고 괄호 앞뒤를 우리말 표기로 되돌린다
polishTypography('원화 약세 (1380 원) 로 인해') === '원화 약세(1380원)로 인해'
  ? ok('[12] 1380 원 → 1380원, 괄호 앞뒤 공백 제거') : bad(`[12] ${polishTypography('원화 약세 (1380 원) 로 인해')}`);
polishTypography('채권 (109억달러) 과 해외 주식') === '채권(109억달러)과 해외 주식'
  ? ok('[12b] 괄호 뒤 조사를 붙인다') : bad(`[12b] ${polishTypography('채권 (109억달러) 과 해외 주식')}`);
polishTypography('작년 (2025년) 그리고 올해') === '작년(2025년) 그리고 올해'
  ? ok('[12c] 조사가 아니면 붙이지 않는다') : bad(`[12c] ${polishTypography('작년 (2025년) 그리고 올해')}`);

// [13] 같은 숫자가 다른 단위를 달고 오면 버린다 — 숫자만 보는 관문은 이걸 못 잡는다
import { changedUnits } from './blog-voice.mjs';
JSON.stringify(changedUnits('동일가중(RSP)이 시총가중 대비 20일 -3%p 열위', '시총가중 대비 20%p 낮아진')) === '["20%p"]'
  ? ok('[13] 20일 → 20%p 를 잡는다') : bad(`[13] ${JSON.stringify(changedUnits('동일가중(RSP)이 시총가중 대비 20일 -3%p 열위', '시총가중 대비 20%p 낮아진'))}`);
changedUnits('나스닥 26,418(+1.7%) 상승', '나스닥은 26,418로 1.7% 올랐습니다').length === 0
  ? ok('[13b] 단위가 그대로면 통과시킨다') : bad('[13b] 멀쩡한 문장을 막았다');
changedUnits('채권(109억달러) 유입', '채권(109억 달러)이 들어왔습니다').length === 0
  ? ok('[13c] 단위 앞 띄어쓰기는 같은 단위로 본다') : bad('[13c] 띄어쓰기를 다른 단위로 봤다');
polishTypography('KOSPI 가 보합세, ROE 를 바탕으로, ETF 도입 논의') === 'KOSPI가 보합세, ROE를 바탕으로, ETF 도입 논의'
  ? ok('[13d] 영문 약어 뒤 조사를 붙이되 낱말은 건드리지 않는다') : bad(`[13d] ${polishTypography('KOSPI 가 보합세, ROE 를 바탕으로, ETF 도입 논의')}`);

// [14] 원문에 없는 한자·가나가 섞이면 버린다 — 2026-09-18 실측: 4B 가 "한국两地 모두" 를 냈고
//      그 글이 실제로 블로그에 올라갔다. 숫자·단위 관문은 이걸 못 잡는다.
import { addedForeignChars } from './blog-voice.mjs';
JSON.stringify(addedForeignChars('오늘 시장은 미국과 한국 모두 올랐다', '미국과 한국两地 모두 올랐습니다')) === '["两","地"]'
  ? ok('[14] 원문에 없는 한자를 잡는다') : bad(`[14] ${JSON.stringify(addedForeignChars('오늘 시장은 미국과 한국 모두 올랐다', '미국과 한국两地 모두 올랐습니다'))}`);
addedForeignChars('美 연준이 금리를 올렸다', '美 연준이 금리를 올렸습니다').length === 0
  ? ok('[14b] 원문에 있던 한자는 통과시킨다') : bad('[14b] 원문 한자를 막았다');
addedForeignChars('나스닥이 올랐다', 'S&P500 지수가 올랐습니다').length === 0
  ? ok('[14c] 라틴 문자는 외국문자로 보지 않는다') : bad('[14c] 영문을 막았다');

// [15] 고쳐 쓴 문장이 문어체로 돌아오면 존댓말로 마무리한다
const r15 = await rewriteBlock('시장은 상승했다.', { call: async () => '시장은 상승 흐름을 이어갔다.' });
/니다\.?$/.test(r15.text.trim()) ? ok('[15] 문어체로 와도 존댓말로 마무리된다') : bad(`[15] ${r15.text}`);

// [16] 과거형은 목록이 아니라 규칙으로 — 받침 ㅆ + 다
[['각기 달랐다.', '달랐습니다'], ['빨랐다.', '빨랐습니다'], ['몰랐다.', '몰랐습니다'],
 ['흐름을 이어갔다.', '이어갔습니다'], ['상승했다.', '상승했습니다'],
].forEach(([src, want]) => toPolite(src).includes(want)
  ? ok(`[16] ${src.trim()} → ${want}`) : bad(`[16] ${src} → ${toPolite(src)}`));
toPolite('오늘은 좋다.').includes('좋다') ? ok('[16b] 받침이 ㅆ 이 아니면 건드리지 않는다') : bad(`[16b] ${toPolite('오늘은 좋다.')}`);

// [17] 참고 사실을 프롬프트에 실어 준다 — 훅은 조사가 없어 주어가 모호할 때가 있다.
//   실측(2026-09-19): "덴마크 헬기, 러시아 군함 조명탄 발사" 를 4B 는 덴마크가 쏜 것으로,
//   agy 는 러시아가 쏜 것으로 읽었다. 기사 제목("덴마크 헬기에 조명탄 발사한 러 군함")을
//   못 봤으니 둘 다 추측이었다. 본 것을 근거로 쓰게 한다.
{
  let seen = '';
  await rewriteBlock('덴마크 헬기, 러시아 군함 조명탄 발사', {
    context: ['덴마크 헬기에 조명탄 발사한 러 군함'],
    call: async (p) => { seen = p; return '러시아 군함이 덴마크 헬기를 향해 조명탄을 발사했습니다.'; },
  });
  seen.includes('덴마크 헬기에 조명탄 발사한 러 군함')
    ? ok('[17] 참고 사실이 프롬프트에 들어간다') : bad(`[17] 프롬프트에 없음: ${seen.slice(0, 120)}`);
  /참고는 사실을 확인하라고 주는 것/.test(seen)
    ? ok('[17b] 참고를 본문에 옮기지 말라고 못박는다') : bad('[17b] 참고 남용을 막는 말이 없다');
}

// [17c] 참고가 없으면 프롬프트 모양이 예전과 같다 — 있는 글을 건드리지 않는다
{
  let seen = '';
  await rewriteBlock('시장은 상승했다.', { call: async (p) => { seen = p; return '시장은 올랐습니다.'; } });
  !/참고/.test(seen) ? ok('[17c] 참고 없으면 그 문단도 없다') : bad('[17c] 빈 참고 문단이 붙었다');
}

// [17d] 참고에 있는 숫자를 본문으로 끌어오면 원문으로 떨어뜨린다 — 참고는 사실 확인용이지 재료가 아니다
{
  const r = await rewriteBlock('코스피가 올랐다', {
    context: ['코스피 2650 마감'],
    call: async () => '코스피가 2650 으로 올랐습니다',
  });
  r.used === 'fallback' && /added-numbers/.test(r.why ?? '')
    ? ok(`[17d] 참고 숫자 유입 차단 (${r.why})`) : bad(`[17d] ${r.used} ${r.why}`);
}

// ── 2026-09-23: 발행 직전에 잡은 사고 ────────────────────────────────────────
// 실제로 reports/blog/2026-09-23-shorts-1242.md 에 이렇게 찍혔다:
//     ## 1조700억 수주, 어디
//     작업을 완료했습니다. 추가로 도움이 필요하시면 말씀해 주세요.
// 모델이 글을 고치는 대신 **챗봇 인사말**을 돌려줬는데 관문이 전부 통과시켰다.
//   길이 33/64 = 0.53 → minRatio(0.45) 위. 숫자·단위·외국문자는 애초에 없으니 안 걸린다.
//   숫자로만 재는 관문은 "내용이 없다" 를 못 본다.
// 실측 2-gram 겹침: 이 덩어리 0.000 / 같은 판의 정상 6덩어리 0.787~0.983.

// [18] 원문 내용이 하나도 안 남으면 버린다
{
  const r = await rewriteBlock(
    'DS투자증권은 포스코퓨처엠[003670]이 리튬인산철(LFP) 양극재와 관련한 첫 공식 수주공시를 냈다며',
    { call: async () => '작업을 완료했습니다. 추가로 도움이 필요하시면 말씀해 주세요.' });
  r.used === 'fallback' && /no-content/.test(r.why ?? '')
    ? ok(`[18] 내용 없는 답을 버린다 (${r.why})`) : bad(`[18] ${r.used} ${r.why}`);
}

// [18b] 원문에 '습니다' 가 있어 보일러플레이트와 어미가 겹쳐도 잡는다 —
//       0.000 이 우연이 아니어야 한다
{
  const r = await rewriteBlock('코스피가 2% 올라 2650 에 마감했습니다. 외국인이 순매수했습니다.',
    { call: async () => '요청하신 작업을 마쳤습니다. 더 필요하시면 말씀해 주세요.' });
  r.used === 'fallback' && /no-content/.test(r.why ?? '')
    ? ok(`[18b] 어미가 겹쳐도 잡는다 (${r.why})`) : bad(`[18b] ${r.used} ${r.why}`);
}

// [18c] ★ 정상 고쳐쓰기는 통과해야 한다. 같은 판에서 실제로 발행된 문장이다(겹침 0.882).
//       관문을 세게 잡으면 멀쩡한 글까지 원문으로 떨어져 말투 개선이 통째로 죽는다.
{
  const r = await rewriteBlock(
    'LG전자[066570]의 핵심 냉각 솔루션이 엔비디아 규격 승인을 받았다. 이 솔루션은 AI 데이터센터(DC)의 열을 안정적으로 관리한다.',
    { call: async () => 'LG전자[066570]의 핵심 냉각 솔루션이 엔비디아 규격 승인을 받았습니다. 이 솔루션은 AI 데이터센터(DC)의 열을 안정적으로 관리합니다.' });
  r.used === 'llm' ? ok('[18c] 정상 고쳐쓰기는 통과') : bad(`[18c] 멀쩡한 글을 버렸다 — ${r.why}`);
}

// [19] 제목 따옴표 — **양끝이 다 따옴표일 때만** 벗긴다.
//   실제로 발행된 제목: `DS증권 "포스코퓨처엠, LFP 첫 공식수주…추가수주 기대 유효 외 6건 — …`
//   DB 원문에는 닫는 따옴표가 있었는데 `/^["“]|["”]$/g` 가 **끝쪽만** 지워서 여는 따옴표가 혼자 남았다.
//   따옴표로 감싼 제목을 벗기려던 규칙이, 인용이 들어간 제목을 망가뜨린 것이다.
{
  const cases = [
    ['DS증권 "포스코퓨처엠, LFP 첫 공식수주…추가수주 기대 유효"', 'DS증권 "포스코퓨처엠, LFP 첫 공식수주…추가수주 기대 유효"', '안쪽 인용은 그대로'],
    ['ADB, 韓 성장률 상향…"반도체 수출 증가"', 'ADB, 韓 성장률 상향…"반도체 수출 증가"', '끝의 인용 부호 보존'],
    ['"전체가 따옴표로 감싸인 제목"', '전체가 따옴표로 감싸인 제목', '감싼 것만 벗긴다'],
    ['“곡선 따옴표로 감싼 제목”', '곡선 따옴표로 감싼 제목', '곡선 따옴표도'],
    ['따옴표 없는 제목', '따옴표 없는 제목', '없으면 그대로'],
  ];
  let bad0 = 0;
  for (const [inp, want, note] of cases) {
    const got = stripWrappingQuotes(inp);
    if (got !== want) { bad0++; console.log(`  FAIL  [19] ${note}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
  }
  bad0 ? (fail += 0) : ok('[19] 감싼 따옴표만 벗긴다 (5종)');
  if (bad0) fail++;
}

// [20] RSS 가 잘린 본문은 `…이다....` 로 끝난다(마침표 넷). 실제 발행본에 그대로 나갔다.
{
  const cases = [
    ['민간소비의 완만한 회복 등도 반영했다는 설명입니다....', '민간소비의 완만한 회복 등도 반영했다는 설명입니다…'],
    ['본문이 여기서 잘렸습니다...', '본문이 여기서 잘렸습니다…'],
    ['정상 문장입니다.', '정상 문장입니다.'],
    ['말줄임표는 그대로…', '말줄임표는 그대로…'],
  ];
  let bad0 = 0;
  for (const [inp, want] of cases) {
    const got = polishTypography(inp);
    if (got !== want) { bad0++; console.log(`  FAIL  [20] ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
  }
  bad0 ? fail++ : ok('[20] 점 네 개를 말줄임표 하나로 (4종)');
}

console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ blog-voice 통과');
process.exit(fail ? 1 : 0);

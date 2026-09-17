#!/usr/bin/env node
/**
 * blog-voice.test.mjs — 보고서 문장을 블로그 말투로 바꿀 때 **숫자가 변하지 않는가**.
 *
 * 2026-09-18 신설. 사용자: "좀 블로그 글 스럽게 / 열심히 분석 및 정리한 글처럼".
 *   말투를 바꾸려면 다시 쓰는 수밖에 없는데, 다시 쓰다가 지수·등락률이 바뀌면
 *   그 글은 못 쓰는 글이 된다. 그래서 고쳐 쓴 문장은 **원문에 없는 숫자를 담을 수 없다**.
 */
import { numbersIn, addedNumbers, toPolite, rewriteBlock } from './blog-voice.mjs';
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

console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ blog-voice 통과');
process.exit(fail ? 1 : 0);

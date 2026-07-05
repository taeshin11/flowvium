// scripts/lib/chat-verify.mjs — 챗 답변 결함 검출·교정 단일 소스 (2026-07-05)
//
// 2026-07-05 사용자 "채팅에서 답변에 나쁜 답변 없는지 검증체계 만들어" — 종전엔 checkChatDefects/
// sanitizeAnswer/DEFECT_LESSON 이 src/app/api/judge-chat/route.ts 안에 갇혀 있어 오프라인 재검증
// (저장대화 소급 스캔·self-test 회귀가드)이 불가능했다. narrative-fix.mjs(sanitizeText)·buy-sell-engine
// 과 같은 "scripts/lib 단일 소스 + route 는 import" 패턴으로 추출.
//
// 소비처: ① /api/judge-chat (답변 반환 전 sanitize + 답변시점 검증로그) ② scripts/verify-chat-answers.mjs
//        (self-test + 저장대화 전수 재검증) ③ analyze-chat-logs.mjs (검증로그 통계는 별도).
import { sanitizeText } from './narrative-fix.mjs';

// 답변 자동검증 — 질문+답변을 grounding 에 대조해 결함 탐지(2026-06-18 사용자 "질문로그·답변로그 함께 검증").
// 결정론 체크(환각/누출/근거이탈/언어·완결성). locale: hanja/영어답변 검사의 정당성 판단(ja/zh 는 한자 정당).
export function checkChatDefects(question, answer, grounding, locale = 'ko') {
  const d = [];
  const a = answer || '';
  const hasEngineData = (grounding?.tickers ?? []).some(t => t.price != null);
  // 0) verdict_mismatch (P0-2): LLM 결론이 결정론 심판과 *반대 방향*이면 검출(폐루프 학습·교정 트리거).
  //   강세론/약세론 양립 서술은 허용 — 명확한 *결론* 지시문이 반대일 때만(보수적).
  const ex = grounding?.expectedAction;
  if (ex) {
    const expDir = (ex.verdict === 'buy' || ex.verdict === 'accumulate') ? 1 : (ex.verdict === 'reduce' || ex.verdict === 'sell' || ex.verdict === 'avoid') ? -1 : 0;
    const bearish = /매도\s*(?:권고|하라|하세요|추천)|팔아|전량\s*매도|비중\s*축소|회피\s*(?:권고|하|추천)|손절\s*권고/.test(a);
    const bullish = /매수\s*(?:권고|하라|하세요|추천)|사세요|사라|분할\s*매수|보유\s*(?:권고|유지)|홀드|추가\s*매수/.test(a);
    const ansDir = (bullish && !bearish) ? 1 : (bearish && !bullish) ? -1 : 0;
    if (expDir !== 0 && ansDir !== 0 && expDir !== ansDir) {
      d.push({ type: 'verdict_mismatch', detail: `심판=${ex.action}(net ${ex.net}) vs 답변결론=${ansDir > 0 ? '매수성' : '매도성'}` });
    }
  }
  // 1) 룰 ID·점수태그 누출 (price_momentum_52w_high, (+5) 등)
  if (/\(\+\d+\)/.test(a)) d.push({ type: 'score_tag_leak', detail: (a.match(/\(\+\d+\)/) ?? [''])[0] });
  // 2026-07-05 self-test 가 잡은 잠재버그 fix: 종전 /[a-z]+_[a-z]+_[a-z0-9]+\b/ 는 정확히 3세그먼트만 매칭 —
  //   \b 가 '_' 앞에서 불성립이라 4세그먼트(price_momentum_52w_high)는 통째로 미검출. 3+세그먼트로 교정.
  if (/\b[a-z]+(?:_[a-z0-9]+){2,}\b/.test(a)) d.push({ type: 'rule_id_leak', detail: (a.match(/\b[a-z]+(?:_[a-z0-9]+){2,}\b/) ?? [''])[0] });
  // 1b) 엔진 블록 통째 복사 — "[이름 (티커)] 매수엔진 총점 N점 (발화:" 또는 "· 룰 종합:" 날것 포맷 노출
  if (/\[[^\]]*\([0-9A-Z.]{1,10}\)\]\s*매수엔진/.test(a) || /\(발화\s*:/.test(a) || /·\s*룰\s*종합\s*:/.test(a)) d.push({ type: 'engine_line_verbatim', detail: '엔진 블록 원문 복사' });
  // 2) 종목 데이터 없는데 엔진 점수 날조 (하우맷 사건)
  if (!hasEngineData && /(매수|매도)\s*엔진\s*(총점|점수)?\s*\d+\s*점/.test(a)) d.push({ type: 'engine_score_no_data' });
  // 3) 변동폭 과장 — N%(<3) 급락/급등
  for (const m of Array.from(a.matchAll(/([\d.]+)\s*%\s*(급락|급등|폭락|폭등)/g))) if (Math.abs(Number(m[1])) < 3) d.push({ type: 'magnitude_overstate', detail: m[0] });
  // 4) 가짜 배수 (이익의 질 938배 류)
  for (const m of Array.from(a.matchAll(/순이익의\s*([\d,]+)\s*배/g))) if (Number(m[1].replace(/,/g, '')) >= 10) d.push({ type: 'fake_multiple', detail: m[0] });
  // 5) stale 연도 환각 — 과거 연도(올해-2 이하)를 "기준/최신/현재"라 칭함 (2026인데 "2024년 기준" 사건)
  //   단, grounding 의 실제 회계연도(fiscalYear)와 일치하면 정당(FY2024 가 최신 연차공시일 수 있음 — ChatGPT #14).
  const curYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 4));
  const allowedYears = new Set((grounding?.tickers ?? []).map(t => (t.fiscalYear ?? '').replace(/\D/g, '').slice(0, 4)).filter(Boolean));
  for (const m of Array.from(a.matchAll(/20(\d\d)\s*년[^.\n]{0,14}(기준|최신|현재)/g))) {
    const yr = '20' + m[1];
    if (Number(yr) <= curYear - 2 && !allowedYears.has(yr)) { d.push({ type: 'stale_year', detail: m[0].slice(0, 24) }); break; }
  }
  // 6) 진입가 현재가 괴리 — 단일 종목 답변에서 진입가가 현재가 ±15% 밖이면 환각 의심
  const priced = (grounding?.tickers ?? []).filter(t => t.price != null);
  if (priced.length === 1 && priced[0].price) {
    const P = priced[0].price;
    const em = a.match(/진입가?[^\d]{0,8}([\d,]+(?:\.\d+)?)\s*[~\-–]\s*([\d,]+(?:\.\d+)?)/);
    if (em) {
      const mid = (Number(em[1].replace(/,/g, '')) + Number(em[2].replace(/,/g, ''))) / 2;
      if (mid > 0 && Math.abs(mid / P - 1) > 0.15) d.push({ type: 'entry_far_from_price', detail: `진입중앙 ${Math.round(mid)} vs 현재 ${Math.round(P)} (${Math.round((mid / P - 1) * 100)}%)` });
    }
  }
  // ── 이하 2026-07-05 신설 검출 (사용자 "나쁜 답변 검증체계") ──────────────────────────
  // 7) hanja_leak — 한자 제로톨러런스(2026-07-01 "한자 나오면 안되"). ja/zh locale 또는 가나 포함(일본어
  //   콘텐츠)이면 한자=정당이라 스킵. sanitizeAnswer 가 반환 전 교정하므로 이 검출은 원문 기준 폐루프 학습용.
  if (!/^(ja|zh)/.test(String(locale)) && !/[\u3040-\u30FF]/.test(a)) {
    const han = a.match(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/);
    if (han) {
      const i = a.indexOf(han[0]);
      d.push({ type: 'hanja_leak', detail: a.slice(Math.max(0, i - 6), i + 8) });
    }
  }
  // 8) price_mismatch — 답변의 "현재가 X"가 grounding 실가와 3%+ 괴리(가격 환각). 단일 종목일 때만(보수적).
  if (priced.length === 1 && priced[0].price) {
    const P = priced[0].price;
    for (const m of Array.from(a.matchAll(/현재\s*(?:주?가|가격)[^\d\n%]{0,10}([\d,]+(?:\.\d+)?)/g))) {
      const v = Number(m[1].replace(/,/g, ''));
      if (v > 0 && Math.abs(v / P - 1) > 0.03) { d.push({ type: 'price_mismatch', detail: `답변 ${v} vs 실가 ${P}` }); break; }
    }
  }
  // 9) english_answer — ko 질문에 영어 답변(base 모델이 언어 지시 무시). 한글이 문자 중 10% 미만이면 검출.
  if (String(locale) === 'ko' && a.length >= 80) {
    const hangul = (a.match(/[가-힣]/g) ?? []).length;
    const latin = (a.match(/[A-Za-z]/g) ?? []).length;
    if (latin > 50 && hangul < (hangul + latin) * 0.1) d.push({ type: 'english_answer', detail: `한글 ${hangul} vs 라틴 ${latin}` });
  }
  // 10) truncated_answer — 토큰한도/스트림 절단으로 문장 미완결. 리스트/표/헤더 라인 끝은 정당 종결로 간주.
  const tail = a.trimEnd();
  if (tail.length >= 150) {
    const lastLine = tail.slice(tail.lastIndexOf('\n') + 1).trim();
    const listLike = /^([-•*|>#]|\d+[.)])/.test(lastLine);
    const sentenceEnd = /[.!?…%)』」"'`]$/.test(tail) || /(다|요|죠|함|음|됨|임|까|네|세요|시오)$/.test(tail);
    if (!listLike && !sentenceEnd) d.push({ type: 'truncated_answer', detail: `…${tail.slice(-24)}` });
  }
  // 11) repetition_loop — 같은 문장(12자+) 3회+ (소형모델 degenerate 반복).
  {
    const sents = a.split(/\n|(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 12);
    const cnt = {};
    for (const s of sents) {
      cnt[s] = (cnt[s] ?? 0) + 1;
      if (cnt[s] === 3) { d.push({ type: 'repetition_loop', detail: s.slice(0, 30) }); break; }
    }
  }
  // 12) non_answer — 실질 무응답(15자 미만) 또는 LLM 전멸 fallback 문구가 답변으로 저장된 경우.
  //   (LLM 행동 교훈 대상이 아니라 인프라 신호 — DEFECT_LESSON 미매핑, analyze/배치감사가 소비.)
  if (tail.length < 15) d.push({ type: 'non_answer', detail: tail });
  else if (tail.length < 80 && /(심판엔진이 응답할 수 없|문제가 발생했습니다|다시 시도해 주세요)/.test(tail)) d.push({ type: 'non_answer', detail: 'llm_unavailable 문구' });
  return d;
}

// 결정론 sanitize — 검출된 결함을 *답변 반환 전* 자동 제거(2026-06-18 사용자 "검증해서 고칠게 있으면 고쳐라·시스템화").
//   base 모델이 프롬프트를 무시해도 사용자는 정상 답변만 보게. checkChatDefects 와 같은 결함류를 기계적으로 교정.
export function sanitizeAnswer(text, grounding, locale = 'ko') {
  let a = text || '';
  // 문자열 corrector(2026-07-02 리포트와 단일 소스화): 한자 매핑+스트립(ja/zh 는 한자=정당 콘텐츠라 내부 skip —
  //   종전 인라인 무조건 스트립은 ja/zh 답변의 한자를 파괴) + garble 매핑(금융크로스→골든크로스·콘탱고변종 등).
  a = sanitizeText(a, locale);
  const hasData = (grounding?.tickers ?? []).some(t => t.price != null);
  // stale_year corrector(2026-06-19 ChatGPT #14, dead-end 해소): 과거 연도를 "기준/최신/현재"로 표기하되 그게
  //   실제 회계연도(fiscalYear)도 아니고 역사적 맥락 단어(당시/과거/전년 등)도 없으면 → "최근 공개자료 기준"으로.
  {
    const curY = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 4));
    const allowed = new Set((grounding?.tickers ?? []).map(t => (t.fiscalYear ?? '').replace(/\D/g, '').slice(0, 4)).filter(Boolean));
    a = a.replace(/20(\d\d)\s*년\s*(기준|최신|현재)/g, (m, yy, kw, off, str) => {
      const yr = '20' + yy;
      if (Number(yr) > curY - 2 || allowed.has(yr)) return m;            // 최근연도/실 회계연도면 정상
      if (/당시|과거|전년|대비|이후|이전|비교|말|초/.test(str.slice(Math.max(0, off - 12), off))) return m; // 역사적 맥락이면 정상
      return '최근 공개자료 기준';
    });
  }
  a = a.replace(/\s*\(\+\d+\)/g, '');                                   // (+5) 점수태그 제거
  // rule_id_leak corrector(2026-06-19 ChatGPT: detector-without-corrector dead-end 해소) — 누출된 snake_case
  //   룰ID(price_momentum_52w_high 등) 제거 + 잔여 괄호/공백 정리. 한글 금융문에 snake_case 영문은 사실상 룰ID뿐.
  //   (2026-07-05: 검출기와 동일하게 3+세그먼트 — 종전 3세그먼트 고정은 4세그먼트 룰ID 미교정.)
  a = a.replace(/\(?\s*\b[a-z]+(?:_[a-z0-9]+){2,}\b\s*\)?/g, '');
  a = a.replace(/^\s*[-•]?\s*\[[^\]]*\([0-9A-Z.]{1,10}\)\]\s*매수엔진[^\n]*\n?/gm, ''); // 엔진 원문라인 제거
  a = a.replace(/([\d.]+)\s*%\s*(급락|폭락)/g, (m, n) => Math.abs(Number(n)) < 3 ? `${n}% 하락` : m); // <3% 급락→하락
  a = a.replace(/([\d.]+)\s*%\s*(급등|폭등)/g, (m, n) => Math.abs(Number(n)) < 3 ? `${n}% 상승` : m);
  if (!hasData) {  // 종목별 엔진 미실행(추천목록·미특정)인데 엔진점수 날조 시 제거
    a = a.replace(/[→·\-\s]*\*{0,2}매수엔진\s*(?:점수|총점)?\s*\d+\s*점\*{0,2}\s*[,·/]?\s*\*{0,2}매도엔진\s*(?:점수|총점)?\s*\d+\s*점\*{0,2}\s*[.→]?/g, '');
    a = a.replace(/\*{0,2}(?:매수|매도)\s*엔진\s*(?:점수|총점)?\s*\d+\s*점\*{0,2}/g, '');
  }
  // repetition_loop corrector(2026-07-05) — *연속* 동일 라인 3회+ 는 1회로 축약(비연속 반복은 문맥일 수 있어 보존).
  a = a.replace(/(^|\n)([^\n]{12,})(\n\2){2,}(?=\n|$)/g, '$1$2');
  return a.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── 챗 학습 폐루프(2026-06-18): 검증로그(flowvium:judge-chat:verify) 의 최근 반복 결함 → 다음 프롬프트 anti-pattern.
//   리포트의 hallucination_history→프롬프트 루프를 챗에 복제. *검증로그가 소비처 없는 dead-end* 였던 사각지대 해소.
//   결함유형→교훈 매핑. 최근 N건 중 실제로 발생한 상위 유형만 surface(프롬프트 비대화 방지).
export const DEFECT_LESSON = {
  // 2026-07-02: verdict_mismatch 는 검출만 되고 교훈 매핑이 없어 폐루프에 안 실리던 갭(detector-without-corrector).
  verdict_mismatch: '결론을 "🔨심판=" 결정론 값과 반대로 내지 마라 — 심판 결과(매수/분할매수/관망/비중축소/매도)를 그대로 제시하고 근거만 설명하라.',
  score_tag_leak: '룰 점수 태그 "(+5)" 류를 답변에 그대로 노출하지 마라 — 우리말 문장으로 풀어 써라.',
  rule_id_leak: '영문 룰 ID(snake_case, 예: price_momentum_52w_high)를 출력하지 마라 — 의미를 우리말로 풀어라.',
  engine_line_verbatim: '"엔진 판정" 블록의 대괄호·"(발화:..)"·"룰 종합:" 줄을 그대로 복사하지 마라.',
  engine_score_no_data: '종목 데이터가 없을 때(추천목록·미특정) "매수엔진 N점/매도엔진 M점" 을 절대 지어내지 마라.',
  magnitude_overstate: '3% 미만 변동에 "급락/급등/폭락/폭등" 을 쓰지 마라 — "소폭 하락/상승" 으로.',
  fake_multiple: '"순이익의 N배" 같은 과장 배수를 만들지 마라 — 라벨에 있는 수치만 인용.',
  stale_year: '"2024년 기준" 처럼 과거 연도를 최신이라 하지 마라 — 오늘 기준 "최근 분기/연간" 으로.',
  entry_far_from_price: '진입가는 반드시 현재가 ±10% 이내로 — 현재가와 동떨어진 진입가 금지.',
  // 2026-07-05 신설 유형 교훈
  hanja_leak: '한자를 한 글자도 쓰지 마라 — 반드시 한글로, 마땅한 한글이 없으면 영어로.',
  price_mismatch: '현재가는 라벨에 제공된 실시간 가격을 그대로 인용하라 — 다른 숫자를 지어내지 마라.',
  english_answer: '답변은 반드시 질문과 같은 언어(한국어 질문이면 한국어)로 작성하라.',
  truncated_answer: '문장을 결론까지 완결하라 — 핵심부터 쓰고 길이 안에서 끝맺어라.',
  repetition_loop: '같은 문장을 반복하지 마라 — 새로운 내용이 없으면 답변을 끝내라.',
};

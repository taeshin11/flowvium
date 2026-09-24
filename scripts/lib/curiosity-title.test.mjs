#!/usr/bin/env node
/**
 * curiosity-title.test.mjs — 궁금증형 제목이 **선을 넘지 않는가.** 2026-09-24 신설.
 *
 * 사장님 "이 장르의 상위 채널들은 어떻게 하는지 레퍼런스 체크해서 다음 편부터 반영".
 * 실측(유튜브 API 13 units): 구독 3만대 쇼츠 뉴스 채널 '짧주' 조회 중앙 377,644 · '짧뉴' 550,220.
 *   상위 제목은 헤드라인이 아니라 궁금증을 남기는 문장이다 —
 *   "결국 밝혀졌다는 상어가 바다로 돌아가지 않는 이유" · "돈 빌려간 학생의 충격반전".
 *   우리 제목은 통신사 문체 그대로다(`…정부, 사실상 확인(종합2보)`).
 *
 * 이 파일의 오랜 원칙 "제목은 헤드라인 그대로 — 지어내지 않는다" 는 **거짓 사실을 막으려는** 것이다.
 *   다시 쓰되 그 목적은 지킨다: 원문에 없는 숫자를 못 넣고, 원문과 동떨어지면 안 되고, 과정 보고는 버린다.
 *   하나라도 어기면 **헤드라인 제목으로 돌아간다** — 제목이 없는 것보다, 선 넘은 제목보다 낫다.
 */
import { makeCuriosityTitle, titleStyleFor, chooseShortsTitle } from './curiosity-title.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const H = '젤렌스키 "북한군 포로 2명, 韓 보내"…정부, 사실상 확인(종합2보)';
const CTX = ['젤렌스키 대통령이 북한군 포로 2명을 한국으로 보내겠다고 밝혔고, 정부가 이를 사실상 확인했습니다.'];
const mk = (t) => async () => JSON.stringify({ title: t });

// [1] 정상 — 원문 사실만으로 궁금증형
{
  const t = await makeCuriosityTitle(H, { context: CTX, call: mk('북한군 포로가 결국 한국으로 오게 된 이유') });
  t === '북한군 포로가 결국 한국으로 오게 된 이유' ? ok(`[1] 통과: ${t}`) : bad(`[1] ${t}`);
}
// [2] ★ 원문에 없는 숫자는 못 넣는다 — 지어낸 사실이다
{
  const t = await makeCuriosityTitle(H, { context: CTX, call: mk('북한군 포로 5명이 한국에 오는 이유') });
  t === null ? ok('[2] 없는 숫자(5명) → 버린다') : bad(`[2] ${t}`);
}
// [3] 길이 초과는 버린다 — 쇼츠 피드는 한두 줄만 보인다
{
  const t = await makeCuriosityTitle(H, { context: CTX, maxLen: 20, call: mk('북한군 포로가 결국 한국으로 오게 된 진짜 이유와 정부의 속내') });
  t === null ? ok('[3] 38자 초과 → 버린다') : bad(`[3] ${t}`);
}
// [4] 원문과 동떨어지면 버린다 — 낚시다
{
  const t = await makeCuriosityTitle(H, { context: CTX, call: mk('아무도 몰랐던 충격적인 진실의 정체') });
  t === null ? ok('[4] 원문과 무관 → 버린다') : bad(`[4] ${t}`);
}
// [5] 작업 보고·실패는 null — 헤드라인 제목으로 돌아간다
{
  (await makeCuriosityTitle(H, { context: CTX, call: mk('요청하신 제목을 생성했습니다') })) === null
  && (await makeCuriosityTitle(H, { context: CTX, call: async () => null })) === null
    ? ok('[5] 작업 보고·빈 응답 → null') : bad('[5]');
}
// [6] 해시태그·따옴표는 걷어낸다(#Shorts 는 발행부가 붙인다)
{
  const t = await makeCuriosityTitle(H, { context: CTX, call: mk('"북한군 포로가 한국으로 오는 이유" #뉴스') });
  t === '북한군 포로가 한국으로 오는 이유' ? ok('[6] 따옴표·해시태그 제거') : bad(`[6] ${JSON.stringify(t)}`);
}
// [7] 번갈아 쓴다 — 같은 날 두 방식이 나란히 있어야 날짜 효과에 속지 않고 비교된다
{
  titleStyleFor(10) !== titleStyleFor(11) && titleStyleFor(10) === titleStyleFor(12)
    ? ok(`[7] 편마다 번갈아: ${titleStyleFor(10)} / ${titleStyleFor(11)}`) : bad('[7]');
}
// [8] ★ 따옴표 없는 느슨한 JSON 이 와도 **중괄호가 제목에 실리지 않는다** (2026-09-25 실측)
//   `{title: 이란 대통령이 … 연설한 이유}` 가 JSON.parse 에 실패해 원문 통째로 제목이 됐고,
//   따옴표만 지워진 채 모든 선을 통과했다. 그대로 발행됐으면 제목 앞뒤에 { } 가 붙었다.
{
  const H2 = '이란 대통령, 전쟁 중 적국에서 연설…"우린 美 테러의 희생자"';
  const t = await makeCuriosityTitle(H2, { call: async () => '{title: 이란 대통령이 전쟁 중 적국에서 연설한 이유}' });
  t === '이란 대통령이 전쟁 중 적국에서 연설한 이유' ? ok(`[8] 느슨한 JSON → 본문만: ${t}`) : bad(`[8] ${t}`);
  const t2 = await makeCuriosityTitle(H2, { call: async () => '{"title": {"text": "이란 대통령이 연설한 이유"}}' });
  t2 === null || !/[{}:]/.test(t2) ? ok('[8b] 구조가 남은 제목은 내보내지 않는다') : bad(`[8b] ${t2}`);
}
// [9] 합격 조건을 agy 에 넘긴다 — 한글 없는 답이면 사슬의 다음 모델이 받는다
{
  let acc = null;
  await makeCuriosityTitle(H, { context: CTX, agyReportImpl: async (p, o) => { acc = o.accept; return null; } });
  (typeof acc === 'function' && acc('{"title":"Task completed"}') === false && acc('{"title":"북한군 포로가 한국에 온 이유"}') === true)
    ? ok('[9] accept 를 넘긴다 (Task completed 불합격 · 한국어 제목 합격)')
    : bad(`[9] accept=${typeof acc}`);
}

// [11] 답 필드가 "title" 이 아니다 — gemini 가 그 이름에 작업 보고를 쓴다(2026-09-25 3/3 실측)
{
  let seen = null;
  const t = await makeCuriosityTitle(H, { context: CTX, agyReportImpl: async (p, o) => {
    seen = { p, keys: Object.keys(o.schema?.properties ?? {}) };
    return JSON.stringify({ shorts_title_ko: '북한군 포로가 결국 한국으로 오게 된 이유' });
  } });
  (seen && !seen.keys.includes('title') && seen.keys.length === 1 && seen.p.includes(`"${seen.keys[0]}"`)
    && t === '북한군 포로가 결국 한국으로 오게 된 이유')
    ? ok(`[11] 스키마·프롬프트 필드 = ${seen.keys[0]} (title 아님), 그 필드에서 제목을 꺼낸다`)
    : bad(`[11] 필드 ${seen?.keys} · 제목 ${t}`);
}

// [12] 사슬을 돌지 않고 1차 모델 하나만 — 발행을 4.5분 붙잡지 않게 (2026-09-25 실측: 뒤 모델 0/8)
{
  const { AGY_MODEL_CHAIN } = await import('./agy-report.mjs');
  let o2 = null;
  await makeCuriosityTitle(H, { context: CTX, agyReportImpl: async (p, o) => { o2 = o; return null; } });
  (o2?.model === AGY_MODEL_CHAIN[0] && o2.timeoutMs <= 120_000)
    ? ok(`[12] 모델 하나(${o2.model}) · 상한 ${o2.timeoutMs / 1000}초`) : bad(`[12] model=${o2?.model} timeout=${o2?.timeoutMs}`);
}

// [10] 발행부가 쓰는 선택 — 차례·로케일·끄개·실패 시 헤드라인
{
  let calls = 0;
  const make = (t) => async () => { calls++; return t; };
  const base = { headlineTitle: '헤드라인 제목', headline: H, context: CTX, isKo: true, maxLen: 38 };
  const a = await chooseShortsTitle({ ...base, seed: 2, make: make('북한군 포로가 한국에 온 이유') });
  (a.title === '북한군 포로가 한국에 온 이유' && a.style === 'curiosity')
    ? ok('[10a] 궁금증 차례 + 통과 → 궁금증 제목') : bad(`[10a] ${JSON.stringify(a)}`);
  const b = await chooseShortsTitle({ ...base, seed: 4, make: make(null) });
  (b.title === '헤드라인 제목' && b.style === 'headline' && b.fellBack === true)
    ? ok('[10b] 궁금증 차례인데 선을 못 지킴 → 헤드라인 · fellBack 표시') : bad(`[10b] ${JSON.stringify(b)}`);
  calls = 0;
  const c = await chooseShortsTitle({ ...base, seed: 3, make: make('X의 이유') });
  (c.title === '헤드라인 제목' && c.style === 'headline' && !c.fellBack && calls === 0)
    ? ok('[10c] 헤드라인 차례 → 부르지도 않는다') : bad(`[10c] ${JSON.stringify(c)} calls=${calls}`);
  calls = 0;
  const d = await chooseShortsTitle({ ...base, isKo: false, seed: 2, make: make('X의 이유') });
  (d.style === 'headline' && calls === 0) ? ok('[10d] 한국어 편이 아니면 안 쓴다') : bad(`[10d] ${JSON.stringify(d)}`);
  calls = 0;
  const e = await chooseShortsTitle({ ...base, seed: 2, disabled: true, make: make('X의 이유') });
  (e.style === 'headline' && calls === 0) ? ok('[10e] 끄개(SHORTS_CURIOSITY_TITLE=0) → 안 쓴다') : bad(`[10e] ${JSON.stringify(e)}`);
  const f = await chooseShortsTitle({ ...base, seed: 2, make: async () => { throw new Error('boom'); } });
  (f.style === 'headline' && f.fellBack) ? ok('[10f] 호출이 터져도 헤드라인으로 발행은 된다') : bad(`[10f] ${JSON.stringify(f)}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);

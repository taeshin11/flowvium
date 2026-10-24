/**
 * headline-hook.mjs — 쇼츠 후보 헤드라인에 '공인·대립·용어' 표시를 달고, 약한 것을 편성 뒤로 민다. (2026-10-24 신설)
 *
 * 왜 (사장님 10/24 "지표가 자라는지 보고 안 되면 고쳐라", Mac mini2 경유): 근거는 headline-hook.test.mjs 머리말.
 *   요약 — 7주 382편에서 공인 실명/직함도 대립도 없는 헤드라인은 붕괴(첫 화면에서 넘김) 22%·평균 0.83, 나머지는 약 5%·1.03.
 *   주제 등급은 이 차이를 못 가른다(주제 중앙값 0.96~1.06). 기준(아래 프롬프트)은 그 측정에 쓴 표시와 같은 말이다 —
 *   바꾸면 측정과 편성의 잣대가 어긋난다.
 * agy 가 실패하면 null — 부르는 쪽은 순서를 건드리지 않는다(쇼츠를 막지 않는다). 형식은 topic-classify 와 같다.
 */
import { agyReport } from './agy-report.mjs';
import { pickAvailable, PREFERRED_CLASSIFY } from './agy-models.mjs';

export function hookPrompt(headlines) {
  const list = headlines.map((h, i) => `${i}|${String(h ?? '').replace(/\|/g, '/').slice(0, 90)}`).join('\n');
  return [
    '아래는 한국어 뉴스 헤드라인 목록이다(번호|헤드라인). 각 헤드라인에 세 가지를 0/1 로 표시해라. 헤드라인 글자만 보고 판단해라.',
    '- person: 한국 일반 시청자 대부분이 이름을 아는 공인(대통령·유명 정치인·재벌 총수·유명인·트럼프 등)의 실명이나 직함(예: 李대통령)이 있다. 회사명·기관명만 있으면 0.',
    '- conflict: 다툼·비난·고발·충돌·고성·전쟁·공격·반박·논란 같은 대립이 드러난다.',
    '- jargon: 일반 시청자가 바로 뜻을 모를 기관명·제도명·금융 용어(예: 코픽스, 국부펀드, 초광역특구법, 회사채, 공사 이름)가 헤드라인의 중심이다.',
    '웹 검색·파일 읽기·URL 열기 등 **어떤 도구도 쓰지 마라.** 바로 답해라.',
    '',
    list,
    '',
    'JSON 으로만 답해라: {"h": {"0": [person, conflict, jargon], "1": [...], ...}} — 모든 번호를 빠짐없이.',
  ].join('\n');
}

/**
 * @param {string[]} headlines
 * @param {{timeoutMs?:number, call?:Function, onReject?:Function}} opt  call 은 테스트용
 * @returns {Promise<{person:0|1, conflict:0|1, jargon:0|1}[]|null>} 하나라도 빠지거나 0/1 이 아니면 null
 */
export async function classifyHooks(headlines, opt = {}) {
  const hs = (headlines ?? []).map((h) => String(h ?? ''));
  if (!hs.length) return [];
  const reject = (why) => { opt.onReject?.(why); return null; };
  const parse = (out) => {
    let h;
    try { h = JSON.parse(out)?.h; } catch { return `JSON 해석 실패: ${String(out).replace(/\s+/g, ' ').slice(0, 80)}`; }
    if (!h || typeof h !== 'object') return `h 가 객체가 아니다: ${String(out).slice(0, 80)}`;
    h = Object.fromEntries(Object.entries(h).map(([k, v]) => [String(k).replace(/['"\s]/g, ''), v]));   // topic-classify 9/25 실측과 같은 키 따옴표
    const bit = (x) => x === 0 || x === 1;
    const bad = hs.map((_, i) => i).filter((i) => !(Array.isArray(h[String(i)]) && h[String(i)].length >= 3 && h[String(i)].slice(0, 3).every(bit)));
    if (bad.length) return `번호 누락·형식 오류 ${bad.length}/${hs.length}: ${String(out).replace(/\s+/g, ' ').slice(0, 80)}`;
    return h;
  };
  const call = opt.call ?? ((p) => agyReport(p, {
    label: 'headline-hook', timeoutMs: opt.timeoutMs ?? 180_000, chain: pickAvailable(PREFERRED_CLASSIFY),
    schema: { type: 'object', properties: { h: { type: 'object' } }, required: ['h'] },
    accept: (out) => typeof parse(out) === 'object',
  }));
  let out;
  try { out = await call(hookPrompt(hs)); } catch (e) { return reject(`호출 오류: ${e?.message ?? e}`); }
  if (!out) return reject('응답 없음(agy 사슬 전부 실패)');
  const h = parse(out);
  if (typeof h === 'string') return reject(h);
  return hs.map((_, i) => { const [person, conflict, jargon] = h[String(i)]; return { person, conflict, jargon }; });
}

/** 약한 헤드라인 — 공인도 대립도 없음, 또는 용어 중심인데 공인 없음. 표시가 없으면 약하지 않다(판단하지 않는다). */
export function hookWeak(f) {
  if (!f) return false;
  return (f.person === 0 && f.conflict === 0) || (f.jargon === 1 && f.person === 0);
}

/**
 * 약한 것만 뒤로(안정 정렬). 전부 약하면 그대로 — 회차를 거르지 않는다(그런 편도 평균 0.83, 안 내면 0).
 * @returns {{order: any[], moved: number}}
 */
export function orderByHook(cands, flags) {
  if (!Array.isArray(flags) || flags.length !== cands.length) return { order: cands, moved: 0 };
  const weak = cands.filter((_, i) => hookWeak(flags[i]));
  if (!weak.length || weak.length === cands.length) return { order: cands, moved: 0 };
  return { order: [...cands.filter((_, i) => !hookWeak(flags[i])), ...weak], moved: weak.length };
}

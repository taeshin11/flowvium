/**
 * curiosity-title.mjs — 쇼츠 제목을 **궁금증을 남기는 문장**으로 다시 쓴다. (2026-09-24 신설)
 *
 * 사장님 "이 장르의 상위 채널들은 어떻게 하는지 레퍼런스 체크해서 다음 편부터 반영".
 *
 * 레퍼런스 (유튜브 API 13 units, 2026-09-24 — tubemon 뉴스 순위의 쇼츠 전용 소형 채널):
 *   짧주   구독 31,300  · 최근 50편 조회 중앙 377,644 · 35초 · 하루 8.1편
 *   짧뉴   구독 282,000 · 조회 중앙 550,220 · 50초 · 하루 1.2편
 *   현장LEO 구독 28,200 · 조회 중앙 45,457 · 33초
 *   (우리: 하루 약 7편 · 48h 조회 중앙 약 1,000)
 *   상위 제목 꼴: "결국 밝혀졌다는 상어가 바다로 돌아가지 않는 이유"(214만) ·
 *     "출근시간 붙잡힌 엘리베이터 주민들이 화내지 않은 이유"(290만) · "돈 빌려간 학생의 충격반전"(365만).
 *   우리 제목은 통신사 문체 그대로였다: `젤렌스키 "북한군 포로 2명, 韓 보내"…정부, 사실상 확인(종합2보)`.
 *
 * ⚠ 그 채널들은 동물·게임·미담 같은 가벼운 소재가 많다. **소재는 따라 할 수 없고 형식만** 가져온다.
 *   그래서 우리 채널에서 통하는지 모른다 — 우리 데이터엔 이 꼴의 제목이 3편뿐이다(판단 불가).
 *   → **번갈아 쓴다**(titleStyleFor). 같은 날 두 방식이 나란히 있어야 날짜 효과에 속지 않고 비교된다.
 *
 * 선(video-meta 의 "지어내지 않는다" 원칙이 막으려던 것 — 거짓 사실):
 *   · 원문(헤드라인+영상 내용)에 없는 숫자를 넣지 않는다 (blog-voice.addedNumbers)
 *   · 원문과 동떨어지면 안 된다 — 2-gram 겹침 하한 (낚시 방지)
 *   · 작업 보고("생성했습니다")는 버린다 (agy-report.isMetaReply)
 *   · 길이 상한 — 쇼츠 피드는 한두 줄만 보인다
 * 하나라도 어기면 null → 발행부가 **헤드라인 제목**으로 돌아간다.
 */
import { agyReport, isMetaReply, AGY_MODEL_CHAIN } from './agy-report.mjs';
import { addedNumbers } from './blog-voice.mjs';
import { overlap } from './blog-quality.mjs';

/** 원문 대비 제목의 2-gram 겹침 하한. 궁금증 꼴("~한 이유") 자체가 새 글자라 너무 높이면 다 떨어진다. */
const MIN_OVERLAP = 0.35;

/** 편마다 번갈아. 씨앗은 발행 누적 편수(결정론 — 같은 편은 같은 방식). */
export function titleStyleFor(seed) {
  return Math.abs(Math.trunc(Number(seed) || 0)) % 2 === 0 ? 'curiosity' : 'headline';
}

/**
 * 답의 필드 이름. **"title" 로 두면 gemini 가 작업 보고를 쓴다.** (2026-09-25 실측)
 *   같은 뉴스 3건을 gemini 에 물어 비교했다:
 *     필드 "title"                → 3/3 작업 보고 ("YouTube Shorts Title Generation Complete", "Task completed")
 *     필드 "shorts_title_ko"(+설명) → 3/3 실제 제목
 *     스키마 없이                  → 3/3 실제 제목
 *   "title" 을 **이 작업의 제목** 으로 읽는 것으로 보인다. 프롬프트는 셋 다 같았다.
 */
const TITLE_KEY = 'shorts_title_ko';

/**
 * 답에서 제목 문자열만 꺼낸다. 못 꺼내면 null.
 *   2026-09-25 실측: 모델이 따옴표 없는 `{title: …}` 를 냈다. JSON.parse 가 실패하자 종전 코드는
 *   원문 통째를 제목으로 썼고, 중괄호가 붙은 채 모든 선을 통과했다.
 */
export function parseTitle(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const j = JSON.parse(s);
    if (typeof j === 'string') return j;
    const v = j?.[TITLE_KEY] ?? j?.title;
    return typeof v === 'string' ? v : null;
  } catch { /* 아래 */ }
  const loose = /^\{\s*["']?(?:shorts_title_ko|title)["']?\s*:\s*(.*?)\s*\}$/s.exec(s);
  if (loose) return loose[1];
  return /[{}]/.test(s) ? null : s;
}

export function curiosityPrompt(headline, context = [], maxLen = 38) {
  return [
    '아래 뉴스로 유튜브 쇼츠 제목을 **한 줄** 써라.',
    '목표: 피드를 넘기던 사람이 **궁금해서 누르게** 만드는 문장. 뉴스 헤드라인 문체가 아니다.',
    '다음 꼴 가운데 하나를 써라: "~한 이유" · "결국 ~한 ~" · "~의 정체" · "~한 ~ 근황" · "~의 반전".',
    '참고(잘 된 쇼츠 제목의 꼴): "결국 밝혀졌다는 상어가 바다로 돌아가지 않는 이유" · "출근시간 붙잡힌 엘리베이터 주민들이 화내지 않은 이유".',
    '',
    '지킬 것:',
    `- ${maxLen}자 이내.`,
    '- **원문에 없는 숫자·인물·기관을 넣지 마라.** 사실을 지어내지 마라. 원문이 말한 것만으로 궁금증을 만들어라.',
    '- **아직 안 일어난 일(전망·계획·검토)은 제목에서도 그렇게 써라.** "~할 전망"을 "~하는"으로 바꾸면 없는 사실이 된다.',
    '- 원문에 없는 과장어(전격·충격·경악·초유·역대급·발칵)를 붙이지 마라.',
    '- 따옴표·해시태그·이모지 쓰지 마라.',
    '- 신문 약어(與·野·韓·美·北·中·日)는 풀어 써라(여당·야당·한국·미국·북한·중국·일본).',
    '',
    `원문 헤드라인: ${headline}`,
    ...(context.length ? ['영상 내용(참고):', ...context.map((c) => `- ${String(c).slice(0, 300)}`)] : []),
    '',
    `JSON 으로만 답해라: {"${TITLE_KEY}": "..."}`,
  ].join('\n');
}

/**
 * @returns {Promise<string|null>} 선을 지킨 제목, 못 지키면 null
 */
export async function makeCuriosityTitle(headline, opt = {}) {
  const maxLen = opt.maxLen ?? 38;
  const context = (opt.context ?? []).map((c) => String(c ?? '')).filter(Boolean);
  const prompt = curiosityPrompt(headline, context, maxLen);
  const viaAgy = opt.agyReportImpl ?? agyReport;
  const call = opt.call ?? ((p) => viaAgy(p, {
    // 발행을 붙잡는 시간이다. **사슬을 돌지 않고 1차 모델 하나만** 부른다(2026-09-25 실측):
    //   gemini 25~77초에 답했고 한 번은 90초를 넘겼다. claude-opus·gpt-oss 는 이 작업에서
    //   8번 넘게 불러 **한 번도** 90초 안에 답하지 못했다 — 사슬 끝까지 가면 4.5분을 붙잡고 결국 헤드라인이다.
    //   제목은 없어도 발행이 되는 부가 기능이라, 기다림 상한(2분)이 뒤 모델의 희박한 성공보다 중요하다.
    //   보고서는 여전히 사슬 전체를 쓴다(이 호출만의 선택).
    label: 'curiosity-title', timeoutMs: opt.timeoutMs ?? 120_000,
    model: opt.model ?? AGY_MODEL_CHAIN[0],
    schema: { type: 'object', required: [TITLE_KEY],
      properties: { [TITLE_KEY]: { type: 'string', description: '시청자에게 보일 한국어 쇼츠 제목 문장 그 자체' } } },
    // 한글 제목이 없으면 이 모델의 답은 쓸 수 없다 — 사슬의 다음 모델이 받게 한다.
    accept: (out) => /[가-힣]/.test(parseTitle(out) ?? ''),
  }));
  // 왜 떨어졌는지 남긴다 — 헤드라인으로 돌아간 편이 어느 선에 걸렸는지 모르면 선을 못 고친다.
  const reject = (why, t = '') => { opt.onReject?.(why, t); return null; };
  let raw;
  try { raw = await call(prompt); } catch (e) { return reject(`호출 실패: ${e?.message ?? e}`); }
  if (!raw) return reject('빈 응답');
  let t = parseTitle(raw);
  if (t == null) return reject('제목을 못 꺼냄', String(raw).slice(0, 60));
  t = String(t).replace(/#\S+/g, '').replace(/["“”'‘’]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return reject('제목 없음');
  if (/[{}]/.test(t)) return reject('구조 문자가 남음', t);
  // 작업 보고는 문구 목록으로 막지 않는다 — 아래 겹침 하한이 잡는다(원문과 겹치는 게 없다).
  if (isMetaReply(t, prompt)) return reject('작업 보고', t);
  if (!/[가-힣]/.test(t)) return reject('한글 없음', t);
  if (t.length > maxLen) return reject(`길이 ${t.length}>${maxLen}`, t);
  const source = [headline, ...context].join(' ');
  const added = addedNumbers(source, t);
  if (added.length) return reject(`원문에 없는 숫자 ${added.join(',')}`, t);
  const ov = overlap(source, t, 2);
  if (ov < MIN_OVERLAP) return reject(`겹침 ${ov.toFixed(2)}<${MIN_OVERLAP}`, t);
  // 2026-09-26(테크이슈 공지 덧붙임 · UAX3Zyb4RKg): 원문이 **아직 안 일어난 일**(전망·계획·검토…)인데 제목이
  //   그 말을 떨어뜨리면 일어난 일처럼 들린다 — "1경4000조원 전망" → "1경 4000조원이 쏟아지는 곳". 숫자·겹침은 통과했다.
  if (FUTURE.test(headline) && !FUTURE_IN_TITLE.test(t)) return reject('전망·계획을 단정으로 바꿨다', t);
  // 2026-09-26 실측(우리 21:45 회차): "…한국행만 공개" → "…한국행을 전격 공개한 이유". 원문에 없는 과장어는 버린다.
  const hype = (t.match(HYPE) ?? []).filter((w) => !source.includes(w));
  if (hype.length) return reject(`원문에 없는 과장어 ${hype.join(',')}`, t);
  return t;
}

const FUTURE = /전망|예상|예정|계획|추진|검토|가능성|우려|목표|방침|할 듯|될 듯|시사/;
const FUTURE_IN_TITLE = /전망|예상|예정|계획|추진|검토|가능성|우려|목표|방침|듯|수도|거라|거란|려는|하려|될까|할까|노리|앞둔|나선/;
/** 사실이 아니라 **말투**를 부풀리는 낱말. 원문에 있으면 괜찮다(인용일 수 있다). */
const HYPE = /전격|충격|경악|초유|역대급|발칵|대참사|폭탄/g;

/**
 * 발행부가 부르는 한 곳. 이 편의 제목 방식을 정하고, 궁금증 차례인데 선을 못 지키면 헤드라인으로 돌아간다.
 *   style 은 **실제로 나간 방식**이다 — 나중에 방식별 조회수를 잴 때 차례가 아니라 이것으로 센다.
 *   fellBack 은 궁금증 차례였는데 헤드라인이 나간 편 — 이 비율이 높으면 비교가 기운다(표본이 한쪽으로 쏠림).
 * @returns {Promise<{title:string, style:'curiosity'|'headline', fellBack:boolean, reason?:string}>}
 */
export async function chooseShortsTitle({ headlineTitle, headline, context = [], seed, isKo, maxLen = 38,
  disabled = false, make = makeCuriosityTitle }) {
  const plain = (extra = {}) => ({ title: headlineTitle, style: 'headline', fellBack: false, ...extra });
  if (disabled || !isKo || !headline || titleStyleFor(seed) !== 'curiosity') return plain();
  let reason = '';
  let t = null;
  try {
    t = await make(headline, { context, maxLen, onReject: (why) => { reason = why; } });
  } catch (e) {
    // 제목 때문에 발행을 잃지 않는다. 다만 조용히 넘기지 않는다 — reason 으로 호출부가 로그에 남긴다.
    reason = `호출 오류: ${e?.message ?? e}`;
  }
  return t ? { title: t, style: 'curiosity', fellBack: false } : plain({ fellBack: true, reason: reason || '제목 없음' });
}

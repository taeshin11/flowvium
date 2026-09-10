/**
 * narrative-edit-kind.mjs — 내러티브 교정을 '배울 것' 과 '그냥 다듬은 것' 으로 가른다.
 *
 * 왜 (2026-09-10): 모니터가 "교정기 상시발동 — narrative_garble_sanitized 23/32보고서" 를 띄웠다.
 *   교정 전후를 스냅샷으로 떠서 **달라졌으면 전부 결함으로 적재**하고 있었고, 그 기록은
 *   harness_ 접두어가 없어 다음 프롬프트에 "이 garble 반복 금지" 로 주입된다.
 *   실물을 보니 대부분 오류가 아니었다 —
 *     컨탱고 → 콘탱고       둘 다 맞는 음역이고 우리가 하나로 통일한 것뿐이다
 *     KOSPI 6,900 → 6,918  모델이 반올림했고 실측으로 맞춘 것(2026-08-23 대조 로직의 정상 동작)
 *   고칠 것 없는 걸 가르치면 프롬프트 자리를 잡아먹고 진짜 결함이 그 잡음에 묻힌다.
 *
 * 판정은 **차이 자체**로 한다(어느 교정기가 손댔는지는 스냅샷이 모른다):
 *   ① 표기 변형표로 양쪽을 정규화했더니 같아진다      → style     (배우지 않는다)
 *   ② 숫자만 다르고 나머지 글자가 같다                → reconcile (배우지 않는다)
 *   ③ 그 외                                          → defect    (배운다)
 *
 * ③ 에 남아야 하는 것들: 오역(짧은 매수 스퀴즈 → 공매도 스퀴즈), 과장(2.3% 급등 → 상승),
 *   근거 없는 수치 제거(0.5% 하락했으나 → 하락했으나). 전부 모델이 실제로 틀린 것이다.
 */

/**
 * 표기 통일 대상 — 뜻이 같고 표기만 다른 것들. 여기 넣는 순간 "모델에게 가르치지 않는다" 는 뜻이니
 *   **의미가 달라지는 교정을 넣으면 안 된다**(오역·과장은 여기 오면 안 된다).
 */
const STYLE_PAIRS = [
  // 콘탱고 음역 변형 — narrative-fix 의 CONTANGO_VARIANTS 와 같은 대상.
  [/컨티구오|컨티아고|컨텐고|컨텐코|컨탱고|콘텡고|콘텐고|콘탕고/g, '콘탱고'],
  // 라틴 bleed 로 깨진 스퀴즈 표기(스que이즈 등) — 뜻은 같고 글자만 깨졌다.
  [/스que이즈|스퀴이즈/g, '스퀴즈'],
];

const applyStyle = (s) => STYLE_PAIRS.reduce((t, [re, to]) => t.replace(re, to), String(s ?? ''));
const stripDigits = (s) => String(s ?? '').replace(/[\d,]+/g, '#');

export function classifyNarrativeEdit(before, after) {
  const b = String(before ?? '');
  const a = String(after ?? '');
  if (b === a) return 'none';
  if (applyStyle(b) === applyStyle(a)) return 'style';
  // 숫자 자리만 바뀐 경우. 글자 수가 아니라 **숫자를 가린 문자열**이 같아야 한다 —
  //   "0.5% 하락했으나" → "하락했으나" 는 % 와 공백까지 사라지므로 여기 걸리지 않는다(배운다).
  if (stripDigits(applyStyle(b)) === stripDigits(applyStyle(a))) return 'reconcile';
  return 'defect';
}

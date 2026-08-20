#!/usr/bin/env node
/**
 * lang-detect.test.mjs — 언어 판정을 휴리스틱이 아니라 감지기로 하는지 검증.
 *
 * 배경(2026-08-20): 미번역 판정을 '대상 스크립트 문자가 있는가'라는 정규식 휴리스틱으로 했다.
 *   그 결과 두 가지를 구분하지 못했다:
 *     ① 짧은 명사 나열("Industrial conglomerates, machinery, aerospace…")을 4B 가 그대로
 *        되돌려줬을 때 — translate/route.ts:74 의 `out !== text` 검사가 '실패'로 보고
 *        클라우드(키 revoked)로 넘겨 원문이 남았다. '동일 출력'과 '번역 불필요'가 구분 안 됨.
 *     ② 티커·숫자처럼 정상적으로 대상문자가 없는 텍스트 — 길이 임계로 막았으나 임의값이었다.
 *
 *   franc(주당 40만 다운로드, 순수 JS)로 실제 언어를 판정하면 둘 다 해결된다.
 *   실측(우리 실패 사례):
 *     "Industrial conglomerates, machinery, aerospace…" → eng ✅
 *     "하이퍼스케일 클라우드 제공업체와…"                → kor ✅
 *     "BILL" / "2026-08-20 +3.5%"                     → und ✅ (오탐 없음)
 *     "KOSPI 지수가 3거래일 만에 상승했다"              → kor ✅ (혼용도 정확)
 *
 *   단, franc 는 '전체가 무슨 언어인가'만 본다. 한국어 문장 속 가나 몇 글자 같은 '부분 혼입'은
 *   kor 로 판정하므로, 기존 스크립트 누출 검사를 버리면 안 된다. 둘을 결합한다.
 */
const M = await import('./lang-detect.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!M?.isUntranslated) { bad('isUntranslated 미구현 — 판정이 여전히 정규식 휴리스틱'); console.log('\n결과: 실패 1건'); process.exit(1); }

const T = (label, text, locale, want) => {
  const got = M.isUntranslated(text, locale);
  got === want ? ok(`${label} → ${want ? '미번역' : '정상'}`) : bad(`${label} — got=${got} want=${want}`);
};
// ① 실제 실패 사례
T('영문 명사나열(ko)', 'Industrial conglomerates, machinery, aerospace, and transportation.', 'ko', true);
T('정상 한국어(ko)',   '하이퍼스케일 클라우드 제공업체와 가장 많은 컴퓨팅 리소스를 소비하는 AI 플랫폼 기업들.', 'ko', false);
// ② 오탐 방지
T('티커(ko)',          'BILL', 'ko', false);
T('숫자·기호(ko)',     '2026-08-20 +3.5%', 'ko', false);
T('빈 문자열(ko)',     '', 'ko', false);
// ③ 혼용은 정상
T('한영 혼용(ko)',     'KOSPI 지수가 3거래일 만에 상승했다', 'ko', false);
// ④ 부분 스크립트 혼입은 감지기가 못 잡으므로 결합 검사가 필요
T('가나 혼입(ko)',     '코스피가 ロンジン 브랜드와 함께 상승했다고 시장은 평가한다', 'ko', true);
// ⑤ 다른 대상 언어
T('한국어인데 ja 대상', '코스피가 3거래일 만에 상승했다고 시장은 평가하고 있다', 'ja', true);
T('일본어(ja)',        'これは日本語の文章です。市場は上昇しています。', 'ja', false);

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

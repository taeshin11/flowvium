#!/usr/bin/env node
/**
 * sub-cta.test.mjs — 끝에 '이유 있는 구독 권유' 를 편마다 절반만 넣는다(A/B). 2026-09-27 신설.
 * 사장님 "구독자 올릴수있는건 다 해봐". 조사: 유튜브 공식 블로그(2026-07)가 마지막 5초의 말+화면 안내를 권한다.
 *   "구독하면 +X%" 류 수치는 출처 없는 일화 — 우리가 직접 나눠 잰다(구독/1천 engaged 조회).
 * 제목 방식(궁금증/헤드라인)이 씨앗 짝홀로 번갈아서, 같은 짝홀을 쓰면 둘이 섞인다 → 씨앗 % 4 로 2×2 를 맞춘다.
 */
import { subCtaFor, SUB_CTA_LINE, withSubCta } from './sub-cta.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
// [1] 2026-10-13 A/B 종료 → 모든 편에. 3일 지표 87편: 권유 있음 1천회당 구독 1.71(79명) vs 없음 1.14(54명).
//   평균 시청 비율은 60.9% vs 69.9% 로 낮지만 조회 순위와 상관 0.25 < 구독 0.35. ChatGPT·agy 둘 다 '유지'.
{
  let off = 0; for (let s = 0; s < 400; s++) if (!subCtaFor(s)) off++;
  off === 0 ? ok('[1] 모든 편에 붙는다') : bad(`[1] ${off}/400 편이 빠진다`);
}
// [2] 마지막 **내용** 장면 끝에 붙인다(광고·마무리 장면 아님), 이미 붙어 있으면 두 번 붙이지 않는다
{
  const sc = [{ say: '첫 문장입니다.' }, { say: '둘째 문장입니다.' }, { say: '사이트 안내', isOutro: true }];
  const out = withSubCta(sc);
  (out[1].say.endsWith(SUB_CTA_LINE) && !out[2].say.includes(SUB_CTA_LINE) && !out[0].say.includes(SUB_CTA_LINE)) ? ok('[2] 마지막 내용 장면 끝에') : bad(`[2] ${JSON.stringify(out)}`);
  const twice = withSubCta(out);
  (twice[1].say.split(SUB_CTA_LINE).length === 2) ? ok('[2b] 두 번 붙이지 않는다') : bad('[2b]');
}
// [3] 권유에 '이유' 가 있다(매일·40초 — 무엇을 받는지)
/매일/.test(SUB_CTA_LINE) && /구독/.test(SUB_CTA_LINE) ? ok(`[3] "${SUB_CTA_LINE}"`) : bad('[3]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

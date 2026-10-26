#!/usr/bin/env node
/**
 * blog-track.test.mjs — 블로그 '지난 추천은 어땠나' 문단. 2026-10-26 신설.
 *
 * 왜: 10/26 아침 글이 "정리를 끝낸 20건 중 수익 85%, 평균 +0.8%, 지수보다 +2%p" 라고 적었다.
 *   보고서의 portfolioOutcomes(옛 판정표 — 손절 ×1.02·목표 ×0.98·추천 전 가격)에서 온 숫자다.
 *   같은 날 고친 채점(data/scorecard.json)은 미국 49%·평균 0.0%, 한국 26%·평균 -3.9%. 블로그가 부풀린 성적을 말하면 안 된다.
 *   → 성적표에서 시장별로 쓴다(합친 숫자는 만들지 않는다 — 미국이 한국을 가린다). 성적표가 없거나 48시간 넘으면 문단을 빼고 지어내지 않는다.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./blog-track.mjs').catch(() => null);
if (!M) { bad('[0] lib/blog-track.mjs 가 없다'); console.log('\n❌ 1건 실패'); process.exit(1); }
const now = Date.parse('2026-10-26T01:00:00Z');
const sc = { generatedAt: '2026-10-25T10:25:00Z', markets: {
  us: { finished: 340, profitShare: 49, meanPct: 0, vsIndexMedian: -0.1, stopShare: 24 },
  kr: { finished: 88, profitShare: 26, meanPct: -3.9, vsIndexMedian: -1.9, stopShare: 60 } }, gate: { kr: { reduce: true } } };
const t = M.trackRecordParagraph(sc, { now }) ?? '';
(/미국/.test(t) && /340건/.test(t) && /49%/.test(t) && /한국/.test(t) && /88건/.test(t) && /26%/.test(t) && /-3\.9%/.test(t) && /60%/.test(t))
  ? ok('[1] 시장별 끝난 건수·돈 번 비율·평균·손절 비율') : bad(`[1] ${t}`);
(/S&P 500 보다 0\.1%p 낮/.test(t) && /코스피보다 1\.9%p 낮/.test(t)) ? ok('[2] 지수 대비는 부호대로(낮/높)') : bad(`[2] ${t}`);
(/track-record/.test(t)) ? ok('[3] 성적표 페이지 링크') : bad('[3] 링크 없음');
(M.trackRecordParagraph({ ...sc, generatedAt: '2026-10-20T00:00:00Z' }, { now }) === null && M.trackRecordParagraph(null, { now }) === null)
  ? ok('[4] 성적표가 없거나 48시간 넘으면 null — 지어내지 않는다') : bad('[4]');
const src = readFileSync(new URL('../make-blog-post.mjs', import.meta.url), 'utf8');
(!/portfolioOutcomes/.test(src) && /trackRecordParagraph\(/.test(src)) ? ok('[5] make-blog-post 가 옛 portfolioOutcomes 대신 성적표를 쓴다') : bad('[5] make-blog-post 가 아직 portfolioOutcomes 를 쓴다');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

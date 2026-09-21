#!/usr/bin/env node
/** blog-quality.test.mjs — 저품질(얇음·중복·광고과다)을 발행 전에 잡는가. 2026-09-18 신설. */
import { checkQuality, originalText, overlap } from './blog-quality.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const ADS = '\n\n---\n\n### 매일 5회, 시장을 정리합니다\n\n**flowvium.net** 에서 봅니다.\n\n👉 **https://flowvium.net**\n\n> 투자 판단과 그 결과는 본인에게 있습니다. 이 글은 정보 제공이며 매매 권유가 아닙니다.\n';
const post = (body) => `# 제목\n\n${body}${ADS}`;
const long = '오늘 시장은 금리와 환율이 함께 움직이며 방향을 잡지 못했습니다. '.repeat(18);

// [1] 광고를 뺀 알맹이만 센다
originalText(post('본문입니다.')).includes('flowvium') === false
  ? ok('[1] 광고 문구는 알맹이에서 빠진다') : bad('[1] 광고가 알맹이에 남았다');

// [2] 얇은 글
{
  const r = checkQuality(post('짧습니다.'));
  !r.ok && r.issues.some((i) => i.includes('알맹이가 짧다')) ? ok('[2] 얇은 글을 막는다') : bad(`[2] ${JSON.stringify(r)}`);
}
// [3] 충분한 글은 통과
{
  const r = checkQuality(post(long));
  r.ok ? ok(`[3] 충분한 글은 통과 (알맹이 ${r.stats.original}자)`) : bad(`[3] ${r.issues.join(' / ')}`);
}
// [4] 광고·고지 누락
checkQuality(`# 제목\n\n${long}`).issues.some((i) => i.includes('광고가 없다'))
  ? ok('[4] 광고 없는 글을 막는다') : bad('[4] 광고 없는 글이 통과했다');
// [5] 중복
{
  const prev = post(long);
  const r = checkQuality(post(long), [prev]);
  !r.ok && r.issues.some((i) => i.includes('겹친다')) ? ok(`[5] 이미 올린 글과 겹치면 막는다 (${r.stats.overlap})`) : bad(`[5] ${JSON.stringify(r.stats)}`);
}
// [6] 다른 내용이면 통과
{
  const other = post('환율이 급등하며 수입 물가가 오르고 있습니다. 반도체 수출은 늘었습니다. '.repeat(18));
  const r = checkQuality(post(long), [other]);
  r.ok ? ok(`[6] 내용이 다르면 통과 (겹침 ${r.stats.overlap})`) : bad(`[6] ${r.issues.join(' / ')}`);
}
// [7] 겹침 계산
const marketA = '오늘 국내 증시는 외국인과 기관의 동반 매도세에 하락 마감했습니다. 특히 반도체와 이차전지 대형주 중심으로 낙폭이 컸습니다. 원달러 환율은 소폭 상승하며 불안감을 키웠습니다.';
const marketB = '전일 미 증시 호조에도 불구하고 국내 증시는 하락 마감했습니다. 외국인 매도세가 이어진 가운데 반도체 섹터의 약세가 두드러졌습니다. 환율은 오름세로 거래를 마쳤습니다.';
const cooking = '오늘은 맛있는 김치찌개를 끓여보겠습니다. 잘 익은 묵은지와 돼지고기를 준비해주세요. 먼저 냄비에 기름을 두르고 고기를 볶다가 김치를 넣어 함께 볶습니다.';
const copiedHalf = '오늘 국내 증시는 외국인과 기관의 동반 매도세에 하락 마감했습니다. 특히 반도체와 이차전지 대형주 중심으로 낙폭이 컸습니다.';

overlap(marketA, marketA) === 1 ? ok('[7-1] 같은 글끼리는 100%') : bad('[7-1] 같은 글끼리는 100%');
overlap(marketA, copiedHalf) >= 0.9 ? ok('[7-2] 앞 절반을 그대로 베낀 글은 90% 이상') : bad(`[7-2] 앞 절반을 그대로 베낀 글은 90% 이상 (${overlap(marketA, copiedHalf)})`);
overlap(marketA, cooking) < 0.1 ? ok('[7-3] 전혀 다른 주제의 두 글은 10% 미만') : bad(`[7-3] 전혀 다른 주제의 두 글은 10% 미만 (${overlap(marketA, cooking)})`);
overlap(marketA, '') === 0 && overlap('', marketA) === 0 ? ok('[7-4] 빈 문자열이 섞이면 0') : bad('[7-4] 빈 문자열이 섞이면 0');
overlap(marketA, marketB, 2) > overlap(marketA, marketB, 4) ? ok('[7-5] n=2 로 주면 4보다 높게 나온다') : bad(`[7-5] n=2 로 주면 4보다 높게 나온다 (2: ${overlap(marketA, marketB, 2)}, 4: ${overlap(marketA, marketB, 4)})`);

console.log(fail ? `\n❌ ${fail} 실패` : '\n✅ blog-quality 통과');
process.exit(fail ? 1 : 0);

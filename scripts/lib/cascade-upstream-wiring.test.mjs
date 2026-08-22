#!/usr/bin/env node
/**
 * cascade-upstream-wiring.test.mjs — 공급망 매수 룰이 실제로 닿는 데이터를 읽는가.
 *
 * 배경(2026-08-22): 사용자가 "매수 추천이 거시·미시·기업·공급망·기술적을 다 고려했나" 를 물어
 *   선정 파이프라인을 실측했다. 최근 12개 보고서·후보 382행에서
 *     fundamental 36.9% · price 23.3% · technical 15.5% · guru 14.4% · micro 8.8% · macro 0.8%
 *   이고 **`micro_cascade_upstream` 은 0회 발화** 였다. 이 사이트의 핵심 서사가 공급망인데.
 *
 *   진입점부터 따라가니 죽은 배선이었다:
 *     generate-report-local.mjs:6955
 *       cascadeUpstreamSet: new Set((ctxRaw?.cascade ?? [])
 *         .flatMap(c => (c.downstreamBeneficiaries ?? []).map(d => d.ticker ?? d)))
 *     :3882  cascade: newsCascade?.articles ?? []      ← news-cascade 기사 배열
 *
 *   news-cascade 기사 스키마(실측): title·link·pubDate·source·region·id·summary·sentiment·
 *     importance·cascades·analyzedAt·analysisSource — **downstreamBeneficiaries 없음.**
 *   그 필드를 만드는 건 /api/supply-chain-signals 이고, ctxRaw 에는 `supplyChainSignals` 로
 *   따로 담겨 있다(:3887). 즉 *다른 객체* 를 읽고 있었다. Set 은 언제나 비고 룰은 발화 불가.
 *
 *   preferSmallModel(선언만 하고 라우팅에 미사용)·ctx.news?.articles(미존재 필드) 와 같은 부류다.
 *   "필드가 없으면 빈 배열" 이 조용히 삼켜서 몇 달간 증상이 안 보였다.
 *
 * 이 테스트는 '어느 변수를 읽는가' 가 아니라 **그 객체가 실제로 그 필드를 갖는가** 를 본다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { buildCascadeUpstreamSet } = await import('./cascade-upstream.mjs')
  .catch((e) => { bad(`cascade-upstream.mjs 없음: ${String(e.message).slice(0, 60)}`); return {}; });
if (!buildCascadeUpstreamSet) { console.log('\n❌ 1건 실패'); process.exit(1); }

// 실측 스키마 그대로
const newsArticle = {
  title: 'x', link: 'y', pubDate: 'z', source: 's', region: 'US', id: 'i',
  summary: '', sentiment: 'neutral', importance: 'low',
  cascades: [{ asset: 'NVDA', direction: 'positive', magnitude: 'low', reason: '', timeframe: '' }],
  analyzedAt: '', analysisSource: 'ai',
};
const supplySignal = {
  ticker: 'NVDA', companyName: 'NVIDIA', signalType: 'contract_win', conviction: 80,
  direction: 'positive', headline: '', summary: '', source: 'sec-8k', date: '',
  downstreamBeneficiaries: ['TSM', 'AVGO'], upstreamRisks: [], whyMatters: '',
};

// [1] 뉴스 기사만 주면 아무것도 안 나온다 — 그 스키마엔 필드가 없다(있는 척하면 안 된다)
buildCascadeUpstreamSet({ cascade: [newsArticle], supplyChainSignals: [] }).size === 0
  ? ok('news-cascade 기사에서는 downstream 을 못 얻는다 (그 스키마에 없다)')
  : bad('없는 필드에서 값을 만들어낸다');

// [2] 공급망 신호를 주면 나온다 — 이게 원래 의도였다
{
  const s = buildCascadeUpstreamSet({ cascade: [], supplyChainSignals: [supplySignal] });
  s.has('TSM') && s.has('AVGO') && s.size === 2
    ? ok(`공급망 신호에서 downstream 수혜 추출: ${[...s].join(', ')}`)
    : bad(`공급망 신호에서 추출 실패: ${[...s].join(', ') || '없음'}`);
}

// [3] 문자열/객체 두 형태를 모두 받는다 (route.ts 는 string[], db.mjs 주석은 객체형도 언급)
{
  const s = buildCascadeUpstreamSet({ supplyChainSignals: [{ downstreamBeneficiaries: [{ ticker: 'AMD' }, 'INTC'] }] });
  s.has('AMD') && s.has('INTC')
    ? ok('string / {ticker} 두 형태 모두 처리')
    : bad(`형태 처리 누락: ${[...s].join(', ')}`);
}

// [4] 빈 입력에 안전
buildCascadeUpstreamSet({}).size === 0 && buildCascadeUpstreamSet(null).size === 0
  ? ok('빈 입력에 안전')
  : bad('빈 입력에서 예외/오값');

// [5] 실제 배선 — 생성기가 이 함수를 쓰는가
const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
/buildCascadeUpstreamSet/.test(gen)
  ? ok('generate-report-local 이 이 함수를 쓴다')
  : bad('함수를 만들었는데 생성기가 안 쓴다 — 소비처 0');
/\(ctxRaw\?\.cascade \?\? \[\]\)\.flatMap\(c => \(c\.downstreamBeneficiaries/.test(gen)
  ? bad('옛 죽은 배선(뉴스 기사에서 downstream 읽기)이 남아 있다')
  : ok('옛 죽은 배선 제거됨');

// [6] 생산 경로가 downstream 을 실제로 채우는가.
//   2026-08-22 실측: 라이브 신호 20건 중 downstreamBeneficiaries 를 가진 건 0건이었다.
//   sec-8k 2건의 headline 이 `8-K [사업계약]:` 형식 — route.ts:320 경로다.
//   그 경로는 `downstreamBeneficiaries: []` 를 박고 inferDownstream 을 부르지 않는다.
//   2026-06-15 에 본문 파싱으로 개선하면서 downstream 추론을 가져오지 않은 회귀다
//   (:190 · :570 · :608 은 부른다). 배선(A)을 고쳐도 데이터가 없으면 룰은 여전히 안 울린다.
{
  const route = (() => { try { return readFileSync(resolve(ROOT, 'src/app/api/supply-chain-signals/route.ts'), 'utf8'); } catch { return ''; } })();
  const emptyLiterals = (route.match(/downstreamBeneficiaries:\s*\[\]/g) ?? []).length;
  emptyLiterals === 0
    ? ok('생산 경로가 downstream 을 빈 배열로 박지 않는다')
    : bad(`downstreamBeneficiaries: [] 하드코딩 ${emptyLiterals}건 — 그 경로 신호는 공급망 룰에 절대 안 닿는다`);
}

console.log(fail === 0 ? '\n✅ cascade-upstream-wiring 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

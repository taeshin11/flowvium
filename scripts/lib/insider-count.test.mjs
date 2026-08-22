#!/usr/bin/env node
/**
 * insider-count.test.mjs — 내부자 '매수' 건수를 실제로 세는가.
 *
 * 배경(2026-08-22): 새로 만든 check-context-fields 가 잡았다.
 *   generate-report-local.mjs:6969
 *     insiderMap: new Map((ctxRaw?.insider ?? []).map(i => [i.ticker, i.filings ?? i.count ?? 1]))
 *   실행 시점 모양(logs/ctx-shapes.json) 기준 insider 원소 키 20종에
 *   **filings 도 count 도 없다**(direction·transactionCode·shares·ticker·… ).
 *   → 값이 항상 1 → 룰 `micro_insider_buying {filings_gte: 3}` 은 구조적으로 발화 불가.
 *   check-rule-firing 이 "배선의심 0-발화" 로 표시하던 것의 정확한 원인이다.
 *
 * 그런데 단순히 행 수를 세면 **새 버그**가 된다 — 라이브 피드 실측이 매도 48 / 매수 1 이다.
 *   전체를 세면 내부자 *매도* 를 매수 신호로 만든다. 방향을 봐야 한다.
 *   방향 해석은 이미 단일 출처가 있다(scripts/lib/insider-direction.mjs) — 새로 만들지 않는다.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./insider-count.mjs').catch((e) => { bad(`insider-count.mjs 없음: ${String(e.message).slice(0,50)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// 실측 스키마 그대로(20키 중 판정에 쓰는 것만)
const row = (ticker, direction, transactionCode) => ({ ticker, direction, transactionCode, shares: 100, filedAt: '2026-08-22' });

// [1] 매수만 센다 — 라이브 분포가 매도 48 : 매수 1 이라 이걸 틀리면 신호가 뒤집힌다
{
  const m = M.buildInsiderBuyMap([
    row('AAA', 'buy'), row('AAA', 'buy'), row('AAA', 'buy'),
    row('BBB', 'sell'), row('BBB', 'sell'), row('BBB', 'sell'), row('BBB', 'sell'),
  ]);
  m.get('AAA') === 3 ? ok('매수 3건을 3으로 센다') : bad(`AAA=${m.get('AAA')} (기대 3)`);
  (m.get('BBB') ?? 0) === 0 ? ok('매도는 매수로 세지 않는다') : bad(`BBB=${m.get('BBB')} — 매도를 매수 신호로 센다`);
}

// [2] 종전 구현(행마다 1)을 재현하면 룰이 못 울린다는 것을 고정
{
  const rows = [row('CCC','buy'), row('CCC','buy'), row('CCC','buy')];
  const oldWay = new Map(rows.map(i => [i.ticker, i.filings ?? i.count ?? 1]));
  oldWay.get('CCC') === 1 && M.buildInsiderBuyMap(rows).get('CCC') === 3
    ? ok('종전 구현은 항상 1 (filings_gte:3 을 못 넘음) · 새 구현은 3')
    : bad('종전/신규 구분 실패 — 회귀 고정이 안 된다');
}

// [3] 방향이 해석 불가면 세지 않는다 (모르는 걸 매수로 치지 않는다)
{
  const m = M.buildInsiderBuyMap([{ ticker: 'DDD' }, { ticker: 'DDD', direction: '' }]);
  (m.get('DDD') ?? 0) === 0 ? ok('방향 불명은 매수로 세지 않는다') : bad(`DDD=${m.get('DDD')}`);
}

// [4] 잘못된 입력에 안전
(M.buildInsiderBuyMap(null).size === 0 && M.buildInsiderBuyMap([{}]).size === 0)
  ? ok('빈/잘못된 입력에 안전') : bad('빈 입력에서 오값');

// [5] 방향 판정은 단일 출처를 쓴다 (중복 구현 금지)
const src = readFileSync(resolve(ROOT, 'scripts/lib/insider-count.mjs'), 'utf8');
/insider-direction\.mjs/.test(src)
  ? ok('insiderDirection 단일 출처를 재사용한다')
  : bad('방향 판정을 또 구현했다 — 두 곳이 갈리면 신호가 어긋난다');

// [6] 실제 배선
// 주석 줄은 제외한다 — 이 수정의 이력 주석이 옛 표현식을 인용하고 있어, 그대로 세면
//   자기 설명글을 결함으로 잡는다(이 세션에서 이미 두 번 겪은 부류).
const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/buildInsiderBuyMap/.test(gen) ? ok('생성기가 쓴다') : bad('만들었는데 생성기가 안 쓴다 — 소비처 0');
/i\.filings \?\? i\.count \?\? 1/.test(gen)
  ? bad('종전 죽은 배선이 남아 있다')
  : ok('종전 죽은 배선 제거됨');

console.log(fail === 0 ? '\n✅ insider-count 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

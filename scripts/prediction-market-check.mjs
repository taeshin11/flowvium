#!/usr/bin/env node
/**
 * prediction-market-check.mjs — 예측시장 수집을 눈으로 확인한다.
 *
 * 키를 받자마자 이걸로 먼저 돌려본다. 보고서에 붙이기 전에 "실제로 쓸 만한 것이 나오는가" 를
 * 사람이 보고 판단해야 하기 때문이다 — 나오는 시장이 전부 스포츠 경기면 투자 보고서에 못 쓴다.
 *
 * 사용:
 *   DOME_API_KEY=... node scripts/prediction-market-check.mjs
 *   node scripts/prediction-market-check.mjs --window=48 --scan=60 --limit=10
 *   node scripts/prediction-market-check.mjs --json          # 파이프용
 *
 * 종료코드: 0 정상 · 1 수집 실패(이유는 stdout) · 2 인자 오류
 */
import { fetchNoteworthyMarkets } from './lib/prediction-market.mjs';
import { loadEnvLocal } from './lib/llm-config.mjs';

loadEnvLocal();   // .env.local 의 DOME_API_KEY 를 process.env 로 올린다

const argv = process.argv.slice(2);
const VALUE = ['--window', '--scan', '--limit', '--min-volume', '--min-move'];
const BOOL = ['--json'];
const arg = (f, d) => {
  const eq = argv.find((a) => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const name = a.split('=')[0];
  if (BOOL.includes(name) || VALUE.includes(name)) { if (VALUE.includes(name) && !a.includes('=')) i++; continue; }
  console.error(`알 수 없는 인자: ${a}\n  쓸 수 있는 것: ${[...BOOL, ...VALUE.map((f) => `${f}=…`)].join(' ')}`);
  process.exit(2);
}

const pct = (p) => `${(p * 100).toFixed(0)}%`;
const usd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);

const res = await fetchNoteworthyMarkets({
  windowHours: Number(arg('--window', 24)),
  scan: Number(arg('--scan', 40)),
  limit: Number(arg('--limit', 8)),
  minVolumeUsd: Number(arg('--min-volume', 20000)),
  minMovePp: Number(arg('--min-move', 1)),
});

if (argv.includes('--json')) {
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}

if (!res.ok) {
  console.log(`❌ 수집 실패 [${res.reason}] ${res.detail}`);
  if (res.reason === 'no-key') {
    console.log('   → https://dashboard.domeapi.io 에서 무료 키를 받아 .env.local 에 DOME_API_KEY= 로 넣으세요.');
  }
  process.exit(1);
}

console.log(`벤더 ${res.vendor} · 조회 ${res.scanned}개 · 창 ${res.windowHours}h · ${res.asOf}`);
if (!res.markets.length) {
  console.log(`\n(비어 있음) [${res.reason}] ${res.detail}`);
  console.log('  빈 결과는 오류가 아니다 — 호출부는 이 경우 섹션을 생략해야 한다(0 으로 채우면 안 된다).');
  process.exit(0);
}
console.log('');
for (const m of res.markets) {
  const sign = m.deltaPp > 0 ? '▲' : '▼';
  console.log(`  ${sign}${Math.abs(m.deltaPp).toFixed(1)}%p  ${pct(m.probPrev)} → ${pct(m.prob)}   거래 ${usd(m.volume24h)} / 누적 ${usd(m.liquidity)}`);
  console.log(`      ${m.title}`);
  console.log(`      마감 ${String(m.closeAt ?? '?').slice(0, 10)}  ${m.url ?? '(링크 없음)'}`);
}
console.log(`\n※ 위 링크는 한국에서 HTTP 451 이다(2026-08-18 방통심의위 접속차단). 데이터만 벤더 경유로 받는다.`);

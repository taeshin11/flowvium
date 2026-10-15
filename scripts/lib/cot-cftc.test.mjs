#!/usr/bin/env node
// cot-cftc.test.mjs — /api/cot-positions 를 CFTC 공식 데이터 API(publicreporting, legacy futures-only 6dca-aqww)로. 2026-10-16.
// 왜(사이트 눈검증 agy): 인텔리전스 COT 탭 'COT 데이터를 불러올 수 없습니다' — www.cftc.gov/dea/newcot/FinFutWk.txt 가
//   어떤 요청에도 403(실측 10/16). 게다가 그 파일은 TFF 형식이라 8·9번째 칸이 딜러 포지션인데 코드는 '비상업(투기)' 이라 불렀다.
//   legacy 데이터셋의 noncomm_* 필드를 쓰고, 시장 이름은 정확히 일치(부분일치는 Micro·Ultra 계약을 먼저 잡을 수 있다).
import { readFileSync } from 'fs';
import { rowsToEntries, COT_MARKETS } from '../../src/lib/cot-cftc.ts';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
// 10/16 실측 행(report 2026-10-06)
const rows = [
  { market_and_exchange_names: 'MICRO E-MINI S&P 500 INDEX - CHICAGO MERCANTILE EXCHANGE', report_date_as_yyyy_mm_dd: '2026-10-06T00:00:00.000', open_interest_all: '175502', noncomm_positions_long_all: '62457', noncomm_positions_short_all: '78271', change_in_noncomm_long_all: '32968', change_in_noncomm_short_all: '24208' },
  { market_and_exchange_names: 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE', report_date_as_yyyy_mm_dd: '2026-10-06T00:00:00.000', open_interest_all: '1932227', noncomm_positions_long_all: '212009', noncomm_positions_short_all: '366079', change_in_noncomm_long_all: '2422', change_in_noncomm_short_all: '13993' },
  { market_and_exchange_names: 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE', report_date_as_yyyy_mm_dd: '2026-09-29T00:00:00.000', open_interest_all: '1', noncomm_positions_long_all: '1', noncomm_positions_short_all: '0', change_in_noncomm_long_all: '0', change_in_noncomm_short_all: '0' },
  { market_and_exchange_names: 'VIX FUTURES - CBOE FUTURES EXCHANGE', report_date_as_yyyy_mm_dd: '2026-10-06T00:00:00.000', open_interest_all: '441261', noncomm_positions_long_all: '86555', noncomm_positions_short_all: '177849', change_in_noncomm_long_all: '-1793', change_in_noncomm_short_all: '9891' },
];
const e = rowsToEntries(rows);
const sp = e.find((x) => x.id === 'sp500');
sp && sp.netPosition === 212009 - 366079 && sp.reportDate === '2026-10-06' && sp.weeklyChange === 2422 - 13993 && sp.netPctOI === -8
  ? ok(`[1] E-mini S&P(정확 일치, Micro 아님) 최신 주 순포지션 ${sp.netPosition}·OI 대비 ${sp.netPctOI}%·주간 ${sp.weeklyChange}`) : bad(`[1] ${JSON.stringify(sp)}`);
const vix = e.find((x) => x.id === 'vix');
vix && vix.sentiment === 'bearish' ? ok(`[2] VIX 순 ${vix.netPctOI}% → bearish`) : bad(`[2] ${JSON.stringify(vix)}`);
e.length === 2 ? ok('[3] 데이터 없는 시장은 빼고(지어내지 않음) 순서 유지') : bad(`[3] ${e.length}`);
COT_MARKETS.length === 7 ? ok('[4] 대상 시장 7개 이름 고정') : bad('[4]');
const route = readFileSync(new URL('../../src/app/api/cot-positions/route.ts', import.meta.url), 'utf8');
/publicreporting\.cftc\.gov/.test(route) && !/FinFutWk\.txt'/.test(route) ? ok('[5] 라우트가 공식 데이터 API 를 쓴다(403 txt 아님)') : bad('[5] 라우트가 아직 FinFutWk.txt');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// paper-trade-sync.test.mjs — 보고서 → 가상매매 연결. 2026-10-16 사이트 눈검증(agy): /ko/paper-trading '처리된 리포트 0' ·
//   포지션 $0. executeReportTrades 를 부르는 곳이 옛 온라인 생성 경로(investment-strategy)뿐이라 로컬 생성기로 옮긴 뒤 한 번도 안 돌았다.
//   route 주석은 "로컬 스크립트 + cron 에서 호출" 인데 호출하는 스크립트가 없었다. 또 execute 는 인증 없이 열려 있었다.
import { readFileSync } from 'fs';
import { pickNewReport } from './paper-trade-sync.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const reps = [
  { id: '2026-10-15:evening', generatedAt: '2026-10-15T11:04:31Z', portfolio: [{ ticker: 'APH', allocation: 17 }] },
  { id: '2026-10-16:midnight', generatedAt: '2026-10-15T13:33:37Z', portfolio: [{ ticker: 'AAPL', allocation: 20 }] },
];
pickNewReport(reps, { lastId: null })?.id === '2026-10-16:midnight' ? ok('[1] 처음이면 가장 최근 회차 하나만(과거 회차를 몰아서 매매하지 않음)') : bad('[1]');
pickNewReport(reps, { lastId: '2026-10-16:midnight' }) === null ? ok('[2] 이미 처리한 회차는 다시 안 한다') : bad('[2]');
pickNewReport([{ ...reps[1], portfolio: [] }], { lastId: null }) === null ? ok('[3] 포트폴리오가 비면 매매 안 함') : bad('[3]');
const route = readFileSync(new URL('../../src/app/api/paper-trading/route.ts', import.meta.url), 'utf8');
/if \(!authed\)[\s\S]{0,200}action === 'execute'|action === 'execute'[\s\S]{0,120}if \(!authed\)/.test(route) ? ok('[4] execute 는 인증 뒤에만') : bad('[4] execute 가 인증 없이 열려 있다');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

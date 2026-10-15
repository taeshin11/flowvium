#!/usr/bin/env node
/**
 * engine-ledger.test.mjs — 엔진 결정 장부(종목선정·매수·매도·심판)의 채점 계산. 2026-10-15 신설.
 *
 * 왜(사장님 10/15 "antigravity·ChatGPT 와 같이 flowvium 예측력 전향적 연구 — 종목선정·매수엔진·매도엔진·심판엔진·
 *   데이터 긁어오는 것 다 검증"): 지금 DB 로는 과거 성적을 믿을 수 없다(읽기 전용 조사 10/15).
 *   결정 줄에 규칙 버전이 없고, 규칙은 매주 전체 결과로 재튜닝(표본 안), 결과 라벨은 사후 수정(118줄 재라벨·
 *   269줄 P&L 지움), 추천 줄은 재실행 때 덮어쓰고, 매수 평가는 고정 기간 없이 경로 사건, 매도 평가는 기준지수 없음,
 *   심판이 거부한 종목은 아무도 안 잰다. 그래서 결정 직후 고정 기록 → 고정 규칙으로 채점한다.
 * 규칙(사전등록 프로토콜 v0.1, docs/prospective-study-protocol.md — agy argon-medium 비판 반영):
 *   - 진입 = 결정 시각 **뒤** 첫 정규장 시가. Yahoo 일봉 t 는 그 장이 열리는 순간이다(10/15 실측: US 13:30Z·KR 00:00Z)
 *     → t > 결정 시각인 첫 봉. 같은 날 이미 열린 봉은 못 쓴다(누수 차단).
 *   - h 일 수익 = 진입 봉 시가 → (진입 봉 + h-1) 종가. 기준지수도 **같은 규칙**(같은 결정 시각)으로.
 *   - 봉이 모자라면: 아직 날짜가 안 됐으면 '대기'. 마지막 봉이 오래전이면(거래정지·상장폐지) 빼지 않고 마지막 종가로
 *     청산하고 표시한다(빼면 최악의 꼬리가 사라진다 — agy).
 *   - 새 신호 = 직전 20거래일(≈28일) 안에 같은 종목·같은 역할 기록이 없을 때.
 *   - 순초과 = 초과수익 - 왕복비용(KR 40bp·US 15bp, 가정).
 *   - 날짜 포트폴리오 시계열의 평균, Newey-West 표준오차(lag = h-1).
 */
import { entryIndex, horizonReturn, scoreSignal, isNewSignal, dailySeries, neweyWest, COST } from './engine-ledger.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// 미국 일봉(13:30Z 시작) — 10/12~10/16
const T = (d, hh = '13:30') => Date.parse(`2026-10-${d}T${hh}:00Z`);
const us = [12, 13, 14, 15, 16].map((d, i) => ({ t: T(d), o: 100 + i, h: 0, l: 0, c: 101 + i }));
const spy = [12, 13, 14, 15, 16].map((d, i) => ({ t: T(d), o: 500, h: 0, l: 0, c: 500 * (1 + 0.001 * (i + 1)) }));

{
  // 결정 10/13 11:04Z(저녁판 20:04 KST) — 10/13 장(13:30Z)은 아직 안 열렸다 → 10/13 봉이 진입
  entryIndex(us, '2026-10-13T11:04:00Z') === 1 ? ok('[1] 장 열리기 전 결정 → 그날 시가') : bad(`[1] ${entryIndex(us, '2026-10-13T11:04:00Z')}`);
  // 결정 10/13 15:00Z(장중) — 그날 봉은 이미 열렸다 → 다음 날
  entryIndex(us, '2026-10-13T15:00:00Z') === 2 ? ok('[2] 장중 결정 → 다음 날 시가(이미 열린 봉 금지)') : bad(`[2] ${entryIndex(us, '2026-10-13T15:00:00Z')}`);
  entryIndex(us, '2026-10-16T14:00:00Z') === -1 ? ok('[3] 아직 진입 봉이 없으면 -1') : bad('[3]');
}
{
  // 진입 10/13 시가 101, h=2 → 10/14 종가 103 → +1.98%
  const r = horizonReturn(us, 1, 2, { now: T(20) });
  r && near(r.ret, 103 / 101 - 1) && r.exitT === us[2].t && !r.stale ? ok('[4] h=2: 진입 시가 → h-1 봉 뒤 종가') : bad(`[4] ${JSON.stringify(r)}`);
  horizonReturn(us, 3, 5, { now: T(17) }) === null ? ok('[5] 아직 h 봉이 안 쌓였으면 대기(null)') : bad('[5]');
  // 마지막 봉 10/16, 지금 11/20 → 오래 끊김 → 마지막 종가로 청산·stale 표시
  const d = horizonReturn(us, 3, 20, { now: Date.parse('2026-11-20T00:00:00Z') });
  d && d.stale === true && near(d.ret, 105 / 103 - 1) ? ok('[6] 거래 끊긴 종목은 빼지 않고 마지막 종가로 청산(stale)') : bad(`[6] ${JSON.stringify(d)}`);
}
{
  const s = scoreSignal({ bars: us, bench: spy, decidedAt: '2026-10-13T11:04:00Z', market: 'us', h: 2, now: T(20) });
  const r = 103 / 101 - 1, b = (500 * 1.003) / 500 - 1;
  s && near(s.ret, r) && near(s.bench, b) && near(s.excess, r - b) && near(s.net, r - b - COST.us) ? ok(`[7] 초과 = 종목 - 같은 규칙 기준지수, 순초과 = 초과 - ${COST.us * 1e4}bp`) : bad(`[7] ${JSON.stringify(s)}`);
  // 종목과 기준지수 진입일이 어긋나면(휴장·결측) 채점하지 않고 이유를 남긴다
  const benchGap = spy.filter((_, i) => i !== 1);
  const g = scoreSignal({ bars: us, bench: benchGap, decidedAt: '2026-10-13T11:04:00Z', market: 'us', h: 2, now: T(20) });
  g && g.status === 'date_mismatch' ? ok('[8] 종목·기준 날짜 어긋나면 date_mismatch(조용히 섞지 않음)') : bad(`[8] ${JSON.stringify(g)}`);
}
{
  const hist = [{ ticker: 'AAPL', role: 'pick', decidedAt: '2026-10-01T11:00:00Z' }];
  isNewSignal(hist, { ticker: 'AAPL', role: 'pick', decidedAt: '2026-10-15T11:00:00Z' }) === false ? ok('[9] 28일 안 같은 종목·역할 → 반복(새 신호 아님)') : bad('[9]');
  isNewSignal(hist, { ticker: 'AAPL', role: 'pick', decidedAt: '2026-11-05T11:00:00Z' }) === true ? ok('[10] 28일 지나면 새 신호') : bad('[10]');
  isNewSignal(hist, { ticker: 'AAPL', role: 'veto', decidedAt: '2026-10-15T11:00:00Z' }) === true ? ok('[11] 역할이 다르면 따로 센다') : bad('[11]');
}
{
  const rows = [
    { day: '2026-10-13', role: 'pick', net: 0.02 }, { day: '2026-10-13', role: 'pick', net: 0.00 },
    { day: '2026-10-14', role: 'pick', net: -0.01 }, { day: '2026-10-14', role: 'veto', net: 0.05 },
  ];
  const s = dailySeries(rows, 'pick');
  s.length === 2 && near(s[0].v, 0.01) && near(s[1].v, -0.01) ? ok('[12] 날짜 포트폴리오 = 그날 신호 동일가중(역할별)') : bad(`[12] ${JSON.stringify(s)}`);
  // Newey-West: 상관없는 시계열은 lag 0 과 거의 같고, 양의 자기상관이면 표준오차가 커진다
  const iid = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
  const persist = [0.01, 0.01, 0.01, 0.01, -0.01, -0.01, -0.01, -0.01];
  const a = neweyWest(persist, 0), b = neweyWest(persist, 3);
  b.se > a.se && near(neweyWest(iid, 0).mean, 0) ? ok(`[13] 겹치는 창(자기상관) → NW 표준오차 커짐 ${a.se.toFixed(4)} → ${b.se.toFixed(4)}`) : bad(`[13] ${JSON.stringify([a, b])}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

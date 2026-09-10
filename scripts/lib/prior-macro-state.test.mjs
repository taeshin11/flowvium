/**
 * prior-macro-state.test.mjs — 직전 회차의 거시 상태를 매수 후보 단계에 넘긴다.
 *
 * 왜 (2026-09-10 사용자 승인): 매수 후보 점수는 거시·섹터·지역 분석보다 **먼저** 돈다.
 *   그래서 macroRiskLevel·sectorStance·regionStance 가 항상 null 이고, 이를 쓰는 룰 5개
 *   (rotation_sector_in · rotation_defensive · macro_low_risk · micro_sector_overweight ·
 *   micro_region_bullish, 점수 비중 19/293 = 6.5%)가 개통 이래 한 번도 발화하지 못했다.
 *   2026-08-22 에 발견됐지만 "순서를 바꾸는 건 투자 로직 결정" 이라 경고만 띄우고 19일이 지났다.
 *
 *   순서를 바꾸는 대신 **직전 회차 값**을 쓴다. 리스크 레벨·섹터/지역 스탠스는 몇 시간 사이에
 *   잘 바뀌지 않는다. 다만 '지금 값이 아니라 직전 회차 값' 이라는 사실을 숨기지 않는다 —
 *   근거 문자열에 회차와 나이를 적는다.
 *
 * ⚠ 너무 오래된 값은 쓰지 않는다. 며칠 전 리스크 레벨로 오늘 종목을 고르면 그건 근거가 아니라 잡음이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromReport, isFresh, MAX_AGE_H } from './prior-macro-state.mjs';

const rep = (over = {}) => ({
  id: '2026-09-10:afternoon:ko',
  generated_at: new Date(Date.now() - 3 * 3600000).toISOString(),
  full_json: JSON.stringify({
    riskLevel: 'medium',
    sectorAllocation: [{ sector: 'Technology', stance: 'overweight' }, { sector: 'Financials', stance: 'neutral' }],
    regionStances: { us: { stance: 'bullish' }, korea: { stance: 'neutral' } },
    ...over,
  }),
});

test('리스크 레벨·섹터·지역을 꺼낸다', () => {
  const s = fromReport(rep());
  assert.equal(s.riskLevel, 'medium');
  // 키는 정규 이름이다 — 보고서의 'Technology' 와 종목의 'Semiconductors' 가 같은 자리로 모여야 한다.
  assert.equal(s.sectorStanceMap.get('information technology'), 'overweight');
  assert.equal(s.regionStanceMap.get('us'), 'bullish');
});

test('보고서와 종목의 섹터 어휘가 같은 자리로 모인다', async () => {
  const { canonSector } = await import('./sector-canon.mjs');
  const m = fromReport(rep()).sectorStanceMap;
  // 실측: 보고서는 'Technology', 종목 메타는 'Semiconductors'/'IT Services' 로 적힌다.
  assert.equal(m.get(canonSector('Semiconductors')), 'overweight');
  assert.equal(m.get(canonSector('Financial Services')), 'neutral');
});

test('korea 는 kr 로 맞춘다 — 매수 ctx 가 kr/us 를 쓴다', () => {
  assert.equal(fromReport(rep()).regionStanceMap.get('kr'), 'neutral');
});

test('출처를 남긴다 — 지금 값인 척하지 않는다', () => {
  const s = fromReport(rep());
  assert.match(s.provenance, /2026-09-10:afternoon:ko/);
  assert.match(s.provenance, /직전 회차/);
  assert.ok(s.ageHours >= 2.9 && s.ageHours <= 3.1, `나이가 이상하다: ${s.ageHours}`);
});

test('오래된 값은 쓰지 않는다', () => {
  assert.equal(isFresh({ ageHours: MAX_AGE_H - 1 }), true);
  assert.equal(isFresh({ ageHours: MAX_AGE_H + 1 }), false);
  assert.equal(isFresh(null), false);
});

test('보고서가 없거나 필드가 비면 빈 상태 — 지어내지 않는다', () => {
  assert.equal(fromReport(null), null);
  const s = fromReport(rep({ riskLevel: undefined, sectorAllocation: [], regionStances: {} }));
  assert.equal(s.riskLevel, null);
  assert.equal(s.sectorStanceMap.size, 0);
  assert.equal(s.regionStanceMap.size, 0);
});

test('깨진 JSON 에 죽지 않는다', () => {
  assert.equal(fromReport({ id: 'x', generated_at: new Date().toISOString(), full_json: '{oops' }), null);
});

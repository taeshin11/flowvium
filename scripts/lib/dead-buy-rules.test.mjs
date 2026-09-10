/**
 * dead-buy-rules.test.mjs — 거시 스탠스를 넣으면 그 룰들이 실제로 발화하는가.
 *
 * 왜 (2026-09-10): 입력을 채웠다는 것과 룰이 도는 것은 다르다. 목적은 "null 을 없앴다" 가 아니라
 *   **개통 이래 0회였던 룰 5개가 발화하는 것**이다. 그것을 여기서 못박는다.
 *   (2026-08-22 에 같은 문제를 발견하고도 19일간 아무 룰도 살아나지 않았다.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateBuyRule } from '../../src/lib/buy-sell-engine.mjs';

const RULES = (() => {
  const j = JSON.parse(readFileSync('data/buy-rules-tuned.json', 'utf8'));
  return Array.isArray(j) ? j : (j.rules ?? []);
})();
const byId = (id) => RULES.find((r) => r.id === id);

/** 스탠스가 없던 종전 ctx — 이 상태에서는 아래 룰이 전부 침묵해야 한다. */
const ctxBefore = {
  price: 100, sector: 'Technology', market: 'us', peRatio: 18, sectorPe: 25,
  macroRiskLevel: null, sectorStance: null, regionStance: null, vix: 15, fgScore: 60,
};
/** 직전 회차 스탠스를 넣은 ctx. */
const ctxAfter = { ...ctxBefore, macroRiskLevel: 'low', sectorStance: 'overweight', regionStance: 'bullish' };

const TARGETS = ['macro_low_risk', 'micro_sector_overweight', 'micro_region_bullish', 'rotation_sector_in'];

test('종전 ctx 에서는 전부 침묵한다 (이것이 19일간의 상태였다)', () => {
  for (const id of TARGETS) {
    const r = byId(id);
    assert.ok(r, `${id} 룰이 없다`);
    assert.ok(!evaluateBuyRule(r, ctxBefore), `${id} 가 스탠스 없이 발화했다`);   // 미발화는 null 또는 undefined
  }
});

test('직전 회차 스탠스를 넣으면 발화한다', () => {
  for (const id of TARGETS) {
    const reason = evaluateBuyRule(byId(id), ctxAfter);
    assert.ok(reason, `${id} 가 스탠스를 넣어도 발화하지 않는다 — 배선이 헛돌았다`);
  }
});

test('방어 회전은 risk=high 일 때만 — 아무 값이나 넣는다고 켜지지 않는다', () => {
  const r = byId('rotation_defensive');
  assert.ok(r);
  assert.ok(!evaluateBuyRule(r, { ...ctxAfter, sector: 'Utilities' }), 'risk=low 인데 방어 회전이 켜졌다');
  assert.ok(evaluateBuyRule(r, { ...ctxAfter, macroRiskLevel: 'high', sector: 'Utilities' }));
});

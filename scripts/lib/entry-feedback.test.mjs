/**
 * entry-feedback.test.mjs — 진입가 피드백 쿼리가 실제로 도는가.
 *
 * 왜 (2026-09-09): 보고서 로그에 매번 `⚠️ entry feedback 생성 실패: near "(": syntax error` 가
 *   찍히고 있었다. catch 가 빈 문자열을 돌려주는 바람에 보고서는 정상 생성됐고,
 *   그래서 **"PAST PERFORMANCE" 블록이 통째로 빠진 채로** 계속 나갔다.
 *   LLM 은 진입가가 실제보다 낮았다는 피드백을 한 번도 못 받았다.
 *   원인은 별칭이 SQL 함수 이름에 붙은 오타였다 — datetime(o.evaluated_at) 이 되어야 할 것이
 *   반대로 쓰여 SQLite 가 near "(" 로 거부했다. 전수 검사는 sql-alias-guard.test.mjs 가 한다.
 *
 * 예외를 삼키면 고장이 조용해진다. 쿼리가 도는지 테스트로 못박는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEntryFeedbackStats } from './db.mjs';

test('쿼리가 SQL 오류 없이 실행된다', () => {
  const rows = getEntryFeedbackStats();
  assert.ok(Array.isArray(rows), '배열이 나와야 한다');
});

test('컬럼이 소비처가 쓰는 이름 그대로 나온다', () => {
  const rows = getEntryFeedbackStats();
  if (!rows.length) return;                       // 표본이 없으면 형태만 통과
  for (const k of ['ticker', 'total', 'ne', 'hits', 'avg_ne_entry', 'avg_ne_actual']) {
    assert.ok(k in rows[0], `${k} 가 없다 — getEntryFeedbackBlock 이 읽는 이름이다`);
  }
});

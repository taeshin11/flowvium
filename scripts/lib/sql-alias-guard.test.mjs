/**
 * sql-alias-guard.test.mjs — `o.datetime(x)` 처럼 별칭이 SQL 함수 이름에 붙은 오타를 막는다.
 *
 * 왜 (2026-09-09): 2026-08-27 에 시간창 비교를 44곳 일괄 수정하면서 4곳에 이 오타가 들어갔다.
 *   `datetime(o.evaluated_at)` 이 `o.datetime(evaluated_at)` 이 되면 SQLite 는 "near (" 로 죽는다.
 *   네 곳 모두 try/catch 안이라 **13일 동안 조용히 비어 있었다** —
 *     · getEntryFeedbackStats : 보고서 프롬프트의 PAST PERFORMANCE 블록이 통째로 누락
 *     · getModelDefectRates   : 모델별 결함률 집계
 *     · audit-coverage 매수/매도 충돌 감사 2곳
 *   로그에 경고는 찍혔지만 아무도 안 봤다. 사람이 보는 것에 기대지 말고 테스트로 막는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SQL_FN = /\b[A-Za-z_][A-Za-z_0-9]{0,3}\.(datetime|date|julianday|strftime|unixepoch)\s*\(/g;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|ts|tsx)$/.test(p) && !p.includes('.bak-') && !p.endsWith('sql-alias-guard.test.mjs')) out.push(p);
  }
  return out;
}

test('별칭이 SQL 함수 이름에 붙은 곳이 없다', () => {
  const hits = [];
  for (const f of walk('scripts').concat(walk('src'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(SQL_FN)) {
      // JS 쪽 정당한 호출(예: date.getTime) 은 위 정규식에 안 걸린다 — SQL 함수명만 본다.
      const line = src.slice(0, m.index).split('\n').length;
      hits.push(`${f}:${line} ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], `별칭이 함수에 붙었다 — datetime(alias.col) 이어야 한다:\n  ${hits.join('\n  ')}`);
});

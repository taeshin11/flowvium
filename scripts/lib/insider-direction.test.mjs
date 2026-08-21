#!/usr/bin/env node
/**
 * insider-direction.test.mjs — 내부자 신호의 매수/매도 방향 판정.
 *
 * 배경(2026-08-21 DB 감사): insider_archive 512행 중 패턴 해석 가능한 241행에서
 *   193행의 direction 이 틀렸다. 저장 경로가 이렇게 되어 있다:
 *       db.mjs:1146  /매도|sell/i.test(i.pattern ?? '') ? 'sell' : 'buy'
 *   그런데 pattern 은 "매수 5 / 매도 0 (순 +5)" 형태다 — *언제나* '매도' 라는 낱말을 포함한다.
 *   그래서 순매수 신호가 전부 'sell' 로 저장됐다.
 *
 *   더구나 원본 객체는 올바른 direction 을 갖고 있었다(raw_json 기준 buy 193 / sell 48).
 *   저장 경로가 권위 있는 필드를 무시하고 부분 문자열 매칭으로 덮어썼다.
 *   insiderSignalsGrounded(generate-report-local:8006)는 net>0 인 매수우위만 내보내므로
 *   그 산출물은 정의상 전부 'buy' 여야 한다.
 *
 * 규칙: 원본 direction 이 있으면 그것이 권위. 없으면 건수로 판정. 둘 다 없으면 null —
 *   모르면 'buy' 로 짐작하지 않는다(그 짐작이 이 결함을 만들었다).
 */
import { insiderDirection } from './insider-direction.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const eq = (g, w, m) => (g === w ? ok(m) : (console.log(`  FAIL  ${m}\n          got ${JSON.stringify(g)} want ${JSON.stringify(w)}`), fail++));

// ① 실측 사례 — 순매수인데 'sell' 로 저장되던 것들
eq(insiderDirection({ pattern: '매수 5 / 매도 0 (순 +5)' }), 'buy', '매수 5 / 매도 0 → buy');
eq(insiderDirection({ pattern: '매수 1 / 매도 0 (순 +1)' }), 'buy', '매수 1 / 매도 0 → buy');
eq(insiderDirection({ pattern: '매수 6 / 매도 0 (순 +6)' }), 'buy', '매수 6 / 매도 0 → buy');
// ② 진짜 매도 우위
eq(insiderDirection({ pattern: '매수 0 / 매도 4 (순 -4)' }), 'sell', '매도 우위 → sell');
eq(insiderDirection({ pattern: '매수 2 / 매도 7 (순 -5)' }), 'sell', '매도 다수 → sell');
// ③ 동수
eq(insiderDirection({ pattern: '매수 3 / 매도 3 (순 0)' }), 'mixed', '동수 → mixed');
// ④ 원본 direction 이 권위 (패턴과 어긋나도 원본을 따른다)
eq(insiderDirection({ direction: 'buy', pattern: '매수 0 / 매도 4' }), 'buy', '원본 direction 우선');
eq(insiderDirection({ direction: 'SELL', pattern: '매수 9 / 매도 0' }), 'sell', '대소문자 무시');
// ⑤ 영문 패턴
eq(insiderDirection({ pattern: 'buys 4 / sells 1' }), 'buy', '영문 패턴 파싱');
// ⑥ 모르면 null — 짐작하지 않는다
eq(insiderDirection({ pattern: '내부자 활동 있음' }), null, '해석 불가 → null');
eq(insiderDirection({}), null, '빈 입력 → null');
eq(insiderDirection(null), null, 'null 안전');
// ⑦ '매도' 라는 낱말이 있다고 sell 이 아니다 — 이 결함의 정확한 재현 방지
insiderDirection({ pattern: '매수 5 / 매도 0 (순 +5)' }) === 'sell'
  ? bad('부분 문자열 매칭으로 회귀')
  : ok("'매도' 낱말 포함이 곧 sell 이 아니다");

// ⑧ 저장 경로가 이 함수를 쓴다
{
  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  // 주석은 검사에서 뺀다 — 이 결함을 설명하는 주석에 옛 정규식을 인용하면 코드로 오인된다.
  //   이 세션에서 '주석을 코드로 오인' 이 세 번째다(fedwatch 테스트 · context-keys 파서 · 여기).
  //   그래서 공용 헬퍼를 재사용한다. 같은 함수를 또 만들면 또 어긋난다.
  const { stripCommentsPreservingLines } = await import('./context-keys.mjs');
  const db = stripCommentsPreservingLines(readFileSync(resolve(ROOT, 'scripts/lib/db.mjs'), 'utf8'));
  /insiderDirection\(/.test(db) ? ok('db.mjs 가 insiderDirection 을 쓴다') : bad('저장 경로 미배선');
  /\/매도\|sell\/i\.test/.test(db) ? bad('부분 문자열 매칭이 남아 있다') : ok('부분 문자열 매칭 제거됨');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

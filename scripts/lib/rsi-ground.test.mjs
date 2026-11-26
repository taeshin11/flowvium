/**
 * rsi-ground.test — 보고서 문장의 RSI·과매도 말을 검증된 RSI 로 맞춘다(generate-report-local 의 결정론 보정).
 *   2026-11-26 오후판 URBN: 실제 RSI 가 35 미만이면 "RSI 과매도" 를 숫자 없이 남겨 verify-report [7]
 *   "RSI 값 없이 과매도 단언" 으로 푸시가 막혔다. 값을 모를 때 지우는 쪽은 `\b` 가 한글 뒤에서 안 걸려 "과매도" 가 안 지워졌다.
 */
let fail = 0;
const ok = (m) => console.log('  PASS ', m), bad = (m) => { fail++; console.log('  FAIL ', m); };
const { groundRsiText: g } = await import('./rsi-ground.mjs').catch(() => ({}));
if (typeof g !== 'function') bad('[0] groundRsiText 없음');
else {
  const a = g('RSI 과매도 $73-77.5 구간+고ROE', 28);
  (/RSI 28 과매도/.test(a)) ? ok(`[1] 실제 과매도면 숫자를 붙인다 → "${a}"`) : bad(`[1] "${a}"`);
  const b = g('정량 44(과매도 갭·RSI 과매도), 과매도 반등 대기', 48);
  (!/과매도/.test(b) && /RSI 48/.test(b)) ? ok(`[2] 실제 48 이면 과매도 말을 없앤다 → "${b}"`) : bad(`[2] "${b}"`);
  const c = g('RSI 31, 과매도 반등 대기', 31);
  (c === 'RSI 31, 과매도 반등 대기') ? ok('[3] 맞는 문장은 그대로') : bad(`[3] "${c}"`);
  const d = g('정량 44(과매도 갭·RSI 과매도), 과매도 반등 대기 RSI 22', null);
  (!/과매도|RSI/.test(d)) ? ok(`[4] 값을 모르면 RSI·과매도 말을 지운다(한글 뒤 경계) → "${d}"`) : bad(`[4] "${d}"`);
  const e = g('RSI 75 과매수 구간', 80);
  (/RSI 80 과매수/.test(e)) ? ok('[5] 과매수도 같은 방식') : bad(`[5] "${e}"`);
}
const { readFileSync } = await import('fs');
/groundRsiText\(/.test(readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8')) ? ok('[6] 보고서가 groundRsiText 를 쓴다') : bad('[6] 연결 안 됨');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

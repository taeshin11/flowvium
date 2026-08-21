/**
 * insider-direction.mjs — 내부자 신호의 매수/매도 방향 판정.
 *
 * 왜 생겼나(2026-08-21 DB 감사): insider_archive 512행 중 패턴 해석 가능한 241행에서
 *   193행의 direction 이 틀려 있었다. 저장 경로가
 *       /매도|sell/i.test(i.pattern ?? '') ? 'sell' : 'buy'
 *   인데 pattern 은 "매수 5 / 매도 0 (순 +5)" 형태라 *언제나* '매도' 를 포함한다.
 *   순매수 신호가 전부 'sell' 로 저장됐다.
 *
 *   더구나 원본 객체는 올바른 direction 을 갖고 있었다(raw_json: buy 193 / sell 48).
 *   저장 경로가 권위 있는 필드를 무시하고 부분 문자열 매칭으로 덮어썼다.
 *
 * 규칙: 원본 direction 이 있으면 권위. 없으면 건수로 판정. 둘 다 없으면 null.
 *   모르면 'buy' 로 짐작하지 않는다 — 그 짐작(else 'buy')이 이 결함의 나머지 절반이었다.
 */

const KO = /매수\s*(\d+)\s*\/\s*매도\s*(\d+)/;
const EN = /buys?\s*(\d+)\s*\/\s*sells?\s*(\d+)/i;

/**
 * @param {{direction?:string, pattern?:string}|null|undefined} signal
 * @returns {'buy'|'sell'|'mixed'|null}
 */
export function insiderDirection(signal) {
  if (!signal || typeof signal !== 'object') return null;
  const d = String(signal.direction ?? '').trim().toLowerCase();
  if (d === 'buy' || d === 'sell' || d === 'mixed') return d;
  const p = String(signal.pattern ?? '');
  const m = KO.exec(p) ?? EN.exec(p);
  if (!m) return null;                       // 해석 불가 — 짐작하지 않는다
  const buys = Number(m[1]), sells = Number(m[2]);
  if (!isFinite(buys) || !isFinite(sells)) return null;
  if (buys > sells) return 'buy';
  if (sells > buys) return 'sell';
  return 'mixed';
}

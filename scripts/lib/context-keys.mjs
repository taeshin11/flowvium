/**
 * context-keys.mjs — 존재하지 않는 컨텍스트 키를 읽는 코드를 소스에서 찾는다.
 *
 * 왜 필요한가: optional chaining 과 `?? []` 는 오타를 정상 동작처럼 보이게 만든다.
 *   `ctxRaw?.shorts ?? ctxRaw?.shortSqueeze ?? []` — 셋 다 없는 키였는데 예외도 로그도 없이 빈 배열이 됐고,
 *   그 결과 squeezeMap 이 영구히 비어 후보 점수 룰이 몇 달간 침묵 미발화했다.
 *   .mjs 라 타입 검사도 없다. 그래서 소스 수준에서 막는다.
 *
 * 규칙: 선언(생산 함수의 return 객체)에도 사후 대입(obj.key = ...)에도 없는 키를 읽는데,
 *   *같은 표현식에 실재하는 키 대안이 없으면* 죽은 읽기다.
 *   앞항이 실재하는 방어용 폴백(`?.fearGreed ?? ?.fear_greed`)은 통과시킨다.
 *
 * 한계: 표현식 범위를 '물리적 한 줄'로 본다. 이 저장소의 폴백 체인은 한 줄에 쓰여 있어 충분하지만,
 *   여러 줄로 나뉜 체인은 앞항을 못 보고 오탐할 수 있다. 파서를 붙이지 않고 한계를 적어 둔다.
 */

/** 줄 수를 보존하며 주석을 지운다 — 주석 속 키 이름을 코드로 오인하지 않기 위해. */
export function stripCommentsPreservingLines(src) {
  let out = String(src).replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length));
  out = out.replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, '$1');
  return out;
}

/**
 * 생산 함수의 `return { ... }` 최상위 키.
 * 들여쓰기로 판별하면 한 줄짜리 `return { a: 1 }` 을 놓친다(실제로 테스트에서 걸렸다).
 * 중괄호/대괄호 깊이로 최상위(depth 1)만 세고, 문자열·템플릿 안은 건너뛴다.
 */
function declaredKeys(src, producer) {
  const at = src.indexOf(`function ${producer}`);
  if (at === -1) return new Set();
  const r = src.indexOf('return {', at);
  if (r === -1) return new Set();
  const s = src.slice(r + 'return '.length);
  const keys = new Set();
  let depth = 0, i = 0, quote = null;
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 0) break; i++; continue; }
    if (depth === 1) {
      const m = /^([A-Za-z_]\w*)\s*([:,}])/.exec(s.slice(i));
      // 앞 문자가 식별자 일부면 키 시작이 아니다 (예: obj.key)
      const prev = s[i - 1] ?? '';
      // `credit: creditBalance,` 의 값 식별자를 키로 세면 안 된다 — 앞에 ':' 가 오면 값이다.
      //   (shorthand `macro,` 와 구분되는 유일한 단서다. 실제로 creditBalance·shortInterest·
      //    fedwatch·fgByAsset·fgByCountry 5개를 키로 잘못 수집했다.)
      const beforeVal = /:\s*$/.test(s.slice(Math.max(0, i - 40), i));
      if (m && !/[A-Za-z0-9_.$]/.test(prev) && !beforeVal) { keys.add(m[1]); i += m[1].length; continue; }
    }
    i++;
  }
  return keys;
}

/**
 * @param {string} source            분석할 소스 전문
 * @param {{objectName:string, producer:string}} opt
 * @returns {{declared:Set<string>, assigned:Set<string>, reads:Set<string>, dead:Array<{key:string,line:number,snippet:string}>}}
 */
export function analyzeContextKeys(source, opt) {
  const objectName = opt?.objectName;
  const producer = opt?.producer;
  const raw = String(source ?? '');
  const code = stripCommentsPreservingLines(raw);
  // 2026-08-21: 종전엔 raw 를 넘겨 선언 블록의 *주석*까지 훑었다.
  //   실측: `blockTrades: ... ,   // 2026-06-13: 거래량 버스트 proxy` 의 'proxy' 가
  //   블록 닫는 '}' 앞에 있어 키로 잡혔다(선언 26종으로 뻥튀기).
  //   reads 는 주석을 지웠는데 declaredKeys 만 원본을 받고 있었다 — 같은 실수를 가드 안에서 반복했다.
  const declared = declaredKeys(code, producer);
  const assigned = new Set(
    [...code.matchAll(new RegExp(`${objectName}\\.([A-Za-z_]\\w*)\\s*=(?!=)`, 'g'))].map((m) => m[1]),
  );
  const known = new Set([...declared, ...assigned]);

  const readRe = new RegExp(`${objectName}\\??\\.([A-Za-z_]\\w*)`, 'g');
  const reads = new Set();
  const dead = [];
  const lines = code.split('\n');
  const rawLines = raw.split('\n');

  for (const [i, line] of lines.entries()) {
    const onThisLine = [...line.matchAll(new RegExp(readRe.source, 'g'))].map((m) => m[1]);
    if (onThisLine.length === 0) continue;
    // 같은 줄에 실재하는 키가 하나라도 있으면, 그 줄의 나머지는 방어용 폴백으로 본다.
    const hasResolving = onThisLine.some((k) => known.has(k));
    for (const k of onThisLine) {
      reads.add(k);
      if (known.has(k) || hasResolving) continue;
      dead.push({ key: k, line: i + 1, snippet: (rawLines[i] ?? '').trim() });
    }
  }
  // 같은 키가 여러 줄에서 죽어 있으면 첫 곳만 보고한다 — 목록이 길어지면 조치를 안 하게 된다.
  const seen = new Set();
  const uniq = dead.filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)));
  return { declared, assigned, reads, dead: uniq };
}

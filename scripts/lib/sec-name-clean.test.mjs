#!/usr/bin/env node
/**
 * sec-name-clean.test.mjs — SEC 법인명을 표시명으로 바꿀 때 약어를 깨거나 주(州)코드를 남기지 않는가.
 *
 * 사건(2026-08-22): harness_usNameMismatch 최근 7일 32건을 추적하니 대부분이
 *   `"Visa"→"Visa Inc."` 같은 **정상 축약형을 교정한 것**(= 모델 결함이 아님)이었고,
 *   그중 `EOG:"EOG Resources"→"Eog Resources Inc"` 9건은 **교정이 오히려 틀렸다**.
 *   실제로 발간본 6건에 `"name":"Eog Resources Inc"` 가 나갔다 — 독자에게 보이는 결함이다.
 *
 * 원인은 data/company-names.json 을 만드는 build-company-names.mjs:48 의 titleCase:
 *     s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
 *   SEC 원본은 전부 대문자다("EOG RESOURCES INC"). 통째로 소문자화하니 약어가 죽는다.
 *   접미 코드 제거도 `/\/\w+$/` 라 "AMPHENOL CORP /DE/"(끝이 `/`)를 못 잡아
 *   `Amphenol Corp /De/` 가 16건 남아 있었다.
 *
 * 실측으로 확인한 것(과장하지 않기 위해 적어 둔다):
 *   · 875개를 Yahoo longName 과 대조 → 235개 상이, 그중 이름이 통째로 다른 건 9개뿐.
 *   · Yahoo 도 만능이 아니다: PARA 는 티커 재배정 탓에 Yahoo 가 "Banzai International" 을 준다.
 *     그래서 Yahoo 로 통째 교체하면 새 오류가 들어온다 → 교차검증이 필요하다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const M = await import('./sec-name-clean.mjs')
  .catch(e => { bad(`sec-name-clean.mjs 없음: ${String(e.message).slice(0,60)}`); return null; });
if (!M) { console.log('\n❌ 1건 실패'); process.exit(1); }

// [1] 주(州)코드 접미 제거 — 실측 16건의 형태 그대로
for (const [src, want] of [
  ['AMPHENOL CORP /DE/', 'Amphenol Corp'],
  ['ENTERGY CORP /DE/', 'Entergy Corp'],
  ['VERTEX PHARMACEUTICALS INC / MA', 'Vertex Pharmaceuticals Inc'],
  ['HUNTINGTON BANCSHARES INC /MD/', 'Huntington Bancshares Inc'],
  ['GROUP INC/RI', 'Group Inc'],
  ['BANK OF MONTREAL /CAN/', 'Bank of Montreal'],
]) {
  const got = M.secTitleCase(src);
  got === want ? ok(`${src} → ${got}`) : bad(`${src} → "${got}" (기대 "${want}")`);
}

// [2] 티커와 같은 약어는 대문자 유지 — EOG 사건
{
  const got = M.secTitleCase('EOG RESOURCES INC', 'EOG');
  /^EOG /.test(got) ? ok(`약어 보존: ${got}`) : bad(`약어가 깨진다: ${got}`);
}
{
  const got = M.secTitleCase('KKR & CO. INC.', 'KKR');
  /^KKR /.test(got) ? ok(`약어 보존: ${got}`) : bad(`약어가 깨진다: ${got}`);
}

// [3] 일반 단어는 그대로 title-case (과잉 대문자화 금지)
for (const [src, tk, want] of [
  ['FOX CORP', 'FOX', 'FOX Corp'],          // 티커와 같은 단어 → 대문자 (약어인지 단어인지 구분 불가, 보수적으로 티커 존중)
  ['MICROSOFT CORP', 'MSFT', 'Microsoft Corp'],
  ['BANK OF AMERICA CORP', 'BAC', 'Bank of America Corp'],
]) {
  const got = M.secTitleCase(src, tk);
  got === want ? ok(`${src} → ${got}`) : bad(`${src} → "${got}" (기대 "${want}")`);
}

// [4] 소문자 연결어는 소문자 (of/and/the — 회사명 관례)
M.secTitleCase('BANK OF NEW YORK MELLON CORP') === 'Bank of New York Mellon Corp'
  ? ok('연결어 of 는 소문자') : bad(`연결어 처리: ${M.secTitleCase('BANK OF NEW YORK MELLON CORP')}`);

// [5] 두 권위 교차검증 — 같은 회사면 표시명(Yahoo)을 쓰고, 어긋나면 보수적으로 SEC 를 남긴다
{
  const a = M.pickDisplayName({ sec: 'EOG RESOURCES INC', yahoo: 'EOG Resources, Inc.', ticker: 'EOG' });
  a.name === 'EOG Resources, Inc.' && a.source === 'yahoo'
    ? ok(`일치 시 Yahoo 표기 채택: ${a.name}`) : bad(`일치인데 Yahoo 를 안 쓴다: ${JSON.stringify(a)}`);
}
{
  // 실측 반례: PARA 는 티커 재배정으로 Yahoo 가 다른 회사를 준다
  const a = M.pickDisplayName({ sec: 'PARAMOUNT GLOBAL', yahoo: 'Banzai International, Inc.', ticker: 'PARA' });
  a.source === 'sec' && /Paramount/.test(a.name)
    ? ok(`불일치 시 SEC 유지 + 표시: ${a.name} (${a.conflict ? '충돌 기록됨' : '충돌 미기록'})`)
    : bad(`불일치인데 Yahoo 를 쓴다: ${JSON.stringify(a)}`);
  a.conflict === true ? ok('충돌을 조용히 넘기지 않고 표시한다') : bad('충돌을 삼킨다 — 사람이 볼 수 없다');
}
{
  const a = M.pickDisplayName({ sec: 'MOODYS CORP /DE/', yahoo: "Moody's Corporation", ticker: 'MCO' });
  a.name === "Moody's Corporation" ? ok(`주코드 사례도 Yahoo 채택: ${a.name}`) : bad(`${JSON.stringify(a)}`);
}
{
  const a = M.pickDisplayName({ sec: 'EOG RESOURCES INC', yahoo: null, ticker: 'EOG' });
  a.source === 'sec' && /^EOG /.test(a.name) ? ok('Yahoo 없으면 SEC 정리본') : bad(`${JSON.stringify(a)}`);
}

// [5b] ETF/ETN 은 SEC 에 발행사로 등록된다 — 상품명과 다른 게 정상이지 충돌이 아니다
{
  const a = M.pickDisplayName({ sec: 'BARCLAYS BANK PLC', yahoo: 'iPath Series B S&P 500 VIX Short-Term Futures ETN', ticker: 'VXX', isFund: true });
  a.source === 'yahoo' && a.conflict === false
    ? ok(`펀드는 상품명 채택: ${a.name.slice(0, 40)}`)
    : bad(`펀드인데 발행사명을 쓴다: ${JSON.stringify(a)}`);
  const b = M.pickDisplayName({ sec: 'BARCLAYS BANK PLC', yahoo: 'iPath Series B …', ticker: 'VXX', isFund: false });
  b.source === 'sec' && b.conflict === true
    ? ok('일반 주식이면 여전히 충돌로 잡는다 (과잉 일반화 방지)')
    : bad(`isFund 플래그가 무시된다: ${JSON.stringify(b)}`);
}

// [6] 빌더가 이 모듈을 쓰는가
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../build-company-names.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  /sec-name-clean\.mjs/.test(src) ? ok('빌더가 단일 출처를 쓴다') : bad('빌더가 아직 자체 titleCase 를 쓴다');
  /const titleCase = \(s\) => s\.toLowerCase\(\)/.test(src)
    ? bad('옛 titleCase 가 남아 있다 — 두 벌이면 갈린다') : ok('옛 titleCase 제거됨');
}

console.log(fail === 0 ? '\n✅ sec-name-clean 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

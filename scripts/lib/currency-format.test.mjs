#!/usr/bin/env node
/**
 * currency-format.test.mjs — 발간 텍스트의 통화 표기 정규화.
 *
 * 배경(2026-08-20 발간본 눈검증): 같은 한 줄 안에서 표기가 갈렸다.
 *     "현재 ₩1397000 → 손절선 ~₩1299210.00 (-7%) / 200MA 위(₩1,224,720), 52주:₩1,022,000-₩1,630,000"
 *   코드가 만든 값(MA·52주)에는 천단위 구분자가 있고, LLM 이 쓴 값(현재·손절선)에는 없다.
 *   원화인데 소수점 2자리(₩1299210.00)까지 붙었다 — 원은 소수 단위가 없다.
 *
 *   generate-report-local.mjs 6i 의 정규화가 '값이 어긋날 때만' 돈다:
 *       if (rationaleStop === stopP) continue;
 *       if (Math.abs(rationaleStop - stopP) / stopP < 0.05) continue;
 *   그래서 값이 맞고 표기만 틀린 경우는 통과해 버린다. 서식 교정이 값 교정에 종속돼 있었다.
 *   두 관심사를 분리한다 — 표기는 값과 무관하게 항상 맞춘다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let C;
try { C = await import('./currency-format.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

// [1] 원화 — 천단위 구분자 + 소수 제거
const cases = [
  ['현재 ₩1397000 → 손절선 ~₩1299210.00 (-7%)', '현재 ₩1,397,000 → 손절선 ~₩1,299,210 (-7%)'],
  ['₩86500', '₩86,500'],
  ['₩1,022,000-₩1,630,000', '₩1,022,000-₩1,630,000'],           // 이미 올바르면 그대로
  // 반올림은 Math.round — 저장소의 기존 서식(db.mjs·6i 의 Math.round(stopP).toLocaleString())과 맞춘다.
  // 36130.50 → 36,131. 처음엔 절사(36,130)를 기대값으로 썼는데 근거 없는 선택이었다.
  ['₩38850 → 손절선 ~₩36130.50', '₩38,850 → 손절선 ~₩36,131'],
];
for (const [inp, want] of cases) {
  const got = C.normalizeCurrencyText(inp);
  got === want ? ok(`${JSON.stringify(inp).slice(0,42)} → ${got.slice(0,40)}`) : bad(`${inp}\n           → ${got}\n           기대 ${want}`);
}

// [2] 달러 — 소수 2자리까지, 천단위 구분자
C.normalizeCurrencyText('$1234.5678') === '$1,234.57' ? ok('$ 소수 2자리 + 구분자') : bad(`$ 처리: ${C.normalizeCurrencyText('$1234.5678')}`);
C.normalizeCurrencyText('$186.39') === '$186.39' ? ok('$ 이미 올바르면 그대로') : bad('$ 정상값을 바꿈');
C.normalizeCurrencyText('현재 $397.72 → 손절선 ~$369.88 (-7%)') === '현재 $397.72 → 손절선 ~$369.88 (-7%)'
  ? ok('$ 문장 보존') : bad('$ 문장이 바뀜');

// [2b] 숫자 뒤의 문장부호를 삼키면 안 된다.
//      실측: "52주:₩1,022,000-₩1,630,000, 진입지지선:" 에서 ₩1,630,000, (뒤 쉼표 포함)이 매칭돼
//      정상값을 결함으로 봤다. 숫자는 쉼표로 끝날 수 없다.
const withComma = '52주:₩1,022,000-₩1,630,000, 진입지지선:₩1,224,720';
C.normalizeCurrencyText(withComma) === withComma ? ok('뒤따르는 쉼표 보존') : bad(`문장부호 훼손: ${C.normalizeCurrencyText(withComma)}`);
C.findBadCurrency(withComma).length === 0 ? ok('쉼표 뒤 정상값 오탐 없음') : bad(`오탐: ${C.findBadCurrency(withComma)}`);

// [3] 통화기호 없는 숫자는 건드리지 않는다 — RSI·거래량·퍼센트를 망가뜨리면 안 된다
const keep = 'RSI 62, 거래량+47%, 200MA 위, 2026년 1234 포인트';
C.normalizeCurrencyText(keep) === keep ? ok('통화기호 없는 숫자 보존') : bad(`무관한 숫자를 건드림: ${C.normalizeCurrencyText(keep)}`);

// [4] 빈/이상 입력
C.normalizeCurrencyText('') === '' && C.normalizeCurrencyText(null) === '' ? ok('빈 입력 안전') : bad('빈 입력 처리 이상');

// [5] 발간 텍스트에 잘못된 원화 표기가 남아 있는지 검사기
C.findBadCurrency('현재 ₩1397000').length > 0 ? ok('잘못된 표기 검출') : bad('검출 실패');
C.findBadCurrency('현재 ₩1,397,000').length === 0 ? ok('올바른 표기는 통과') : bad('정상을 결함으로 봄');

// ── 2026-08-21: 서식 패스가 값·기호 교정보다 *먼저* 돌아 무력화된 사건 ───────────────────
// 발간본에 ₩1,299,210.00 · ₩36,130.50 (원화에 소수점) 6건이 다시 나왔다. 함수는 정상이었다.
// generate-report-local.mjs 의 6j-2 (a) 가 KR 종목의 "$숫자" 를 "₩숫자" 로 *기호만* 바꾸는데,
// 내 서식 패스는 그보다 앞(6i 직후)에 있었다. 그 시점엔 문자열이 아직 "$1,299,210.00" 이라
// 달러 규칙상 소수 2자리가 정상이라 통과했고, 이후 기호가 ₩ 로 바뀌며 위법 표기가 됐다.
// 이번 세션에서 세 번째로 겪은 "정규화가 대상보다 먼저 도는" 유형이다 — 순서를 테스트로 못 박는다.
{
  // 기호 교정을 흉내낸 뒤 서식을 적용하면 올바른 원화 표기가 나온다.
  const afterSymbolSwap = '현재 ₩1,397,000 → 손절선 ~₩1,299,210.00 (-7%)';
  const out = C.normalizeCurrencyText(afterSymbolSwap);
  out.includes('₩1,299,210') && !out.includes('.00')
    ? ok('기호 교정 후 서식 적용 → 원화 소수점 제거')
    : bad(`기호 교정 후에도 소수점 잔존: ${out}`);

  // 반대 순서(서식 먼저 → 기호 교정)면 소수점이 살아남는다 — 이게 실제로 벌어진 일이다.
  const beforeSwap = '현재 $1,397,000 → 손절선 ~$1,299,210.00 (-7%)';
  const swapped = C.normalizeCurrencyText(beforeSwap).replace(/\$(\d)/g, '₩$1');
  swapped.includes('.00')
    ? ok('순서를 뒤집으면 실제로 소수점이 남는다(사건 재현)')
    : bad('사건 재현 실패 — 가정이 틀렸으므로 원인 분석을 다시 해야 한다');
}

// 생성 코드에서 서식 패스가 기호 교정보다 뒤에 오는지 — 소스 순서로 강제한다.
{
  const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
  const swapIdx = gen.indexOf("replace(/\\$(\\d)/g");          // 6j-2 (a) 기호 교정
  const fmtIdx  = gen.lastIndexOf('normalizeCurrencyText(');    // 서식 패스
  swapIdx === -1
    ? bad('6j-2 기호 교정 지점을 못 찾음 — 테스트 앵커가 낡았다')
    : (fmtIdx > swapIdx
        ? ok('서식 패스가 기호 교정 뒤에 있다')
        : bad(`서식 패스가 기호 교정보다 앞에 있다 (fmt@${fmtIdx} < swap@${swapIdx}) — 무력화된다`));
}

// ── 단위 접미사가 붙은 값은 건드리면 안 된다 (2026-08-21 라이브에서 발견한 잠재 지뢰) ──────
// 발간본에 "💰 ₩1.60조 · 상대 Ras" 가 있다. 조 단위라 소수가 정상이다.
// 이 패스를 stopLossRationale 밖으로 넓히는 순간 ₩1.60조 → ₩2조 가 되어 25% 값 오류가 난다.
// 지금은 적용 범위가 좁아 사고가 안 났을 뿐이다 — 함수 자체를 안전하게 만든다.
for (const [inp, want] of [
  ['💰 ₩1.60조 · 상대 Ras · 매출대비 21.41%', '💰 ₩1.60조 · 상대 Ras · 매출대비 21.41%'],
  ['거래대금 ₩3.5억 수준',                     '거래대금 ₩3.5억 수준'],
  ['시총 ₩12.4만 단위',                        '시총 ₩12.4만 단위'],
  ['$1.2B 규모',                                '$1.2B 규모'],
  ['$3.4M 매출',                                '$3.4M 매출'],
]) {
  const got = C.normalizeCurrencyText(inp);
  got === want ? ok(`단위 접미사 보존: ${inp.slice(0, 24)}`) : bad(`단위 값 훼손: ${inp} → ${got}`);
}
// 접미사가 없으면 종전대로 정규화한다 (회귀 방지)
C.normalizeCurrencyText('손절선 ~₩1,299,210.00') === '손절선 ~₩1,299,210'
  ? ok('접미사 없는 값은 그대로 정규화') : bad('접미사 규칙이 정상 경로를 막았다');
C.findBadCurrency('💰 ₩1.60조').length === 0
  ? ok('findBadCurrency 도 단위 값을 결함으로 보지 않는다') : bad('findBadCurrency 오탐');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

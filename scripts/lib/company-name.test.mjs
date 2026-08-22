#!/usr/bin/env node
/**
 * company-name.test.mjs — 종목명 해석의 단일 소스.
 *
 * 배경(2026-08-20 발간본 눈검증): 저녁 보고서 '조건부 진입 감시' 블록에
 *   회사명 자리에 제품/사업부문 이름이 찍혔다:
 *     EPYC Server CPUs (AMD) · Networking ASICs (AVGO) · Conductor Etch (LRCX)
 *   추적하니 generate-report-local.mjs 의 conditionalEntryWatch 가
 *     name: tickerMeta.meta?.[c.ticker]?.name
 *   즉 data/candidate-tickers.json 의 meta.name 을 그대로 쓴다. 그 필드가 오염돼 있다
 *   (같은 파일에서 LOGI → "PC Peripherals (Mice, Keyboards)", BRK.B → "Insurance (GEICO, Gen Re)").
 *
 *   그런데 이 저장소에는 이미 권위 소스가 있다 — data/company-names.json (904종목,
 *   generate-report-local.mjs:123 주석: "실제 회사명 (name 환각 override 권위 소스)").
 *   AMD → "Advanced Micro Devices" 로 정확히 들어 있다. 쓰는 곳만 안 쓰고 있었다.
 *
 *   한국 종목은 company-names.json 에 없고 candidate-tickers.json 의 krNames 가 담당한다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let N;
try { N = await import('./company-name.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

// [1] 권위 소스가 이긴다 — meta.name 이 오염돼 있어도.
//   2026-08-22: 기대값을 문자열로 박아 두었더니 권위 파일이 더 정확해질 때 테스트가 깨졌다
//   (LRCX "Lam Research Corp" → "Lam Research Corporation"). 검사할 것은 표기가 아니라
//   **권위 파일을 따르는가**와 **제품/사업부문 이름을 회사명이라 하지 않는가** 이다.
{
  const { readFileSync } = await import('fs');
  const AUTH = JSON.parse(readFileSync(new URL('../../data/company-names.json', import.meta.url), 'utf8'));
  const POLLUTED = { AMD: { name: 'EPYC Server CPUs' }, AVGO: { name: 'Networking ASICs' }, LRCX: { name: 'Conductor Etch' } };
  for (const t of ['AMD', 'AVGO', 'LRCX']) {
    const got = N.resolveCompanyName(t, { meta: POLLUTED });
    got === AUTH[t]
      ? ok(`${t} → ${got} (권위 파일과 일치)`)
      : bad(`${t} → ${JSON.stringify(got)} — 권위 파일은 ${JSON.stringify(AUTH[t])}`);
    got !== POLLUTED[t].name ? ok(`${t} 제품명(${POLLUTED[t].name}) 거부`) : bad(`${t} 제품명을 회사명으로 썼다`);
  }
}

// [2] 한국 종목은 krNames 에서
for (const [t, want] of [['241710.KQ','코스메카코리아'], ['062040.KS','산일전기']]) {
  const got = N.resolveCompanyName(t);
  got === want ? ok(`${t} → ${got}`) : bad(`${t} → ${JSON.stringify(got)} (기대 ${want})`);
}

// [3] 권위 소스에 없고 meta.name 이 부적격이면 티커로 — 제품명을 회사명이라 하지 않는다
const bogus = N.resolveCompanyName('ZZZZ', { meta: { ZZZZ: { name: 'PC Peripherals (Mice, Keyboards)' } } });
bogus === 'ZZZZ' ? ok('부적격 meta.name 거부 → 티커 사용') : bad(`부적격 이름을 채택: ${JSON.stringify(bogus)}`);

// [4] 권위 소스에 없지만 meta.name 이 멀쩡하면 그건 쓴다
const okName = N.resolveCompanyName('YYYY', { meta: { YYYY: { name: 'Acme Industries' } } });
okName === 'Acme Industries' ? ok('적격 meta.name 은 채택') : bad(`적격 이름을 버림: ${JSON.stringify(okName)}`);

// [5] 아무 정보 없으면 티커 (null 이나 빈 문자열을 내지 않는다 — 화면에 빈칸이 뜬다)
N.resolveCompanyName('QQQQ') === 'QQQQ' ? ok('정보 없으면 티커 반환') : bad('빈 값 반환');
N.resolveCompanyName('') === '' ? ok('빈 입력 안전') : bad('빈 입력 처리 이상');

// [6] 실제 보고서 소스에서 오염 이름이 사라졌는가 — 배선 확인
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
!/name: tickerMeta\.meta\?\.\[c\.ticker\]\?\.name/.test(src)
  ? ok('conditionalEntryWatch 가 meta.name 을 직접 쓰지 않음')
  : bad('conditionalEntryWatch 가 여전히 오염 소스를 직접 참조');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

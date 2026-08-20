#!/usr/bin/env node
/**
 * company-name-plausible.test.mjs — 티커 메타의 name 이 '회사명'인지 판정.
 *
 * 배경(2026-08-20): 권위 매핑(티커→한국어명)과 티커→영문명을 조인해 확정 번역 사전을 채웠는데,
 *   영문명 소스의 품질이 고르지 않았다. 실측:
 *     sp500 meta  GOOGL → "Mountain View, California"   (회사명이 아니라 소재지)
 *     candidate   LOGI  → "PC Peripherals (Mice, Keyboards)"  (사업부문 설명)
 *                 BRK.B → "Insurance (GEICO, Gen Re)"
 *   그대로 넣으면 "Mountain View, California → 구글" 같은 잘못된 확정이 사전에 박힌다.
 *   사전은 만료가 없으므로 잘못 들어가면 계속 잘못 나간다 — 넣기 전에 걸러야 한다.
 *
 *   회사 접미사(Inc./Corp./Ltd.)는 정상이므로 쉼표만으로 거르면 안 된다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let C;
try { C = await import('./company-name-plausible.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const GOOD = ['Tesla, Inc.', 'Nike, Inc.', 'Workday, Inc.', 'BXP, Inc.', 'Microsoft', 'Applied Materials',
              'Lam Research', 'Micron Technology', 'Texas Roadhouse Restaurants', 'A. O. Smith', '3M',
              'Duke Energy', 'KLA Corporation', 'Etsy',
              // "(The)" 는 설명이 아니라 표기 관습이다 — 괄호 규칙의 예외.
              'Coca-Cola Company (The)', 'Walt Disney Company (The)', 'Home Depot (The)', 'Mosaic Company (The)'];
const BADS = ['Mountain View, California', 'Cupertino, California', 'Armonk, New York',
              'PC Peripherals (Mice, Keyboards)', 'Insurance (GEICO, Gen Re)',
              'Advanced Packaging (FC-BGA, SiP)', 'Application Services (CDN, DDoS)',
              'Financial Advisory (M&A, Restructuring)', 'Owned Brands (Cat & Jack, Good & Gather, Up&Up)',
              'Online Music (QQ Music, KuGou, Kuwo)', 'Retail Net Lease Properties (Ground Leases, NNN)'];

for (const g of GOOD) C.isPlausibleCompanyName(g) ? ok(`통과: ${g}`) : bad(`정상 회사명을 거부: ${g}`);
for (const b of BADS) !C.isPlausibleCompanyName(b) ? ok(`거부: ${b}`) : bad(`부적격을 통과시킴: ${b}`);

// 빈/이상 입력
!C.isPlausibleCompanyName('') && !C.isPlausibleCompanyName(null) && !C.isPlausibleCompanyName('AB')
  ? ok('빈/과단축 입력 거부') : bad('빈 입력 처리 이상');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * cascade-asset.test.mjs — 뉴스 cascade 의 asset 이 지어낸 회사명을 싣지 않는가.
 *
 * 배경(2026-08-22 눈검증). 07:01 발간본 /ko 화면을 직접 보다가 뉴스 태그에
 *   `US Coffee Retail Sector` 가 영문으로 있는 걸 발견했고, 파고드니 더 나쁜 게 나왔다.
 *   라이브 /api/news-cascade?locale=ko 실측 — cascade 57건 중 asset 17건(29%)이 티커 형식이 아니었고,
 *   그중 KR 4건은 **티커↔회사명이 틀렸다**(DART 3,984사 권위 소스 대조):
 *
 *     LLM 주장                        DART 실제        판정
 *     KRX:000670 (Lg Chem)            영풍            ❌ (LG화학=051910)
 *     KRX:005380 (Samsung SDI)        현대자동차       ❌ (삼성SDI=006400)
 *     KRX:035720 (LG Energy Solution) 카카오          ❌ (LG엔솔=373220)
 *     KRX:035490 (SK Infinitum)       비상장/없음      ❌ 존재하지 않음
 *
 *   CLAUDE.md 가 CPRT="Cypress Semiconductor" 사건 뒤 규칙까지 만들어 둔 바로 그 부류다.
 *   규칙 2는 "새 LLM 출력 필드를 노출하면 cross-check probe 를 같이 추가" 인데,
 *   `cascades[].asset` 은 UI 에 배지로 그려지면서 probe 가 하나도 없었다.
 *   parseCascade 는 reason 만 검사한다(한자·garbage). asset 은 손도 안 댄다.
 *
 *   KR 은 저장소 어디에도 영문명 매핑이 없다 — DART·universe-search·kr-major-indexes 전부 한글이다.
 *   그래서 "Lg Chem" 이 맞는지 문자열로 검증할 방법이 없다.
 *   검증할 수 없는 주장을 화면에 싣지 않는다 — 괄호 속 회사명은 버리고 코드만 권위 소스로 확인한다.
 *   존재하지 않는 코드는 통째로 버린다(그 항목의 reason 도 그 회사 얘기라 살릴 게 없다).
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { normalizeCascadeAsset, loadAssetAuthority } = await import('./cascade-asset.mjs');
const auth = loadAssetAuthority(ROOT);

auth.krNames.size > 3000
  ? ok(`KR 권위 소스 ${auth.krNames.size}사 (DART 상장 전수)`)
  : bad(`KR 권위 소스가 ${auth.krNames.size}건뿐 — 일부만 검증하면 나머지는 silent 통과한다`);

// 라이브에서 실제로 관측된 값들 그대로
const cases = [
  // [입력, 기대 kind, 기대 asset(또는 null), 설명]
  ['KRX:035720 (LG Energy Solution)', 'invalid', null,      '틀린 이름 주장이 붙은 항목은 통째로 버린다(reason 도 그 회사 얘기다)'],
  ['KRX:000660 (SK Hynix)',           'invalid', null,      '맞는 주장이어도 KR 은 검증 수단이 없어 함께 버린다'],
  ['KRX:035490 (SK Infinitum)',       'invalid', null,      '존재하지 않는 코드'],
  ['KRX:000670 (Lg Chem)',            'invalid', null,      '000670 은 실제로 영풍이다 — 이름 주장이 틀렸다'],
  ['035720.KS',                       'ticker', '035720.KS', '맨 티커는 그대로 통과한다(프롬프트가 요구하는 형태)'],
  ['373220.KS',                       'ticker', '373220.KS', '이미 정규형인 KR 티커'],
  ['DUTCH',                           'ticker', 'DUTCH',     '평범한 US 티커'],
  ['6752.T',                          'ticker', '6752.T',    '일본 티커는 숫자로 시작한다(소니)'],
  ['1211.HK',                         'ticker', '1211.HK',   '홍콩 티커(BYD)'],
  ['300750.SZ',                       'ticker', '300750.SZ', '선전 티커(CATL) — KR 6자리와 헷갈리면 안 된다'],
  ['BRK.B',                           'ticker', 'BRK.B',     '클래스 접미사'],
  ['12345',                           'theme',  '12345',     '글자 없는 순수 숫자는 티커로 보지 않는다'],
  ['Caterpillar (NYSE: CAT)',         'ticker', 'CAT',       'US 는 괄호 속 티커를 쓰고 이름은 버린다'],
  ['UPS (NYSE: UPS)',                 'ticker', 'UPS',       '이름=티커인 경우'],
  ['US Coffee Retail Sector',         'theme',  'US Coffee Retail Sector', '서술 라벨은 테마로 보존'],
  ['EV Batteries',                    'theme',  'EV Batteries',            '프롬프트가 허용한 하위섹터'],
  ['Software Sector ETF (e.g., IBB)', 'theme',  'Software Sector ETF',     '근거 없는 티커 연결(e.g.)은 버린다'],
  ['US Equity Market (SPY)',          'theme',  'US Equity Market',        '테마에 붙은 티커 힌트도 버린다'],
  ['GOLD (Gold Futures)',             'ticker', 'GOLD',      '괄호를 뗀 뒤 티커면 티커다 — 테마로 보면 번역돼 버린다'],
  ['JPM (JPMorgan Chase)',            'ticker', 'JPM',       '거래소 표기가 없어도 티커+이름 주장이다'],
  ['SLV (Silver ETF)',                'ticker', 'SLV',       "실측: 테마로 잘못 보고 '실브' 로 번역됐다"],
  ['DQ (Daqo New Energy)',            'ticker', 'DQ',        '2글자 티커'],
  ['CPRT (Cypress Semiconductor)',    'invalid', null,       'CPRT 사건 재현 — Copart 와 토큰 겹침 0'],
];
for (const [input, kind, expected, why] of cases) {
  const r = normalizeCascadeAsset(input, auth);
  const gotAsset = r.kind === 'invalid' ? null : r.asset;
  (r.kind === kind && gotAsset === expected)
    ? ok(`${why}: "${input}" → ${r.kind}${gotAsset ? ' ' + gotAsset : ''}`)
    : bad(`"${input}" → ${r.kind}/${gotAsset} (기대 ${kind}/${expected}) — ${why}`);
}

// 이름을 버렸다는 사실은 조용히 넘어가면 안 된다 — Karpathy 학습 입력이 된다
const claim = normalizeCascadeAsset('KRX:035720 (LG Energy Solution)', auth);
claim.defect
  ? ok(`검증 불가 이름 주장을 결함으로 보고한다 (${claim.defect})`)
  : bad('이름 주장을 조용히 버린다 — 환각 추세가 학습에 안 잡힌다');

// 실제 배선
const route = readFileSync(resolve(ROOT, 'src/app/api/news-cascade/route.ts'), 'utf8');
/normalizeCascadeAsset/.test(route)
  ? ok('news-cascade route 가 실제로 호출한다')
  : bad('정규화기를 만들었는데 route 가 안 부른다 — 소비처 0');
/assetKind === 'theme'/.test(route) && /tr\?\.a\?\.trim\(\)/.test(route)
  ? ok('테마 라벨은 번역 경로를 탄다')
  : bad("테마 asset 이 번역에서 빠진다 — /ko 화면에 영문이 남는다 (166행 '티커라 그대로' 가정)");

// 캐시가 이미 오염돼 있다 — 읽기 경계에서도 걸러야 고친 즉시 화면이 바뀐다.
/dropForeignTitles[\s\S]{0,1200}?sanitizeAssets/.test(route)
  ? ok('캐시 읽기 경계(dropForeignTitles)에서도 asset 을 검증한다')
  : bad('신규 분석에만 검증이 걸린다 — 오염된 캐시가 TTL 동안 계속 환각을 내보낸다');

console.log(fail === 0 ? '\n✅ cascade-asset 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

/**
 * cascade-asset.mjs — 뉴스 cascade 의 `asset` 을 권위 소스로 정규화한다.
 *
 * 왜 (2026-08-22 눈검증): 07:01 발간본 /ko 화면에서 뉴스 태그에 영문 라벨이 보였고,
 *   파고드니 티커↔회사명 환각이 라이브에 실려 있었다. 실측 57건 중 asset 17건(29%)이
 *   티커 형식이 아니었고 KR 4건은 이름이 틀렸다(DART 3,984사 대조):
 *     KRX:000670 (Lg Chem) → 실제 영풍 · KRX:005380 (Samsung SDI) → 실제 현대자동차
 *     KRX:035720 (LG Energy Solution) → 실제 카카오 · KRX:035490 (SK Infinitum) → 비상장
 *
 *   CLAUDE.md 가 CPRT="Cypress Semiconductor" 사건 뒤 규칙까지 만들어 둔 부류인데,
 *   `cascades[].asset` 은 UI 배지로 그려지면서 cross-check probe 가 하나도 없었다.
 *   parseCascade 는 reason 만 본다(한자·garbage). asset 은 손도 안 댄다.
 *   route.ts 의 주석은 "asset 은 ticker/심볼이라 그대로" 라고 *가정* 하는데,
 *   정작 프롬프트(766행)가 "티커 **또는 하위섹터**" 를 허용한다. 가정과 계약이 어긋나 있었다.
 *
 * 판정 원칙 — 검증할 수 없는 주장은 화면에 싣지 않는다.
 *   · KR 은 저장소 어디에도 영문명 매핑이 없다(DART·universe-search·kr-major-indexes 전부 한글).
 *     그래서 "Lg Chem" 이 맞는지 문자열로 검증할 방법이 *없다*. 없는 검증을 있는 척하지 않고,
 *     괄호 속 이름 주장은 버리고 코드만 권위 소스로 확인한다.
 *   · 코드가 권위 소스에 없으면 그 항목을 통째로 버린다 — reason 도 그 회사 얘기라 살릴 게 없다.
 *   · US 는 company-names.json(SEC 추출)이 있으므로 이름을 대조할 수 있다. 어긋나면 버린다.
 *   · 서술 라벨(EV Batteries 등)은 프롬프트가 허용한 설계이므로 테마로 보존하고,
 *     대신 번역 경로를 태운다. 그게 /ko 에 영문이 남던 이유다.
 *   버린 주장은 조용히 넘기지 않고 defect 로 보고한다 — Karpathy 학습 입력이다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 권위 소스를 읽는다. 호출부가 주입하도록 분리한 이유는 순수 판정 함수를 테스트하기 위해서다.
 * @param {string} root 저장소 루트
 */
export function loadAssetAuthority(root) {
  const krNames = new Map();   // '035720' → { ticker: '035720.KS', name: '카카오' }
  const usNames = new Map();   // 'CAT' → 'Caterpillar Inc.'
  try {
    // DART 상장 전수(3,984). 가장 완전한 KR 권위 소스다.
    const dart = JSON.parse(readFileSync(resolve(root, 'data/dart-corp-codes.json'), 'utf8'));
    for (const [code, v] of Object.entries(dart.map ?? {})) krNames.set(code, { ticker: null, name: v.corpName });
  } catch { /* 없으면 KR 판정을 못 한다 — 아래에서 size 로 드러난다 */ }
  try {
    // 시장 접미사(.KS/.KQ)는 DART 에 없다. 지수 구성 메타에서 가져온다.
    const kx = JSON.parse(readFileSync(resolve(root, 'data/kr-major-indexes.json'), 'utf8'));
    for (const meta of [kx.kospi?.meta, kx.kosdaq?.meta]) {
      for (const key of Object.keys(meta ?? {})) {
        const code = key.split('.')[0];
        const e = krNames.get(code);
        if (e) e.ticker = key;
      }
    }
  } catch { /* 접미사는 아래 기본값으로 채운다 */ }
  try {
    const names = JSON.parse(readFileSync(resolve(root, 'data/company-names.json'), 'utf8'));
    for (const [t, n] of Object.entries(names)) if (typeof n === 'string') usNames.set(t.toUpperCase(), n);
  } catch { /* US 이름 대조는 건너뛴다 */ }
  // 이름 → 티커 역인덱스. '주장이 *다른 실재 회사* 인가' 를 묻기 위해 필요하다(아래 참조).
  const usByName = new Map();
  for (const [t, n] of usNames) { const k = normName(n); if (k && !usByName.has(k)) usByName.set(k, t); }
  return { krNames, usNames, usByName };
}

/** 회사명 비교용 정규화 — 법인 접미사와 구두점을 걷어낸다. */
const normName = (s) => String(s).toLowerCase()
  .replace(/[.,'"&()]/g, ' ')
  .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|sa|nv|ag|holdings?|group|the|class [ab])\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

/**
 * 두 회사명이 양립 가능한가 — *겹치는 의미 토큰이 하나도 없으면* 불일치로 본다.
 *
 * 부분 문자열 포함으로 보면 안 된다(실측): 'GOLD (Gold Futures)' 는 권위 소스의
 *   'Barrick Gold' 와 서로 포함하지 않아 불일치로 잡히는데, 실제로는 티커에 붙은 서술이다.
 *   반대로 CPRT 사건의 Copart ↔ Cypress Semiconductor 는 겹치는 토큰이 0이다.
 * 겹침 0 을 기준으로 하면 '지어낸 다른 회사' 는 잡고 '서술이 붙은 같은 대상' 은 통과한다.
 * 완벽한 판정은 아니다 — 토큰이 우연히 겹치는 환각은 통과한다. 다만 괄호 속 이름은
 * 화면에 싣지 않으므로(항상 버린다) 남는 위험은 '그 항목을 살려둔다' 까지다.
 */
/**
 * 괄호 속 주장이 *다른 실재 회사* 로 되짚어지는가 — **심각도 판정에만** 쓴다.
 *
 * 처음엔 이걸 통과/폐기의 기준으로 삼으려 했다. 'GOLD (XAU/USD)' 와 'CME (Corn Futures)' 가
 *   이름 불일치로 버려지는 게 과하다고 봤기 때문이다(괄호 속이 회사명이 아니라 서술이다).
 *   그런데 그러자 'CPRT (Cypress Semiconductor)' 까지 통과했다 — company-names.json 은
 *   SEC 추출 ~499개라 Cypress 가 없어 되짚어지지 않는다. CPRT 부류를 놓치면 이 검증의
 *   존재 이유가 사라진다(CLAUDE.md 가 그 사건 때문에 규칙을 만들었다).
 *
 * 그래서 판정은 보수적으로 되돌린다 — **권위 소스의 이름과 양립하지 않는 주장이 붙으면 버린다.**
 *   근거: 버리는 건 asset 만이 아니라 그 항목의 reason 이다. 주장을 검증할 수 없으면
 *   그 reason 이 이 티커에 관한 것인지도 보증할 수 없다. KR 규칙과 같은 논리다.
 *   비용: 'GOLD (XAU/USD)' 같은 서술 주석이 붙은 항목을 잃는다(관측 20건 중 2건).
 *   그 비용을 감수하는 이유 — 'GOLD' 를 Barrick Gold 라 라벨한 채 금 시세 얘기를 붙이는 것도
 *   틀린 표시다. 그리고 조인 프롬프트가 맨 티커를 요구하므로 이 분기 자체가 드물어졌다(실측).
 *
 * 되짚기는 남겨 둔다 — '확실히 다른 회사'(high)와 '검증 불가'(medium)를 구분해
 *   hallucination_history 에 다른 무게로 적재하기 위해서다. 둘 다 버리는 건 같다.
 */
function claimsDifferentCompany(auth, ticker, claim) {
  const other = auth.usByName?.get(normName(claim));
  return Boolean(other && other !== ticker);
}

function compatibleName(known, claim) {
  if (!known || !claim) return true;
  const a = new Set(normName(known).split(' ').filter((w) => w.length > 1));
  const b = new Set(normName(claim).split(' ').filter((w) => w.length > 1));
  if (!a.size || !b.size) return true;
  for (const w of b) if (a.has(w)) return true;
  return false;
}

const KR_CODE = /(?:^|[^0-9])(\d{6})(?:\.(K[SQ]))?(?:$|[^0-9])/;
const US_EXCHANGE = /\((?:NYSE|NASDAQ|NYSEARCA|AMEX|CBOE)\s*:\s*([A-Z][A-Z.\-]{0,6})\)/i;
// 티커는 알파벳으로 시작한다고 가정하면 안 된다 — 실측에서 '6752.T'(소니)·'1211.HK'(BYD)·
//   '300750.SZ'(CATL) 가 테마로 분류돼 번역 경로로 갈 뻔했다. 아시아 시장 코드는 숫자로 시작한다.
//   대신 글자가 하나도 없는 순수 숫자는 티커로 보지 않는다(KR 6자리는 위 분기가 이미 처리한다).
const BARE_TICKER = /^[A-Z0-9]{1,6}(?:\.[A-Z]{1,4})?$/;
const hasLetter = (x) => /[A-Z]/.test(x);

/**
 * @param {string} raw LLM 이 준 asset 문자열
 * @param {{krNames: Map, usNames: Map}} auth loadAssetAuthority() 결과
 * @returns {{kind:'ticker'|'theme'|'invalid', asset:string|null, label?:string, defect?:string}}
 */
export function normalizeCascadeAsset(raw, auth) {
  const s = String(raw ?? '').trim();
  if (!s) return { kind: 'invalid', asset: null, defect: 'empty_asset' };

  // ── KR: KRX:035720 / 035720.KS / 035720
  //   KR 판정은 '한국 시장' 표식이 있을 때만 한다. 6자리라는 이유만으로 KR 로 보면
  //   선전 '300750.SZ'(CATL) 를 한국 코드로 오인해 통째로 버린다(실측으로 걸렸다).
  const isKrMarket = /KRX/i.test(s) || /\d{6}\.K[SQ]\b/i.test(s) || /^\d{6}$/.test(s);
  const kr = s.match(KR_CODE);
  if (kr && isKrMarket) {
    const code = kr[1];
    const entry = auth.krNames.get(code);
    if (!entry) {
      return { kind: 'invalid', asset: null, defect: `unknown_kr_code:${code}` };
    }
    const ticker = entry.ticker ?? `${code}.${kr[2] ?? 'KS'}`;
    // 괄호 속 이름 주장이 있으면 **항목을 통째로 버린다.**
    //   라벨만 권위 소스로 바꾸면 화면엔 '카카오' 가 뜨는데 그 항목의 reason 은
    //   LG에너지솔루션 얘기다 — 틀린 이름을 지우는 대신 틀린 논리를 붙이는 셈이라 더 나쁘다.
    //   실측 표본에서 KR 이름 주장 4건 중 3건이 틀렸다. 맞는 1건(SK Hynix)까지 같이 버리는 건
    //   손해지만, KR 영문명 권위 소스가 없는 한 맞는 것과 틀린 것을 가릴 방법이 없다.
    //   대신 프롬프트를 조여 맨 티커('035720.KS')를 내게 했다 — 그건 이 분기를 안 탄다.
    const claimed = s.match(/\(([^)]+)\)/)?.[1]?.trim();
    if (claimed) return { kind: 'invalid', asset: null, defect: `unverifiable_kr_name_claim:${code}:${claimed.slice(0, 40)}` };
    return { kind: 'ticker', asset: ticker, label: entry.name };
  }

  // ── US: Caterpillar (NYSE: CAT)
  const us = s.match(US_EXCHANGE);
  if (us) {
    const ticker = us[1].toUpperCase();
    const claimed = s.slice(0, s.indexOf('(')).trim();
    const known = auth.usNames.get(ticker);
    // 이름=티커('UPS (NYSE: UPS)')와 두문자어는 불일치가 아니다 — 통용명이다.
    const acronym = known ? normName(known).split(' ').map((w) => w[0] ?? '').join('').toUpperCase() : '';
    const sameAsTicker = claimed.toUpperCase() === ticker || claimed.toUpperCase() === acronym;
    if (known && claimed && !sameAsTicker && !compatibleName(known, claimed)) {
      const kind = claimsDifferentCompany(auth, ticker, claimed) ? 'us_name_mismatch' : 'unverifiable_name_claim';
      return { kind: 'invalid', asset: null, defect: `${kind}:${ticker}:${claimed.slice(0, 40)}` };
    }
    return { kind: 'ticker', asset: ticker, label: known ?? (claimed || ticker) };
  }

  // ── 맨 티커
  if (BARE_TICKER.test(s) && hasLetter(s)) return { kind: 'ticker', asset: s, label: auth.usNames.get(s) ?? s };

  // ── 괄호가 붙은 나머지. 떼어낸 *뒤* 남은 게 무엇인지 다시 봐야 한다.
  //    2026-08-22 실측 회귀(내가 만든 것): 여기서 무조건 theme 을 돌려주는 바람에
  //    'GOLD (Gold Futures)'·'JPM (JPMorgan Chase)'·'SLV (Silver ETF)' 가 테마로 분류됐고,
  //    그러자 번역 경로를 타서 /ko 화면에 'GOLD → 미국 지질학회', 'SLV → 실브' 가 나왔다.
  //    티커를 번역해 버린 것이다. 괄호를 떼는 것과 종류를 정하는 건 다른 판단이다.
  const paren = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (paren) {
    const base = paren[1].trim();
    const claim = paren[2].trim();
    if (base && BARE_TICKER.test(base) && hasLetter(base)) {
      // 괄호 속은 회사명 주장이다. US 거래소 형식과 같은 규율로 대조한다.
      const known = auth.usNames.get(base);
      const acronym = known ? normName(known).split(' ').map((w) => w[0] ?? '').join('').toUpperCase() : '';
      const benign = !claim || claim.toUpperCase() === base || claim.toUpperCase() === acronym;
      if (known && !benign && !compatibleName(known, claim)) {
        const kind = claimsDifferentCompany(auth, base, claim) ? 'us_name_mismatch' : 'unverifiable_name_claim';
        return { kind: 'invalid', asset: null, defect: `${kind}:${base}:${claim.slice(0, 40)}` };
      }
      return { kind: 'ticker', asset: base, label: known ?? base, ...(claim ? { defect: `dropped_name_claim:${claim.slice(0, 30)}` } : {}) };
    }
    // 서술 라벨에 붙은 티커 힌트는 근거가 없다 — 실측 'Software Sector ETF (e.g., IBB)' 에서
    //   IBB 는 바이오텍 ETF 다. 라벨만 남기고 힌트는 버린다.
    if (base) return { kind: 'theme', asset: base, defect: `dropped_ticker_hint:${claim.slice(0, 30)}` };
  }
  return { kind: 'theme', asset: s };
}

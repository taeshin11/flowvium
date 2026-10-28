/**
 * etf-leveraged.mjs — ETF 전략 섹션의 미국 레버리지·인버스 슬리브. 머리말 규칙은 etf-leveraged.test.mjs.
 *
 * 2026-10-28 사장님: "추천 종목 중에 ETF 들도 있잖아. 거기에 QQQ 나 QLD 나 TQQQ, 속셀, 속스, 프로 뭐 이런 거 다 넣어야지."
 *   종전엔 어디에도 안 나왔다 — 종목 포트폴리오는 ETF 를 통째로 빼고(6/14 사장님, lib/etf-filter isEtf),
 *   ETF 섹션(generate-report-local ETF_META)엔 지역 레버리지(KORU 등)만 있었다.
 * 고르는 기준은 다른 ETF 와 같다 — 보고서의 시장 스탠스·섹터 비중(근거 없는 선택 없음).
 *   강세: 나스닥 2x 매수, 3x·S&P 3x 관망 / 약세: 인버스 1x 헤지, 3x 인버스 관망 / 중립: 나스닥 2x·3x 관망.
 *   반도체(없으면 기술 섹터) 비중확대면 반도체 3x(강세면 2x 도), 비중축소면 반도체 3x 인버스.
 * 3배 상품은 매수(buy)로 내지 않는다 — 일일 리밸런싱으로 횡보장에서도 가치가 녹는다. 모든 줄에 단기 경고·작은 비중·손절.
 */
export const LEVERAGED_META = {
  QLD: { name: '나스닥100 2x', cat: 'leveraged' }, TQQQ: { name: '나스닥100 3x', cat: 'leveraged' },
  PSQ: { name: '나스닥100 인버스 1x', cat: 'leveraged' }, SQQQ: { name: '나스닥100 인버스 3x', cat: 'leveraged' },
  SSO: { name: 'S&P500 2x', cat: 'leveraged' }, UPRO: { name: 'S&P500 3x', cat: 'leveraged' },
  SH: { name: 'S&P500 인버스 1x', cat: 'leveraged' }, SPXU: { name: 'S&P500 인버스 3x', cat: 'leveraged' },
  USD: { name: '반도체 2x', cat: 'leveraged' }, SOXL: { name: '반도체 3x', cat: 'leveraged' }, SOXS: { name: '반도체 인버스 3x', cat: 'leveraged' },
};

const WARN3 = '⚠️ 3배·단기 트레이딩 전용(하루 단위 재조정이라 오래 들면 가치가 녹는다)';
const WARN2 = '⚠️ 2배·단기 위주(오래 들면 가치가 녹는다)';
const WARN1 = '⚠️ 하락 헤지용·단기(오래 들면 손해)';
const warnOf = (t) => (/3x/.test(LEVERAGED_META[t].name) ? WARN3 : /인버스 1x/.test(LEVERAGED_META[t].name) ? WARN1 : WARN2);
const SIZE = { 3: '단기 1–2% 이내', 2: '단기 2–3% 이내', 1: '헤지 2–5% 이내' };
const sizeOf = (t) => SIZE[/3x/.test(LEVERAGED_META[t].name) ? 3 : /인버스 1x/.test(LEVERAGED_META[t].name) ? 1 : 2];
const INVAL = {
  long: '-10% 손절 또는 스탠스가 중립·약세로 바뀌면 바로 정리',
  short: '-10% 손절 또는 스탠스가 중립·강세로 바뀌면 바로 정리',
};

export function leveragedPicks({ stance = 'neutral', sectorAllocation = [] } = {}) {
  // 보고서 섹터 이름은 프롬프트 스키마(GICS 식)라 반도체가 'Technology' 안에 든다 — 반도체 줄이 없으면 기술 섹터 신호로 읽는다
  //   (generate-report-local SECTOR_ETF 도 semiconductors·technology 를 같은 XLK 로 묶는다).
  const stanceOf = (names) => sectorAllocation.find((s) => names.includes(String(s.sector ?? '').toLowerCase()))?.stance ?? null;
  const semi = stanceOf(['semiconductors']) ?? stanceOf(['technology', 'information technology']);
  const out = [];
  const add = (ticker, why, action, dir) => out.push({ ticker, ...LEVERAGED_META[ticker], tag: 'leveraged', action,
    rationale: `${why} — ${warnOf(ticker)}`, sizingHint: sizeOf(ticker), invalidation: INVAL[dir] });
  if (stance === 'bullish') {
    add('QLD', '강세 스탠스 — 나스닥 2배', 'buy', 'long');
    add('TQQQ', '강세 스탠스 — 나스닥 3배', 'watch', 'long');
    add('UPRO', '강세 스탠스 — S&P500 3배', 'watch', 'long');
    if (semi === 'overweight') { add('SOXL', '반도체 비중확대 — 반도체 3배', 'watch', 'long'); add('USD', '반도체 비중확대 — 반도체 2배', 'watch', 'long'); }
  } else if (stance === 'bearish') {
    add('PSQ', '약세 스탠스 — 나스닥 하락 헤지', 'hedge', 'short');
    add('SH', '약세 스탠스 — S&P500 하락 헤지', 'hedge', 'short');
    add('SQQQ', '약세 스탠스 — 나스닥 하락 3배', 'watch', 'short');
    add('SPXU', '약세 스탠스 — S&P500 하락 3배', 'watch', 'short');
    if (semi === 'underweight') add('SOXS', '반도체 비중축소 — 반도체 하락 3배', 'watch', 'short');
  } else {
    add('QLD', '중립 스탠스 — 나스닥 2배 관망', 'watch', 'long');
    add('TQQQ', '중립 스탠스 — 나스닥 3배 관망', 'watch', 'long');
    if (semi === 'overweight') add('SOXL', '반도체 비중확대 — 반도체 3배 관망', 'watch', 'long');
    else if (semi === 'underweight') add('SOXS', '반도체 비중축소 — 반도체 하락 3배 관망', 'watch', 'short');
  }
  return out;
}

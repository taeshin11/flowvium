/**
 * investment-prompts.ts
 *
 * Karpathy AutoResearch Loop 적용 (2026년 3월 개념):
 *   Draft → Critique → Refine
 *
 * Section 1: 거시경제 + 기술적 + 리스크이벤트  (병렬)
 * Section 2: 포트폴리오 구성                   (병렬)
 * Section 3: 국가별 시장 전망                  (병렬)
 * Section 4: 자기비판 루프 (Critic)            (Draft 완성 후)
 *   → Draft 포트폴리오의 약점/오류/누락 지적
 *   → 수정된 rationale/action 반영
 *
 * "Editable asset": 포트폴리오 Draft
 * "Scalar metric": 리스크 조정 기대수익률 (rationale 품질)
 * "Karpathy Loop": Propose → Critique → Commit/Revert
 */

const LOCALE_LANG: Record<string, string> = {
  ko: 'Korean', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian',
  ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', th: 'Thai', tr: 'Turkish', vi: 'Vietnamese',
};

export interface CtxForPrompts {
  macro: string;
  sentiment: string;
  flows: string;
  cot: string;
  commodity: string;
  institutional: string;
  shorts: string;
  news: string;
  koreaFlow: string;
  assetFg: string;
  bbWarnings: string;
}

// ── Section 1: 거시경제 + 기술적 분석 + 리스크이벤트 ─────────────────────────
export function buildMacroPrompt(ctx: CtxForPrompts, vix: string, locale = 'en', session = 'morning'): string {
  const today = new Date().toISOString().slice(0, 10);
  const lang = LOCALE_LANG[locale];
  const li = lang ? `\nWrite ALL text in ${lang} except tickers/numbers/JSON keys.\n` : '';
  const sc = session === 'morning' ? 'Post US-close' : session === 'afternoon' ? 'Post Asia-close' : 'Pre US-open';

  return [
    `You are a macro strategist. Session: ${sc} ${today}.${li}`,
    '',
    `[Macro Indicators] ${ctx.macro}`,
    `[Sentiment + FedWatch] ${ctx.sentiment}`,
    `[VIX] ${vix || 'No data'}`,
    `[COT Positioning] ${ctx.cot || 'No data'}`,
    `[Commodity Curves] ${ctx.commodity || 'No data'}`,
    `[News — 연준발언 우선] ${ctx.news}`,
    '파월은 2026년 의장 임기 만료 후 이사(Governor)로 잔류. 파월 전 의장 또는 파월 이사로 표기.',
    '',
    'Respond in pure JSON (no markdown):',
    '{"macroAnalysis":"한국어 150자 이내, CPI/금리/스프레드 실제수치 포함",',
    '"technicalAnalysis":"VIX+수익률곡선만 120자, 선물용어 금지",',
    '"fundamentalAnalysis":"실적서프라이즈+밸류에이션+기관시그널 150자",',
    '"thesis":"핵심테마 50자",',
    '"riskLevel":"low|medium|high",',
    '"riskEvents":[{"date":"YYYY-MM-DD","event":"이벤트명","impact":"high|medium|low","watchFor":"60자 한국어 구체적 설명"}]}',
    'riskEvents 3-5개, BOJ/ECB/Fed/NFP/CPI 포함. Pure JSON only.',
  ].join('\n');
}

// ── Section 2: 포트폴리오 구성 ────────────────────────────────────────────────
export function buildPortfolioPrompt(
  ctx: CtxForPrompts,
  sectorPe: string,
  earnings: string,
  priceData: string,
  locale = 'en',
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lang = LOCALE_LANG[locale];
  const li = lang ? `\nWrite rationale/reason in ${lang} (Korean preferred).\n` : '';

  return [
    `You are a portfolio manager building an investment strategy. Date: ${today}.${li}`,
    '',
    `[Live Prices — base for entryZone/stopLoss/target]`,
    priceData || 'No data',
    '',
    `[Institutional + Insider Signals]`,
    ctx.institutional,
    '집중매매감지 = 5건 이상 내부자 신고 = 강한 확신 신호',
    '',
    `[Sector Valuations (SPDR ETFs)] ${sectorPe || 'No data'}`,
    `[Bollinger Band 과매수 경고] ${ctx.bbWarnings || 'None'}`,
    `[Short Squeeze Candidates] ${ctx.shorts || 'None'}`,
    `[Upcoming Earnings] ${earnings || 'None'}`,
    '',
    'RULES:',
    '1. 6-8 items: US stocks + ETFs + country ETFs (EWY=Korea, EWJ=Japan, FXI=China, VGK=Europe, INDA=India, EWT=Taiwan)',
    '2. Each item: "market" field = us/korea/japan/china/europe/india/taiwan/global',
    '3. entryZone/stopLoss/target: actual dollar ranges from live prices above',
    '4. rationale 100 chars max with real data:',
    '   - BB "4d4sig" hit -> action=watch, rationale add "4일4시그마진입금지"',
    '   - BB "20d2sig" hit -> rationale add "BB상단이탈"',
    '   - 집중매매감지 -> "내부자집중매수N건"',
    '   - F&G > 75 -> "극단탐욕눌림목대기"',
    '   BAD: "KOSPI 상승세" GOOD: "EWY F&G77+BB상단->눌림목대기 $112이하"',
    '5. allocation must sum to 100',
    '6. action: buy=accumulate now, hold=keep, watch=wait for entry',
    '',
    'Respond in pure JSON (no markdown):',
    '{"stance":"bullish|neutral|bearish",',
    '"portfolio":[{"ticker":"NVDA","name":"NVIDIA","sector":"Technology","market":"us",',
    '"rationale":"실데이터포함100자","allocation":15,"entryZone":"$205-212",',
    '"stopLoss":"$190","target":"$240","confidence":"high","action":"buy"}],',
    '"sectorAllocation":[{"sector":"Technology","pct":25,"stance":"overweight","reason":"40자"}]}',
    '6-8 portfolio items, 5 sectorAllocation items. Pure JSON only.',
  ].join('\n');
}

// ── Section 3: 국가별 시장 전망 ───────────────────────────────────────────────
export function buildRegionalPrompt(ctx: CtxForPrompts, locale = 'en'): string {
  const today = new Date().toISOString().slice(0, 10);
  const lang = LOCALE_LANG[locale];
  const li = lang ? `\nWrite thesis in ${lang}.\n` : '';

  return [
    `You are a global market strategist providing country-by-country outlook. Date: ${today}.${li}`,
    '',
    `[Capital Flows — 1W/4W returns by country/asset]`,
    ctx.flows,
    `[Korean Market] ${ctx.koreaFlow || 'No data'}`,
    `[Asset-Class Fear & Greed] ${ctx.assetFg || 'No data'}`,
    '',
    'Provide bullish/neutral/bearish for each country based on flows and F&G.',
    'Respond in pure JSON (no markdown):',
    '{"regionStances":{',
    '"us":{"stance":"bullish","thesis":"40자","keyData":"SPY 1w, F&G score"},',
    '"korea":{"stance":"neutral","thesis":"...","keyData":"EWY 1w, F&G"},',
    '"japan":{"stance":"...","thesis":"...","keyData":"..."},',
    '"china":{"stance":"...","thesis":"...","keyData":"..."},',
    '"europe":{"stance":"...","thesis":"...","keyData":"..."},',
    '"india":{"stance":"...","thesis":"...","keyData":"..."},',
    '"taiwan":{"stance":"...","thesis":"...","keyData":"..."},',
    '"brazil":{"stance":"...","thesis":"...","keyData":"..."},',
    '"australia":{"stance":"...","thesis":"...","keyData":"..."},',
    '"global":{"stance":"...","thesis":"...","keyData":"..."}',
    '}}',
    'All 10 regions required. Pure JSON only.',
  ].join('\n');
}

// ── Section 4: Karpathy Loop — 자기비판 (Critic) ─────────────────────────────
// Draft 포트폴리오를 반박하는 역할. 약점 발견 → rationale 수정 제안.
// AutoResearch의 "val_bpb로 평가 후 리버트" 대신 AI가 자체 평가.
export interface CritiqueInput {
  portfolio: Array<{
    ticker: string;
    rationale: string;
    action: string;
    entryZone: string;
    target: string;
  }>;
  macroAnalysis: string;
  bbWarnings: string;
  assetFg: string;
}

export function buildCritiquePrompt(draft: CritiqueInput, locale = 'en'): string {
  const lang = LOCALE_LANG[locale] ?? 'Korean';
  const portfolioSummary = draft.portfolio
    .map(p => `${p.ticker}(${p.action}) entry=${p.entryZone} target=${p.target}: ${p.rationale}`)
    .join('\n');

  return [
    `You are a contrarian analyst critiquing an investment portfolio. Write in ${lang}.`,
    '',
    '[Draft Portfolio to Critique]',
    portfolioSummary,
    '',
    `[Macro Context] ${draft.macroAnalysis}`,
    `[BB Overextension Warnings] ${draft.bbWarnings || 'None'}`,
    `[Asset F&G] ${draft.assetFg || 'No data'}`,
    '',
    'For each portfolio item, identify ONE of:',
    '1. REVISE: action or rationale needs correction (e.g. "buy" when BB shows 4d4sig, or F&G>75)',
    '2. WARN: add a risk not mentioned in rationale',
    '3. OK: no change needed',
    '',
    'Be concise. Only flag items that need change.',
    '',
    'Respond in pure JSON:',
    '{"critiques":[{"ticker":"NVDA","verdict":"REVISE|WARN|OK","correction":"≤80 chars 한국어, 구체적 수치 포함"}]}',
    'Only include items that need REVISE or WARN. Pure JSON only.',
  ].join('\n');
}

// ── Critique 결과를 Draft에 반영 ──────────────────────────────────────────────
export function applyCritique(
  portfolio: CritiqueInput['portfolio'],
  critiqueJson: string,
): CritiqueInput['portfolio'] {
  try {
    const m = critiqueJson.match(/\{[\s\S]*\}/);
    if (!m) return portfolio;
    const parsed = JSON.parse(m[0]) as { critiques?: Array<{ ticker: string; verdict: string; correction: string }> };
    const critiques = parsed.critiques ?? [];
    if (!critiques.length) return portfolio;

    return portfolio.map(p => {
      const c = critiques.find(cr => cr.ticker === p.ticker);
      if (!c) return p;
      if (c.verdict === 'REVISE') {
        // action 수정 (4d4sig → watch)
        const newAction = c.correction.includes('진입금지') || c.correction.includes('WARN') ? 'watch' : p.action;
        return { ...p, action: newAction, rationale: `[수정] ${c.correction}`.slice(0, 100) };
      }
      if (c.verdict === 'WARN') {
        return { ...p, rationale: `${p.rationale} ⚠️${c.correction}`.slice(0, 100) };
      }
      return p;
    });
  } catch { return portfolio; }
}

/**
 * investment-prompts.ts
 *
 * Karpathy AutoResearch Loop 적용 (2026년 3월 개념):
 * Grounding facts 주입: buildGroundingFacts()로 할루시네이션 방지
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

import { buildGroundingFacts } from '@/lib/grounding';
import { getGuruPromptContext } from '@/lib/guru-methodologies';

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
  credit: string;       // 국가별 신용잔고 요약
  nport: string;        // N-PORT 뮤추얼펀드 기관 집계
  optionsFlow: string;  // 이상 옵션 플로우
  ownership: string;    // 13D/G 대량보유 변동
  econCal: string;      // 향후 고임팩트 경제 이벤트
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
    `[Credit Balance — Market Leverage Risk] ${ctx.credit || 'No data'}`,
    `[Upcoming High-Impact Events] ${ctx.econCal || 'No data'}`,
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
    buildGroundingFacts(priceData || undefined),
    '',
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
    `[Unusual Options Flow] ${ctx.optionsFlow || 'None'}`,
    `[13D/G 대량보유 변동] ${ctx.ownership || 'None'}`,
    `[N-PORT 뮤추얼펀드 기관집계] ${ctx.nport || 'None'}`,
    `[Upcoming Earnings] ${earnings || 'None'}`,
    '',
    '[Guru Frameworks]',
    getGuruPromptContext([]),
    '',
    '',
    '** OBJECTIVE: ALPHA GENERATION — Beat the index (S&P 500). **',
    '** Passive ETFs (SPY/QQQ/VTI) and bonds (TLT/IEF) combined ≤ 20% total. **',
    '** Concentrate on HIGH-CONVICTION individual stocks (드러켄밀러: 확신 있을 때 집중). **',
    '** Minimum 5 individual stocks, each ≥ 10% allocation. **',
    '** GLD/hedges: only if VIX > 25 or explicit macro risk. Otherwise skip. **',
    '',
    'RULES:',
    '1. 6-8 items: PRIMARILY individual stocks with high alpha potential:',
    '   - ONLY pick tickers present in [Live Prices] above. Do NOT invent prices.',
    '   - Rank by signal strength: (1) insider 집중매수/13D crossing, (2) high squeeze score, (3) 13F accumulation, (4) unusual options flow, (5) capital-flow momentum',
    '   - Korean (*.KS): include only if KRX foreign/institutional net-buy is positive this week',
    '   - Country ETFs: only if capital-flow shows 3%+ 4W momentum for that region',
    '   - SPY/QQQ/TLT/GLD: hedge only (≤5% each), skip when no explicit macro risk',
    '2. Each item: "market" field = us/korea/japan/china/europe/india/taiwan/global',
    '3. entryZone/stopLoss/target: actual dollar ranges from live prices above',
    '4. rationale 100 chars max with real data:',
    '   - BB "4d4sig" hit -> action=watch, rationale add "4일4시그마진입금지"',
    '   - BB "20d2sig" hit -> rationale add "BB상단이탈"',
    '   - 집중매매감지 -> "내부자집중매수N건"',
    '   - F&G > 75 -> "극단탐욕눌림목대기"',
    '   BAD: "KOSPI 상승세" GOOD: "EWY F&G77+BB상단->눌림목대기 $112이하"',
    '5. allocation must sum to 100. NO single position > 25%.',
    '6. action: buy=accumulate now, hold=keep, watch=wait for entry',
    '7. entryRationale (≤80자): WHY this entry — MUST use ≥1 non-technical reason when available:',
    '   Technical: 50일선/$X 지지, BB중선, 주요지지선',
    '   Fundamental: ROE X%+FCF수익률Y% (버핑), PEG<1 성장대비저평가 (린치), P/FCF<10 (버리)',
    '   Valuation: P/E vs 섹터평균 -X%, Graham Number=$Y 이하, EBIT/EV>10% (그린블라트)',
    '   예(GOOD): "100일선+린치PEG0.8→성장대비저평가 진입"',
    '   예(GOOD): "50일선+버핑ROE18%FCF수익률 → 안전마진"',
    '   예(BAD): "50일선 지지" (기술적만 — reject)',
    '8. targetRationale (≤80자): WHY this target — fundamentals-first, technicals-secondary:',
    '   PRIMARY (use if data available): DCF fair value, P/E target multiple, analyst consensus, PEG-implied price',
    '   SECONDARY: 52W high, ATH, Fibonacci extension',
    '   CRITICAL: 52W high is NOT automatically the ceiling. If momentum is strong:',
    '     - Price near 52W high → consider BREAKOUT scenario: next target = ATH or Fib 1.618× move',
    '     - Price already above 52W high → use ATH or extension as target, NOT 52W high',
    '     - Include both scenarios if uncertain: "돌파 시 $X, 저항 시 $Y"',
    '   예(GOOD): "P/E목표35배→$370 | 52주고점돌파시Fib1.618→$395"',
    '   예(GOOD): "DCF내재가치$385 | 이미52주고점돌파→ATH$410목표"',
    '   예(GOOD): "린치PEG목표1.0→$280 | 강세지속시Fib→$310"',
    '   예(BAD): "52주 고점 저항" (단순기술적, 돌파가능성 무시 — reject)',
    '',
    'Respond in pure JSON (no markdown):',
    '{"stance":"bullish|neutral|bearish",',
    '"portfolio":[{"ticker":"TICKER","name":"Company Name","sector":"Sector","market":"us|korea|...",',
    '"rationale":"실데이터포함100자","allocation":15,"entryZone":"$X-Y",',
    '"entryRationale":"기술적근거+펀더멘털근거→안전마진진입","stopLoss":"$Z",',
    '"target":"$A","targetBull":"$B","targetRationale":"P/E목표배수→$A기본 | 돌파시Fib→$B강세","confidence":"high","action":"buy"}],',
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

// ── Section 4: 기회 신호 분석 (숏스퀴즈 + 내부자 매매) ───────────────────────
// 숏스퀴즈 후보와 내부자 집중매매 패턴을 전문적으로 분석
export function buildOpportunityPrompt(ctx: CtxForPrompts, locale = 'en'): string {
  const today = new Date().toISOString().slice(0, 10);
  const lang = LOCALE_LANG[locale] ?? 'Korean';
  return [
    `You are a short squeeze and insider trading specialist. Date: ${today}. Write in ${lang}.`,
    '',
    `[Short Squeeze Candidates] ${ctx.shorts || 'None'}`,
    `[Insider + Institutional Signals] ${ctx.institutional}`,
    `[Asset F&G (sector sentiment)] ${ctx.assetFg || 'No data'}`,
    '',
    'For each SHORT SQUEEZE candidate, analyze:',
    '- squeeze_score: the level (scale of urgency)',
    '- timing: when squeeze could trigger (near-term catalyst?)',
    '- risk: what could prevent the squeeze',
    '',
    'For INSIDER signals with 5+ filings (집중매매감지):',
    '- significance: why this matters (officer level, size)',
    '- pattern: accumulation vs single trade',
    '- dateRange: EXACT period from [Insider + Institutional Signals] — format "YYYY-MM-DD~YYYY-MM-DD"',
    '',
    '⚠️ filings count MUST match exactly what appears in [집중매매감지] above — NEVER copy example numbers.',
    '',
    'Respond in pure JSON:',
    '{"shortSqueeze":[{"ticker":"[TICKER]","score":0,"timing":"[≤40 chars]","risk":"[≤40 chars]"}],"insiderSignals":[{"ticker":"[TICKER]","filings":[EXACT_COUNT_FROM_DATA],"dateRange":"[YYYY-MM-DD~YYYY-MM-DD from data]","significance":"[≤40 chars]","pattern":"[≤30 chars]"}],"topOpportunity":"[≤100 chars]"}',
    'Pure JSON only.',
  ].join('\n');
}

// ── Section 5: 리스크 관리 (손절 + 헤징 전략) ────────────────────────────────
// 각 포트폴리오 항목의 손절 근거와 전체 포트폴리오 헤징 전략
export interface RiskMgmtInput {
  portfolio: Array<{ ticker: string; entryZone: string; stopLoss: string; allocation: number; action: string }>;
  riskLevel: string;
  bbWarnings: string;
  vix: string;
}
export function buildRiskMgmtPrompt(input: RiskMgmtInput, locale = 'en'): string {
  const lang = LOCALE_LANG[locale] ?? 'Korean';
  const positions = input.portfolio.map(p =>
    `${p.ticker}(${p.allocation}%): entry=${p.entryZone} stop=${p.stopLoss} action=${p.action}`
  ).join('\n');
  return [
    `You are a risk manager. Write in ${lang}.`,
    '',
    `[Portfolio Positions] ${positions}`,
    `[Overall Risk Level] ${input.riskLevel}`,
    `[BB Overextension] ${input.bbWarnings || 'None'}`,
    `[VIX] ${input.vix || 'No data'}`,
    '',
    'For each position, provide stop-loss rationale (WHY this level, not just the number).',
    'Also provide overall portfolio hedging suggestion.',
    '',
    'Respond in pure JSON:',
    '{"stopLossRationale":[{"ticker":"NVDA","rationale":"$190은 8월 저점 지지선이자 200일 이평선, 이탈 시 추세전환"}],"hedgingSuggestion":"VIX 18 저변동 → TLT 5% 헤지 + GLD 5% 인플레 헤지","portfolioRiskNote":"포트폴리오 전체 리스크 평가 100자"}',
    'Pure JSON only.',
  ].join('\n');
}

// ── Section 6: 시장 내러티브 (Why + Next) ─────────────────────────────────────
// 시장이 왜 이렇게 움직이는지, 다음에 무엇을 봐야 하는지
export function buildNarrativePrompt(ctx: CtxForPrompts, session = 'morning', locale = 'en', sectorPe = ''): string {
  const today = new Date().toISOString().slice(0, 10);
  const lang = LOCALE_LANG[locale] ?? 'Korean';
  const sc = session === 'morning' ? '미국장 마감 직후' : session === 'afternoon' ? '아시아장 마감 직후' : '미국장 개장 전';
  return [
    `You are a market narrative writer. Session: ${sc} ${today}. Write in ${lang}.`,
    '',
    `[Capital Flow Story] ${ctx.flows}`,
    `[News Events] ${ctx.news}`,
    `[Macro Context] ${ctx.macro}`,
    `[Institutional & Insider Signals] ${ctx.institutional || 'No data'}`,
    `[Sector Valuations & Returns] ${sectorPe || 'No data'}`,
    `[Short Squeeze & Options Flow] ${ctx.shorts || 'No data'}`,
    '',
    '## Theme extraction rules',
    'From the data above, identify 2-4 specific hot investment themes currently driving markets.',
    'Examples of good themes (name actual sector/tech/industry): "AI 반도체", "광통신", "전력 인프라", "바이오텍", "방산", "에너지", "핀테크", "클라우드", "Biotech", "Defense".',
    'Do NOT write generic phrases like "테크", "성장주", "위험자산". Must be specific sub-sector or technology.',
    'Derive themes from the actual news/flows/institutional data provided, not from training data.',
    '',
    'Respond in pure JSON:',
    `{"why":"구체적 이유 100자","watch":"관찰포인트 80자","story":"시장스토리 200자","hotThemes":["specific theme 1","specific theme 2"],"sessionNote":"이 세션의 특이사항 60자"}`,
    '- hotThemes: array of 2-4 strings, each ≤15 chars, in ' + lang + ', specific sector/technology names only.',
    'Pure JSON only.',
  ].join('\n');
}

// ── Section 2b: 매수 종목 상세분석 (Stock Detail Analysis) ──────────────────────
// Wave 2에서 action='buy' 종목만 집중 분석. 촉매·펀더멘털·기술·리스크를 별도 LLM 호출로 생성.
export interface StockDetailInput {
  buyStocks: Array<{
    ticker: string;
    name: string;
    sector: string;
    rationale: string;
    entryZone: string;
    target: string;
    entryRationale?: string;
    targetRationale?: string;
  }>;
  institutional: string;   // 13F + insider signals
  shorts: string;          // squeeze candidates
  earnings: string;        // upcoming / recent earnings
  sectorPe: string;        // sector valuations
  news: string;            // relevant news
}

export function buildStockDetailPrompt(input: StockDetailInput, locale = 'en'): string {
  const today = new Date().toISOString().slice(0, 10);
  const lang = LOCALE_LANG[locale] ?? 'Korean';
  const stockList = input.buyStocks
    .map(s => `- ${s.ticker}(${s.name}, ${s.sector}): entry=${s.entryZone}, target=${s.target}, rationale="${s.rationale}"`)
    .join('\n');

  return [
    `You are an equity research analyst. Date: ${today}. Write ALL text fields in ${lang}.`,
    '',
    `Focus ONLY on these BUY-recommended stocks:`,
    stockList,
    '',
    `[Institutional & Insider Signals] ${input.institutional}`,
    `[Short Squeeze Candidates] ${input.shorts}`,
    `[Upcoming / Recent Earnings] ${input.earnings}`,
    `[Sector Valuations] ${input.sectorPe}`,
    `[Recent News] ${input.news}`,
    '',
    'For EACH stock above, provide a detailed investment case:',
    '- catalysts: array of 2-3 SPECIFIC near-term catalysts with numbers',
    '  e.g., ["Blackwell GPU 출하 QoQ+40% (Q2 실적)", "13F 내부자 47건 순매수", "AI datacenter capex $200B 전망"]',
    '- fundamentalBasis: ≤120 chars — EPS growth%, PE or PEG, margin trend, institutional activity',
    '  e.g., "EPS YoY+102%, PEG 1.3, 영업이익률 55%, 기관 13F 47건 집중매집"',
    '- technicalBasis: ≤80 chars — MA position, RSI (neutral=40-60, overbought>70), volume vs 20d avg',
    '  e.g., "200MA 위, RSI 55 중립, 거래량 20일평균 +18%"',
    '- riskNote: ≤60 chars — SINGLE biggest downside risk to the thesis with numbers if possible',
    '  e.g., "수출규제 확대 시 매출 15% 하락 위험" or "경쟁사 AMD Mi400 출시 압박"',
    '',
    'CRITICAL: Use ONLY data present in the sections above. No hallucination.',
    'If data is unavailable for a field, use the most relevant available signal.',
    '',
    'Respond in pure JSON:',
    '{"stockDetails":[{"ticker":"NVDA","catalysts":["Blackwell GPU 출하 QoQ+40%","내부자 집중매수 47건","AI capex $200B"],"fundamentalBasis":"EPS YoY+102%, PEG 1.3, 영업이익률 55%","technicalBasis":"200MA 위, RSI 55 중립, 거래량 +18%","riskNote":"수출규제 확대 시 매출 15% 하락"}]}',
    'Include ALL tickers from the buy list. Pure JSON only.',
  ].join('\n');
}

// ── Section 8: 기업 변화 모니터링 (Corporate Changes) ─────────────────────────
// 포트폴리오 종목별 최근 실적/가이던스/이벤트 변화를 분석
export interface CompanyChangesInput {
  portfolio: Array<{ ticker: string; name: string }>;
  earnings: string;           // 최근 실적 데이터 (buildCtxSummary 기반)
  institutional: string;      // 13F 기관 변화
  news: string;               // 관련 뉴스
  companyFinancials: string;  // 종목별 분기 매출 성장률 요약
}

export function buildCompanyChangesPrompt(input: CompanyChangesInput, locale = 'en'): string {
  const today = new Date().toISOString().slice(0, 10);
  const lang = LOCALE_LANG[locale] ?? 'Korean';
  const tickers = input.portfolio.map(p => `${p.ticker}(${p.name})`).join(', ');
  return [
    `You are a corporate analyst tracking key company changes. Date: ${today}. Write keyChange in ${lang}.`,
    '',
    `Portfolio tickers to analyze: ${tickers}`,
    '',
    `[Recent Financials — Revenue YoY Growth]`,
    input.companyFinancials || 'No data',
    '',
    `[Upcoming/Recent Earnings] ${input.earnings}`,
    `[Institutional Changes] ${input.institutional}`,
    `[News & Events] ${input.news}`,
    '',
    'For EACH ticker in the portfolio, identify the most important recent change:',
    '- Revenue growth acceleration/deceleration',
    '- Earnings beat/miss vs expectations',
    '- Management guidance raised/lowered/maintained',
    '- Major corporate events (acquisition, partnership, product launch, regulatory)',
    '- Institutional ownership increase/decrease',
    '',
    'keyChange: ≤80자, specific numbers preferred. sentiment based on overall change direction.',
    'guidance: "raised" | "maintained" | "lowered" | "unknown"',
    '',
    'Respond in pure JSON:',
    `{"companyChanges":[{"ticker":"NVDA","name":"NVIDIA","revenueYoY":73.2,"latestQuarter":"Q4 FY2026","keyChange":"Q4 매출 $68.1B (+73% YoY) 컨센서스 7% 상회, 데이터센터 Blackwell 수요 가속","guidance":"raised","sentiment":"positive"}]}`,
    'Include ALL portfolio tickers. If no data, set sentiment to "neutral" and explain why. Pure JSON only.',
  ].join('\n');
}

// ── Section 7: Karpathy Loop — 자기비판 (Critic) ─────────────────────────────
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

    // ticker당 최고 심각도 critique만 적용 (REVISE > WARN > OK)
    const severity: Record<string, number> = { REVISE: 3, WARN: 2, OK: 1 };
    const bestCritique = new Map<string, { ticker: string; verdict: string; correction: string }>();
    for (const c of critiques) {
      const key = c.ticker.toUpperCase();
      const prev = bestCritique.get(key);
      if (!prev || (severity[c.verdict] ?? 0) > (severity[prev.verdict] ?? 0)) bestCritique.set(key, c);
    }

    const shouldWatchRe = /watch|hold|avoid|wait|진입금지|관망|대기|관찰|보류|철회|매수 취소|취소|overextended|overbought|매도|비중 축소|줄이기|오버확장|집중 매매|조정 및 매도|전환/i;

    return portfolio.map(p => {
      const c = bestCritique.get(p.ticker.toUpperCase());
      if (!c) return p;
      const updated = { ...p, critiqueNote: c.correction.slice(0, 100) };
      if (c.verdict === 'REVISE') {
        if (shouldWatchRe.test(c.correction)) updated.action = 'watch' as const;
      }
      return updated;
    });
  } catch { return portfolio; }
}

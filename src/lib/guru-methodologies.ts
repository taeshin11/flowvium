export interface GuruCriteria {
  name: string;
  nameKo: string;
  style: string;
  entrySignals: string[];
  targetMethod: string;
  exitSignals: string[];
  keyMetrics: string[];
}

export const GURU_METHODOLOGIES: GuruCriteria[] = [
  {
    name: 'Warren Buffett',
    nameKo: '워렌 버핑',
    style: 'value',
    entrySignals: [
      'ROE > 15% for 10 consecutive years',
      'Debt/Equity < 0.5',
      'Owner earnings yield > 10-year treasury x 2',
      'Moat: pricing power, brand, switching cost, network effect',
      'P/E < historical average when sector underperforms',
      'Management: owner-operator, low dilution, high buybacks',
    ],
    targetMethod: 'DCF with 15% discount rate, 10-year FCF projection; target = intrinsic value x 0.75 (margin of safety)',
    exitSignals: ['Valuation exceeds DCF by 50%', 'Competitive moat eroded', 'Management changes'],
    keyMetrics: ['ROE', 'FCF yield', 'Debt/Equity', 'Owner earnings'],
  },
  {
    name: 'Peter Lynch',
    nameKo: '피터 린치',
    style: 'growth',
    entrySignals: [
      'PEG ratio < 1 (P/E divided by EPS growth rate)',
      'Invest in what you know -- consumer/retail preference',
      'Fast growers: EPS growth 20-50% with sustainable business',
      'Asset plays: hidden asset value not reflected in stock price',
      'Turnarounds: oversold with clear catalyst for recovery',
      'Revenue growth > 15% YoY for 3+ consecutive quarters',
    ],
    targetMethod: 'Target P/E = 2 x EPS growth rate; 10-bagger = 10x return over 5 years for fast growers',
    exitSignals: ['PEG > 2', 'Growth rate decelerates 3 quarters', 'Story changes fundamentally'],
    keyMetrics: ['PEG ratio', 'EPS growth rate', 'Revenue growth YoY'],
  },
  {
    name: 'Joel Greenblatt',
    nameKo: '조엘 그린블라트',
    style: 'value',
    entrySignals: [
      'Magic Formula: high earnings yield (EBIT/EV) + high ROIC',
      'Earnings yield > 10% (EBIT/Enterprise Value)',
      'ROIC > 25% (Return on Invested Capital)',
      'Special situations: spinoffs, mergers, restructurings',
    ],
    targetMethod: 'Reversion to mean valuation; target EV/EBIT normalization within 2-3 years',
    exitSignals: ['Earnings yield falls below 7%', 'ROIC deteriorates', '1-year holding period'],
    keyMetrics: ['EBIT/EV', 'ROIC', 'Enterprise Value'],
  },
  {
    name: 'Benjamin Graham',
    nameKo: '벤저민 그레이엄',
    style: 'value',
    entrySignals: [
      'P/E x P/B < 22.5 (Graham Number)',
      'P/E < 15 and P/B < 1.5',
      'Net-net: market cap < net current assets (NCAV)',
      'Debt/Equity < 1 for defensive stocks',
      'Dividend yield > AAA bond yield x 0.67',
      'EPS stable for 10 years',
    ],
    targetMethod: 'Graham Number = sqrt(22.5 x EPS x Book Value per share)',
    exitSignals: ['Price exceeds Graham Number by 50%', 'Fundamentals deteriorate'],
    keyMetrics: ['Graham Number', 'P/B', 'P/E', 'NCAV'],
  },
  {
    name: 'Philip Fisher',
    nameKo: '필립 피셔',
    style: 'growth',
    entrySignals: [
      'Scuttlebutt: industry checks confirm competitive advantage',
      'R&D as % of sales > competitors',
      'Sales force effectiveness: can grow sales without proportional cost increase',
      'Above-average profit margins sustained 5+ years',
      'Strong management team depth',
      'Long-term growth market with 10%+ CAGR',
    ],
    targetMethod: 'Buy and hold indefinitely if growth thesis intact; no fixed price target',
    exitSignals: [
      'Management quality deteriorates',
      'Market becomes commoditized',
      'Competitive advantage lost',
    ],
    keyMetrics: ['Profit margin', 'R&D/Sales', 'Revenue CAGR 5Y'],
  },
  {
    name: 'Howard Marks',
    nameKo: '하워드 마크스',
    style: 'value',
    entrySignals: [
      'Second-level thinking: consensus is wrong, contrarian opportunity',
      'Market cycle: buy aggressively in fear/panic, reduce in greed',
      'Risk-adjusted return: asymmetric upside/downside',
      'Distressed assets: price reflects excessive pessimism',
      'Quality matters: downside protection first',
    ],
    targetMethod: 'Risk-adjusted: buy when probability-weighted return >> downside risk; target = fair value',
    exitSignals: [
      'Sentiment shifts from fear to greed',
      'Risk premium compressed',
      'Better opportunities emerge',
    ],
    keyMetrics: ['Yield spread', 'Sentiment indicator', 'Risk premium'],
  },
  {
    name: 'Stanley Druckenmiller',
    nameKo: '스탠리 드러켄밀러',
    style: 'macro',
    entrySignals: [
      'Liquidity-driven: Fed easing = buy equities/risk assets',
      'Earnings inflection: first derivative of earnings acceleration',
      'Sector rotation: identify early-cycle vs late-cycle',
      'Currency signals: weak USD = EM/commodities outperform',
      'Concentrate: when right, size up significantly (25%+ position)',
    ],
    targetMethod: 'Momentum-based; target set at resistance level with trailing stop; hold as long as trend intact',
    exitSignals: ['Fed tightening', 'Earnings growth decelerates', 'Technical breakdown'],
    keyMetrics: ['Fed funds trend', 'EPS momentum', 'Currency trend'],
  },
  {
    name: 'Michael Burry',
    nameKo: '마이클 버리',
    style: 'value',
    entrySignals: [
      'Deep value: P/FCF < 10 with identifiable catalyst',
      'Insider buying: significant management purchases',
      'Share buybacks: company repurchasing at deep discount',
      'Industry out of favor: pessimism creates opportunity',
      'Specific catalyst: event-driven value unlock',
    ],
    targetMethod: 'Target = FCF yield normalization; 3x return thesis with clear catalyst timeline',
    exitSignals: ['Thesis plays out', 'Better risk/reward elsewhere', 'Catalyst fails to materialize'],
    keyMetrics: ['P/FCF', 'Insider ownership', 'Buyback yield'],
  },
];

export function getGuruPromptContext(_tickers: string[]): string {
  const top5 = GURU_METHODOLOGIES.slice(0, 5);
  return [
    '[GURU INVESTMENT FRAMEWORKS -- use these to diversify entry/target rationale]',
    'When generating entryRationale and targetRationale, cite MULTIPLE frameworks, not just technicals:',
    ...top5.map(
      (g) =>
        `${g.nameKo}(${g.name}): Entry=${g.entrySignals[0]}; Target=${g.targetMethod.slice(0, 80)}`,
    ),
    '',
    'RULE: entryRationale must include at least one NON-technical signal when fundamental data available.',
    'Examples:',
    '  BAD: 50il-seon ji-ji (technical only)',
    '  GOOD: 50il-seon + ROE 18% -> FCF yield 8% > bond x2 -> margin of safety confirmed',
    '  GOOD: Lynch PEG 0.8<1 + 100il-seon -> undervalued vs growth entry zone',
    '[END GURU FRAMEWORKS]',
  ].join('\n');
}
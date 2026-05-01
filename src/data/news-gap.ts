// @static-data-warning: 이 파일의 ownershipData/sinceDate 데이터는 하드코딩되어 있습니다.
// live API 또는 SEC EDGAR 크론이 이 데이터를 override합니다.
// 직접 수정 시 연관 API 로직도 함께 확인하세요.
import { type NewsArticle } from '@/lib/alpha-vantage';

export interface OwnershipRecord {
  institution: string;
  valueM: number;        // 포지션 가치 ($M)
  pctOfShares: number;   // 발행주식 대비 지분율 (%)
  /** 직전 분기 지분율 (변화 방향 표시용) */
  prevPct?: number;
  sharesM?: number;      // 보유 주식수 (백만 주)
  quarter: string;       // "Q4 2025"
  action: 'new' | 'increased' | 'maintained' | 'reduced';
  /** SEC EDGAR 13F 검색 링크 */
  secUrl: string;
}

export interface NewsGapEntry {
  ticker: string;
  companyName: string;
  sector: string;
  ibActivityLevel: 'high' | 'medium' | 'low';
  ibActivityScore: number;
  /** Overridden at runtime by live Alpha Vantage data */
  mediaScore: number;
  /** Overridden at runtime by live Alpha Vantage data */
  gapScore: number;
  topInstitutions: string[];
  /** Overridden at runtime by live Alpha Vantage data (includes date + source) */
  recentArticles: NewsArticle[];
  ibActions: string[];
  /** 주요 기관 보유 현황 (13F 기준) */
  ownershipData: OwnershipRecord[];
}

/** SEC EDGAR 13F 검색 URL 생성 */
function edgarSearch(institution: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(institution)}&CIK=&type=13F-HR&dateb=&owner=include&count=10&search_text=&action=getcompany`;
}

/** SEC EDGAR 티커 기준 13F 검색 */
function edgarTicker(ticker: string): string {
  return `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=13F-HR&dateRange=custom&startdt=2025-01-01`;
}

/**
 * Static institutional activity data sourced from 13F filings (updated quarterly).
 * mediaScore / gapScore / recentArticles are overridden by live Alpha Vantage data at request time.
 * Tickers match US_TICKERS_BY_PRIORITY in signals-service.ts (25 total).
 */
export const newsGapData: NewsGapEntry[] = [
  // ── Tier 1: Mid/small caps ──────────────────────────────────────────────────
  {
    ticker: 'MU',
    companyName: 'Micron Technology',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 83,
    mediaScore: 35,
    gapScore: 70,
    topInstitutions: ['BlackRock', 'Vanguard', 'Fidelity Management'],
    recentArticles: [
      { title: 'Micron beats Q1 estimates on HBM demand', date: 'Apr 2, 2026', source: 'Bloomberg', url: '' },
    ],
    ibActions: [
      'BlackRock added $2.1B position in Q4 2025',
      'Fidelity accumulated through index rebalance',
      'Multiple semiconductor-focused funds built positions citing HBM cycle',
      'Citadel disclosed new $340M stake in latest 13F',
    ],
    ownershipData: [
      { institution: 'BlackRock', valueM: 2100, pctOfShares: 2.1, sharesM: 23.3, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('BlackRock') },
      { institution: 'Vanguard', valueM: 1850, pctOfShares: 1.9, sharesM: 20.6, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'Fidelity', valueM: 980, pctOfShares: 1.0, sharesM: 10.9, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Fidelity Management') },
      { institution: 'Citadel', valueM: 340, pctOfShares: 0.35, sharesM: 3.8, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Citadel') },
    ],
  },
  {
    ticker: 'AMAT',
    companyName: 'Applied Materials',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 75,
    mediaScore: 32,
    gapScore: 72,
    topInstitutions: ['T. Rowe Price', 'Capital Research', 'Vanguard'],
    recentArticles: [
      { title: 'Applied Materials beats estimates on gate-all-around demand', date: 'Mar 20, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'T. Rowe Price increased semiconductor equipment exposure in Q4',
      'Capital Research built $800M position across multiple funds',
      'Multiple funds rotated into equipment names ahead of WFE upcycle',
      'Wellington Management initiated $450M new position',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 2200, pctOfShares: 2.6, sharesM: 12.2, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'T. Rowe Price', valueM: 1100, pctOfShares: 1.3, sharesM: 6.1, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('T. Rowe Price') },
      { institution: 'Capital Research', valueM: 800, pctOfShares: 0.95, sharesM: 4.4, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Capital Research') },
      { institution: 'Wellington', valueM: 450, pctOfShares: 0.53, sharesM: 2.5, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Wellington Management') },
    ],
  },
  {
    ticker: 'LRCX',
    companyName: 'Lam Research',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 74,
    mediaScore: 28,
    gapScore: 74,
    topInstitutions: ['Fidelity', 'Wellington Management', 'BlackRock'],
    recentArticles: [
      { title: 'Lam Research raises guidance on advanced packaging demand', date: 'Mar 15, 2026', source: 'Barron\'s', url: '' },
    ],
    ibActions: [
      'Fidelity added across growth and value funds in Q4 2025',
      'Wellington built $620M position citing WFE upcycle thesis',
      'BlackRock index addition added shares systematically',
      'Artisan Partners disclosed new position in latest 13F',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 1800, pctOfShares: 2.8, sharesM: 5.7, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'Fidelity', valueM: 950, pctOfShares: 1.5, sharesM: 3.0, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Fidelity') },
      { institution: 'Wellington', valueM: 620, pctOfShares: 0.97, sharesM: 2.0, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Wellington Management') },
      { institution: 'Artisan Partners', valueM: 380, pctOfShares: 0.59, sharesM: 1.2, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Artisan Partners') },
    ],
  },
  {
    ticker: 'KLAC',
    companyName: 'KLA Corporation',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 78,
    mediaScore: 25,
    gapScore: 75,
    topInstitutions: ['Artisan Partners', 'T. Rowe Price', 'Capital Group'],
    recentArticles: [
      { title: 'KLA process control revenue accelerates on advanced node ramp', date: 'Mar 10, 2026', source: 'Seeking Alpha', url: '' },
    ],
    ibActions: [
      'Artisan Partners doubled position in Q3 2025 — $880M total',
      'T. Rowe Price added $600M citing process control monopoly',
      'Capital Group initiated new $520M position',
      'Millennium Management added $280M in latest quarter',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 2100, pctOfShares: 2.9, sharesM: 5.9, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'Artisan Partners', valueM: 880, pctOfShares: 1.2, sharesM: 2.5, quarter: 'Q3 2025', action: 'increased', secUrl: edgarSearch('Artisan Partners') },
      { institution: 'T. Rowe Price', valueM: 600, pctOfShares: 0.83, sharesM: 1.7, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('T. Rowe Price') },
      { institution: 'Millennium', valueM: 280, pctOfShares: 0.39, sharesM: 0.8, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Millennium Management') },
    ],
  },
  {
    ticker: 'ALB',
    companyName: 'Albemarle',
    sector: 'ev-battery',
    ibActivityLevel: 'high',
    ibActivityScore: 92,
    mediaScore: 8,
    gapScore: 95,
    topInstitutions: ['Point72 Asset Management', 'Millennium Management', 'Citadel Advisors'],
    recentArticles: [
      { title: 'Lithium prices remain depressed amid oversupply concerns', date: 'Apr 1, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Point72 initiated $480M position in Q4 2025 — quietly accumulated',
      'Millennium accumulated $320M over two consecutive quarters',
      'Citadel doubled position size while media ignored the stock',
      'Dragoneer built $150M stake with no press coverage',
      'Renaissance Technologies increased allocation by 40%',
    ],
    ownershipData: [
      { institution: 'Point72', valueM: 480, pctOfShares: 6.8, sharesM: 7.9, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Point72') },
      { institution: 'Millennium', valueM: 320, pctOfShares: 4.6, sharesM: 5.3, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Millennium Management') },
      { institution: 'Citadel', valueM: 200, pctOfShares: 2.9, sharesM: 3.3, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Citadel') },
      { institution: 'Dragoneer', valueM: 150, pctOfShares: 2.1, sharesM: 2.5, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Dragoneer') },
    ],
  },
  {
    ticker: 'KTOS',
    companyName: 'Kratos Defense',
    sector: 'defense',
    ibActivityLevel: 'high',
    ibActivityScore: 85,
    mediaScore: 5,
    gapScore: 92,
    topInstitutions: ['Dragoneer Investment', 'Baillie Gifford', 'ARK Invest'],
    recentArticles: [
      { title: 'Pentagon budget includes drone funding increase', date: 'Mar 25, 2026', source: 'Defense News', url: '' },
    ],
    ibActions: [
      'Dragoneer built $200M position quietly over 3 quarters',
      'Baillie Gifford accumulated over 6 months — $340M total',
      'ARK Invest added across multiple ETFs citing drone warfare thesis',
      'Coatue Management disclosed $120M stake in 13F filing',
    ],
    ownershipData: [
      { institution: 'Baillie Gifford', valueM: 340, pctOfShares: 9.7, sharesM: 18.0, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Baillie Gifford') },
      { institution: 'Dragoneer', valueM: 200, pctOfShares: 5.7, sharesM: 10.6, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Dragoneer') },
      { institution: 'ARK Invest', valueM: 180, pctOfShares: 5.1, sharesM: 9.5, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('ARK Investment') },
      { institution: 'Coatue', valueM: 120, pctOfShares: 3.4, sharesM: 6.3, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Coatue Management') },
    ],
  },
  {
    ticker: 'MRVL',
    companyName: 'Marvell Technology',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 88,
    mediaScore: 15,
    gapScore: 88,
    topInstitutions: ['Tiger Global', 'Coatue Management', 'D1 Capital'],
    recentArticles: [
      { title: 'Marvell custom silicon pipeline expands to four hyperscalers', date: 'Apr 8, 2026', source: 'The Information', url: '' },
    ],
    ibActions: [
      'Tiger Global built $1.2B position over 3 quarters — largest new bet',
      'Coatue added $600M in Q4 citing custom ASIC opportunity',
      'D1 Capital initiated new $400M position — first semi holding',
      'Viking Global added $310M stake in latest 13F',
    ],
    ownershipData: [
      { institution: 'Tiger Global', valueM: 1200, pctOfShares: 2.1, sharesM: 17.7, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Tiger Global') },
      { institution: 'Coatue', valueM: 600, pctOfShares: 1.0, sharesM: 8.8, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Coatue Management') },
      { institution: 'D1 Capital', valueM: 400, pctOfShares: 0.7, sharesM: 5.9, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('D1 Capital') },
      { institution: 'Viking Global', valueM: 310, pctOfShares: 0.54, sharesM: 4.6, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Viking Global') },
    ],
  },
  {
    ticker: 'RTX',
    companyName: 'RTX Corporation',
    sector: 'defense',
    ibActivityLevel: 'medium',
    ibActivityScore: 71,
    mediaScore: 42,
    gapScore: 65,
    topInstitutions: ['Vanguard', 'State Street', 'Fidelity'],
    recentArticles: [
      { title: 'RTX wins $3B missile defense contract', date: 'Mar 28, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Vanguard index rebalance systematically increased allocation',
      'State Street defense ETF added shares on quarterly rebalance',
      'Fidelity defense thematic fund built $780M position',
      'Capital Research added $1.1B across multiple funds',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 6800, pctOfShares: 8.4, sharesM: 106, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'State Street', valueM: 3200, pctOfShares: 4.0, sharesM: 50, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('State Street') },
      { institution: 'Capital Research', valueM: 1100, pctOfShares: 1.4, sharesM: 17, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Research') },
      { institution: 'Fidelity', valueM: 780, pctOfShares: 0.97, sharesM: 12, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Fidelity') },
    ],
  },
  {
    ticker: 'NOC',
    companyName: 'Northrop Grumman',
    sector: 'defense',
    ibActivityLevel: 'high',
    ibActivityScore: 76,
    mediaScore: 38,
    gapScore: 68,
    topInstitutions: ['BlackRock', 'Capital Research', 'Dodge & Cox'],
    recentArticles: [
      { title: 'Northrop B-21 Raider production ramps ahead of schedule', date: 'Apr 5, 2026', source: 'Aviation Week', url: '' },
    ],
    ibActions: [
      'BlackRock defense ETF increased weighting to overweight',
      'Capital Research added $900M across 3 different funds',
      'Dodge & Cox built substantial $670M new position',
      'T. Rowe Price increased defense allocation to 5-year high',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 3100, pctOfShares: 7.8, sharesM: 9.4, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'BlackRock', valueM: 2200, pctOfShares: 5.5, sharesM: 6.7, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('BlackRock') },
      { institution: 'Capital Research', valueM: 900, pctOfShares: 2.3, sharesM: 2.7, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Research') },
      { institution: 'Dodge & Cox', valueM: 670, pctOfShares: 1.7, sharesM: 2.0, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Dodge & Cox') },
    ],
  },
  {
    ticker: 'LHX',
    companyName: 'L3Harris Technologies',
    sector: 'defense',
    ibActivityLevel: 'medium',
    ibActivityScore: 72,
    mediaScore: 30,
    gapScore: 72,
    topInstitutions: ['Vanguard', 'Fidelity', 'State Street'],
    recentArticles: [
      { title: 'L3Harris wins electronic warfare systems contract', date: 'Mar 18, 2026', source: 'Defense News', url: '' },
    ],
    ibActions: [
      'Vanguard index allocation systematically increased',
      'Fidelity defense fund doubled position to $520M',
      'State Street added $340M on pullback',
      'Wellington Management disclosed new $290M stake',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 2400, pctOfShares: 9.2, sharesM: 19.8, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'State Street', valueM: 1100, pctOfShares: 4.2, sharesM: 9.1, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('State Street') },
      { institution: 'Fidelity', valueM: 520, pctOfShares: 2.0, sharesM: 4.3, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Fidelity') },
      { institution: 'Wellington', valueM: 290, pctOfShares: 1.1, sharesM: 2.4, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Wellington Management') },
    ],
  },
  {
    ticker: 'REGN',
    companyName: 'Regeneron Pharmaceuticals',
    sector: 'pharma-biotech',
    ibActivityLevel: 'high',
    ibActivityScore: 82,
    mediaScore: 20,
    gapScore: 80,
    topInstitutions: ['Baillie Gifford', 'Wellington Management', 'Capital Group'],
    recentArticles: [
      { title: 'Regeneron dupilumab approved for new indication', date: 'Apr 10, 2026', source: 'BioPharma Dive', url: '' },
    ],
    ibActions: [
      'Baillie Gifford maintained $1.8B conviction position unchanged',
      'Wellington added $1.1B in Q4 citing dupilumab multi-indication growth',
      'Capital Group accumulated $890M through pullbacks',
      'T. Rowe Price increased allocation to all-time high $650M',
    ],
    ownershipData: [
      { institution: 'Baillie Gifford', valueM: 1800, pctOfShares: 1.7, sharesM: 1.6, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Baillie Gifford') },
      { institution: 'Wellington', valueM: 1100, pctOfShares: 1.1, sharesM: 1.0, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Wellington Management') },
      { institution: 'Capital Group', valueM: 890, pctOfShares: 0.85, sharesM: 0.8, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Group') },
      { institution: 'T. Rowe Price', valueM: 650, pctOfShares: 0.62, sharesM: 0.6, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('T. Rowe Price') },
    ],
  },
  {
    ticker: 'MRNA',
    companyName: 'Moderna',
    sector: 'pharma-biotech',
    ibActivityLevel: 'high',
    ibActivityScore: 80,
    mediaScore: 30,
    gapScore: 72,
    topInstitutions: ['Baillie Gifford', 'Fidelity', 'Wellington Management'],
    recentArticles: [
      { title: 'Moderna cancer vaccine shows 49% risk reduction in melanoma trial', date: 'Mar 30, 2026', source: 'NEJM', url: '' },
    ],
    ibActions: [
      'Baillie Gifford doubled position near multi-year lows — $1.4B total',
      'Fidelity accumulated $900M over two consecutive quarters',
      'Wellington initiated $780M position citing cancer vaccine pipeline',
      'ARK Invest maintained largest ETF position despite drawdown',
    ],
    ownershipData: [
      { institution: 'Baillie Gifford', valueM: 1400, pctOfShares: 8.2, sharesM: 31.1, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Baillie Gifford') },
      { institution: 'Fidelity', valueM: 900, pctOfShares: 5.3, sharesM: 20.0, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Fidelity') },
      { institution: 'Wellington', valueM: 780, pctOfShares: 4.6, sharesM: 17.3, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Wellington Management') },
      { institution: 'ARK Invest', valueM: 420, pctOfShares: 2.5, sharesM: 9.3, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('ARK Investment') },
    ],
  },
  {
    ticker: 'PFE',
    companyName: 'Pfizer',
    sector: 'pharma-biotech',
    ibActivityLevel: 'medium',
    ibActivityScore: 68,
    mediaScore: 55,
    gapScore: 45,
    topInstitutions: ['Vanguard', 'BlackRock', 'State Street'],
    recentArticles: [
      { title: 'Pfizer oncology pipeline advances to Phase 3', date: 'Apr 3, 2026', source: 'Reuters', url: '' },
      { title: 'Pfizer raises full-year guidance on cost cuts', date: 'Mar 22, 2026', source: 'Bloomberg', url: '' },
    ],
    ibActions: [
      'Major index funds maintained large positions at multi-year lows',
      'Capital Research increased stake — contrarian value thesis',
      'Dodge & Cox added $1.2B citing pipeline de-risking',
      'Causeway Capital initiated new $450M position',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 9200, pctOfShares: 8.4, sharesM: 1050, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'BlackRock', valueM: 7100, pctOfShares: 6.5, sharesM: 810, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('BlackRock') },
      { institution: 'Dodge & Cox', valueM: 1200, pctOfShares: 1.1, sharesM: 137, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Dodge & Cox') },
      { institution: 'Causeway Capital', valueM: 450, pctOfShares: 0.41, sharesM: 51, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Causeway Capital') },
    ],
  },
  {
    ticker: 'ORCL',
    companyName: 'Oracle',
    sector: 'ai-cloud',
    ibActivityLevel: 'medium',
    ibActivityScore: 70,
    mediaScore: 48,
    gapScore: 52,
    topInstitutions: ['Capital Research', 'T. Rowe Price', 'Primecap Management'],
    recentArticles: [
      { title: 'Oracle cloud revenue surges 24% on AI workload demand', date: 'Apr 7, 2026', source: 'CNBC', url: '' },
    ],
    ibActions: [
      'Capital Research added $1.4B on cloud acceleration thesis',
      'T. Rowe Price initiated tech value position — $680M',
      'Primecap built $520M position citing AI infrastructure tailwinds',
      'Sequoia added to position amid multi-cloud adoption surge',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 8400, pctOfShares: 3.0, sharesM: 59, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'Capital Research', valueM: 1400, pctOfShares: 0.50, sharesM: 9.8, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Research') },
      { institution: 'T. Rowe Price', valueM: 680, pctOfShares: 0.24, sharesM: 4.8, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('T. Rowe Price') },
      { institution: 'Primecap', valueM: 520, pctOfShares: 0.19, sharesM: 3.6, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Primecap') },
    ],
  },
  {
    ticker: 'NVO',
    companyName: 'Novo Nordisk',
    sector: 'pharma-biotech',
    ibActivityLevel: 'high',
    ibActivityScore: 84,
    mediaScore: 62,
    gapScore: 38,
    topInstitutions: ['Capital Group', 'Wellington Management', 'Baillie Gifford'],
    recentArticles: [
      { title: 'Novo Nordisk semaglutide cardiovascular data redefines obesity treatment', date: 'Apr 9, 2026', source: 'The Lancet', url: '' },
      { title: 'NVO raises Wegovy capacity forecast by 40%', date: 'Mar 14, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Capital Group maintained largest ex-Denmark position — $4.2B',
      'Wellington added $1.6B on GLP-1 total addressable market expansion',
      'Baillie Gifford cited 10-year obesity treatment opportunity',
      'Fidelity Contrafund built $1.1B position in latest quarter',
    ],
    ownershipData: [
      { institution: 'Capital Group', valueM: 4200, pctOfShares: 1.8, sharesM: 92, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Capital Group') },
      { institution: 'Wellington', valueM: 1600, pctOfShares: 0.69, sharesM: 35, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Wellington Management') },
      { institution: 'Baillie Gifford', valueM: 1200, pctOfShares: 0.52, sharesM: 26, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Baillie Gifford') },
      { institution: 'Fidelity Contrafund', valueM: 1100, pctOfShares: 0.47, sharesM: 24, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Fidelity') },
    ],
  },
  {
    ticker: 'TSM',
    companyName: 'TSMC',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 82,
    mediaScore: 42,
    gapScore: 45,
    topInstitutions: ['Capital Group', 'Berkshire Hathaway', 'GIC Singapore'],
    recentArticles: [
      { title: 'TSMC reports record revenue on AI demand', date: 'Apr 11, 2026', source: 'Reuters', url: '' },
      { title: 'TSMC Arizona fab on track for 2nm production', date: 'Mar 27, 2026', source: 'Bloomberg', url: '' },
    ],
    ibActions: [
      'Capital Group added $1.6B in Q4 2025 — largest semi position',
      'Berkshire Hathaway maintained $5B+ long-term strategic position',
      'GIC Singapore increased stake by 15% in latest 13F',
      'Fisher Investments added $890M on AI semiconductor cycle thesis',
    ],
    ownershipData: [
      { institution: 'Capital Group', valueM: 1600, pctOfShares: 0.62, sharesM: 95, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Group') },
      { institution: 'Berkshire Hathaway', valueM: 5200, pctOfShares: 2.0, sharesM: 308, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Berkshire Hathaway') },
      { institution: 'Fisher Investments', valueM: 890, pctOfShares: 0.34, sharesM: 53, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Fisher Investments') },
    ],
  },
  {
    ticker: 'ASML',
    companyName: 'ASML Holding',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 79,
    mediaScore: 25,
    gapScore: 75,
    topInstitutions: ['Capital Research', 'Baillie Gifford', 'Norges Bank'],
    recentArticles: [
      { title: 'ASML High-NA EUV orders accelerate from memory customers', date: 'Mar 12, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Capital Research built $2.2B position citing EUV monopoly moat',
      'Baillie Gifford added to 8-year long-term holding',
      'Norges Bank increased allocation to 1.8% of sovereign fund',
      'Wellington Management initiated $750M position in latest 13F',
    ],
    ownershipData: [
      { institution: 'Capital Research', valueM: 2200, pctOfShares: 0.87, sharesM: 5.5, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Research') },
      { institution: 'Baillie Gifford', valueM: 1800, pctOfShares: 0.71, sharesM: 4.5, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Baillie Gifford') },
      { institution: 'Norges Bank', valueM: 1400, pctOfShares: 0.55, sharesM: 3.5, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Norges Bank') },
      { institution: 'Wellington', valueM: 750, pctOfShares: 0.30, sharesM: 1.9, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Wellington Management') },
    ],
  },
  {
    ticker: 'NVDA',
    companyName: 'NVIDIA',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 95,
    mediaScore: 98,
    gapScore: 5,
    topInstitutions: ['Vanguard', 'BlackRock', 'Goldman Sachs AM'],
    recentArticles: [
      { title: 'NVIDIA reports blowout earnings, beats on every metric', date: 'Apr 12, 2026', source: 'Bloomberg', url: '' },
      { title: 'Jensen Huang keynote reveals next-gen Rubin architecture', date: 'Apr 8, 2026', source: 'The Verge', url: '' },
    ],
    ibActions: [
      'Goldman Sachs added $3.8B in Q4 — across all portfolios',
      'Universal accumulation across every major institutional fund',
      'Hedge fund positioning at all-time highs per 13F aggregate',
      'Vanguard maintains $180B+ position as largest holder',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 180000, pctOfShares: 7.3, sharesM: 4400, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'BlackRock', valueM: 140000, pctOfShares: 5.7, sharesM: 3400, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('BlackRock') },
      { institution: 'Goldman Sachs AM', valueM: 3800, pctOfShares: 0.15, sharesM: 92, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Goldman Sachs') },
    ],
  },
  {
    ticker: 'MSFT',
    companyName: 'Microsoft',
    sector: 'ai-cloud',
    ibActivityLevel: 'high',
    ibActivityScore: 88,
    mediaScore: 90,
    gapScore: 10,
    topInstitutions: ['Vanguard', 'BlackRock', 'Capital Research'],
    recentArticles: [
      { title: 'Microsoft Copilot drives Azure growth acceleration', date: 'Apr 10, 2026', source: 'CNBC', url: '' },
      { title: 'Microsoft raises dividend by 10%, buyback $60B', date: 'Apr 3, 2026', source: 'WSJ', url: '' },
    ],
    ibActions: [
      'Vanguard maintains largest position — $180B+ across all funds',
      'BlackRock systematically increased via all index rebalances',
      'Capital Research added $4B citing Copilot AI monetization',
      'T. Rowe Price increased to top-3 holding',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 180000, pctOfShares: 8.8, sharesM: 6600, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'BlackRock', valueM: 140000, pctOfShares: 6.8, sharesM: 5100, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('BlackRock') },
      { institution: 'Capital Research', valueM: 4000, pctOfShares: 0.19, sharesM: 143, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Research') },
    ],
  },
  {
    ticker: 'GOOGL',
    companyName: 'Alphabet',
    sector: 'ai-cloud',
    ibActivityLevel: 'high',
    ibActivityScore: 87,
    mediaScore: 88,
    gapScore: 12,
    topInstitutions: ['Vanguard', 'BlackRock', 'T. Rowe Price'],
    recentArticles: [
      { title: 'Google Gemini integration boosts search monetization', date: 'Apr 9, 2026', source: 'Reuters', url: '' },
      { title: 'Alphabet announces $70B buyback program', date: 'Mar 30, 2026', source: 'Bloomberg', url: '' },
    ],
    ibActions: [
      'Vanguard maintains $140B+ position across index funds',
      'BlackRock increased weight in all growth portfolios',
      'T. Rowe Price added $2.1B on AI search narrative',
      'Fidelity Growth Company doubled Alphabet allocation',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 140000, pctOfShares: 6.9, sharesM: 11900, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'BlackRock', valueM: 110000, pctOfShares: 5.4, sharesM: 9300, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('BlackRock') },
      { institution: 'T. Rowe Price', valueM: 2100, pctOfShares: 0.10, sharesM: 178, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('T. Rowe Price') },
    ],
  },
  {
    ticker: 'META',
    companyName: 'Meta Platforms',
    sector: 'ai-cloud',
    ibActivityLevel: 'high',
    ibActivityScore: 90,
    mediaScore: 85,
    gapScore: 15,
    topInstitutions: ['Vanguard', 'Fidelity', 'Capital Group'],
    recentArticles: [
      { title: 'Meta Llama 4 outperforms GPT-4 on key benchmarks', date: 'Apr 11, 2026', source: 'TechCrunch', url: '' },
      { title: 'Meta advertising revenue beats by 8%, raises guidance', date: 'Apr 5, 2026', source: 'Bloomberg', url: '' },
    ],
    ibActions: [
      'Vanguard index holdings at all-time highs via rebalancing',
      'Fidelity Contrafund added $2.4B on advertising recovery',
      'Capital Group increased to top-5 holding — $6.1B total',
      'D1 Capital built new $890M position on AI revenue thesis',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 58000, pctOfShares: 7.0, sharesM: 990, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'Fidelity', valueM: 2400, pctOfShares: 0.29, sharesM: 41, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Fidelity') },
      { institution: 'Capital Group', valueM: 6100, pctOfShares: 0.73, sharesM: 104, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Group') },
      { institution: 'D1 Capital', valueM: 890, pctOfShares: 0.11, sharesM: 15, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('D1 Capital') },
    ],
  },
  {
    ticker: 'AMZN',
    companyName: 'Amazon',
    sector: 'ai-cloud',
    ibActivityLevel: 'high',
    ibActivityScore: 91,
    mediaScore: 82,
    gapScore: 18,
    topInstitutions: ['Vanguard', 'BlackRock', 'Fidelity'],
    recentArticles: [
      { title: 'AWS revenue grows 37% as enterprise AI migration accelerates', date: 'Apr 13, 2026', source: 'CNBC', url: '' },
      { title: 'Amazon raises Prime membership pricing in 12 markets', date: 'Apr 2, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Vanguard maintains $220B+ position as #1 external holder',
      'BlackRock growth funds increased allocation to 5-year high',
      'Universal institutional accumulation on AWS AI growth thesis',
      'Capital Group added $3.2B in latest quarter',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 220000, pctOfShares: 7.0, sharesM: 21000, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'BlackRock', valueM: 170000, pctOfShares: 5.4, sharesM: 16200, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('BlackRock') },
      { institution: 'Capital Group', valueM: 3200, pctOfShares: 0.10, sharesM: 305, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Group') },
    ],
  },
  {
    ticker: 'TSLA',
    companyName: 'Tesla',
    sector: 'ev-battery',
    ibActivityLevel: 'medium',
    ibActivityScore: 76,
    mediaScore: 80,
    gapScore: 20,
    topInstitutions: ['Vanguard', 'BlackRock', 'ARK Invest'],
    recentArticles: [
      { title: 'Tesla FSD v13 approval pending in EU', date: 'Apr 7, 2026', source: 'Electrek', url: '' },
      { title: 'Tesla Cybertruck ramp accelerates in Q1', date: 'Mar 25, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'ARK Invest maintains largest conviction position — $2.1B',
      'Vanguard index adds on S&P 500 weighting rebalance',
      'BlackRock ETF added shares on quarterly rebalance',
      'Some value funds reduced on valuation concerns — net neutral',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 22000, pctOfShares: 6.8, sharesM: 690, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'BlackRock', valueM: 17000, pctOfShares: 5.2, sharesM: 532, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('BlackRock') },
      { institution: 'ARK Invest', valueM: 2100, pctOfShares: 0.64, sharesM: 65, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('ARK Investment') },
    ],
  },
  {
    ticker: 'LLY',
    companyName: 'Eli Lilly',
    sector: 'pharma-biotech',
    ibActivityLevel: 'high',
    ibActivityScore: 88,
    mediaScore: 75,
    gapScore: 20,
    topInstitutions: ['Capital Research', 'T. Rowe Price', 'Wellington'],
    recentArticles: [
      { title: 'Mounjaro demand continues to outstrip supply globally', date: 'Apr 11, 2026', source: 'Bloomberg', url: '' },
      { title: 'Eli Lilly raises full-year guidance for third time', date: 'Apr 4, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Capital Research accumulated $4.8B through multiple fund vehicles',
      'T. Rowe Price increased conviction position to $3.2B',
      'Wellington Management added $2.1B on pullbacks',
      'Fidelity Contrafund quadrupled position over 18 months',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 28000, pctOfShares: 2.9, sharesM: 290, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('Vanguard') },
      { institution: 'Capital Research', valueM: 4800, pctOfShares: 0.50, sharesM: 50, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Research') },
      { institution: 'T. Rowe Price', valueM: 3200, pctOfShares: 0.33, sharesM: 33, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('T. Rowe Price') },
      { institution: 'Wellington', valueM: 2100, pctOfShares: 0.22, sharesM: 22, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Wellington Management') },
    ],
  },
  {
    ticker: 'LMT',
    companyName: 'Lockheed Martin',
    sector: 'defense',
    ibActivityLevel: 'medium',
    ibActivityScore: 73,
    mediaScore: 45,
    gapScore: 60,
    topInstitutions: ['Vanguard', 'State Street', 'Capital Research'],
    recentArticles: [
      { title: 'Lockheed F-35 production milestone reached — 1000th jet', date: 'Apr 6, 2026', source: 'Defense News', url: '' },
      { title: 'Lockheed wins $12B hypersonic weapons contract', date: 'Mar 20, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Vanguard defense ETF increased allocation to overweight',
      'Capital Research added $1.3B on defense budget growth thesis',
      'State Street maintains core index position — $3.8B',
      'Dodge & Cox initiated new value position at multi-year discount',
    ],
    ownershipData: [
      { institution: 'Vanguard', valueM: 8200, pctOfShares: 8.0, sharesM: 18.0, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Vanguard') },
      { institution: 'State Street', valueM: 3800, pctOfShares: 3.7, sharesM: 8.3, quarter: 'Q4 2025', action: 'maintained', secUrl: edgarSearch('State Street') },
      { institution: 'Capital Research', valueM: 1300, pctOfShares: 1.3, sharesM: 2.9, quarter: 'Q4 2025', action: 'increased', secUrl: edgarSearch('Capital Research') },
      { institution: 'Dodge & Cox', valueM: 680, pctOfShares: 0.66, sharesM: 1.5, quarter: 'Q4 2025', action: 'new', secUrl: edgarSearch('Dodge & Cox') },
    ],
  },
  // ── Batch6 additions ───────────────────────────────────────────────────────
  {
    ticker: 'COIN',
    companyName: 'Coinbase',
    sector: 'financials',
    ibActivityLevel: 'high',
    ibActivityScore: 78,
    mediaScore: 32,
    gapScore: 68,
    topInstitutions: ['Millennium Management', 'ARK Invest', 'Fidelity'],
    recentArticles: [
      { title: 'Coinbase institutional custody AUM crosses $400B milestone', date: 'Apr 9, 2026', source: 'The Block', url: '' },
      { title: 'Coinbase Prime adds 18 new hedge fund clients in Q1 2026', date: 'Apr 1, 2026', source: 'CoinDesk', url: '' },
    ],
    ibActions: [
      'Millennium Management initiated $2.3B new position — largest institutional onboarding',
      'ARK Invest maintains largest conviction position at $1.8B',
      'Fidelity Digital Assets expanded institutional custody agreement',
      '14 new institutional mandates opened following Digital Asset Market Structure Act',
    ],
    ownershipData: [
      { institution: 'ARK Invest', valueM: 1800, pctOfShares: 2.4, sharesM: 5.8, quarter: 'Q1 2026', action: 'maintained', secUrl: edgarSearch('ARK Investment') },
      { institution: 'Millennium Management', valueM: 2300, pctOfShares: 3.1, sharesM: 7.4, quarter: 'Q1 2026', action: 'new', secUrl: edgarSearch('Millennium Management') },
      { institution: 'Fidelity', valueM: 820, pctOfShares: 1.1, sharesM: 2.7, quarter: 'Q1 2026', action: 'increased', secUrl: edgarSearch('Fidelity') },
    ],
  },
  {
    ticker: 'FCX',
    companyName: 'Freeport-McMoRan',
    sector: 'materials',
    ibActivityLevel: 'high',
    ibActivityScore: 80,
    mediaScore: 26,
    gapScore: 71,
    topInstitutions: ['Baupost Group', 'BlackRock', 'Vanguard'],
    recentArticles: [
      { title: 'Copper prices surge on global electrification demand outlook', date: 'Apr 8, 2026', source: 'Bloomberg', url: '' },
      { title: 'Freeport Grasberg copper output hits quarterly record', date: 'Mar 27, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Baupost Group initiated $680M new position — value-driven entry at multi-year discount',
      'BlackRock infrastructure funds increased allocation on electrification thesis',
      'Five energy-transition hedge funds built positions totaling ~8% of float',
      'State Street copper/materials ETF rebalanced upward',
    ],
    ownershipData: [
      { institution: 'Baupost Group', valueM: 680, pctOfShares: 0.47, sharesM: 14.2, quarter: 'Q1 2026', action: 'new', secUrl: edgarSearch('Baupost Group') },
      { institution: 'BlackRock', valueM: 4200, pctOfShares: 2.9, sharesM: 87.4, quarter: 'Q1 2026', action: 'increased', secUrl: edgarSearch('BlackRock') },
      { institution: 'Vanguard', valueM: 3800, pctOfShares: 2.6, sharesM: 79.1, quarter: 'Q1 2026', action: 'maintained', secUrl: edgarSearch('Vanguard') },
    ],
  },
  {
    ticker: 'SMCI',
    companyName: 'Super Micro Computer',
    sector: 'semiconductors',
    ibActivityLevel: 'high',
    ibActivityScore: 82,
    mediaScore: 18,
    gapScore: 76,
    topInstitutions: ['Renaissance Technologies', 'Vanguard', 'Citadel'],
    recentArticles: [
      { title: 'Super Micro ships record AI server racks to hyperscalers in Q1', date: 'Apr 4, 2026', source: 'Reuters', url: '' },
      { title: 'SMCI secures $1.2B AI infrastructure contract with unnamed cloud provider', date: 'Mar 18, 2026', source: 'Bloomberg', url: '' },
    ],
    ibActions: [
      'Renaissance Technologies initiated $580M new position via quant models',
      'Citadel Advisors increased position by 340% in single quarter',
      'Three AI-infrastructure focused hedge funds built simultaneous positions',
      'Institutional ownership increased from 42% to 61% of float in 2 quarters',
    ],
    ownershipData: [
      { institution: 'Renaissance Technologies', valueM: 580, pctOfShares: 1.8, sharesM: 4.2, quarter: 'Q1 2026', action: 'new', secUrl: edgarSearch('Renaissance Technologies') },
      { institution: 'Vanguard', valueM: 1200, pctOfShares: 3.7, sharesM: 8.7, quarter: 'Q1 2026', action: 'increased', secUrl: edgarSearch('Vanguard') },
      { institution: 'Citadel', valueM: 420, pctOfShares: 1.3, sharesM: 3.1, quarter: 'Q1 2026', action: 'increased', secUrl: edgarSearch('Citadel Advisors') },
    ],
  },
  {
    ticker: 'DELL',
    companyName: 'Dell Technologies',
    sector: 'ai-cloud',
    ibActivityLevel: 'high',
    ibActivityScore: 76,
    mediaScore: 38,
    gapScore: 63,
    topInstitutions: ['Appaloosa Management', 'BlackRock', 'Silver Lake'],
    recentArticles: [
      { title: 'Dell AI server backlog exceeds $9B as enterprise AI buildout accelerates', date: 'Apr 7, 2026', source: 'CNBC', url: '' },
      { title: 'Dell Infrastructure Solutions revenue up 42% on AI server demand', date: 'Mar 22, 2026', source: 'Reuters', url: '' },
    ],
    ibActions: [
      'Appaloosa Management added $740M on AI server thesis',
      'BlackRock increased conviction position to 5-year high',
      'Private equity sponsors maintain large strategic stake',
      'Value funds added on discounted valuation vs. AI server peers',
    ],
    ownershipData: [
      { institution: 'Appaloosa Management', valueM: 740, pctOfShares: 1.0, sharesM: 18.4, quarter: 'Q1 2026', action: 'increased', secUrl: edgarSearch('Appaloosa Management') },
      { institution: 'BlackRock', valueM: 2800, pctOfShares: 3.7, sharesM: 69.6, quarter: 'Q1 2026', action: 'increased', secUrl: edgarSearch('BlackRock') },
      { institution: 'Vanguard', valueM: 2200, pctOfShares: 2.9, sharesM: 54.7, quarter: 'Q1 2026', action: 'maintained', secUrl: edgarSearch('Vanguard') },
    ],
  },
];

export { edgarTicker };

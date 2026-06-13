import { allCompanies } from "./companies";

export interface Sector {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  /** 2026-06-13: 동적 계산값 — 아래 리터럴은 무시되고 allCompanies 실제 count 로 덮어씀.
   *  (하드코딩 count 가 universe 1210+ 성장과 drift: semiconductors 15→실제 35 등 전부 과소표기.
   *   "권위 소스 파생물 손으로 나열 금지" — explore 페이지 c.sector===id 필터와 동일 기준.) */
  companyCount: number;
  leaderTicker: string;
}

export const sectors: Sector[] = [
  {
    id: "semiconductors",
    name: "Semiconductors",
    description:
      "The foundational hardware layer powering AI, mobile, automotive, and cloud computing. Spans chip designers (NVIDIA), foundries (TSMC), memory makers (SK Hynix, Samsung, Micron), and equipment suppliers (ASML, Applied Materials, Lam Research, KLA).",
    icon: "Cpu",
    color: "#6366f1",
    companyCount: 15,
    leaderTicker: "NVDA",
  },
  {
    id: "ai-cloud",
    name: "AI / Cloud",
    description:
      "Hyperscale cloud providers and AI-platform companies that consume the majority of advanced semiconductors. Microsoft Azure, AWS, Google Cloud, Meta, and Oracle drive multi-hundred-billion-dollar capex cycles that cascade through the entire chip supply chain.",
    icon: "Cloud",
    color: "#3b82f6",
    companyCount: 10,
    leaderTicker: "MSFT",
  },
  {
    id: "ev-battery",
    name: "EV / Battery",
    description:
      "The electric-vehicle and energy-storage ecosystem from upstream lithium mining (Albemarle) through battery cell manufacturing (CATL, LG Energy, Panasonic) to vehicle OEMs (Tesla, BYD). Supply-chain cascades flow from lithium prices to cell costs to vehicle margins.",
    icon: "Battery",
    color: "#22c55e",
    companyCount: 11,
    leaderTicker: "TSLA",
  },
  {
    id: "defense",
    name: "Defense",
    description:
      "Western defense-industrial base anchored by U.S. prime contractors (Lockheed Martin, RTX, Northrop Grumman) and key international partners (BAE Systems). Driven by government budgets, geopolitical tensions, and multi-decade program cycles like the F-35 and B-21.",
    icon: "Shield",
    color: "#ef4444",
    companyCount: 15,
    leaderTicker: "LMT",
  },
  {
    id: "pharma-biotech",
    name: "Pharma / Biotech",
    description:
      "Large-cap pharmaceutical and biotechnology companies spanning GLP-1 obesity drugs (Novo Nordisk, Eli Lilly), mRNA therapeutics (Moderna, Pfizer), and antibody platforms (Regeneron). Patent cliffs, FDA approvals, and clinical trial data drive sector-wide cascades.",
    icon: "FlaskConical",
    color: "#a855f7",
    companyCount: 18,
    leaderTicker: "LLY",
  },
  {
    id: "consumer-defensive",
    name: "Consumer Defensive",
    description:
      "Essential consumer goods and services that perform well regardless of economic conditions. Spans household products (Procter & Gamble), beverages (Coca-Cola, PepsiCo), warehouse retail (Costco, Walmart), and packaged food (General Mills).",
    icon: "ShoppingCart",
    color: "#8B5CF6",
    companyCount: 25,
    leaderTicker: "PG",
  },
  {
    id: "financials",
    name: "Financials",
    description:
      "Banks, insurance, asset management, and financial services companies. Includes diversified banking (JPMorgan), investment banking (Goldman Sachs, Morgan Stanley), payments (Visa), and exchanges (ICE, Tradeweb).",
    icon: "Landmark",
    color: "#F59E0B",
    companyCount: 35,
    leaderTicker: "JPM",
  },
  {
    id: "energy",
    name: "Energy",
    description:
      "Oil, gas, renewable energy companies and energy infrastructure. Spans integrated majors (ExxonMobil, Chevron), exploration & production (ConocoPhillips, EOG), oilfield services (Schlumberger), renewables (NextEra, First Solar), and LNG export (Cheniere).",
    icon: "Flame",
    color: "#DC2626",
    companyCount: 23,
    leaderTicker: "XOM",
  },
  {
    id: "healthcare",
    name: "Healthcare",
    description:
      "Healthcare providers, medical device manufacturers, and health insurance companies. Includes managed care (UnitedHealth), medical devices (Abbott, Medtronic), health services (HCA Healthcare), and life sciences tools (Thermo Fisher, Danaher).",
    icon: "Heart",
    color: "#10b981",
    companyCount: 30,
    leaderTicker: "UNH",
  },
  {
    id: "industrials",
    name: "Industrials",
    description:
      "Industrial conglomerates, machinery, aerospace, and transportation companies. Spans heavy equipment (Caterpillar, Deere), aerospace (Boeing, GE Aerospace), railroads (Union Pacific), and industrial automation (Honeywell, Emerson).",
    icon: "Factory",
    color: "#64748b",
    companyCount: 40,
    leaderTicker: "CAT",
  },
  {
    id: "communication-services",
    name: "Communication Services",
    description:
      "Media, entertainment, telecommunications, and interactive services companies. Includes legacy media (Disney, Comcast), streaming platforms, telecom carriers (AT&T, Verizon), and interactive entertainment.",
    icon: "Radio",
    color: "#f97316",
    companyCount: 19,
    leaderTicker: "DIS",
  },
  {
    id: "real-estate",
    name: "Real Estate",
    description:
      "Real estate investment trusts (REITs) and real estate services. Spans cell towers (American Tower, Crown Castle), data centers (Equinix, Digital Realty), industrial warehousing (Prologis), and residential REITs.",
    icon: "Building2",
    color: "#14b8a6",
    companyCount: 25,
    leaderTicker: "AMT",
  },
  {
    id: "materials",
    name: "Materials",
    description:
      "Chemical, mining, and materials companies that provide raw inputs across industries. Includes industrial gases (Linde, Air Products), specialty chemicals (Ecolab, Sherwin-Williams), metals & mining, and packaging materials.",
    icon: "Gem",
    color: "#a3866a",
    companyCount: 21,
    leaderTicker: "LIN",
  },
  {
    id: "utilities",
    name: "Utilities",
    description:
      "Electric, gas, and water utility companies providing essential services. Includes regulated utilities (Duke Energy, Southern Company), renewable-focused utilities (NextEra Energy), and multi-utility providers.",
    icon: "Zap",
    color: "#eab308",
    companyCount: 22,
    leaderTicker: "DUK",
  },
  {
    id: "consumer-discretionary",
    name: "Consumer Discretionary",
    description:
      "Consumer goods and services tied to discretionary spending. Spans home improvement (Home Depot, Lowe's), apparel (Nike), restaurants (McDonald's, Starbucks), e-commerce (Amazon), and automotive retail.",
    icon: "ShoppingBag",
    color: "#ec4899",
    companyCount: 35,
    leaderTicker: "HD",
  },
  {
    id: "it-software",
    name: "IT / Software",
    description:
      "Information technology hardware, software, and services companies. Includes consumer electronics (Apple), enterprise software (Salesforce, SAP), IT services (Accenture), cybersecurity (Palo Alto Networks, CrowdStrike), and networking (Cisco).",
    icon: "Monitor",
    color: "#0ea5e9",
    companyCount: 28,
    leaderTicker: "AAPL",
  },
];

// 2026-06-13: companyCount 를 allCompanies 권위 소스에서 동적 계산 — 하드코딩 리터럴 덮어씀.
//   explore/[sector] 의 `c.sector === id` 필터와 정확히 같은 기준이라 카드 숫자=상세페이지 종목수 일치.
{
  const counts: Record<string, number> = {};
  for (const c of allCompanies) counts[c.sector] = (counts[c.sector] ?? 0) + 1;
  for (const s of sectors) s.companyCount = counts[s.id] ?? 0;
}

export function getSectorById(id: string): Sector | undefined {
  return sectors.find((s) => s.id === id);
}

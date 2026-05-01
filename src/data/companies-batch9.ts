/**
 * @static-data-warning
 * revenue.total, revenue.segments[].amount, employees 필드는 정적 데이터입니다.
 * 실제 값은 /api/company-financials/{ticker} (SEC EDGAR) 및 Yahoo Finance에서 자동 override됩니다.
 * 이 파일의 금액/직원수를 수동으로 수정하지 마세요 — live API가 우선합니다.
 * 정적값은 live 데이터 없을 때의 fallback 역할만 합니다.
 */
import { Company } from './companies';

export const companiesBatch9: Company[] = [
  // ============================================================
  // AUTOMOTIVE (INTERNATIONAL)
  // ============================================================
  {
    id: "hmc",
    name: "Honda Motor Co.",
    ticker: "HMC",
    sector: "automotive",
    subSector: "Automobiles",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Automobiles & SUVs", description: "Civic, Accord, CR-V, Pilot, Odyssey — global passenger vehicle lineup.", revenueShare: 70 },
      { name: "Motorcycles", description: "World's largest motorcycle maker — Africa Twin, Gold Wing, CB series.", revenueShare: 14 },
      { name: "Power Products & Others", description: "Engines, generators, lawnmowers, marine engines, aircraft (Honda Jet).", revenueShare: 16 },
    ],
    revenue: { total: "$142B", segments: [
      { name: "Automobile Business", percentage: 70, amount: "$99.4B" },
      { name: "Motorcycle Business", percentage: 14, amount: "$19.9B" },
      { name: "Financial Services", percentage: 12, amount: "$17.0B" },
      { name: "Power Products & Other", percentage: 4, amount: "$5.7B" },
    ]},
    relationships: [
      { targetId: "tsm", type: "supplier", products: ["Automotive chips"], revenueImpact: "indirect" },
      { targetId: "lly", type: "partner", products: ["Battery sourcing"], revenueImpact: "growing" },
    ],
    description: "Honda is Japan's second-largest automaker and the world's largest motorcycle manufacturer. It is the first Japanese automaker to produce more cars in the US than it imports.",
    headquarters: "Tokyo, Japan", founded: 1948, employees: "197,000", website: "honda.com",
  },
  {
    id: "stla",
    name: "Stellantis N.V.",
    ticker: "STLA",
    sector: "automotive",
    subSector: "Automobiles",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Jeep / Ram / Dodge", description: "Core North American brands — Jeep Wrangler/Grand Cherokee, Ram pickups, Dodge muscle cars.", revenueShare: 45 },
      { name: "Peugeot / Citroën / Opel", description: "European mass-market brands after PSA merger.", revenueShare: 30 },
      { name: "Fiat / Alfa Romeo / Maserati / Chrysler", description: "Italian premium and mass-market brands plus legacy Chrysler.", revenueShare: 25 },
    ],
    revenue: { total: "$189B", segments: [
      { name: "North America", percentage: 46, amount: "$87B" },
      { name: "Enlarged Europe", percentage: 37, amount: "$70B" },
      { name: "Middle East & Africa / South America / Other", percentage: 17, amount: "$32B" },
    ]},
    relationships: [
      { targetId: "lly", type: "partner", products: ["EV battery supply"], revenueImpact: "strategic" },
      { targetId: "f", type: "competitor", products: ["Trucks/pickups"], revenueImpact: "major" },
    ],
    description: "Stellantis (formed from the FCA-PSA merger in 2021) is the world's fourth-largest automaker by unit sales, owning 14 brands including Jeep, Ram, Peugeot, Fiat, and Chrysler.",
    headquarters: "Amsterdam, Netherlands", founded: 2021, employees: "294,000", website: "stellantis.com",
  },
  {
    id: "li",
    name: "Li Auto Inc.",
    ticker: "LI",
    sector: "automotive",
    subSector: "Electric Vehicles",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Extended-Range EVs (EREV)", description: "Li L7, L8, L9 SUVs with onboard range extender — eliminates range anxiety without pure-BEV infrastructure.", revenueShare: 95 },
      { name: "Pure BEV (MEGA & future models)", description: "Li MEGA MPV and upcoming pure-battery models targeting premium China market.", revenueShare: 5 },
    ],
    revenue: { total: "$21.5B", segments: [
      { name: "Vehicle Sales", percentage: 97, amount: "$20.9B" },
      { name: "Services & Others", percentage: 3, amount: "$0.6B" },
    ]},
    relationships: [
      { targetId: "catl", type: "supplier", products: ["EV battery cells"], revenueImpact: "critical" },
      { targetId: "nvda", type: "partner", products: ["Orin SoC for ADAS"], revenueImpact: "significant" },
    ],
    description: "Li Auto is a leading Chinese EV maker specializing in extended-range electric vehicles (EREVs), targeting family SUV buyers in China who want EV economics without pure-EV range anxiety.",
    headquarters: "Beijing, China", founded: 2015, employees: "32,000", website: "lixiang.com",
  },
  {
    id: "lkq",
    name: "LKQ Corporation",
    ticker: "LKQ",
    sector: "automotive",
    subSector: "Auto Parts Distribution",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "Aftermarket Parts (North America)", description: "Non-OEM collision and mechanical auto parts distributed to collision repair shops and mechanics.", revenueShare: 45 },
      { name: "European Wholesale Parts (ECP/Rhiag/Sator)", description: "Aftermarket parts distribution across Europe through acquired networks.", revenueShare: 40 },
      { name: "Salvage / Specialty", description: "Recycled OEM parts from salvage vehicles plus specialty/performance parts.", revenueShare: 15 },
    ],
    revenue: { total: "$14.1B", segments: [
      { name: "Wholesale — North America", percentage: 42, amount: "$5.9B" },
      { name: "Europe", percentage: 46, amount: "$6.5B" },
      { name: "Specialty", percentage: 12, amount: "$1.7B" },
    ]},
    relationships: [
      { targetId: "azo", type: "competitor", products: ["Auto parts retail"], revenueImpact: "indirect" },
    ],
    description: "LKQ is the largest provider of alternative and specialty parts to repair and accessorize automobiles and other vehicles in North America and Europe.",
    headquarters: "Chicago, IL", founded: 1998, employees: "48,000", website: "lkqcorp.com",
  },

  // ============================================================
  // ENERGY E&P
  // ============================================================
  {
    id: "eqt",
    name: "EQT Corporation",
    ticker: "EQT",
    sector: "energy",
    subSector: "Natural Gas E&P",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Natural Gas Production", description: "Largest US natural gas producer by volume — Marcellus and Utica shale in Appalachia.", revenueShare: 90 },
      { name: "Natural Gas Liquids (NGLs)", description: "Ethane, propane, butane extracted alongside natural gas.", revenueShare: 10 },
    ],
    revenue: { total: "$5.8B", segments: [
      { name: "Natural Gas Sales", percentage: 88, amount: "$5.1B" },
      { name: "NGL and Oil Sales", percentage: 12, amount: "$0.7B" },
    ]},
    relationships: [
      { targetId: "kmi", type: "customer", products: ["Pipeline transport"], revenueImpact: "large" },
      { targetId: "eqnr", type: "partner", products: ["LNG export"], revenueImpact: "growing" },
    ],
    description: "EQT is America's largest natural gas producer, operating predominantly in the Appalachian Basin (Marcellus and Utica shales). It produces roughly 6% of total US natural gas supply.",
    headquarters: "Pittsburgh, PA", founded: 1888, employees: "1,700", website: "eqt.com",
  },
  {
    id: "apa",
    name: "APA Corporation",
    ticker: "APA",
    sector: "energy",
    subSector: "Oil & Gas E&P",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "US Permian Oil & Gas", description: "Conventional and unconventional production in the Permian Basin (Texas/New Mexico).", revenueShare: 55 },
      { name: "International (Suriname / Egypt)", description: "Offshore Suriname Block 58 with TotalEnergies; Egypt Western Desert operations.", revenueShare: 45 },
    ],
    revenue: { total: "$6.7B", segments: [
      { name: "United States", percentage: 55, amount: "$3.7B" },
      { name: "Egypt", percentage: 30, amount: "$2.0B" },
      { name: "North Sea & Other", percentage: 15, amount: "$1.0B" },
    ]},
    relationships: [
      { targetId: "ttef", type: "partner", products: ["Suriname offshore JV"], revenueImpact: "significant" },
    ],
    description: "APA is an independent E&P with operations in the US Permian Basin, Egypt's Western Desert, and a major offshore discovery in Suriname alongside TotalEnergies.",
    headquarters: "Houston, TX", founded: 1954, employees: "3,500", website: "apacorp.com",
  },
  {
    id: "rrc",
    name: "Range Resources Corporation",
    ticker: "RRC",
    sector: "energy",
    subSector: "Natural Gas E&P",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "Marcellus Shale Gas", description: "Natural gas and NGL production in southwestern Pennsylvania Marcellus shale.", revenueShare: 75 },
      { name: "Natural Gas Liquids", description: "Ethane and propane from NGL-rich Marcellus zones — significant NGL yields.", revenueShare: 25 },
    ],
    revenue: { total: "$3.2B", segments: [
      { name: "Natural Gas Sales", percentage: 62, amount: "$2.0B" },
      { name: "NGL Sales", percentage: 30, amount: "$0.96B" },
      { name: "Oil Sales", percentage: 8, amount: "$0.26B" },
    ]},
    relationships: [],
    description: "Range Resources is a leading Appalachian Basin natural gas and NGL producer, known for its low-cost Marcellus shale operations and high NGL content that improves margins.",
    headquarters: "Fort Worth, TX", founded: 1976, employees: "710", website: "rangeresources.com",
  },
  {
    id: "pr",
    name: "Permian Resources Corporation",
    ticker: "PR",
    sector: "energy",
    subSector: "Oil & Gas E&P",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "Delaware Basin Crude Oil", description: "Oil and associated gas production in the Delaware sub-basin of the Permian (New Mexico/Texas).", revenueShare: 70 },
      { name: "Natural Gas & NGLs", description: "Associated natural gas and NGLs from Delaware Basin operations.", revenueShare: 30 },
    ],
    revenue: { total: "$4.5B", segments: [
      { name: "Oil Revenue", percentage: 70, amount: "$3.15B" },
      { name: "NGL Revenue", percentage: 18, amount: "$0.81B" },
      { name: "Gas Revenue", percentage: 12, amount: "$0.54B" },
    ]},
    relationships: [
      { targetId: "oxy", type: "competitor", products: ["Permian Basin production"], revenueImpact: "regional" },
    ],
    description: "Permian Resources (formerly Centennial Resource Development, merged with Colgate Energy) is a pure-play Permian Basin E&P focused on the Delaware Basin.",
    headquarters: "Midland, TX", founded: 2022, employees: "1,100", website: "permianres.com",
  },
  {
    id: "ar",
    name: "Antero Resources Corporation",
    ticker: "AR",
    sector: "energy",
    subSector: "Natural Gas E&P",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "Natural Gas (Marcellus/Utica)", description: "Appalachian Basin natural gas production, among the largest US gas producers.", revenueShare: 60 },
      { name: "C3+ NGLs", description: "Propane, butane, and heavier NGLs — significant propane export position.", revenueShare: 40 },
    ],
    revenue: { total: "$5.1B", segments: [
      { name: "Gas Sales", percentage: 50, amount: "$2.55B" },
      { name: "NGL Sales", percentage: 43, amount: "$2.19B" },
      { name: "Oil Sales", percentage: 7, amount: "$0.36B" },
    ]},
    relationships: [
      { targetId: "am", type: "partner", products: ["Gathering & processing (Antero Midstream)"], revenueImpact: "critical" },
    ],
    description: "Antero Resources is one of the top US natural gas producers and the second-largest NGL producer, with large propane export exposure via its Antero Midstream partnership.",
    headquarters: "Denver, CO", founded: 2002, employees: "1,100", website: "anteroresources.com",
  },

  // ============================================================
  // CHINA / ASIA TECH ADRs
  // ============================================================
  {
    id: "ntes",
    name: "NetEase, Inc.",
    ticker: "NTES",
    sector: "technology",
    subSector: "Online Gaming & Internet",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Online Games", description: "PC and mobile games — Fantasy Westward Journey, Naraka: Bladepoint, Identity V. Blizzard distribution partner.", revenueShare: 75 },
      { name: "Youdao (Education Tech)", description: "AI-powered learning platform — dictionary, courses, OCR.", revenueShare: 7 },
      { name: "Cloud Music (NetEase Music)", description: "Leading China music streaming platform competing with Tencent Music.", revenueShare: 10 },
      { name: "Yanxuan / E-commerce", description: "Premium private-label e-commerce (Yanxuan brand).", revenueShare: 8 },
    ],
    revenue: { total: "$13.5B", segments: [
      { name: "Games and Related Value-Added Services", percentage: 75, amount: "$10.1B" },
      { name: "Youdao", percentage: 7, amount: "$0.95B" },
      { name: "Cloud Music", percentage: 10, amount: "$1.35B" },
      { name: "Innovative Businesses & Others", percentage: 8, amount: "$1.1B" },
    ]},
    relationships: [
      { targetId: "atvi", type: "partner", products: ["Blizzard game distribution (ending)"], revenueImpact: "material historical" },
    ],
    description: "NetEase is China's second-largest gaming company, with a growing international game portfolio (Naraka: Bladepoint). It also owns Youdao education and Cloud Music.",
    headquarters: "Hangzhou, China", founded: 1997, employees: "28,000", website: "netease.com",
  },
  {
    id: "bili",
    name: "Bilibili Inc.",
    ticker: "BILI",
    sector: "technology",
    subSector: "Video Platform / Gaming",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Value-Added Services (VAS)", description: "Premium subscriptions (大会员), virtual gifts/live streaming — core monetization.", revenueShare: 40 },
      { name: "Mobile Games", description: "Licensed and self-developed anime-style games; FateGrand Order operator in China.", revenueShare: 25 },
      { name: "Advertising", description: "Brand and performance advertising on video/live content.", revenueShare: 25 },
      { name: "IP Derivatives & Commerce", description: "Merchandise, figures, and e-commerce tied to anime/IP.", revenueShare: 10 },
    ],
    revenue: { total: "$4.3B", segments: [
      { name: "Value-Added Services", percentage: 40, amount: "$1.72B" },
      { name: "Advertising", percentage: 26, amount: "$1.12B" },
      { name: "Mobile Games", percentage: 24, amount: "$1.03B" },
      { name: "IP Derivatives & Commerce", percentage: 10, amount: "$0.43B" },
    ]},
    relationships: [
      { targetId: "baba", type: "partner", products: ["E-commerce integration"], revenueImpact: "moderate" },
    ],
    description: "Bilibili is China's leading video community for anime, comics, and games (ACG) culture, similar to a combination of YouTube and Twitch aimed at Gen-Z Chinese users.",
    headquarters: "Shanghai, China", founded: 2009, employees: "10,000", website: "bilibili.com",
  },
  {
    id: "grab",
    name: "Grab Holdings Limited",
    ticker: "GRAB",
    sector: "technology",
    subSector: "Superapp / Gig Platform",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Deliveries (GrabFood / GrabMart)", description: "On-demand food and grocery delivery across Southeast Asia.", revenueShare: 50 },
      { name: "Mobility (Ride-Hailing)", description: "GrabCar, GrabBike, GrabTaxi across 700+ cities in 8 SE Asian countries.", revenueShare: 30 },
      { name: "Financial Services (GrabFin)", description: "GrabPay wallet, GrabLoans, microinsurance — embedded fintech in superapp.", revenueShare: 20 },
    ],
    revenue: { total: "$2.7B", segments: [
      { name: "Deliveries", percentage: 50, amount: "$1.35B" },
      { name: "Mobility", percentage: 30, amount: "$0.81B" },
      { name: "Financial Services", percentage: 20, amount: "$0.54B" },
    ]},
    relationships: [
      { targetId: "uber", type: "competitor", products: ["Ride-hailing (Uber sold SEA ops to Grab)"], revenueImpact: "historical exit" },
    ],
    description: "Grab is Southeast Asia's leading superapp, offering ride-hailing, food/grocery delivery, and financial services across Singapore, Indonesia, Malaysia, Thailand, Philippines, Vietnam, Myanmar, and Cambodia.",
    headquarters: "Singapore", founded: 2012, employees: "9,600", website: "grab.com",
  },
  {
    id: "tme",
    name: "Tencent Music Entertainment Group",
    ticker: "TME",
    sector: "technology",
    subSector: "Music Streaming",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Online Music (QQ Music, KuGou, Kuwo)", description: "Subscription and ad-supported music streaming; ~900M MAU combined.", revenueShare: 55 },
      { name: "Social Entertainment (WeSing)", description: "Karaoke/social music app; virtual gifts from live audio/video.", revenueShare: 45 },
    ],
    revenue: { total: "$4.1B", segments: [
      { name: "Online Music Services", percentage: 55, amount: "$2.26B" },
      { name: "Social Entertainment Services", percentage: 45, amount: "$1.84B" },
    ]},
    relationships: [
      { targetId: "ntes", type: "competitor", products: ["China music streaming"], revenueImpact: "direct" },
    ],
    description: "Tencent Music operates China's three largest music streaming apps (QQ Music, KuGou, Kuwo) plus WeSing karaoke, reaching ~900 million monthly active users.",
    headquarters: "Shenzhen, China", founded: 2016, employees: "11,000", website: "tencentmusic.com",
  },
  {
    id: "beke",
    name: "KE Holdings Inc. (Beike)",
    ticker: "BEKE",
    sector: "technology",
    subSector: "Real Estate Platform",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Existing Home Transactions (Lianjia)", description: "China's largest chain of real estate brokerage stores — Lianjia brand in major cities.", revenueShare: 55 },
      { name: "New Home Transactions", description: "Commission-based new home sales on Beike platform connecting developers with buyers.", revenueShare: 35 },
      { name: "Home Renovation & Furnishing", description: "Interior design and renovation services marketplace.", revenueShare: 10 },
    ],
    revenue: { total: "$11.2B", segments: [
      { name: "Existing Home Transactions", percentage: 55, amount: "$6.16B" },
      { name: "New Home Transactions", percentage: 35, amount: "$3.92B" },
      { name: "Emerging & Other", percentage: 10, amount: "$1.12B" },
    ]},
    relationships: [],
    description: "KE Holdings (Beike) operates China's leading integrated online/offline housing platform through its Lianjia brokerage network and Beike marketplace. It facilitates over 3 million transactions annually.",
    headquarters: "Beijing, China", founded: 2018, employees: "100,000+", website: "ke.com",
  },
  {
    id: "vips",
    name: "VIPSHOP Holdings Limited",
    ticker: "VIPS",
    sector: "consumer",
    subSector: "E-commerce / Flash Sales",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Online Discount Retail (Vipshop)", description: "Flash-sale platform offering branded apparel, beauty, and lifestyle at discounts up to 70%.", revenueShare: 90 },
      { name: "Shan Shan Outlets", description: "Physical outlet mall operations in China.", revenueShare: 10 },
    ],
    revenue: { total: "$15.9B", segments: [
      { name: "Product Revenue", percentage: 90, amount: "$14.3B" },
      { name: "Other Revenue", percentage: 10, amount: "$1.6B" },
    ]},
    relationships: [
      { targetId: "jd", type: "partner", products: ["Logistics collaboration"], revenueImpact: "operational" },
    ],
    description: "VIPSHOP is China's largest online discount retailer for branded products, operating a flash-sale model where over-inventory goods from 30,000+ brands sell at deep discounts.",
    headquarters: "Guangzhou, China", founded: 2008, employees: "50,000", website: "vip.com",
  },

  // ============================================================
  // PRECIOUS METALS MINING
  // ============================================================
  {
    id: "gold",
    name: "Barrick Gold Corporation",
    ticker: "GOLD",
    sector: "materials",
    subSector: "Gold Mining",
    marketCap: "large",
    role: "supplier",
    products: [
      { name: "Gold Mining", description: "World's second-largest gold miner — Tier One mines in Nevada (Nevada Gold Mines JV with Newmont), Pueblo Viejo (Dominican Republic), Carlin.", revenueShare: 84 },
      { name: "Copper Mining", description: "Lumwana (Zambia), Reko Diq (Pakistan JV) — growing copper exposure.", revenueShare: 16 },
    ],
    revenue: { total: "$12.0B", segments: [
      { name: "Gold", percentage: 84, amount: "$10.1B" },
      { name: "Copper", percentage: 16, amount: "$1.9B" },
    ]},
    relationships: [
      { targetId: "nem", type: "partner", products: ["Nevada Gold Mines JV (61.5% Barrick)"], revenueImpact: "$4B+ output" },
    ],
    description: "Barrick is the world's second-largest gold miner, operating Tier One gold and copper mines across Africa, Americas, Middle East, and Asia Pacific. Its Nevada Gold Mines JV with Newmont is the world's largest gold complex.",
    headquarters: "Toronto, Canada", founded: 1983, employees: "33,000", website: "barrick.com",
  },
  {
    id: "aem",
    name: "Agnico Eagle Mines Limited",
    ticker: "AEM",
    sector: "materials",
    subSector: "Gold Mining",
    marketCap: "large",
    role: "supplier",
    products: [
      { name: "Gold Production", description: "High-quality gold mines — LaRonde (Quebec), Detour Lake (Ontario), Meliadine/Meadowbank (Nunavut), Fosterville (Australia).", revenueShare: 97 },
      { name: "Silver / Zinc / Copper By-Products", description: "Significant silver and zinc credits from polymetallic mines.", revenueShare: 3 },
    ],
    revenue: { total: "$8.1B", segments: [
      { name: "Gold Sales", percentage: 97, amount: "$7.9B" },
      { name: "By-product Credits", percentage: 3, amount: "$0.2B" },
    ]},
    relationships: [
      { targetId: "nem", type: "partner", products: ["Canadian Malartic JV (50%)"], revenueImpact: "$1B+ annually" },
    ],
    description: "Agnico Eagle is Canada's largest gold miner and among the world's top three, known for its low all-in sustaining costs and purely gold-focused portfolio in politically stable jurisdictions.",
    headquarters: "Toronto, Canada", founded: 1957, employees: "20,000", website: "agnicoeagle.com",
  },
  {
    id: "wpm",
    name: "Wheaton Precious Metals Corp.",
    ticker: "WPM",
    sector: "materials",
    subSector: "Precious Metals Streaming",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "Gold Streaming", description: "Purchases gold at fixed low cost ($400-500/oz) from 40+ mining operations worldwide — no mining operating risk.", revenueShare: 55 },
      { name: "Silver Streaming", description: "Purchases silver at fixed low cost from mines — world's largest silver streaming company.", revenueShare: 30 },
      { name: "Palladium/Cobalt Streaming", description: "Diversified precious and base metals streaming.", revenueShare: 15 },
    ],
    revenue: { total: "$1.3B", segments: [
      { name: "Gold", percentage: 55, amount: "$0.72B" },
      { name: "Silver", percentage: 30, amount: "$0.39B" },
      { name: "Other Precious Metals", percentage: 15, amount: "$0.19B" },
    ]},
    relationships: [
      { targetId: "vale", type: "partner", products: ["Salobo copper mine silver stream"], revenueImpact: "~$200M annually" },
      { targetId: "gold", type: "partner", products: ["Antamina silver stream"], revenueImpact: "significant" },
    ],
    description: "Wheaton Precious Metals is the world's largest precious metals streaming company, financing miners in exchange for the right to buy gold/silver at fixed low prices — combining exposure to metals prices without mining operating risk.",
    headquarters: "Vancouver, Canada", founded: 2004, employees: "50", website: "wheatonpm.com",
  },
  {
    id: "ccj",
    name: "Cameco Corporation",
    ticker: "CCJ",
    sector: "energy",
    subSector: "Uranium Mining",
    marketCap: "large",
    role: "supplier",
    products: [
      { name: "Uranium Production (Cigar Lake / McArthur River)", description: "Two of the world's highest-grade uranium mines in Saskatchewan, Canada.", revenueShare: 80 },
      { name: "Fuel Services (UF6 Conversion)", description: "Uranium conversion services at Port Hope, Ontario — essential step before enrichment.", revenueShare: 20 },
    ],
    revenue: { total: "$2.8B", segments: [
      { name: "Uranium", percentage: 80, amount: "$2.24B" },
      { name: "Fuel Services", percentage: 20, amount: "$0.56B" },
    ]},
    relationships: [
      { targetId: "bwe", type: "partner", products: ["Westinghouse JV (49%)"], revenueImpact: "nuclear fuel cycle integration" },
    ],
    description: "Cameco is the world's largest publicly traded uranium company, operating Cigar Lake and McArthur River — the two highest-grade uranium mines globally. It benefits directly from nuclear power renaissance driven by AI data center demand.",
    headquarters: "Saskatoon, Canada", founded: 1988, employees: "4,100", website: "cameco.com",
  },

  // ============================================================
  // FINTECH & DIGITAL FINANCE
  // ============================================================
  {
    id: "afrm",
    name: "Affirm Holdings, Inc.",
    ticker: "AFRM",
    sector: "financials",
    subSector: "Buy Now Pay Later (BNPL)",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "BNPL Installment Loans", description: "Pay-in-4 and longer-term installment loans at checkout — 0% APR promo or interest-bearing. Integrated with Shopify, Amazon, Walmart.", revenueShare: 80 },
      { name: "Affirm Card", description: "Debit card that can split purchases into installments — extending BNPL to everyday spend.", revenueShare: 10 },
      { name: "Savings / Consumer App", description: "Affirm Savings high-yield account — cross-sell to BNPL users.", revenueShare: 10 },
    ],
    revenue: { total: "$2.3B", segments: [
      { name: "Merchant Network Revenue", percentage: 35, amount: "$0.81B" },
      { name: "Interest Income", percentage: 40, amount: "$0.92B" },
      { name: "Gain on Sales & Servicing", percentage: 25, amount: "$0.57B" },
    ]},
    relationships: [
      { targetId: "amzn", type: "partner", products: ["Amazon checkout BNPL integration"], revenueImpact: "~$1B GMV" },
      { targetId: "shop", type: "partner", products: ["Shop Pay Installments (Shopify)"], revenueImpact: "major distribution" },
    ],
    description: "Affirm is a leading BNPL (buy now, pay later) platform integrated into merchant checkouts, allowing consumers to split purchases into fixed installments. It operates the largest BNPL network in the US.",
    headquarters: "San Francisco, CA", founded: 2012, employees: "2,400", website: "affirm.com",
  },
  {
    id: "hood",
    name: "Robinhood Markets, Inc.",
    ticker: "HOOD",
    sector: "financials",
    subSector: "Retail Brokerage / Fintech",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Options & Equities Trading", description: "Commission-free stock, ETF, and options trading — pioneer of zero-commission retail brokerage.", revenueShare: 50 },
      { name: "Crypto Trading", description: "Commission-based crypto trading — BTC, ETH, DOGE — significant revenue during bull cycles.", revenueShare: 20 },
      { name: "Robinhood Gold / Cash Card", description: "Subscription ($5/mo) with 4.9% APY savings, margin, Level II quotes; debit card.", revenueShare: 15 },
      { name: "Payment for Order Flow (PFOF)", description: "Revenue from routing orders to market makers — primary monetization of free trades.", revenueShare: 15 },
    ],
    revenue: { total: "$2.1B", segments: [
      { name: "Transaction-Based Revenue", percentage: 60, amount: "$1.26B" },
      { name: "Net Interest Revenue", percentage: 30, amount: "$0.63B" },
      { name: "Other Revenue", percentage: 10, amount: "$0.21B" },
    ]},
    relationships: [],
    description: "Robinhood democratized retail investing with its commission-free model, attracting millennial and Gen-Z investors. It has expanded into crypto, retirement accounts, credit cards, and UK/EU markets.",
    headquarters: "Menlo Park, CA", founded: 2013, employees: "2,200", website: "robinhood.com",
  },
  {
    id: "mstr",
    name: "MicroStrategy Incorporated",
    ticker: "MSTR",
    sector: "technology",
    subSector: "Bitcoin Treasury / Business Intelligence",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Bitcoin Treasury Holdings", description: "Primary value driver — largest corporate holder of Bitcoin (~214,000 BTC), held as primary treasury reserve asset.", revenueShare: 85 },
      { name: "Enterprise Analytics Software", description: "MicroStrategy ONE business intelligence platform — legacy SaaS business with AI features.", revenueShare: 15 },
    ],
    revenue: { total: "$0.5B", segments: [
      { name: "Product Licenses", percentage: 20, amount: "$0.1B" },
      { name: "Subscription Services", percentage: 35, amount: "$0.175B" },
      { name: "Other Services", percentage: 45, amount: "$0.225B" },
    ]},
    relationships: [
      { targetId: "mara", type: "competitor", products: ["Bitcoin accumulation strategy"], revenueImpact: "market correlation" },
    ],
    description: "MicroStrategy has transformed from a business intelligence software company into the world's largest corporate Bitcoin holder. CEO Michael Saylor's strategy to issue equity/debt to buy Bitcoin makes it a de facto Bitcoin proxy stock.",
    headquarters: "Tysons, VA", founded: 1989, employees: "1,700", website: "microstrategy.com",
  },
  {
    id: "wex",
    name: "WEX Inc.",
    ticker: "WEX",
    sector: "financials",
    subSector: "Fleet & Benefits Payments",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Fleet Solutions", description: "Fuel cards, fleet management, and expense control for trucking, government fleets, and SMB vehicles.", revenueShare: 46 },
      { name: "Health & Employee Benefits", description: "HSA, FSA, HRA administration — WEX processes $40B+ in healthcare spending.", revenueShare: 36 },
      { name: "Corporate Payments", description: "Virtual card payments for travel management companies, airlines, and hospitality.", revenueShare: 18 },
    ],
    revenue: { total: "$3.1B", segments: [
      { name: "Fleet Solutions", percentage: 46, amount: "$1.43B" },
      { name: "Health & Employee Benefits", percentage: 36, amount: "$1.12B" },
      { name: "Corporate Payments", percentage: 18, amount: "$0.56B" },
    ]},
    relationships: [
      { targetId: "gpn", type: "competitor", products: ["B2B payments"], revenueImpact: "indirect" },
    ],
    description: "WEX is a global commerce platform enabling payments in fleet and corporate travel, and employee benefit spending. It processes over $200 billion in payments annually across fleet cards, virtual cards, and benefits.",
    headquarters: "Portland, ME", founded: 1983, employees: "7,000", website: "wexinc.com",
  },
  {
    id: "evr",
    name: "Evercore Inc.",
    ticker: "EVR",
    sector: "financials",
    subSector: "Investment Banking Advisory",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Advisory (M&A / Restructuring)", description: "Independent M&A advisory — #1 or #2 independent advisor by deal count in most years. Also top restructuring franchise.", revenueShare: 80 },
      { name: "Equities / ECM / Research", description: "Institutional equities sales & trading, equity capital markets, and fundamental research.", revenueShare: 20 },
    ],
    revenue: { total: "$2.7B", segments: [
      { name: "Investment Banking", percentage: 80, amount: "$2.16B" },
      { name: "Investment Management", percentage: 20, amount: "$0.54B" },
    ]},
    relationships: [],
    description: "Evercore is the leading independent investment banking advisory firm, consistently ranking #1 in completed M&A advisory transactions. It advises on the largest global mergers, acquisitions, and restructurings without the conflicts of bulge-bracket banks.",
    headquarters: "New York, NY", founded: 1995, employees: "2,100", website: "evercore.com",
  },

  // ============================================================
  // CRYPTO MINING
  // ============================================================
  {
    id: "mara",
    name: "MARA Holdings, Inc.",
    ticker: "MARA",
    sector: "technology",
    subSector: "Bitcoin Mining",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "Bitcoin Mining", description: "Industrial-scale Bitcoin mining using ASIC miners — ~35 EH/s hash rate capacity. Holds mined BTC as treasury.", revenueShare: 95 },
      { name: "Hosting & Energy Services", description: "Third-party miner hosting and energy management at owned data centers.", revenueShare: 5 },
    ],
    revenue: { total: "$0.9B", segments: [
      { name: "Bitcoin Mining Revenue", percentage: 95, amount: "$0.855B" },
      { name: "Other Revenue", percentage: 5, amount: "$0.045B" },
    ]},
    relationships: [
      { targetId: "mstr", type: "competitor", products: ["Bitcoin exposure strategy"], revenueImpact: "market correlation" },
      { targetId: "riot", type: "competitor", products: ["Bitcoin mining hash rate"], revenueImpact: "direct" },
    ],
    description: "MARA (formerly Marathon Digital) is one of the largest publicly traded Bitcoin miners by hash rate in North America. Its business model is entirely dependent on Bitcoin price, mining difficulty, and energy costs.",
    headquarters: "Fort Lauderdale, FL", founded: 2010, employees: "200", website: "maraholdings.com",
  },
  {
    id: "riot",
    name: "Riot Platforms, Inc.",
    ticker: "RIOT",
    sector: "technology",
    subSector: "Bitcoin Mining",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "Bitcoin Mining", description: "Corsicana, TX facility — 1 GW power capacity, among the largest single-site Bitcoin mines globally.", revenueShare: 85 },
      { name: "Data Center Hosting", description: "Third-party colocation and hosting for other miners at Corsicana.", revenueShare: 10 },
      { name: "Engineering Services (Whinstone)", description: "Electrical and infrastructure engineering services.", revenueShare: 5 },
    ],
    revenue: { total: "$0.8B", segments: [
      { name: "Bitcoin Mining", percentage: 85, amount: "$0.68B" },
      { name: "Data Center Hosting", percentage: 10, amount: "$0.08B" },
      { name: "Engineering", percentage: 5, amount: "$0.04B" },
    ]},
    relationships: [
      { targetId: "mara", type: "competitor", products: ["Bitcoin mining"], revenueImpact: "direct" },
    ],
    description: "Riot Platforms is one of North America's largest Bitcoin miners, operating its flagship Corsicana, Texas facility with 1 GW of power. It benefits from power purchase agreements allowing it to curtail mining and sell power back during peak grid demand.",
    headquarters: "Castle Rock, CO", founded: 2000, employees: "700", website: "riotplatforms.com",
  },

  // ============================================================
  // HOMEBUILDERS
  // ============================================================
  {
    id: "phm",
    name: "PulteGroup, Inc.",
    ticker: "PHM",
    sector: "consumer",
    subSector: "Homebuilding",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Pulte Homes (Move-up)", description: "Mid-priced homes for families upgrading from starter homes.", revenueShare: 40 },
      { name: "Centex (Entry-Level)", description: "Affordable first-time buyer homes.", revenueShare: 30 },
      { name: "Del Webb (Active Adult 55+)", description: "Nation's largest 55+ community builder — Sun City communities.", revenueShare: 25 },
      { name: "Divosta / John Wieland", description: "Premium regional builders.", revenueShare: 5 },
    ],
    revenue: { total: "$17.0B", segments: [
      { name: "Homebuilding", percentage: 95, amount: "$16.2B" },
      { name: "Financial Services (Pulte Mortgage)", percentage: 5, amount: "$0.8B" },
    ]},
    relationships: [
      { targetId: "dhi", type: "competitor", products: ["Entry-level homebuilding"], revenueImpact: "direct" },
      { targetId: "len", type: "competitor", products: ["Move-up homebuilding"], revenueImpact: "direct" },
    ],
    description: "PulteGroup is America's third-largest homebuilder by revenue, with a multi-brand strategy spanning entry-level (Centex), move-up (Pulte), and active adult (Del Webb) segments.",
    headquarters: "Atlanta, GA", founded: 1950, employees: "8,100", website: "pultegroupinc.com",
  },

  // ============================================================
  // RESTAURANTS / QSR
  // ============================================================
  {
    id: "qsr",
    name: "Restaurant Brands International Inc.",
    ticker: "QSR",
    sector: "consumer",
    subSector: "Quick Service Restaurants",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Tim Hortons", description: "Dominant Canadian coffee/quick service chain — 5,700 locations, ~$7B system sales.", revenueShare: 35 },
      { name: "Burger King", description: "Global fast food giant with 19,000+ locations in 100+ countries.", revenueShare: 35 },
      { name: "Popeyes Louisiana Kitchen", description: "Fried chicken QSR with viral success — 3,900+ locations globally.", revenueShare: 20 },
      { name: "Firehouse Subs", description: "Better-for-you submarine sandwich chain acquired 2021.", revenueShare: 10 },
    ],
    revenue: { total: "$7.5B", segments: [
      { name: "Tim Hortons", percentage: 35, amount: "$2.6B" },
      { name: "Burger King", percentage: 35, amount: "$2.6B" },
      { name: "Popeyes", percentage: 20, amount: "$1.5B" },
      { name: "Firehouse Subs", percentage: 10, amount: "$0.8B" },
    ]},
    relationships: [
      { targetId: "mcd", type: "competitor", products: ["QSR burgers"], revenueImpact: "direct" },
      { targetId: "yum", type: "competitor", products: ["Global QSR"], revenueImpact: "direct" },
    ],
    description: "Restaurant Brands International owns four of the world's most iconic fast food brands — Tim Hortons, Burger King, Popeyes, and Firehouse Subs — operating in 100+ countries with 30,000+ locations.",
    headquarters: "Toronto, Canada", founded: 2014, employees: "4,500", website: "rbi.com",
  },
  {
    id: "txrh",
    name: "Texas Roadhouse, Inc.",
    ticker: "TXRH",
    sector: "consumer",
    subSector: "Full-Service Restaurants",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Texas Roadhouse Restaurants", description: "Affordable steakhouse with made-from-scratch food, fresh-baked rolls, and exceptional value — 600+ US locations.", revenueShare: 90 },
      { name: "Bubba's 33", description: "Sports bar concept by same parent company.", revenueShare: 7 },
      { name: "Jaggers", description: "Fast casual burger/chicken concept.", revenueShare: 3 },
    ],
    revenue: { total: "$5.4B", segments: [
      { name: "Texas Roadhouse", percentage: 90, amount: "$4.9B" },
      { name: "Other Concepts", percentage: 10, amount: "$0.5B" },
    ]},
    relationships: [],
    description: "Texas Roadhouse is America's most popular steakhouse chain by customer satisfaction, known for its legendary rolls, fall-off-the-bone ribs, and hand-cut steaks at affordable prices. It is a rare large-cap restaurant that has maintained near-zero franchising.",
    headquarters: "Louisville, KY", founded: 1993, employees: "75,000", website: "texasroadhouse.com",
  },
  {
    id: "wen",
    name: "The Wendy's Company",
    ticker: "WEN",
    sector: "consumer",
    subSector: "Quick Service Restaurants",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Wendy's Restaurants", description: "Hamburger QSR known for square burgers, Frosty dessert, and fresh (never frozen) beef — 6,800+ US locations.", revenueShare: 75 },
      { name: "International Franchise", description: "250+ international Wendy's locations with growth in UK, Canada, Middle East.", revenueShare: 25 },
    ],
    revenue: { total: "$2.1B", segments: [
      { name: "US Company-Owned Restaurant Revenue", percentage: 50, amount: "$1.05B" },
      { name: "Franchise Royalties & Fees", percentage: 35, amount: "$0.74B" },
      { name: "Other Revenue", percentage: 15, amount: "$0.31B" },
    ]},
    relationships: [
      { targetId: "mcd", type: "competitor", products: ["QSR burgers"], revenueImpact: "direct" },
    ],
    description: "Wendy's is the third-largest US hamburger fast food chain, distinguished by its commitment to fresh (never frozen) beef. It has been testing dynamic pricing and expanding its breakfast daypart.",
    headquarters: "Dublin, OH", founded: 1969, employees: "12,000", website: "wendys.com",
  },

  // ============================================================
  // SPORTS BETTING / GAMING
  // ============================================================
  {
    id: "dkng",
    name: "DraftKings Inc.",
    ticker: "DKNG",
    sector: "consumer",
    subSector: "Online Sports Betting",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Sportsbook (DraftKings Sportsbook)", description: "Online sports betting in 25+ US states — market share #2 behind FanDuel (Flutter). NFL/NBA/MLB/NHL wagering.", revenueShare: 65 },
      { name: "iGaming (Online Casino)", description: "Online slots, table games, and live dealer in 5 states — growing revenue stream.", revenueShare: 25 },
      { name: "Daily Fantasy Sports (DFS)", description: "Original DraftKings product — season-long fantasy contests origin; now smaller share.", revenueShare: 10 },
    ],
    revenue: { total: "$4.8B", segments: [
      { name: "B2C (Direct Consumer)", percentage: 95, amount: "$4.56B" },
      { name: "B2B (SBTech)", percentage: 5, amount: "$0.24B" },
    ]},
    relationships: [
      { targetId: "penn", type: "competitor", products: ["US online sports betting"], revenueImpact: "direct" },
    ],
    description: "DraftKings is America's second-largest online sports betting operator, operating in 25+ states. It monetizes the legalized US sports betting opportunity post-PASPA repeal, competing with FanDuel (Flutter) for market share.",
    headquarters: "Boston, MA", founded: 2012, employees: "6,200", website: "draftkings.com",
  },
  {
    id: "penn",
    name: "PENN Entertainment, Inc.",
    ticker: "PENN",
    sector: "consumer",
    subSector: "Gaming / Online Betting",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "ESPN BET (Online Sportsbook)", description: "Online sports betting under ESPN BET brand through ESPN deal — launched 2023.", revenueShare: 20 },
      { name: "Regional Casinos", description: "43 gaming and racing properties across 20 US states — Hollywood Casino brand.", revenueShare: 70 },
      { name: "Interactive Gaming (iCasino)", description: "Online casino in select states — theScore Bet Canada.", revenueShare: 10 },
    ],
    revenue: { total: "$6.5B", segments: [
      { name: "Interactive", percentage: 10, amount: "$0.65B" },
      { name: "Northeast", percentage: 30, amount: "$1.95B" },
      { name: "South", percentage: 20, amount: "$1.3B" },
      { name: "West", percentage: 20, amount: "$1.3B" },
      { name: "Midwest & Other", percentage: 20, amount: "$1.3B" },
    ]},
    relationships: [
      { targetId: "dkng", type: "competitor", products: ["US online sports betting"], revenueImpact: "direct" },
    ],
    description: "PENN Entertainment operates the largest portfolio of owned regional casinos in the US and has pivoted to online sports betting via its ESPN BET brand partnership with Disney/ESPN.",
    headquarters: "Wyomissing, PA", founded: 1972, employees: "28,000", website: "pennentertainment.com",
  },

  // ============================================================
  // BIOTECH / SPECIALTY PHARMA
  // ============================================================
  {
    id: "uthr",
    name: "United Therapeutics Corporation",
    ticker: "UTHR",
    sector: "healthcare",
    subSector: "Specialty Pharmaceuticals",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Tyvaso / Tyvaso DPI (Inhaled Treprostinil)", description: "Pulmonary arterial hypertension (PAH) + pulmonary hypertension associated with ILD. Fastest-growing drug.", revenueShare: 55 },
      { name: "Remodulin (Treprostinil Infusion)", description: "Continuous subcutaneous/IV infusion for severe PAH.", revenueShare: 25 },
      { name: "Orenitram (Oral Treprostinil)", description: "Oral extended-release treprostinil for PAH.", revenueShare: 10 },
      { name: "Unituxin / Transplant Pipeline", description: "Pediatric neuroblastoma + regenerative medicine (xenotransplantation organs).", revenueShare: 10 },
    ],
    revenue: { total: "$2.8B", segments: [
      { name: "Tyvaso Products", percentage: 55, amount: "$1.54B" },
      { name: "Remodulin", percentage: 25, amount: "$0.7B" },
      { name: "Orenitram", percentage: 12, amount: "$0.34B" },
      { name: "Other", percentage: 8, amount: "$0.22B" },
    ]},
    relationships: [],
    description: "United Therapeutics focuses on life-saving treatments for pulmonary arterial hypertension and is pioneering xenotransplantation — using genetically modified pig organs for human transplant. It has over $5B in cash and no long-term debt.",
    headquarters: "Silver Spring, MD", founded: 1996, employees: "2,600", website: "unither.com",
  },
  {
    id: "podd",
    name: "Insulet Corporation",
    ticker: "PODD",
    sector: "healthcare",
    subSector: "Medical Devices",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Omnipod 5 (Automated Insulin Delivery)", description: "Tubeless insulin pump with Omnipod 5 closed-loop system — world's first tubeless AID system.", revenueShare: 75 },
      { name: "Omnipod DASH (Traditional Pump)", description: "Bluetooth-enabled tubeless pump without automated delivery.", revenueShare: 20 },
      { name: "Drug Delivery (Non-Diabetes)", description: "Pod technology licensing for drug delivery beyond insulin.", revenueShare: 5 },
    ],
    revenue: { total: "$2.3B", segments: [
      { name: "US Omnipod", percentage: 40, amount: "$0.92B" },
      { name: "International Omnipod", percentage: 55, amount: "$1.27B" },
      { name: "Drug Delivery", percentage: 5, amount: "$0.11B" },
    ]},
    relationships: [
      { targetId: "dxcm", type: "partner", products: ["Dexcom CGM integration with Omnipod 5"], revenueImpact: "critical feature" },
    ],
    description: "Insulet makes the Omnipod — the world's only tubeless insulin delivery system. Omnipod 5 is the first tubeless automated insulin delivery (AID) system, integrating with Dexcom's CGM for closed-loop glucose management.",
    headquarters: "Acton, MA", founded: 2000, employees: "6,200", website: "insulet.com",
  },
  {
    id: "srpt",
    name: "Sarepta Therapeutics, Inc.",
    ticker: "SRPT",
    sector: "healthcare",
    subSector: "Rare Disease / Gene Therapy",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Elevidys (Delandistrogene Moxeparvovec)", description: "First FDA-approved gene therapy for Duchenne muscular dystrophy — one-time treatment targeting the root cause.", revenueShare: 55 },
      { name: "Exon Skipping Drugs (Exondys/Vyondys/Amondys)", description: "Exon 51/53/45 skipping drugs — monthly IV infusions for specific DMD mutations.", revenueShare: 45 },
    ],
    revenue: { total: "$1.9B", segments: [
      { name: "Elevidys", percentage: 40, amount: "$0.76B" },
      { name: "Exondys 51 + Other Exon Skipping", percentage: 60, amount: "$1.14B" },
    ]},
    relationships: [
      { targetId: "roche", type: "partner", products: ["Elevidys co-promotion (Roche/Genentech in ex-US)"], revenueImpact: "significant" },
    ],
    description: "Sarepta Therapeutics is the leader in treatments for Duchenne muscular dystrophy (DMD) — a fatal muscle-wasting disease affecting young boys. Its gene therapy Elevidys is the first approved treatment to address the genetic root cause.",
    headquarters: "Cambridge, MA", founded: 1980, employees: "1,900", website: "sarepta.com",
  },
  {
    id: "iclr",
    name: "ICON plc",
    ticker: "ICLR",
    sector: "healthcare",
    subSector: "Contract Research Organization (CRO)",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "Clinical Development Services", description: "Phase I-IV clinical trials, data management, biostatistics — full-service CRO.", revenueShare: 75 },
      { name: "PRA Health Sciences (Legacy)", description: "Acquired PRA 2021 — integrated services doubling ICON's scale.", revenueShare: 25 },
    ],
    revenue: { total: "$8.3B", segments: [
      { name: "Clinical Research Services", percentage: 100, amount: "$8.3B" },
    ]},
    relationships: [
      { targetId: "pfe", type: "customer", products: ["Clinical trial services"], revenueImpact: "large" },
      { targetId: "lly", type: "customer", products: ["Clinical trial services"], revenueImpact: "growing" },
    ],
    description: "ICON is the world's second-largest CRO (contract research organization), managing clinical trials for pharma and biotech companies globally. CROs like ICON benefit from biopharma R&D outsourcing trends.",
    headquarters: "Dublin, Ireland", founded: 1990, employees: "40,000", website: "iconplc.com",
  },

  // ============================================================
  // INDUSTRIAL / DEFENSE
  // ============================================================
  {
    id: "acm",
    name: "AECOM",
    ticker: "ACM",
    sector: "industrials",
    subSector: "Engineering & Construction",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "Americas Advisory, Design & Engineering (ACAD)", description: "Infrastructure consulting, design, and program management — highways, bridges, water, transit.", revenueShare: 60 },
      { name: "International Advisory (ACAI)", description: "Infrastructure and environmental consulting outside the Americas.", revenueShare: 25 },
      { name: "AECOM Capital", description: "Infrastructure development and equity investment.", revenueShare: 15 },
    ],
    revenue: { total: "$16.4B", segments: [
      { name: "Americas Design & Consulting", percentage: 60, amount: "$9.8B" },
      { name: "International Design & Consulting", percentage: 25, amount: "$4.1B" },
      { name: "Construction Management & Other", percentage: 15, amount: "$2.5B" },
    ]},
    relationships: [
      { targetId: "flr", type: "competitor", products: ["Government engineering services"], revenueImpact: "direct" },
    ],
    description: "AECOM is the world's premier infrastructure consulting firm, designing and managing major infrastructure projects including the LA 2028 Olympics venues, London's Crossrail, and hundreds of US military base projects.",
    headquarters: "Dallas, TX", founded: 1990, employees: "53,000", website: "aecom.com",
  },
  {
    id: "kbr",
    name: "KBR, Inc.",
    ticker: "KBR",
    sector: "industrials",
    subSector: "Defense & Government Services",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Government Solutions", description: "Defense, intelligence, and civilian government technical services — DoD, NASA, DHS missions.", revenueShare: 55 },
      { name: "Sustainable Technology Solutions", description: "Ammonia synthesis technology, refining solutions, petrochemical process technology licensing.", revenueShare: 30 },
      { name: "Energy Solutions", description: "EPC services for LNG plants, refineries, and industrial energy.", revenueShare: 15 },
    ],
    revenue: { total: "$8.2B", segments: [
      { name: "Government Solutions", percentage: 55, amount: "$4.5B" },
      { name: "Sustainable Technology Solutions", percentage: 30, amount: "$2.5B" },
      { name: "Energy Solutions", percentage: 15, amount: "$1.2B" },
    ]},
    relationships: [
      { targetId: "lmt", type: "partner", products: ["Defense program support"], revenueImpact: "significant" },
    ],
    description: "KBR provides government services (DoD, NASA, intelligence community) and sustainable technology solutions (hydrogen, ammonia, ethylene technology licensing). Its government segment is heavily tied to US defense spending.",
    headquarters: "Houston, TX", founded: 1998, employees: "34,000", website: "kbr.com",
  },
  {
    id: "tdy",
    name: "Teledyne Technologies Incorporated",
    ticker: "TDY",
    sector: "industrials",
    subSector: "Defense Electronics / Instruments",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Instrumentation", description: "Marine instruments, environmental monitoring, test & measurement — analytical instruments portfolio.", revenueShare: 30 },
      { name: "Digital Imaging", description: "FLIR thermal cameras (acquired 2021), X-ray detectors, night vision, satellite cameras.", revenueShare: 35 },
      { name: "Aerospace & Defense Electronics", description: "Avionics, electronic warfare, radar, countermeasures, space electronics.", revenueShare: 25 },
      { name: "Engineered Systems", description: "Turbine engines for cruise missiles, marine propulsion, defense systems.", revenueShare: 10 },
    ],
    revenue: { total: "$5.7B", segments: [
      { name: "Digital Imaging", percentage: 35, amount: "$2.0B" },
      { name: "Instrumentation", percentage: 30, amount: "$1.71B" },
      { name: "Aerospace & Defense", percentage: 25, amount: "$1.43B" },
      { name: "Engineered Systems", percentage: 10, amount: "$0.57B" },
    ]},
    relationships: [
      { targetId: "lmt", type: "customer", products: ["Defense electronics"], revenueImpact: "significant" },
    ],
    description: "Teledyne Technologies is a leading provider of sophisticated electronic systems, instruments, and digital imaging technology for defense, industrial, and scientific applications. The 2021 FLIR acquisition made it the premier thermal imaging company.",
    headquarters: "Thousand Oaks, CA", founded: 1999, employees: "25,000", website: "teledyne.com",
  },

  // ============================================================
  // SPECIALTY INDUSTRIAL
  // ============================================================
  {
    id: "ggg",
    name: "Graco Inc.",
    ticker: "GGG",
    sector: "industrials",
    subSector: "Fluid Handling Equipment",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Contractor Segment (Sprayers)", description: "Airless paint sprayers, texture sprayers — sold through Sherwin-Williams, Home Depot, Amazon.", revenueShare: 35 },
      { name: "Industrial (Pumps/Dispensing)", description: "Fluid management equipment for manufacturing, oil lube, auto assembly — lubrication and fluid control.", revenueShare: 40 },
      { name: "Process (Chemical/Sanitary)", description: "Precision fluid control for food/beverage, pharmaceutical, chemical processing.", revenueShare: 25 },
    ],
    revenue: { total: "$2.2B", segments: [
      { name: "Industrial", percentage: 40, amount: "$0.88B" },
      { name: "Contractor", percentage: 35, amount: "$0.77B" },
      { name: "Process", percentage: 25, amount: "$0.55B" },
    ]},
    relationships: [
      { targetId: "shw", type: "partner", products: ["Contractor sprayer distribution"], revenueImpact: "significant channel" },
    ],
    description: "Graco is the global leader in fluid handling equipment, manufacturing pumps, meters, valves, and spray equipment for a wide range of industrial, commercial, and consumer uses. Known for superior quality and durable margins ~50% gross.",
    headquarters: "Minneapolis, MN", founded: 1926, employees: "4,500", website: "graco.com",
  },
  {
    id: "rrx",
    name: "Regal Rexnord Corporation",
    ticker: "RRX",
    sector: "industrials",
    subSector: "Industrial Motors & Motion",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Industrial Motion (Rexnord)", description: "Couplings, gears, conveyor components — power transmission hardware for factory automation.", revenueShare: 35 },
      { name: "Power Efficiency Solutions (AC/DC Motors)", description: "Electric motors for HVAC, pumps, fans — highly energy-efficient products benefiting from IRA incentives.", revenueShare: 40 },
      { name: "Automation & Motion Control", description: "Linear actuators, servo motors, drives for robotics and automation.", revenueShare: 25 },
    ],
    revenue: { total: "$6.7B", segments: [
      { name: "Industrial Powertrain Solutions", percentage: 35, amount: "$2.35B" },
      { name: "Power Efficiency Solutions", percentage: 40, amount: "$2.68B" },
      { name: "Automation & Motion Control", percentage: 25, amount: "$1.68B" },
    ]},
    relationships: [],
    description: "Regal Rexnord is a global manufacturer of electric motors and motion controls, formed from the merger of Regal Beloit and Rexnord. It benefits from data center cooling, industrial automation, and energy efficiency megatrends.",
    headquarters: "Beloit, WI", founded: 2021, employees: "36,000", website: "regalrexnord.com",
  },
  {
    id: "nvt",
    name: "nVent Electric plc",
    ticker: "NVT",
    sector: "industrials",
    subSector: "Electrical Enclosures & Thermal Management",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "Enclosures (Hoffman/Schroff)", description: "Electrical enclosures for data centers, industrial controls, utility substations.", revenueShare: 45 },
      { name: "Thermal Management (Hoffman Liebert-style)", description: "Precision cooling and thermal management for electronics — growing data center exposure.", revenueShare: 30 },
      { name: "Electrical & Fastening Solutions", description: "Cable management, grounding, lightning protection (ERICO brand).", revenueShare: 25 },
    ],
    revenue: { total: "$3.4B", segments: [
      { name: "Enclosures", percentage: 45, amount: "$1.53B" },
      { name: "Thermal Management", percentage: 30, amount: "$1.02B" },
      { name: "Electrical & Fastening", percentage: 25, amount: "$0.85B" },
    ]},
    relationships: [
      { targetId: "etn", type: "competitor", products: ["Electrical components/data center"], revenueImpact: "indirect" },
    ],
    description: "nVent Electric (spun off from Pentair in 2018) makes electrical enclosures, thermal management, and cable management solutions. Its data center business (Hoffman DC enclosures, precision cooling) is benefiting from AI infrastructure buildout.",
    headquarters: "London, UK / Minneapolis, MN", founded: 2018, employees: "11,000", website: "nvent.com",
  },

  // ============================================================
  // SOFTWARE / CLOUD / SAAS
  // ============================================================
  {
    id: "docs",
    name: "Doximity, Inc.",
    ticker: "DOCS",
    sector: "technology",
    subSector: "Healthcare Professional Network",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Pharmaceutical Marketing Platform", description: "Targeted drug promotion to physicians via Doximity's verified MD/NP/PA network — 80%+ US physicians are members.", revenueShare: 80 },
      { name: "Telehealth (Doximity Dialer)", description: "HIPAA-compliant video/audio calls for physician-patient and provider-to-provider communication.", revenueShare: 12 },
      { name: "Hiring Solutions", description: "Physician and NP/PA job recruitment platform for health systems.", revenueShare: 8 },
    ],
    revenue: { total: "$0.97B", segments: [
      { name: "Subscription", percentage: 100, amount: "$0.97B" },
    ]},
    relationships: [
      { targetId: "pfe", type: "customer", products: ["Physician marketing platform"], revenueImpact: "significant" },
      { targetId: "lly", type: "customer", products: ["Drug marketing to physicians"], revenueImpact: "significant" },
    ],
    description: "Doximity is the LinkedIn of doctors — 80%+ of US physicians are on the platform. It monetizes by enabling pharma companies and health systems to reach physicians with high precision, generating ~80% operating margins.",
    headquarters: "San Francisco, CA", founded: 2010, employees: "1,300", website: "doximity.com",
  },
  {
    id: "pcor",
    name: "Procore Technologies, Inc.",
    ticker: "PCOR",
    sector: "technology",
    subSector: "Construction Management Software",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Project Management", description: "Construction project management — RFIs, submittals, drawings, daily logs for GCs and owners.", revenueShare: 50 },
      { name: "Financial Management", description: "Construction ERP — job cost accounting, billing, budget forecasting.", revenueShare: 30 },
      { name: "Workforce Management", description: "Scheduling, time tracking, compliance for construction crews.", revenueShare: 20 },
    ],
    revenue: { total: "$1.2B", segments: [
      { name: "Software Subscriptions", percentage: 97, amount: "$1.16B" },
      { name: "Professional Services", percentage: 3, amount: "$0.04B" },
    ]},
    relationships: [],
    description: "Procore is the dominant construction management software platform used by general contractors, owners, and specialty contractors. Construction is a $13T industry and one of the least digitized — Procore is the category leader.",
    headquarters: "Carpinteria, CA", founded: 2002, employees: "4,200", website: "procore.com",
  },
  {
    id: "tenb",
    name: "Tenable Holdings, Inc.",
    ticker: "TENB",
    sector: "technology",
    subSector: "Cybersecurity (Vulnerability Management)",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Tenable One (Exposure Management)", description: "Unified vulnerability and exposure management platform across IT, OT, cloud, and identity surfaces.", revenueShare: 60 },
      { name: "Nessus (Vulnerability Scanner)", description: "World's most widely deployed vulnerability scanner — 30,000+ organizations; freemium + commercial.", revenueShare: 25 },
      { name: "OT Security (Tenable.ot)", description: "Industrial control system / operational technology security (ex-Indegy acquisition).", revenueShare: 15 },
    ],
    revenue: { total: "$0.9B", segments: [
      { name: "Cloud / Subscription", percentage: 80, amount: "$0.72B" },
      { name: "Perpetual + Maintenance", percentage: 20, amount: "$0.18B" },
    ]},
    relationships: [],
    description: "Tenable is the global leader in vulnerability management and exposure management, protecting more than 43,000 organizations including 60% of the Fortune 500. Its Nessus scanner is the de facto standard for security assessments.",
    headquarters: "Columbia, MD", founded: 2002, employees: "2,400", website: "tenable.com",
  },
  {
    id: "pstg",
    name: "Pure Storage, Inc.",
    ticker: "PSTG",
    sector: "technology",
    subSector: "Flash Storage",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "FlashArray (Block Storage)", description: "All-NVMe flash arrays for databases and enterprise apps — FlashArray//X, //C, //XL.", revenueShare: 55 },
      { name: "FlashBlade (File/Object Storage)", description: "Unstructured data flash storage for AI training datasets, analytics, and media workloads.", revenueShare: 30 },
      { name: "Evergreen Subscription / Portworx (Cloud)", description: "Perpetual subscription model; Portworx container storage for Kubernetes.", revenueShare: 15 },
    ],
    revenue: { total: "$3.0B", segments: [
      { name: "Product Revenue", percentage: 45, amount: "$1.35B" },
      { name: "Subscription Services", percentage: 55, amount: "$1.65B" },
    ]},
    relationships: [
      { targetId: "nvda", type: "partner", products: ["AI training storage (NVIDIA DGX SuperPOD)"], revenueImpact: "growing" },
      { targetId: "msft", type: "partner", products: ["Azure Pure Cloud Block Store"], revenueImpact: "cloud distribution" },
    ],
    description: "Pure Storage is the leading all-flash storage company, disrupting hard-drive-based storage with its NVMe arrays and subscription model. It is a direct beneficiary of AI/ML training infrastructure buildout, where FlashBlade stores massive datasets.",
    headquarters: "Mountain View, CA", founded: 2009, employees: "6,000", website: "purestorage.com",
  },

  // ============================================================
  // RETAIL
  // ============================================================
  {
    id: "burl",
    name: "Burlington Stores, Inc.",
    ticker: "BURL",
    sector: "consumer",
    subSector: "Off-Price Retail",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Apparel (Women/Men/Kids)", description: "Brand-name and private label clothing at 20-60% below department store prices.", revenueShare: 60 },
      { name: "Home Furnishings & Décor", description: "Bed, bath, kitchen, and seasonal home goods at off-price.", revenueShare: 25 },
      { name: "Accessories, Beauty & Toys", description: "Handbags, jewelry, shoes, cosmetics, and toy category.", revenueShare: 15 },
    ],
    revenue: { total: "$10.3B", segments: [
      { name: "Net Sales", percentage: 100, amount: "$10.3B" },
    ]},
    relationships: [
      { targetId: "tjx", type: "competitor", products: ["Off-price apparel & home"], revenueImpact: "direct" },
    ],
    description: "Burlington Stores is America's third-largest off-price retailer (behind TJX and Ross), operating 1,000+ stores across the US. It has historically lagged peers but is closing the gap through improved buying, smaller formats, and better inventory management.",
    headquarters: "Burlington, NJ", founded: 1972, employees: "60,000", website: "burlington.com",
  },
  {
    id: "five",
    name: "Five Below, Inc.",
    ticker: "FIVE",
    sector: "consumer",
    subSector: "Extreme Value Retail",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Trend & Style (teen/tween)", description: "Phone cases, fashion jewelry, beauty, and social-media-trending items under $5-10.", revenueShare: 35 },
      { name: "Leisure (toys, gaming, sports)", description: "Low-price toys, games, activity kits, and seasonal sports items.", revenueShare: 30 },
      { name: "Home & Room", description: "Dorm and bedroom organization, storage, and décor at $1-$10.", revenueShare: 20 },
      { name: "Candy & Beauty", description: "Name-brand snacks, candy, and basic beauty/personal care.", revenueShare: 15 },
    ],
    revenue: { total: "$3.8B", segments: [
      { name: "Net Sales", percentage: 100, amount: "$3.8B" },
    ]},
    relationships: [],
    description: "Five Below targets teens and tweens with trend-driven merchandise priced at $1-$10 (with some Five Beyond items up to $25). It has 1,500+ stores and is one of the fastest-growing specialty retailers in the US.",
    headquarters: "Philadelphia, PA", founded: 2002, employees: "18,000", website: "fivebelow.com",
  },
  {
    id: "pvh",
    name: "PVH Corp.",
    ticker: "PVH",
    sector: "consumer",
    subSector: "Apparel / Fashion Brands",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Calvin Klein", description: "Global premium lifestyle brand — denim, underwear, fragrance, and fashion. $10B+ retail value.", revenueShare: 45 },
      { name: "Tommy Hilfiger", description: "American classic sportswear and lifestyle brand — strongest in Europe.", revenueShare: 50 },
      { name: "Heritage Brands (liquidating)", description: "Warner's, Speedo, Van Heusen — being divested.", revenueShare: 5 },
    ],
    revenue: { total: "$9.1B", segments: [
      { name: "Tommy Hilfiger North America", percentage: 20, amount: "$1.82B" },
      { name: "Tommy Hilfiger International", percentage: 30, amount: "$2.73B" },
      { name: "Calvin Klein North America", percentage: 18, amount: "$1.64B" },
      { name: "Calvin Klein International", percentage: 27, amount: "$2.46B" },
      { name: "Other", percentage: 5, amount: "$0.45B" },
    ]},
    relationships: [],
    description: "PVH Corp owns two iconic global fashion brands — Calvin Klein and Tommy Hilfiger. Tommy Hilfiger is its largest brand with particular strength in Europe, while Calvin Klein has global denim, underwear, and luxury presence.",
    headquarters: "New York, NY", founded: 1881, employees: "40,000", website: "pvh.com",
  },

  // ============================================================
  // HEALTHCARE REIT
  // ============================================================
  {
    id: "ohi",
    name: "Omega Healthcare Investors, Inc.",
    ticker: "OHI",
    sector: "real estate",
    subSector: "Healthcare REIT",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Skilled Nursing Facilities (SNF)", description: "Triple-net leases to SNF operators — largest SNF REIT in the US, 900+ facilities.", revenueShare: 80 },
      { name: "Assisted Living & Senior Housing", description: "ALF/memory care facilities under triple-net and RIDEA structures.", revenueShare: 20 },
    ],
    revenue: { total: "$1.1B", segments: [
      { name: "Rental Income", percentage: 85, amount: "$0.94B" },
      { name: "Interest on Real Estate Loans", percentage: 15, amount: "$0.17B" },
    ]},
    relationships: [],
    description: "Omega Healthcare is the largest publicly traded skilled nursing facility REIT in the US, owning and leasing ~900 healthcare facilities to operators. It benefits from aging demographics (Baby Boomer SNF demand) and Medicare/Medicaid reimbursement trends.",
    headquarters: "Timonium, MD", founded: 1992, employees: "80", website: "omegahealthcare.com",
  },
  {
    id: "stag",
    name: "STAG Industrial, Inc.",
    ticker: "STAG",
    sector: "real estate",
    subSector: "Industrial REIT",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Single-Tenant Industrial Properties", description: "Warehouses and light manufacturing in secondary US markets — e-commerce fulfillment and industrial tenants.", revenueShare: 100 },
    ],
    revenue: { total: "$0.77B", segments: [
      { name: "Rental Income", percentage: 100, amount: "$0.77B" },
    ]},
    relationships: [
      { targetId: "amzn", type: "customer", products: ["Fulfillment center leases"], revenueImpact: "significant tenant" },
    ],
    description: "STAG Industrial is a single-tenant industrial REIT focused on light industrial and warehouse properties in smaller US markets. It's known for monthly dividend payments and a diversified tenant roster of 500+ companies including Amazon.",
    headquarters: "Boston, MA", founded: 2010, employees: "120", website: "stagindustrial.com",
  },

  // ============================================================
  // SPECIALTY INDUSTRIALS / MATERIALS
  // ============================================================
  {
    id: "cmc",
    name: "Commercial Metals Company",
    ticker: "CMC",
    sector: "materials",
    subSector: "Steel / Metal Distribution",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "North America Steel Manufacturing", description: "Rebar, wire rod, merchant bar, and structural steel from electric arc furnaces — #1 US rebar producer.", revenueShare: 65 },
      { name: "Europe Steel Manufacturing (Poland)", description: "Rebar and merchant bar from Poland's two most efficient mills.", revenueShare: 20 },
      { name: "Emerging Businesses (Impact Metals, Tensar)", description: "Tensar geogrid infrastructure products; Impact Metals scrap processing.", revenueShare: 15 },
    ],
    revenue: { total: "$7.2B", segments: [
      { name: "North America Steel Group", percentage: 65, amount: "$4.7B" },
      { name: "Europe Steel Group", percentage: 20, amount: "$1.44B" },
      { name: "Emerging Businesses", percentage: 15, amount: "$1.08B" },
    ]},
    relationships: [],
    description: "Commercial Metals is America's largest producer of steel rebar, manufacturing from 100% scrap metal in ultra-efficient electric arc furnaces. It benefits directly from US infrastructure spending (roads, bridges, buildings require rebar).",
    headquarters: "Irving, TX", founded: 1915, employees: "17,000", website: "cmc.com",
  },
  {
    id: "ati",
    name: "ATI Inc.",
    ticker: "ATI",
    sector: "materials",
    subSector: "Specialty Alloys",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "High-Performance Materials (Aerospace)", description: "Titanium alloys, nickel superalloys, and specialty alloys for jet engine components (GE Aerospace, Pratt & Whitney supply chain).", revenueShare: 55 },
      { name: "Advanced Alloys & Solutions (Industrials)", description: "Specialty stainless, titanium, and zirconium for chemical processing, defense, and medical.", revenueShare: 30 },
      { name: "Titanium Ingot & Mill Products", description: "Titanium sponge reduction and mill product for aerospace structures.", revenueShare: 15 },
    ],
    revenue: { total: "$4.2B", segments: [
      { name: "High Performance Materials & Components", percentage: 55, amount: "$2.31B" },
      { name: "Advanced Alloys & Solutions", percentage: 45, amount: "$1.89B" },
    ]},
    relationships: [
      { targetId: "ge", type: "customer", products: ["Jet engine alloys"], revenueImpact: "largest customer" },
      { targetId: "rtx", type: "customer", products: ["Pratt & Whitney engine alloys"], revenueImpact: "major" },
    ],
    description: "ATI is a leading specialty metals company supplying titanium alloys, nickel superalloys, and specialty stainless to commercial aerospace (70% of backlog), defense, and industrial markets. It benefits from record commercial jet engine production rates.",
    headquarters: "Dallas, TX", founded: 1996, employees: "8,800", website: "atimaterials.com",
  },
  {
    id: "trex",
    name: "Trex Company, Inc.",
    ticker: "TREX",
    sector: "materials",
    subSector: "Composite Decking",
    marketCap: "mid",
    role: "leader",
    products: [
      { name: "Trex Decking (Transcend/Select/Enhance)", description: "Wood-alternative composite decking made from 95% recycled materials — industry-leading brand.", revenueShare: 85 },
      { name: "Trex Transcend Lineage", description: "Premium composite deck boards launched 2024 — new manufacturing process.", revenueShare: 10 },
      { name: "Trex Commercial & Accessories", description: "Commercial railing systems, lighting, and structural components.", revenueShare: 5 },
    ],
    revenue: { total: "$1.1B", segments: [
      { name: "Residential", percentage: 90, amount: "$0.99B" },
      { name: "Commercial", percentage: 10, amount: "$0.11B" },
    ]},
    relationships: [
      { targetId: "hd", type: "customer", products: ["Deck board distribution"], revenueImpact: "~45% of revenue" },
      { targetId: "low", type: "customer", products: ["Deck board distribution"], revenueImpact: "~20% of revenue" },
    ],
    description: "Trex is the undisputed leader in wood-alternative composite decking, holding ~45% of the composite deck market. Its decks are made from 95% recycled content (reclaimed wood and plastic bags) and command premium pricing due to brand strength and durability.",
    headquarters: "Winchester, VA", founded: 1996, employees: "1,100", website: "trex.com",
  },

  // ============================================================
  // INSURANCE / SPECIALTY FINANCE
  // ============================================================
  {
    id: "eg",
    name: "Everest Group, Ltd.",
    ticker: "EG",
    sector: "financials",
    subSector: "Reinsurance",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "Reinsurance", description: "Global treaty and facultative reinsurance — property catastrophe, casualty, and specialty lines.", revenueShare: 55 },
      { name: "Insurance (Primary)", description: "Specialty primary insurance — admitted and E&S lines in the US.", revenueShare: 45 },
    ],
    revenue: { total: "$17.0B", segments: [
      { name: "Reinsurance Group", percentage: 55, amount: "$9.35B" },
      { name: "Insurance Group", percentage: 45, amount: "$7.65B" },
    ]},
    relationships: [],
    description: "Everest Group is a global (re)insurance provider operating in 90+ countries, known for its disciplined underwriting in property catastrophe, specialty, and casualty lines. It benefits from hard market conditions in commercial insurance.",
    headquarters: "Hamilton, Bermuda", founded: 1973, employees: "2,900", website: "everestgroupltd.com",
  },
  {
    id: "ryan",
    name: "Ryan Specialty Holdings, Inc.",
    ticker: "RYAN",
    sector: "financials",
    subSector: "Insurance Distribution (E&S)",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "Wholesale Specialty Insurance Brokerage", description: "E&S (excess and surplus) lines distribution — connects retail brokers with specialty insurers for complex/unusual risks.", revenueShare: 80 },
      { name: "Underwriting Management / MGAs", description: "Managing general agents and underwriting programs for niche risk classes.", revenueShare: 20 },
    ],
    revenue: { total: "$2.3B", segments: [
      { name: "Commissions & Fees", percentage: 100, amount: "$2.3B" },
    ]},
    relationships: [],
    description: "Ryan Specialty is the largest wholesale specialty insurance broker in the US, operating in the E&S market that handles unusual risks that standard insurers won't cover (cyber, cannabis, extreme weather, etc.). Founded by Patrick Ryan.",
    headquarters: "Chicago, IL", founded: 2010, employees: "6,800", website: "ryanspecialty.com",
  },
  {
    id: "omf",
    name: "OneMain Financial Holdings, LLC",
    ticker: "OMF",
    sector: "financials",
    subSector: "Consumer Finance",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Personal Loans (Secured & Unsecured)", description: "Installment loans to non-prime consumers — $1,500-$20,000, fixed rate, 3-5 year terms. 1,400+ branch offices.", revenueShare: 85 },
      { name: "OneMain BrightWay Credit Card", description: "Secured credit card for credit-building — cross-sell to loan customers.", revenueShare: 10 },
      { name: "Insurance Products", description: "Credit life, disability, and unemployment insurance sold alongside loans.", revenueShare: 5 },
    ],
    revenue: { total: "$3.8B", segments: [
      { name: "Interest Income & Fees", percentage: 85, amount: "$3.23B" },
      { name: "Other Revenue", percentage: 15, amount: "$0.57B" },
    ]},
    relationships: [],
    description: "OneMain Financial is the largest US consumer finance company serving non-prime borrowers, operating 1,400+ branches across 44 states. It offers secured and unsecured installment loans to the 100M+ Americans underserved by traditional banks.",
    headquarters: "Evansville, IN", founded: 1912, employees: "9,500", website: "onemainfinancial.com",
  },

  // ============================================================
  // BUSINESS SERVICES / HR
  // ============================================================
  {
    id: "tnet",
    name: "TriNet Group, Inc.",
    ticker: "TNET",
    sector: "industrials",
    subSector: "Human Resources Outsourcing",
    marketCap: "mid",
    role: "intermediary",
    products: [
      { name: "Professional Employer Organization (PEO)", description: "Co-employment model — TriNet becomes co-employer, handling all HR for SMBs (benefits, payroll, compliance, risk).", revenueShare: 80 },
      { name: "HRIS Software (Zenefits integration)", description: "HR technology platform for benefits administration, payroll, and workforce analytics.", revenueShare: 20 },
    ],
    revenue: { total: "$5.1B", segments: [
      { name: "Insurance Cost (benefits pass-through)", percentage: 70, amount: "$3.57B" },
      { name: "Professional Service Fees", percentage: 30, amount: "$1.53B" },
    ]},
    relationships: [
      { targetId: "adp", type: "competitor", products: ["PEO for SMBs"], revenueImpact: "direct" },
    ],
    description: "TriNet is a leading PEO (professional employer organization) serving SMBs, providing co-employment services so small businesses can offer Fortune 500-quality benefits and HR support without an in-house HR team.",
    headquarters: "Dublin, CA", founded: 1988, employees: "3,000", website: "trinet.com",
  },
  {
    id: "sci",
    name: "Service Corporation International",
    ticker: "SCI",
    sector: "consumer",
    subSector: "Funeral Services",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Funeral Services (Dignity Memorial)", description: "Full-service funeral home operations — caskets, burial, cremation, pre-need arrangements. 1,500+ funeral homes.", revenueShare: 70 },
      { name: "Cemetery Operations", description: "500+ cemetery properties — grave sites, mausoleums, monument sales, and perpetual care.", revenueShare: 30 },
    ],
    revenue: { total: "$4.1B", segments: [
      { name: "Funeral Segment", percentage: 70, amount: "$2.87B" },
      { name: "Cemetery Segment", percentage: 30, amount: "$1.23B" },
    ]},
    relationships: [],
    description: "Service Corporation International is the largest funeral and cemetery services company in North America, operating under the Dignity Memorial brand network. Death care is a highly recession-resistant business with pricing power and a pre-need backlog of $16B+.",
    headquarters: "Houston, TX", founded: 1962, employees: "24,000", website: "sci-corp.com",
  },
];

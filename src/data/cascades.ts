export interface CascadeStep {
  ticker: string;
  companyName: string;
  typicalDelay: string;
  role: "leader" | "first_follower" | "mid_cap" | "late_mover";
  reason: string;
}

export interface HistoricalCascade {
  date: string;
  trigger: string;
  leaderMove: string;
  cascadeResult: string;
}

export interface CascadePattern {
  id: string;
  sector: string;
  sectorName: string;
  leaderTicker: string;
  leaderName: string;
  description: string;
  sequence: CascadeStep[];
  historicalOccurrences: HistoricalCascade[];
}

export const cascadePatterns: CascadePattern[] = [
  // ============================================================
  // SEMICONDUCTORS
  // ============================================================
  {
    id: "semi-nvda-earnings-cascade",
    sector: "semiconductors",
    sectorName: "Semiconductors",
    leaderTicker: "NVDA",
    leaderName: "NVIDIA",
    description:
      "NVIDIA earnings set the tone for the entire semiconductor supply chain. A beat or miss cascades first to memory suppliers (SK Hynix, Micron), then to TSMC and equipment names, and finally to the hyperscaler customers that drive GPU demand.",
    sequence: [
      {
        ticker: "NVDA",
        companyName: "NVIDIA",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "NVIDIA's data-center guidance is the single most important demand signal for AI chips, HBM memory, and advanced packaging.",
      },
      {
        ticker: "000660.KS",
        companyName: "SK Hynix",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "SK Hynix is NVIDIA's primary HBM supplier; NVIDIA's demand outlook directly dictates SK Hynix HBM revenue expectations.",
      },
      {
        ticker: "MU",
        companyName: "Micron",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "Micron's HBM3e ramp is gated by NVIDIA orders; strong NVIDIA guidance validates Micron's HBM revenue trajectory.",
      },
      {
        ticker: "TSM",
        companyName: "TSMC",
        typicalDelay: "1-2 trading days",
        role: "mid_cap",
        reason: "TSMC fabricates all NVIDIA GPUs; higher NVIDIA volume means higher utilization of 3nm/5nm and CoWoS packaging capacity.",
      },
      {
        ticker: "ASML",
        companyName: "ASML",
        typicalDelay: "2-3 trading days",
        role: "mid_cap",
        reason: "Sustained GPU demand growth implies TSMC needs more EUV capacity, supporting ASML's order backlog.",
      },
      {
        ticker: "AMAT",
        companyName: "Applied Materials",
        typicalDelay: "2-5 trading days",
        role: "late_mover",
        reason: "Equipment spend follows 1-2 quarters behind foundry utilization; NVIDIA strength signals future AMAT orders.",
      },
      {
        ticker: "LRCX",
        companyName: "Lam Research",
        typicalDelay: "2-5 trading days",
        role: "late_mover",
        reason: "Memory capex recovery (driven by HBM demand) flows to Lam's etch-heavy memory equipment business with a lag.",
      },
      {
        ticker: "KLAC",
        companyName: "KLA Corp",
        typicalDelay: "3-5 trading days",
        role: "late_mover",
        reason: "Process-control spending is the last equipment budget to move, but rising complexity at 3nm lifts KLA's content per wafer.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2024-02-21",
        trigger: "NVIDIA FY24 Q4 earnings: data-center revenue +409% YoY, guided Q1 to $24B vs $22B consensus",
        leaderMove: "NVDA +16.4% on earnings day",
        cascadeResult: "SK Hynix +8% in 2 days, TSMC +5% in 3 days, ASML +4% over the week. SOX index +6% in 5 sessions.",
      },
      {
        date: "2024-05-22",
        trigger: "NVIDIA FY25 Q1 earnings: revenue $26B (+262% YoY), announced 10:1 stock split",
        leaderMove: "NVDA +9.3% after hours",
        cascadeResult: "Micron +6% next day on HBM optimism. TSMC +3%. Equipment names (AMAT, LRCX) each +4% within the week.",
      },
      {
        date: "2025-02-26",
        trigger: "NVIDIA FY25 Q4 earnings: data-center revenue $35.6B, Blackwell ramp confirmed ahead of schedule",
        leaderMove: "NVDA +4.2% (modest given elevated expectations)",
        cascadeResult: "SK Hynix +5%, Micron +3% on HBM3e validation. Equipment names lagged as capex timing questions persisted.",
      },
      {
        date: "2026-02-26",
        trigger: "NVIDIA FY26 Q4 earnings: data-center revenue $35.6B Q4, full-year $215.9B (+114% YoY). Blackwell GPU demand continues to surge; Rubin architecture roadmap announced.",
        leaderMove: "NVDA +3.8% post-earnings (beat expectations, Q1 FY27 guided $43B)",
        cascadeResult: "SK Hynix +6% on HBM4 demand confirmation. Micron +4%, TSMC +3%. AMD +2% on broader AI chip tailwinds. SOX index +4% over the week.",
      },
    ],
  },
  {
    id: "semi-asml-orders-cascade",
    sector: "semiconductors",
    sectorName: "Semiconductors",
    leaderTicker: "ASML",
    leaderName: "ASML",
    description:
      "ASML's quarterly order bookings are a leading indicator for semiconductor capex cycles. Strong EUV orders signal fab expansion across TSMC, Samsung, and memory makers, cascading to peer equipment companies and then to chip designers who benefit from capacity growth.",
    sequence: [
      {
        ticker: "ASML",
        companyName: "ASML",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "ASML's EUV order book is the earliest signal of foundry and memory fab investment plans 12-18 months forward.",
      },
      {
        ticker: "AMAT",
        companyName: "Applied Materials",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "ASML orders confirm capex cycle strength, directly implying demand for AMAT's complementary deposition and etch tools.",
      },
      {
        ticker: "LRCX",
        companyName: "Lam Research",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "Lam's etch business is tightly correlated with fab starts that ASML orders foreshadow.",
      },
      {
        ticker: "KLAC",
        companyName: "KLA Corp",
        typicalDelay: "1-2 trading days",
        role: "mid_cap",
        reason: "Rising wafer starts mean more inspection and metrology demand; KLA benefits from increased complexity at advanced nodes.",
      },
      {
        ticker: "TSM",
        companyName: "TSMC",
        typicalDelay: "1-3 trading days",
        role: "mid_cap",
        reason: "TSMC is the largest EUV buyer; strong orders confirm TSMC's expansion plans are on track.",
      },
      {
        ticker: "005930.KS",
        companyName: "Samsung Electronics",
        typicalDelay: "2-4 trading days",
        role: "late_mover",
        reason: "Samsung's foundry and memory capex plans are validated by overall industry equipment spending trends.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2024-01-24",
        trigger: "ASML Q4 2023 orders of EUR 9.2B crushed EUR 3.6B consensus — largest order quarter ever",
        leaderMove: "ASML +9.7% on earnings day",
        cascadeResult: "AMAT +5%, LRCX +6%, KLAC +4% within 2 days. TSMC +3% as capex cycle confirmation spread through the sector.",
      },
      {
        date: "2024-10-15",
        trigger: "ASML Q3 2024 bookings disappointed at EUR 2.6B, well below expectations; China restrictions cited",
        leaderMove: "ASML -15.6% (leaked a day early)",
        cascadeResult: "AMAT -5%, LRCX -6%, KLAC -4% same day. TSMC initially dipped -2% but recovered after its own strong earnings.",
      },
    ],
  },

  // ============================================================
  // AI / CLOUD
  // ============================================================
  {
    id: "cloud-capex-cascade",
    sector: "ai-cloud",
    sectorName: "AI / Cloud",
    leaderTicker: "MSFT",
    leaderName: "Microsoft",
    description:
      "Hyperscaler capex guidance cascades through the AI supply chain. When Microsoft raises Azure AI spending, it validates GPU demand (NVIDIA), foundry utilization (TSMC), and signals peer hyperscalers will follow suit.",
    sequence: [
      {
        ticker: "MSFT",
        companyName: "Microsoft",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "Microsoft's Azure capex guidance is the most closely watched AI infrastructure spending signal on Wall Street.",
      },
      {
        ticker: "NVDA",
        companyName: "NVIDIA",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "Microsoft is NVIDIA's largest single customer; higher Azure capex directly translates to GPU orders.",
      },
      {
        ticker: "GOOGL",
        companyName: "Alphabet",
        typicalDelay: "1-3 trading days",
        role: "mid_cap",
        reason: "Google Cloud typically matches or exceeds peer capex growth to maintain AI competitiveness.",
      },
      {
        ticker: "AMZN",
        companyName: "Amazon (AWS)",
        typicalDelay: "1-3 trading days",
        role: "mid_cap",
        reason: "AWS must keep pace with Azure AI investment or risk losing cloud AI market share.",
      },
      {
        ticker: "META",
        companyName: "Meta",
        typicalDelay: "1-5 trading days",
        role: "mid_cap",
        reason: "Meta's AI capex follows the same GPU procurement cycle, though driven by AI model training rather than cloud revenue.",
      },
      {
        ticker: "ORCL",
        companyName: "Oracle",
        typicalDelay: "3-7 trading days",
        role: "late_mover",
        reason: "Oracle OCI benefits from hyperscaler overflow demand and enterprise customers seeking GPU capacity alternatives.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2024-01-30",
        trigger: "Microsoft FY24 Q2: Azure revenue +30%, CEO Nadella announced 'AI demand ahead of available capacity'",
        leaderMove: "MSFT +2.5% after hours",
        cascadeResult: "NVDA +4% next session. Google and Amazon each guided higher capex in subsequent earnings. ORCL added $10B to capex plans within 2 months.",
      },
      {
        date: "2024-07-30",
        trigger: "Microsoft FY24 Q4: capex rose to $19B/quarter, guided higher for FY25 with 'AI demand outstripping supply'",
        leaderMove: "MSFT -3.4% (market worried about capex ROI)",
        cascadeResult: "Despite MSFT dip, NVDA +5% on demand validation. GPU supply chain rallied as capex concern was read as demand strength for semi names.",
      },
      {
        date: "2025-10-28",
        trigger: "Microsoft FY26 Q1: Azure AI revenue growth re-accelerated to +45%, capex guidance raised to $22B/quarter",
        leaderMove: "MSFT +6.1%",
        cascadeResult: "NVDA +8%, TSMC +4%, ASML +3% over the following week. Oracle raised OCI GPU cluster targets by 40%.",
      },
    ],
  },

  // ============================================================
  // EV / BATTERY
  // ============================================================
  {
    id: "ev-tesla-deliveries-cascade",
    sector: "ev-battery",
    sectorName: "EV / Battery",
    leaderTicker: "TSLA",
    leaderName: "Tesla",
    description:
      "Tesla's quarterly delivery numbers cascade through the entire EV battery supply chain. Strong deliveries signal healthy end-demand, boosting battery makers, then lithium miners. Weak deliveries trigger fears of EV slowdown across the chain.",
    sequence: [
      {
        ticker: "TSLA",
        companyName: "Tesla",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "Tesla's delivery report is the single most-watched EV demand indicator, setting sentiment for the entire sector.",
      },
      {
        ticker: "300750.SZ",
        companyName: "CATL",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "CATL is Tesla's primary LFP battery supplier; Tesla volume directly affects CATL's order book.",
      },
      {
        ticker: "6752.T",
        companyName: "Panasonic",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "Panasonic derives ~70% of its battery revenue from Tesla; delivery numbers are existential for Panasonic Energy.",
      },
      {
        ticker: "373220.KS",
        companyName: "LG Energy Solution",
        typicalDelay: "1-2 trading days",
        role: "mid_cap",
        reason: "LG Energy supplies cylindrical cells to Tesla and reads through to broader EV demand across GM, Hyundai, and others.",
      },
      {
        ticker: "1211.HK",
        companyName: "BYD",
        typicalDelay: "1-3 trading days",
        role: "mid_cap",
        reason: "BYD's own delivery data typically follows within days; Tesla trends signal whether the global EV market is accelerating or decelerating.",
      },
      {
        ticker: "ALB",
        companyName: "Albemarle",
        typicalDelay: "3-7 trading days",
        role: "late_mover",
        reason: "Lithium miners react with a lag as the market reassesses battery-cell production rates and upstream material demand.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2024-04-02",
        trigger: "Tesla Q1 2024 deliveries of 387K missed consensus of 449K — first YoY decline in 4 years",
        leaderMove: "TSLA -4.9% on delivery miss",
        cascadeResult: "CATL -3%, Panasonic -4%, LG Energy -5% over 3 days. Albemarle -8% in the week as lithium demand fears intensified.",
      },
      {
        date: "2024-10-02",
        trigger: "Tesla Q3 2024 deliveries of 463K beat 461K consensus, signaling recovery",
        leaderMove: "TSLA +3.2%",
        cascadeResult: "Battery makers rallied 2-4% over 2 days. Albemarle +5% as lithium sentiment stabilized. BYD reported record 443K NEV deliveries days later, amplifying the upswing.",
      },
      {
        date: "2025-07-02",
        trigger: "Tesla Q2 2025 deliveries of 520K smashed 480K consensus, new quarterly record driven by refreshed Model Y",
        leaderMove: "TSLA +8.5%",
        cascadeResult: "CATL +6%, Panasonic +7%, LG Energy +5% in 3 sessions. Albemarle +10% over the week as lithium restocking expectations rose.",
      },
    ],
  },

  // ============================================================
  // DEFENSE
  // ============================================================
  {
    id: "defense-budget-cascade",
    sector: "defense",
    sectorName: "Defense",
    leaderTicker: "LMT",
    leaderName: "Lockheed Martin",
    description:
      "Defense budget announcements and Lockheed Martin's order book set the tone for the sector. As the largest DoD contractor, LMT's backlog growth signals budget flow to primes and then to mid-tier defense electronics suppliers.",
    sequence: [
      {
        ticker: "LMT",
        companyName: "Lockheed Martin",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "Lockheed's backlog and margin guidance signal overall DoD budget health and program execution across F-35, missiles, and space.",
      },
      {
        ticker: "RTX",
        companyName: "RTX Corporation",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "RTX's Raytheon segment competes and partners with LMT on missile defense; LMT strength implies robust munitions spending.",
      },
      {
        ticker: "NOC",
        companyName: "Northrop Grumman",
        typicalDelay: "1-2 trading days",
        role: "first_follower",
        reason: "Northrop is a critical F-35 subcontractor and benefits from the same defense-budget tailwinds driving Lockheed's backlog.",
      },
      {
        ticker: "BA.L",
        companyName: "BAE Systems",
        typicalDelay: "1-3 trading days",
        role: "mid_cap",
        reason: "BAE reacts to U.S. budget signals with a lag, as its UK/international exposure provides partial insulation.",
      },
      {
        ticker: "LHX",
        companyName: "L3Harris",
        typicalDelay: "2-5 trading days",
        role: "late_mover",
        reason: "L3Harris is a sub-tier supplier whose orders flow through prime-contractor procurement cycles with a multi-quarter lag.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2024-01-23",
        trigger: "Lockheed Martin Q4 2023: backlog hit record $160.6B, 2024 guidance above consensus on strong F-35 and missile orders",
        leaderMove: "LMT +4.8%",
        cascadeResult: "RTX +3%, NOC +2.5% over 2 days. BAE Systems +2% in London. L3Harris +1.5% within the week as defense sentiment improved.",
      },
      {
        date: "2024-03-11",
        trigger: "White House FY2025 defense budget request of $895B (+1% real growth), emphasis on Pacific deterrence and munitions",
        leaderMove: "LMT +2.1% on budget day",
        cascadeResult: "RTX +3.5% (munitions emphasis), NOC +2% (B-21 funding confirmed), BAE +1.5% (UK spending aligned with NATO 2% pledge).",
      },
      {
        date: "2025-06-15",
        trigger: "Lockheed awarded $12B F-35 Lot 19 contract — largest single F-35 production award",
        leaderMove: "LMT +3.4%",
        cascadeResult: "RTX +4% (Pratt & Whitney engine work), NOC +3% (fuselage subcontract), BAE +2.5% (UK workshare). L3Harris +2% over the week.",
      },
    ],
  },

  // ============================================================
  // PHARMA / BIOTECH
  // ============================================================
  {
    id: "pharma-glp1-cascade",
    sector: "pharma-biotech",
    sectorName: "Pharma / Biotech",
    leaderTicker: "LLY",
    leaderName: "Eli Lilly",
    description:
      "GLP-1 drug data and sales figures from Eli Lilly cascade through the obesity/metabolic drug landscape. Positive tirzepatide data lifts the entire GLP-1 class while pressuring competitors in adjacent therapeutic areas that obesity drugs may disrupt.",
    sequence: [
      {
        ticker: "LLY",
        companyName: "Eli Lilly",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "Eli Lilly's Mounjaro/Zepbound sales and clinical trial readouts set expectations for the entire GLP-1 obesity market.",
      },
      {
        ticker: "NVO",
        companyName: "Novo Nordisk",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "Novo Nordisk and Lilly form a GLP-1 duopoly; positive class data lifts both, while competitive data creates relative winners and losers.",
      },
      {
        ticker: "PFE",
        companyName: "Pfizer",
        typicalDelay: "1-3 trading days",
        role: "mid_cap",
        reason: "Pfizer's oral GLP-1 candidate (danuglipron) is a distant follower; strong Lilly data validates the obesity market while highlighting Pfizer's competitive gap.",
      },
      {
        ticker: "MRNA",
        companyName: "Moderna",
        typicalDelay: "2-5 trading days",
        role: "late_mover",
        reason: "Moderna benefits from broader biopharma innovation sentiment but has no direct GLP-1 program; moves are sentiment-driven.",
      },
      {
        ticker: "REGN",
        companyName: "Regeneron",
        typicalDelay: "2-5 trading days",
        role: "late_mover",
        reason: "Regeneron's antibody platform may produce GLP-1 alternatives; the company reacts to obesity-market sizing and competitive dynamics.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2024-05-02",
        trigger: "Eli Lilly Q1 2024: Mounjaro revenue $1.8B (+219% YoY), Zepbound launched at $500M+ run-rate in first quarter",
        leaderMove: "LLY +6.3%",
        cascadeResult: "NVO +3% (class validation), PFE -1.5% (competitive pressure on oral GLP-1 timeline). Broader biotech ETF (XBI) +2%.",
      },
      {
        date: "2024-11-20",
        trigger: "Eli Lilly Phase 3 orforglipron (oral GLP-1) data showed 14.7% weight loss — better than expected",
        leaderMove: "LLY +4.5%",
        cascadeResult: "NVO -3.2% (oral GLP-1 competitive threat). PFE -2% (danuglipron outlook further dimmed). REGN +1% on obesity market expansion thesis.",
      },
      {
        date: "2025-08-12",
        trigger: "Eli Lilly retatrutide (triple agonist) Phase 3 results: 26% body weight loss at 48 weeks — best in class",
        leaderMove: "LLY +8.1%",
        cascadeResult: "NVO -5% (competitive pressure), PFE -2%, REGN +2% (exploring anti-obesity antibodies). Bariatric surgery stocks fell 10-15%.",
      },
    ],
  },

  // ============================================================
  // ENERGY TRANSITION
  // ============================================================
  {
    id: "energy-fslr-ira-cascade",
    sector: "ev-battery",
    sectorName: "Energy Transition",
    leaderTicker: "FSLR",
    leaderName: "First Solar",
    description:
      "First Solar's share price reacts sharply to IRA policy developments and utility-scale solar contract wins. As the only large-scale domestic thin-film manufacturer, FSLR leads a cascade through residential solar (ENPH, SEDG, RUN) and then into battery storage and lithium supply (ALB, SQM).",
    sequence: [
      {
        ticker: "FSLR",
        companyName: "First Solar",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "First Solar is the primary IRA beneficiary in solar manufacturing — 45X production tax credits apply directly to its US-based thin-film modules, making FSLR the clearest policy read-through in clean energy.",
      },
      {
        ticker: "ENPH",
        companyName: "Enphase Energy",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "Enphase microinverters attach to rooftop solar installations; IRA residential clean energy credits drive demand for both modules and Enphase's power electronics.",
      },
      {
        ticker: "SEDG",
        companyName: "SolarEdge Technologies",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "SolarEdge's DC-optimized inverter systems serve the same residential and commercial solar installers; policy tailwinds read through identically to ENPH.",
      },
      {
        ticker: "RUN",
        companyName: "Sunrun",
        typicalDelay: "1-3 trading days",
        role: "mid_cap",
        reason: "Sunrun is the largest US residential solar installer; strong IRA incentives reduce customer acquisition costs and boost lease economics.",
      },
      {
        ticker: "ALB",
        companyName: "Albemarle",
        typicalDelay: "3-7 trading days",
        role: "late_mover",
        reason: "Accelerating solar deployment drives battery storage co-installations, increasing lithium demand expectations; Albemarle reprices with a week-plus lag.",
      },
      {
        ticker: "SQM",
        companyName: "Sociedad Quimica y Minera",
        typicalDelay: "3-7 trading days",
        role: "late_mover",
        reason: "SQM is the world's second-largest lithium producer; energy storage demand signals reach Chilean miners after the full solar policy cascade has played out.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2022-08-16",
        trigger: "Inflation Reduction Act signed into law — $369B in climate/energy spending including 30% ITC, 45X manufacturing credits",
        leaderMove: "FSLR +39.6% in the week of passage",
        cascadeResult: "ENPH +26%, SEDG +22%, RUN +18% in the same week. ALB +12%, SQM +10% over two weeks as battery storage buildout assumptions were revised sharply higher.",
      },
      {
        date: "2024-01-12",
        trigger: "Treasury Dept issued final guidance on 45X domestic content adders — FSLR modules confirmed to qualify for maximum bonus credits",
        leaderMove: "FSLR +8.4% on guidance day",
        cascadeResult: "ENPH +5%, SEDG +4% as broader US solar demand outlook improved. RUN +6% on installer margin expectations. ALB +3% over the following week.",
      },
    ],
  },

  // ============================================================
  // AI INFRASTRUCTURE
  // ============================================================
  {
    id: "ai-msft-azure-infra-cascade",
    sector: "ai-cloud",
    sectorName: "AI Infrastructure",
    leaderTicker: "MSFT",
    leaderName: "Microsoft",
    description:
      "Microsoft Azure AI capacity announcements trigger a multi-layer infrastructure cascade. Azure capex guidance directly validates GPU demand (NVDA), which flows to semiconductor equipment makers (AMAT, LRCX) needed to produce AI chips, and finally reaches memory suppliers (MU, SK Hynix) who provide HBM for AI accelerators.",
    sequence: [
      {
        ticker: "MSFT",
        companyName: "Microsoft",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "Microsoft's Azure AI capacity expansion announcements signal the scale and pace of enterprise AI infrastructure buildout — the single most credible demand signal for the entire AI hardware supply chain.",
      },
      {
        ticker: "NVDA",
        companyName: "NVIDIA",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "NVIDIA is the primary GPU supplier for Azure AI clusters; every new Azure AI capacity commitment directly translates to GPU purchase orders.",
      },
      {
        ticker: "AMAT",
        companyName: "Applied Materials",
        typicalDelay: "2-4 trading days",
        role: "mid_cap",
        reason: "Applied Materials supplies deposition and etch equipment to TSMC and Samsung for GPU wafer production; sustained Azure demand growth justifies AMAT's next capex cycle.",
      },
      {
        ticker: "LRCX",
        companyName: "Lam Research",
        typicalDelay: "2-4 trading days",
        role: "mid_cap",
        reason: "Lam's etch tools are essential for HBM and advanced logic fab starts; rising AI accelerator volumes drive equipment reorder cycles.",
      },
      {
        ticker: "MU",
        companyName: "Micron",
        typicalDelay: "3-6 trading days",
        role: "late_mover",
        reason: "Micron's HBM3e production is capacity-constrained; Azure cluster expansion signals new HBM allocation commitments and validates Micron's aggressive HBM capex spend.",
      },
      {
        ticker: "000660.KS",
        companyName: "SK Hynix",
        typicalDelay: "3-6 trading days",
        role: "late_mover",
        reason: "SK Hynix is NVIDIA's lead HBM supplier; Microsoft-driven GPU demand cascades to HBM order visibility, supporting SK Hynix's premium memory margins.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2023-11-20",
        trigger: "Microsoft extended OpenAI partnership with multi-year Azure exclusivity commitment, pledging $10B+ in additional cloud AI infrastructure",
        leaderMove: "MSFT +3.2% on announcement day",
        cascadeResult: "NVDA +5.8% next session as GPU order backlog expectations expanded. AMAT +4%, LRCX +3.5% within 4 days. MU +6% on HBM demand validation over the week.",
      },
      {
        date: "2025-01-21",
        trigger: "Microsoft joined OpenAI Stargate joint venture announcement — $500B US AI infrastructure commitment with MSFT as primary cloud provider",
        leaderMove: "MSFT +4.8%",
        cascadeResult: "NVDA +6.4% same day. AMAT +5%, LRCX +4.5% over 3 days as fab utilization and equipment order outlook improved sharply. SK Hynix +7%, MU +5% on HBM supply agreement expectations.",
      },
    ],
  },
  // ============================================================
  // FINANCIALS / FINTECH
  // ============================================================
  {
    id: "fintech-visa-payments-crypto-cascade",
    sector: "financials",
    sectorName: "Financials / Fintech",
    leaderTicker: "V",
    leaderName: "Visa",
    description:
      "Visa's transaction volume acceleration triggers a cascade through the payments ecosystem. As Visa and Mastercard formalize stablecoin settlement rails, institutional capital flows from the legacy network leaders into crypto infrastructure — particularly Coinbase, which serves as the institutional custody and settlement backbone for TradFi's crypto adoption.",
    sequence: [
      {
        ticker: "V",
        companyName: "Visa",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "Visa's cross-border transaction volume and stablecoin settlement announcements set the narrative for the entire payment ecosystem. Institutional ownership near 90% of float signals broad conviction.",
      },
      {
        ticker: "MA",
        companyName: "Mastercard",
        typicalDelay: "0-1 trading days",
        role: "first_follower",
        reason: "Mastercard mirrors Visa's transaction volume dynamics and is pursuing parallel stablecoin settlement pilots. A positive Visa earnings beat or partnership announcement triggers immediate re-rating of Mastercard's identical business model.",
      },
      {
        ticker: "COIN",
        companyName: "Coinbase",
        typicalDelay: "2-5 trading days",
        role: "mid_cap",
        reason: "Coinbase Custody and Prime brokerage are the institutional-grade infrastructure layers for TradFi's crypto adoption. When Visa/Mastercard validate crypto settlement rails, COIN's institutional custody revenue outlook expands materially.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2023-10-03",
        trigger: "Visa announced expanded stablecoin settlement pilot using USDC on Ethereum and Solana for cross-border payments with merchant acquirers",
        leaderMove: "V +2.8% on announcement",
        cascadeResult: "MA +2.4% same day on direct business model read-through. COIN +11% over following 3 days as institutional read-through to crypto custody demand drove significant volume.",
      },
      {
        date: "2025-08-15",
        trigger: "U.S. Digital Asset Market Structure Act signed into law, providing regulatory clarity for crypto exchanges and opening institutional mandates to hold crypto infrastructure equity",
        leaderMove: "V +1.5% on payment network validation; MA +1.6%",
        cascadeResult: "COIN +28% over 2 weeks as 14 institutional investors initiated new positions disclosed in Q3 2025 13F filings — the largest single-quarter institutional onboarding in COIN's history as a public company.",
      },
    ],
  },
  // ============================================================
  // MATERIALS / CRITICAL MINERALS
  // ============================================================
  {
    id: "materials-alb-critical-minerals-cascade",
    sector: "materials",
    sectorName: "Materials / Critical Minerals",
    leaderTicker: "ALB",
    leaderName: "Albemarle",
    description:
      "Albemarle, as the world's largest lithium producer, sets the institutional tone for the entire critical minerals supply chain. Policy catalysts — IRA subsidies, Defense Production Act invocations, federal loan commitments — trigger accumulation in ALB first, then flow to copper leader FCX, and finally to development-stage US-based miners MP Materials and Lithium Americas as the thesis broadens.",
    sequence: [
      {
        ticker: "ALB",
        companyName: "Albemarle",
        typicalDelay: "0 (trigger)",
        role: "leader",
        reason: "Albemarle is the highest-quality, most liquid expression of lithium demand. Institutional investors accumulate ALB first when EV demand data or policy signals strengthen the structural lithium thesis.",
      },
      {
        ticker: "FCX",
        companyName: "Freeport-McMoRan",
        typicalDelay: "1-3 trading days",
        role: "first_follower",
        reason: "Copper is the broadest electrification metal — every EV, wind turbine, and data center cooling system requires it. FCX re-rates alongside lithium when the energy transition demand narrative strengthens, as both are driven by the same fundamental tailwinds.",
      },
      {
        ticker: "MP",
        companyName: "MP Materials",
        typicalDelay: "3-7 trading days",
        role: "mid_cap",
        reason: "MP Materials is the only US rare earth producer and benefits from the same domestic supply chain reshoring narrative as ALB and FCX. Institutional capital flows from the large-cap commodity leaders into MP as the thesis broadens to national security supply chain.",
      },
      {
        ticker: "LAC",
        companyName: "Lithium Americas",
        typicalDelay: "5-10 trading days",
        role: "late_mover",
        reason: "Lithium Americas is a development-stage miner with the largest known US lithium resource at Thacker Pass. It captures the final wave of institutional capital as higher-risk mandates chase the same structural lithium thesis after large-cap positions are established.",
      },
    ],
    historicalOccurrences: [
      {
        date: "2022-08-16",
        trigger: "Inflation Reduction Act signed into law — $369B in climate and energy provisions including EV tax credits, battery manufacturing incentives, and domestic critical minerals requirements",
        leaderMove: "ALB +8.4% on IRA signing day as lithium demand projections were revised sharply upward",
        cascadeResult: "FCX +5.2% over 2 days on electrification copper demand read-through. MP +12% over the week on rare earth domestic supply mandate. LAC +18% over 10 days as Thacker Pass DOE loan application gained credibility.",
      },
      {
        date: "2025-03-07",
        trigger: "DOE finalized $2.26B conditional loan commitment for Lithium Americas' Thacker Pass project; simultaneous GM announcement of expanded ALB lithium supply agreement through 2030",
        leaderMove: "ALB +6.1% on supply agreement extension; improved price visibility",
        cascadeResult: "FCX +3.8% on broader energy transition demand validation. MP +9.4% on government support read-through for domestic critical minerals producers. LAC +24% on direct DOE loan catalyst — the largest single-day move in the cascade.",
      },
    ],
  },
];

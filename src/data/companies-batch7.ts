/**
 * @static-data-warning
 * revenue.total, revenue.segments[].amount, employees 필드는 정적 데이터입니다.
 * 실제 값은 /api/company-financials/{ticker} (SEC EDGAR) 및 Yahoo Finance에서 자동 override됩니다.
 * 이 파일의 금액/직원수를 수동으로 수정하지 마세요 — live API가 우선합니다.
 * 정적값은 live 데이터 없을 때의 fallback 역할만 합니다.
 */
import { Company } from './companies';

export const companiesBatch7: Company[] = [
  // ============================================================
  // SEMICONDUCTORS — Missing S&P 500
  // ============================================================
  {
    id: "amd",
    name: "Advanced Micro Devices",
    ticker: "AMD",
    sector: "semiconductors",
    subSector: "CPU / GPU / AI Accelerators",
    marketCap: "mega",
    role: "leader",
    products: [
      { name: "EPYC Server CPUs", description: "Zen 4 / Zen 5 architecture server processors commanding 35%+ of x86 server market share. Key customers: Microsoft, Amazon, Google, Meta.", revenueShare: 38 },
      { name: "Instinct MI300 AI Accelerators", description: "AMD's HBM-integrated AI GPU competing with NVIDIA H100. MI300X targets LLM inference; $3.5B+ in 2024 AI accelerator revenue.", revenueShare: 22 },
      { name: "Radeon Consumer GPUs", description: "RX 7000 series consumer GPUs for gaming PCs. Competes with NVIDIA GeForce in mid-to-high range segment.", revenueShare: 18 },
      { name: "Ryzen Consumer CPUs", description: "Desktop and laptop processors for consumer PCs. Zen 4 / Zen 5 architecture with best-in-class performance-per-watt.", revenueShare: 14 },
      { name: "Adaptive SoCs (Xilinx)", description: "FPGAs and adaptive SoCs for communications, automotive, and industrial markets acquired from Xilinx.", revenueShare: 8 },
    ],
    revenue: {
      total: "$22.7B",
      segments: [
        {
          name: "Data Center",
          percentage: 52,
          amount: "$11.8B",
          description: "EPYC server CPUs and Instinct AI accelerators sold to hyperscalers and enterprises.",
          topCustomers: [
            { name: "Microsoft Azure", ticker: "MSFT", share: "~20%" },
            { name: "Amazon AWS", ticker: "AMZN", share: "~18%" },
            { name: "Google Cloud", ticker: "GOOG", share: "~12%" },
            { name: "Meta Platforms", ticker: "META", share: "~8%" },
          ],
        },
        {
          name: "Client (PC)",
          percentage: 28,
          amount: "$6.4B",
          description: "Ryzen CPUs for consumer laptops and desktops, sold through OEMs and retail.",
          topCustomers: [
            { name: "Dell Technologies", ticker: "DELL", share: "~25%" },
            { name: "HP / Lenovo / ASUS (OEMs)", share: "~55%" },
          ],
        },
        { name: "Gaming", percentage: 12, amount: "$2.7B" },
        { name: "Embedded (Xilinx)", percentage: 8, amount: "$1.8B" },
      ],
    },
    rdPipeline: [
      {
        name: "CDNA4 / MI400 AI Accelerator",
        stage: "development",
        description: "Next-gen AMD AI GPU with HBM4 memory and improved transformer performance. Targets NVIDIA B200 competition.",
        targetDate: "2026",
      },
      {
        name: "Zen 6 CPU Architecture",
        stage: "research",
        description: "Next-generation CPU architecture for server (EPYC Turin+) and consumer (Ryzen 9000 series) with significant IPC uplift.",
        targetDate: "2026-2027",
      },
    ],
    relationships: [
      { targetId: "tsmc", type: "supplier", products: ["Wafer fabrication for all AMD CPUs and GPUs (N3/N4/N5)"], revenueImpact: "Critical — sole advanced-node foundry" },
      { targetId: "sk-hynix", type: "supplier", products: ["HBM3e for MI300X"], revenueImpact: "High" },
      { targetId: "nvda", type: "competitor", products: ["AI accelerators, data center GPUs"], revenueImpact: "Primary competitor in AI GPU market" },
      { targetId: "msft", type: "customer", products: ["EPYC CPUs, MI300X accelerators for Azure"], revenueImpact: "$3B+ annually" },
    ],
    description: "AMD designs high-performance CPUs and GPUs for data centers, PCs, and gaming. Its EPYC server CPUs have taken 35%+ x86 server market share from Intel, while its Instinct MI300 AI accelerators are a credible alternative to NVIDIA in AI inference workloads.",
    headquarters: "Santa Clara, California, USA",
    founded: 1969,
    employees: "26,000+",
    website: "https://www.amd.com",
  },
  {
    id: "intc",
    name: "Intel Corporation",
    ticker: "INTC",
    sector: "semiconductors",
    subSector: "CPU / Foundry",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Core Ultra / Xeon CPUs", description: "Client and server x86 processors. Xeon Scalable for data centers; Core Ultra for AI-capable laptops (Intel AI PC campaign).", revenueShare: 52 },
      { name: "Gaudi AI Accelerators", description: "Intel's answer to NVIDIA GPUs. Gaudi 3 targets training/inference at lower price points. Traction in enterprise AI.", revenueShare: 8 },
      { name: "Foundry Services (IFS)", description: "Intel Foundry manufacturing for external customers (TSMC competitor). 18A process node targets NVIDIA and Qualcomm as future customers.", revenueShare: 12 },
      { name: "Network & Edge (NEX)", description: "Ethernet adapters, FPGAs (Altera), and edge AI chips for telecommunications and networking.", revenueShare: 15 },
      { name: "Mobileye (ADAS)", description: "Autonomous driving chips and EyeQ systems. Leading ADAS supplier to BMW, VW, Nissan, and Hyundai.", revenueShare: 13 },
    ],
    revenue: {
      total: "$53.1B",
      segments: [
        {
          name: "Client Computing (CCG)",
          percentage: 52,
          amount: "$27.6B",
          description: "Core and Core Ultra CPUs for consumer and business laptops/desktops.",
          topCustomers: [
            { name: "Lenovo", share: "~25%" },
            { name: "HP / Dell", share: "~40%" },
            { name: "Apple (legacy, ended)", share: "0% (exited)" },
          ],
        },
        {
          name: "Data Center & AI (DCAI)",
          percentage: 28,
          amount: "$14.9B",
          description: "Xeon server CPUs and Gaudi AI accelerators for cloud and enterprise.",
          topCustomers: [
            { name: "Microsoft", ticker: "MSFT", share: "~15%" },
            { name: "Amazon AWS", ticker: "AMZN", share: "~12%" },
            { name: "Google", ticker: "GOOG", share: "~10%" },
          ],
        },
        { name: "Mobileye (ADAS)", percentage: 10, amount: "$5.3B" },
        { name: "Network & Edge / Foundry", percentage: 10, amount: "$5.3B" },
      ],
    },
    relationships: [
      { targetId: "amd", type: "competitor", products: ["x86 CPUs for PC and server markets"], revenueImpact: "Primary competitor — AMD gaining share" },
      { targetId: "nvda", type: "competitor", products: ["AI accelerators, data center compute"], revenueImpact: "Gaudi vs H100/Blackwell" },
      { targetId: "tsmc", type: "partner", products: ["Leading-edge wafers for Core Ultra (N3)"], revenueImpact: "Intel outsources some chips to TSMC while building own foundry" },
    ],
    description: "Intel is the largest x86 CPU maker by revenue, with dominant share in PC processors and a significant position in data center servers. The company is in a turnaround period, rebuilding its leading-edge manufacturing capabilities through the Intel Foundry strategy under CEO Pat Gelsinger's IDM 2.0 roadmap.",
    headquarters: "Santa Clara, California, USA",
    founded: 1968,
    employees: "124,000+",
    website: "https://www.intel.com",
  },

  // ============================================================
  // CONSUMER — Missing S&P 500
  // ============================================================
  {
    id: "f",
    name: "Ford Motor Company",
    ticker: "F",
    sector: "consumer-discretionary",
    subSector: "Automobiles",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "F-Series Trucks", description: "Best-selling vehicle in the US for 47 consecutive years. F-150, F-250/350 Super Duty. High-margin flagship lineup generating ~40% of Ford's profits.", revenueShare: 38 },
      { name: "Ford Maverick / Bronco / Explorer", description: "Mid-size trucks and SUVs targeting younger buyers and adventure segments.", revenueShare: 22 },
      { name: "Ford Pro (Commercial Vehicles)", description: "Transit vans, F-Series Pro, and fleet services for commercial customers. Fastest growing segment with software subscriptions.", revenueShare: 20 },
      { name: "Ford Model e (EV)", description: "Mustang Mach-E, F-150 Lightning, and E-Transit electric vehicles. Currently running at a loss (~$5B EBIT loss in 2024) while scaling.", revenueShare: 8 },
      { name: "Ford Credit (Financial Services)", description: "Auto lending and leasing arm. $2.5B+ in annual EBT contribution.", revenueShare: 12 },
    ],
    revenue: {
      total: "$185B",
      segments: [
        { name: "Ford Pro (Commercial)", percentage: 38, amount: "$70.3B", topCustomers: [{ name: "US commercial fleet operators", share: "~60%" }] },
        { name: "Ford Blue (ICE Vehicles)", percentage: 42, amount: "$77.7B" },
        { name: "Ford Model e (EV)", percentage: 8, amount: "$14.8B" },
        { name: "Ford Credit", percentage: 12, amount: "$22.2B" },
      ],
    },
    relationships: [
      { targetId: "alb", type: "supplier", products: ["Lithium for EV batteries"], revenueImpact: "Critical for EV battery supply" },
      { targetId: "gm", type: "competitor", products: ["Trucks, SUVs, EVs"], revenueImpact: "Primary North American rival" },
    ],
    description: "Ford Motor Company designs and manufactures automobiles and commercial vehicles. The F-Series truck franchise is the highest-revenue vehicle line in the US. Ford is investing $50B+ in EV and battery manufacturing through 2026 while maintaining ICE profitability.",
    headquarters: "Dearborn, Michigan, USA",
    founded: 1903,
    employees: "177,000+",
    website: "https://www.ford.com",
  },
  {
    id: "gm",
    name: "General Motors",
    ticker: "GM",
    sector: "consumer-discretionary",
    subSector: "Automobiles",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Chevrolet Silverado / GMC Sierra Trucks", description: "GM's top-selling light-duty trucks, competing directly with Ford F-150. Consistently top-3 best-selling vehicles in the US.", revenueShare: 35 },
      { name: "Chevrolet / GMC / Buick / Cadillac SUVs", description: "Large SUV lineup including Tahoe, Suburban, Yukon, and Escalade — among the highest-margin vehicles globally.", revenueShare: 30 },
      { name: "Ultium EV Platform", description: "GM's next-gen EV architecture powering Hummer EV, Silverado EV, Equinox EV, and Blazer EV. Targeting 1M+ EV units by 2025.", revenueShare: 10 },
      { name: "Cruise Autonomous Vehicles", description: "Self-driving robotaxi service. Operations paused in 2024 following regulatory issues; restructuring underway.", revenueShare: 3 },
      { name: "GM Financial", description: "Captive auto lending arm providing financing for GM vehicles globally.", revenueShare: 22 },
    ],
    revenue: {
      total: "$187B",
      segments: [
        { name: "GMNA (North America)", percentage: 80, amount: "$149.6B" },
        { name: "GMI (International)", percentage: 12, amount: "$22.4B" },
        { name: "GM Financial", percentage: 8, amount: "$15B" },
      ],
    },
    relationships: [
      { targetId: "f", type: "competitor", products: ["Trucks, SUVs, EVs"], revenueImpact: "Primary North American rival" },
      { targetId: "alb", type: "supplier", products: ["Lithium for Ultium EV batteries"], revenueImpact: "Critical EV supply chain" },
    ],
    description: "General Motors is one of the world's largest automakers by revenue. GM earns the majority of its profits from high-margin trucks and large SUVs in North America, while investing heavily in its Ultium EV platform to transition to electric vehicles.",
    headquarters: "Detroit, Michigan, USA",
    founded: 1908,
    employees: "163,000+",
    website: "https://www.gm.com",
  },
  {
    id: "tgt",
    name: "Target Corporation",
    ticker: "TGT",
    sector: "consumer-discretionary",
    subSector: "Retail — Discount",
    marketCap: "large",
    role: "customer",
    products: [
      { name: "Owned Brands (Cat & Jack, Good & Gather, Up&Up)", description: "30+ private-label brands generating ~33% of total sales at higher margins than national brands.", revenueShare: 33 },
      { name: "Apparel & Accessories", description: "Fashion-forward clothing and accessories for families. Differentiating category vs Walmart.", revenueShare: 20 },
      { name: "Electronics & Hardlines", description: "Consumer electronics, toys, sporting goods, and home furnishings.", revenueShare: 22 },
      { name: "Food & Beverage", description: "Grocery and everyday consumables. Target's fastest-growing traffic driver.", revenueShare: 18 },
      { name: "Same-Day Services (Drive Up, Shipt)", description: "Curbside pickup and same-day delivery. 10%+ of total sales fulfilled via Drive Up.", revenueShare: 7 },
    ],
    revenue: {
      total: "$109.1B",
      segments: [
        { name: "Apparel & Accessories", percentage: 20, amount: "$21.8B" },
        { name: "Food & Beverage", percentage: 18, amount: "$19.6B" },
        { name: "Household Essentials", percentage: 25, amount: "$27.3B" },
        { name: "Hardlines (Electronics/Toys)", percentage: 22, amount: "$24B" },
        { name: "Home Décor & Furnishings", percentage: 15, amount: "$16.4B" },
      ],
    },
    relationships: [
      { targetId: "wmt", type: "competitor", products: ["Discount retail across all categories"], revenueImpact: "Primary competitor" },
      { targetId: "amzn", type: "competitor", products: ["E-commerce, same-day delivery"], revenueImpact: "Growing threat in online categories" },
    ],
    description: "Target is a general merchandise retailer operating 1,900+ stores across the US. It differentiates from Walmart through a more fashion-forward, design-oriented approach and 30+ owned brands. Target's curbside Drive Up service and same-day delivery via Shipt are key competitive advantages.",
    headquarters: "Minneapolis, Minnesota, USA",
    founded: 1902,
    employees: "400,000+",
    website: "https://www.target.com",
  },
  {
    id: "uber",
    name: "Uber Technologies",
    ticker: "UBER",
    sector: "consumer-discretionary",
    subSector: "Ridesharing / Mobility",
    marketCap: "mega",
    role: "leader",
    products: [
      { name: "Uber Rides (Mobility)", description: "Core ridesharing platform operating in 70+ countries. Includes UberX, Uber Comfort, Uber Black, and shared rides.", revenueShare: 56 },
      { name: "Uber Eats (Delivery)", description: "Food and grocery delivery marketplace. #2 food delivery app in the US after DoorDash; #1 in many international markets.", revenueShare: 32 },
      { name: "Uber Freight", description: "Digital freight brokerage connecting shippers with carriers. $1.3B+ in revenue.", revenueShare: 8 },
      { name: "Advertising", description: "In-app advertising on the Uber platform — 1B+ trips per quarter creates massive impressions inventory.", revenueShare: 4 },
    ],
    revenue: {
      total: "$37.3B",
      segments: [
        {
          name: "Mobility (Rides)",
          percentage: 56,
          amount: "$20.9B",
          topCustomers: [{ name: "Individual consumers globally (150M+ monthly active users)", share: "100%" }],
        },
        { name: "Delivery (Eats)", percentage: 32, amount: "$11.9B" },
        { name: "Freight", percentage: 8, amount: "$3B" },
        { name: "Advertising & Other", percentage: 4, amount: "$1.5B" },
      ],
    },
    rdPipeline: [
      {
        name: "Uber Autonomous (Waymo Partnership)",
        stage: "commercial",
        description: "Waymo robotaxis available on Uber app in San Francisco and Phoenix. Uber acts as demand aggregator; no capital needed for AV fleet ownership.",
        targetDate: "2025+ (expanding)",
      },
      {
        name: "UberX Share + AI Matching",
        stage: "development",
        description: "AI-driven carpooling optimization to improve utilization and reduce cost per trip for both drivers and riders.",
        targetDate: "2025",
      },
    ],
    relationships: [
      { targetId: "googl", type: "partner", products: ["Google Maps navigation API, Google Cloud infrastructure"], revenueImpact: "Critical mapping and cloud dependency" },
    ],
    description: "Uber is the world's largest ridesharing and food delivery platform by gross bookings. After years of losses, Uber achieved GAAP profitability in 2023. Its asset-light marketplace model connects drivers and delivery couriers with consumers globally across 70+ countries.",
    headquarters: "San Francisco, California, USA",
    founded: 2009,
    employees: "32,600+",
    website: "https://www.uber.com",
  },

  // ============================================================
  // FINTECH / PAYMENTS — Missing S&P 500
  // ============================================================
  {
    id: "pypl",
    name: "PayPal Holdings",
    ticker: "PYPL",
    sector: "financials",
    subSector: "Digital Payments",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "PayPal Checkout (Merchant Services)", description: "PayPal button on 30M+ merchant websites worldwide. Processes 50%+ of e-commerce checkout sessions on major platforms.", revenueShare: 55 },
      { name: "Venmo (P2P Payments)", description: "Peer-to-peer payment app with 90M+ users in the US. Monetizing through Venmo debit card, Pay with Venmo, and in-app purchases.", revenueShare: 20 },
      { name: "Braintree (Developer Payments)", description: "Payment gateway for large enterprises and tech companies. Processes payments for Uber, Airbnb, GitHub, etc.", revenueShare: 15 },
      { name: "PayPal Credit / Pay Later (BNPL)", description: "Buy Now Pay Later products integrated into PayPal checkout. Growing fast but margin-dilutive.", revenueShare: 10 },
    ],
    revenue: {
      total: "$31.8B",
      segments: [
        {
          name: "Transaction Revenue",
          percentage: 88,
          amount: "$28B",
          topCustomers: [
            { name: "eBay (legacy, declining)", share: "~3%" },
            { name: "Major e-commerce merchants (anonymous)", share: "~50%" },
          ],
        },
        { name: "Other Value Added Services", percentage: 12, amount: "$3.8B" },
      ],
    },
    relationships: [
      { targetId: "v", type: "partner", products: ["PayPal debit/credit card network processing"], revenueImpact: "Network partnership" },
      { targetId: "ma", type: "partner", products: ["Mastercard network for PayPal cards"], revenueImpact: "Network partnership" },
    ],
    description: "PayPal is one of the world's largest digital payments platforms with 430M+ active accounts. It operates PayPal Checkout, Venmo, Braintree, and Xoom. The company is executing a turnaround strategy under CEO Alex Chriss focusing on profitable growth and new merchant tools.",
    headquarters: "San Jose, California, USA",
    founded: 1998,
    employees: "27,200+",
    website: "https://www.paypal.com",
  },

  // ============================================================
  // HEALTHCARE — Missing S&P 500
  // ============================================================
  {
    id: "cvs",
    name: "CVS Health Corporation",
    ticker: "CVS",
    sector: "healthcare",
    subSector: "Healthcare Services / Pharmacy",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "Pharmacy Benefits (CVS Caremark)", description: "One of the three largest pharmacy benefit managers (PBMs) in the US. Manages drug coverage for 100M+ plan members.", revenueShare: 38 },
      { name: "Health Insurance (Aetna)", description: "Aetna commercial, Medicare Advantage, and Medicaid health plans serving 24M+ members acquired for $69B in 2018.", revenueShare: 35 },
      { name: "Retail Pharmacy (CVS Pharmacy)", description: "9,900+ retail pharmacy locations. Filling 1.5B+ prescriptions annually. Also includes front-store retail.", revenueShare: 22 },
      { name: "Health Services (MinuteClinic / Oak Street)", description: "Primary care clinics (1,100+ MinuteClinics, 200+ Oak Street Health centers). Vertical integration into care delivery.", revenueShare: 5 },
    ],
    revenue: {
      total: "$357B",
      segments: [
        { name: "Health Services (Caremark PBM)", percentage: 38, amount: "$135.7B" },
        { name: "Health Insurance (Aetna)", percentage: 35, amount: "$125B" },
        { name: "Pharmacy & Consumer Wellness", percentage: 22, amount: "$78.5B" },
        { name: "Corporate / Other", percentage: 5, amount: "$17.8B" },
      ],
    },
    relationships: [
      { targetId: "unh", type: "competitor", products: ["PBM (UnitedHealth OptumRx) and health insurance"], revenueImpact: "Primary competitor" },
      { targetId: "ci", type: "competitor", products: ["PBM (Express Scripts) and health insurance"], revenueImpact: "Significant competitor" },
    ],
    description: "CVS Health is one of the largest healthcare companies in the US, operating an integrated model spanning pharmacy benefits management (Caremark), health insurance (Aetna), retail pharmacy (9,900 stores), and primary care clinics (Oak Street Health, MinuteClinic).",
    headquarters: "Woonsocket, Rhode Island, USA",
    founded: 1963,
    employees: "300,000+",
    website: "https://www.cvshealth.com",
  },
  {
    id: "hum",
    name: "Humana",
    ticker: "HUM",
    sector: "healthcare",
    subSector: "Health Insurance",
    marketCap: "large",
    role: "intermediary",
    products: [
      { name: "Medicare Advantage (MA)", description: "Humana's core business — the #2 Medicare Advantage insurer in the US with 5.2M+ MA members. MA plans are government-funded private alternatives to traditional Medicare.", revenueShare: 74 },
      { name: "Medicaid", description: "State Medicaid managed care plans across multiple states.", revenueShare: 8 },
      { name: "Commercial Group Insurance", description: "Employer-sponsored health, dental, and vision plans.", revenueShare: 10 },
      { name: "CenterWell (Primary Care / Pharmacy)", description: "Humana's care delivery arm with 300+ primary care centers and a specialty pharmacy business.", revenueShare: 8 },
    ],
    revenue: {
      total: "$106.4B",
      segments: [
        { name: "Insurance (Medicare Advantage)", percentage: 74, amount: "$78.7B" },
        { name: "CenterWell (Care Delivery)", percentage: 8, amount: "$8.5B" },
        { name: "Medicaid & Group Insurance", percentage: 18, amount: "$19.2B" },
      ],
    },
    relationships: [
      { targetId: "unh", type: "competitor", products: ["Medicare Advantage insurance"], revenueImpact: "UnitedHealth is the #1 MA insurer" },
      { targetId: "cvs", type: "competitor", products: ["Medicare Advantage (Aetna/CVS)"], revenueImpact: "Key competitor in MA" },
    ],
    description: "Humana is a leading US health insurance company primarily focused on Medicare Advantage. It is the #2 Medicare Advantage insurer by enrollment. Humana is integrating forward into care delivery through its CenterWell primary care clinic and pharmacy businesses.",
    headquarters: "Louisville, Kentucky, USA",
    founded: 1961,
    employees: "67,000+",
    website: "https://www.humana.com",
  },

  // ============================================================
  // INDUSTRIALS — Missing S&P 500
  // ============================================================
  {
    id: "carr",
    name: "Carrier Global",
    ticker: "CARR",
    sector: "industrials",
    subSector: "HVAC & Refrigeration",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "Commercial HVAC Systems", description: "Chiller, air handling, and heat pump systems for commercial buildings. Includes Carrier, Toshiba Carrier, and Kidde brands.", revenueShare: 45 },
      { name: "Residential HVAC (Carrier / Bryant)", description: "Home air conditioning, heat pumps, and furnaces. Benefiting from heat pump regulatory tailwinds in Europe and US.", revenueShare: 30 },
      { name: "Refrigeration (Transport & Commercial)", description: "Truck and container refrigeration units (Transicold), and commercial display cases. Carrier is #1 in transport refrigeration.", revenueShare: 15 },
      { name: "Fire & Security (Chubb)", description: "Fire detection, suppression, and security systems. Divesting Chubb in 2024 to focus on HVAC.", revenueShare: 10 },
    ],
    revenue: {
      total: "$22B",
      segments: [
        { name: "HVAC (Americas)", percentage: 52, amount: "$11.4B" },
        { name: "HVAC (Europe & Middle East)", percentage: 23, amount: "$5.1B" },
        { name: "Refrigeration", percentage: 15, amount: "$3.3B" },
        { name: "Fire & Security", percentage: 10, amount: "$2.2B" },
      ],
    },
    relationships: [
      { targetId: "hon", type: "competitor", products: ["Building automation and HVAC controls"], revenueImpact: "Overlaps in building systems" },
    ],
    description: "Carrier Global is a leading global provider of HVAC, refrigeration, fire, and security solutions. Spun off from United Technologies in 2020, Carrier is the #1 global HVAC brand and #1 transport refrigeration provider. It is focused on heat pump-driven electrification of heating.",
    headquarters: "Palm Beach Gardens, Florida, USA",
    founded: 2020,
    employees: "53,000+",
    website: "https://www.carrier.com",
  },
  {
    id: "otis",
    name: "Otis Worldwide Corporation",
    ticker: "OTIS",
    sector: "industrials",
    subSector: "Elevators & Escalators",
    marketCap: "large",
    role: "leader",
    products: [
      { name: "New Equipment (Elevators & Escalators)", description: "New elevator installations globally. Includes Gen2, CompassRose, and other modern elevator lines. China is the largest new equipment market.", revenueShare: 42 },
      { name: "Service & Maintenance (Otis ONE)", description: "Maintenance contracts for 2.2M+ units globally — Otis's highest-margin, most recurring revenue stream.", revenueShare: 58 },
    ],
    revenue: {
      total: "$14.3B",
      segments: [
        {
          name: "New Equipment",
          percentage: 42,
          amount: "$6B",
          topCustomers: [
            { name: "Real estate developers (China 35%, US 20%)", share: "majority" },
          ],
        },
        {
          name: "Service (Maintenance & Repair)",
          percentage: 58,
          amount: "$8.3B",
          description: "2.2M+ units under service contract globally. ~75% gross margins in service segment.",
          topCustomers: [
            { name: "Building owners / operators globally", share: "Fragmented — 10,000+ customers" },
          ],
        },
      ],
    },
    relationships: [
      { targetId: "carr", type: "competitor", products: ["Building systems and HVAC"], revenueImpact: "Carrier competes in commercial building solutions" },
      { targetId: "hon", type: "competitor", products: ["Building automation and controls"], revenueImpact: "Honeywell competes in building infrastructure" },
    ],
    description: "Otis is the world's largest manufacturer and service company for elevators and escalators, with 70,000+ employees and 2.2M+ units under maintenance contracts globally. Spun off from United Technologies in 2020. Service is the dominant and most profitable segment with recurring contract revenue.",
    headquarters: "Farmington, Connecticut, USA",
    founded: 1853,
    employees: "71,000+",
    website: "https://www.otis.com",
  },

  // ============================================================
  // MATERIALS — Missing S&P 500
  // ============================================================
  {
    id: "aa",
    name: "Alcoa Corporation",
    ticker: "AA",
    sector: "materials",
    subSector: "Aluminum",
    marketCap: "mid",
    role: "supplier",
    products: [
      { name: "Aluminum Smelting (Primary)", description: "Primary aluminum production from alumina. Alcoa operates smelters in the US, Canada, Brazil, Australia, and Europe.", revenueShare: 48 },
      { name: "Alumina Refining", description: "Alumina (aluminum oxide) refined from bauxite — the feedstock for aluminum smelters. Alcoa is one of the world's largest alumina producers.", revenueShare: 32 },
      { name: "Bauxite Mining", description: "Bauxite ore mining in Australia, Guinea, and Brazil. Upstream raw material for the alumina-to-aluminum chain.", revenueShare: 12 },
      { name: "Rolled Products / Fabrication", description: "Flat-rolled aluminum for packaging, automotive, and aerospace applications.", revenueShare: 8 },
    ],
    revenue: {
      total: "$10.6B",
      segments: [
        { name: "Aluminum", percentage: 48, amount: "$5.1B" },
        { name: "Alumina", percentage: 32, amount: "$3.4B" },
        { name: "Bauxite", percentage: 12, amount: "$1.3B" },
        { name: "Other", percentage: 8, amount: "$0.8B" },
      ],
    },
    relationships: [
      { targetId: "f", type: "customer", products: ["Automotive aluminum sheet for F-150 body"], revenueImpact: "Significant automotive customer" },
      { targetId: "ba", type: "customer", products: ["Aerospace-grade aluminum alloys"], revenueImpact: "Aircraft structural materials" },
      { targetId: "fcx", type: "competitor", products: ["Base metals mining"], revenueImpact: "Competes in metals supply chain" },
    ],
    description: "Alcoa is a global aluminum producer spanning the full upstream value chain from bauxite mining to primary aluminum production. It is a major supplier of aluminum to aerospace, automotive, and packaging industries. Aluminum prices and energy costs are the primary drivers of financial performance.",
    headquarters: "Pittsburgh, Pennsylvania, USA",
    founded: 1888,
    employees: "18,000+",
    website: "https://www.alcoa.com",
  },
];

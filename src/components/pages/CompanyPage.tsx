'use client';

import { useMemo, useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { allCompanies, type Company, type RevenueSegment } from '@/data/companies';
import { getGeneratedMacroImpact, getGeneratedRdPipeline } from '@/data/company-contexts';
import { getNarrativesByTicker } from '@/data/macro-narratives';
import { institutionalSignals } from '@/data/institutional-signals';
import { newsGapData } from '@/data/news-gap';
import { cascadePatterns } from '@/data/cascades';
import { sectorContextMap } from '@/data/sector-context';
import { companySupplyChainUpdates, typeLabels, type SupplyChainUpdate } from '@/data/company-supply-chain-updates';
import { krSupplyChain, type KrRelType } from '@/data/kr-supply-chain';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  ComposedChart,
} from 'recharts';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Building2,
  Calendar,
  Users,
  Globe,
  TrendingUp,
  TrendingDown,
  Plus,
  LogOut,
  Sparkles,
  Gauge,
  Loader2,
  AlertTriangle,
  Zap,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  Users2,
  Brain,
  Target,
} from 'lucide-react';
import ShareButtons from '@/components/ShareButtons';
import Breadcrumbs from '@/components/Breadcrumbs';
import dynamic from 'next/dynamic';

const SupplyChainMap = dynamic(() => import('@/components/SupplyChainMap'), { ssr: false });
import { useTranslatedText } from '@/hooks/useTranslatedText';

function T({ text }: { text: string }) {
  const translated = useTranslatedText(text);
  return <>{translated}</>;
}

const COLORS = ['#4F8FBF', '#6CB4A8', '#E8A945', '#D97171', '#5CB88A', '#7C5CFC'];

const relationshipColors: Record<string, string> = {
  supplier: '#4F8FBF',
  customer: '#5CB88A',
  partner: '#E8A945',
  competitor: '#D97171',
};

const actionIcons: Record<string, React.ReactNode> = {
  accumulating: <TrendingUp className="w-4 h-4" />,
  reducing: <TrendingDown className="w-4 h-4" />,
  new_position: <Plus className="w-4 h-4" />,
  exit: <LogOut className="w-4 h-4" />,
};

const actionColors: Record<string, string> = {
  accumulating: 'text-green-600 bg-green-50',
  reducing: 'text-red-600 bg-red-50',
  new_position: 'text-blue-600 bg-blue-50',
  exit: 'text-orange-600 bg-orange-50',
};

function SegmentRow({ seg, idx, topCustomersLabel, liveRevenueUSD }: { seg: RevenueSegment; idx: number; topCustomersLabel: string; liveRevenueUSD?: number | null }) {
  const [open, setOpen] = useState(false);
  const hasExtra = !!(seg.topCustomers?.length || seg.description);
  // live 매출 있으면 비율로 계산, 없으면 정적 amount 사용
  const displayAmount = liveRevenueUSD
    ? (() => {
        const v = liveRevenueUSD * (seg.percentage / 100);
        if (v >= 1e12) return `$${(v/1e12).toFixed(2)}T`;
        if (v >= 1e9)  return `$${(v/1e9).toFixed(1)}B`;
        return `$${(v/1e6).toFixed(0)}M`;
      })()
    : seg.amount;
  return (
    <div className="rounded-lg border border-cf-border overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        onClick={() => hasExtra && setOpen((v) => !v)}
        disabled={!hasExtra}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: COLORS[idx % COLORS.length] }}
          />
          <span className="text-sm font-medium text-cf-text-primary truncate">{seg.name}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-sm text-cf-text-secondary">{displayAmount}</span>
          <div className="flex items-center gap-1">
            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-cf-primary" style={{ width: `${seg.percentage}%` }} />
            </div>
            <span className="text-xs text-cf-text-secondary w-8 text-right">{seg.percentage}%</span>
          </div>
          {hasExtra && (
            open ? <ChevronUp className="w-3.5 h-3.5 text-cf-text-secondary" /> : <ChevronDown className="w-3.5 h-3.5 text-cf-text-secondary" />
          )}
        </div>
      </button>
      {open && hasExtra && (
        <div className="px-4 pb-3 bg-gray-50 border-t border-cf-border">
          {seg.description && (
            <p className="text-xs text-cf-text-secondary leading-relaxed pt-2 mb-2">{seg.description}</p>
          )}
          {seg.topCustomers && seg.topCustomers.length > 0 && (
            <div>
              <p className="text-xs font-bold text-cf-text-secondary mb-1.5">{topCustomersLabel}</p>
              <div className="space-y-1">
                {seg.topCustomers.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      {c.ticker && (
                        <span className="font-mono font-bold text-cf-primary">{c.ticker}</span>
                      )}
                      <span className="text-cf-text-secondary">{c.name}</span>
                    </div>
                    {c.share && (
                      <span className="font-medium text-cf-text-primary bg-white border border-cf-border px-1.5 py-0.5 rounded text-xs">{c.share}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function quarterToFilingDate(quarter: string): string {
  const parts = quarter.split(' ');
  const q = parts[0];
  const year = parseInt(parts[1] || '2025');
  if (q === 'Q4') return `${year + 1}.02.14`;
  if (q === 'Q3') return `${year}.11.14`;
  if (q === 'Q2') return `${year}.08.14`;
  return `${year}.05.15`;
}

const impactColors: Record<string, string> = {
  high: 'border-l-red-400 bg-red-50/30',
  medium: 'border-l-amber-400 bg-amber-50/30',
  low: 'border-l-blue-400 bg-blue-50/30',
};

const updateTypeColors: Record<string, string> = {
  disruption: 'text-red-600 bg-red-50',
  expansion: 'text-green-700 bg-green-50',
  partnership: 'text-blue-700 bg-blue-50',
  risk: 'text-amber-700 bg-amber-50',
  opportunity: 'text-purple-700 bg-purple-50',
};


// ── Sector metrics live overlay helpers ──────────────────────────────────────
interface SectorMetricsForHelper {
  wtiPrice: number | null;
  naturalGas: number | null;
  creditCardDelinquency: number | null;
  fedFundsRate: number | null;
  tnxYield: number | null;
  ismPmi: number | null;
}
function getLiveValue(label: string, m: SectorMetricsForHelper): number | null {
  const l = label.toLowerCase();
  if (l.includes('wti')) return m.wtiPrice;
  if (l.includes('천연가스') || l.includes('henry hub') || l.includes('natural gas')) return m.naturalGas;
  if (l.includes('연체율') || l.includes('delinquency')) return m.creditCardDelinquency;
  if (l.includes('ism') || l.includes('pmi')) return m.ismPmi;
  if (l.includes('10년물') || l.includes('tnx') || l.includes('treasury') || l.includes('10y')) return m.tnxYield;
  if (l.includes('fed funds') || l.includes('기준금리') || l.includes('ffr')) return m.fedFundsRate;
  return null;
}
function formatLiveValue(label: string, val: number): string {
  const l = label.toLowerCase();
  if (l.includes('wti')) return `$${val.toFixed(1)}/bbl`;
  if (l.includes('천연가스') || l.includes('henry hub')) return `$${val.toFixed(2)}/MMBtu`;
  if (l.includes('연체율') || l.includes('delinquency')) return `${val.toFixed(2)}%`;
  if (l.includes('ism') || l.includes('pmi')) return val.toFixed(1);
  if (l.includes('10년물') || l.includes('tnx')) return `${val.toFixed(2)}%`;
  if (l.includes('fed funds') || l.includes('기준금리')) return `${val.toFixed(2)}%`;
  return val.toFixed(2);
}

export default function CompanyPage({ ticker }: { ticker: string }) {
  const t = useTranslations('company');
  const locale = useLocale();
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [terminalView, setTerminalView] = useState(false);

  interface CompanyNewsItem { title: string; description: string; link: string; pubDate: string; source: string; }
  interface CompanyNewsData { news: CompanyNewsItem[]; summary: string | null; generatedAt: string; }
  const [companyNews, setCompanyNews] = useState<CompanyNewsData | null>(null);
  const [newsLoading, setNewsLoading] = useState(true);

  const company = useMemo(
    () => allCompanies.find((c) => c.ticker.toUpperCase() === ticker.toUpperCase()),
    [ticker]
  );

  // Live employee count from Yahoo Finance (overrides static company.employees)
  const [liveEmployees, setLiveEmployees] = useState<string | null>(null);
  useEffect(() => {
    if (!ticker) return;
    const ctrl = new AbortController();
    fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker.toUpperCase()}?modules=summaryProfile`, {
      signal: ctrl.signal, cache: 'no-store',
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const n = d?.quoteSummary?.result?.[0]?.summaryProfile?.fullTimeEmployees;
        if (n && !ctrl.signal.aborted) {
          setLiveEmployees(n >= 10000 ? `${(n/1000).toFixed(0)}K` : n.toLocaleString());
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [ticker]);

  // Use hardcoded data if available, otherwise fall back to generated context
  const effectiveMacroImpact = useMemo(
    () => company?.macroImpact ?? getGeneratedMacroImpact(ticker),
    [company, ticker]
  );
  const effectiveRdPipeline = useMemo(
    () => (company?.rdPipeline?.length ? company.rdPipeline : getGeneratedRdPipeline(ticker)),
    [company, ticker]
  );

  const signals = useMemo(
    () => institutionalSignals.filter((s) => s.ticker.toUpperCase() === ticker.toUpperCase()),
    [ticker]
  );

  const newsGap = useMemo(
    () => newsGapData.find((n) => n.ticker.toUpperCase() === ticker.toUpperCase()),
    [ticker]
  );

  const cascadePosition = useMemo(() => {
    if (!company) return null;
    for (const pattern of cascadePatterns) {
      const step = pattern.sequence.find(
        (s) => s.ticker.toUpperCase() === ticker.toUpperCase()
      );
      if (step) return { pattern, step };
    }
    return null;
  }, [company, ticker]);

  // ── Live stock price + 90-day history (Yahoo Finance) ─────────────────────
  interface LivePrice { price: number | null; change: number | null; changePct: number | null; currency: string; marketState: string | null; volume: number | null; dayHigh: number | null; dayLow: number | null; week52High: number | null; week52Low: number | null; }
  function fmtVol(v: number): string {
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(v);
  }
  interface PricePoint { date: string; close: number }
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);
  interface SectorMetrics {
    wtiPrice: number | null;
    naturalGas: number | null;
    creditCardDelinquency: number | null;
    fedFundsRate: number | null;
    tnxYield: number | null;
    ismPmi: number | null;
  }
  const [liveMetrics, setLiveMetrics] = useState<SectorMetrics | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/sector-metrics', { signal: ctrl.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !ctrl.signal.aborted) setLiveMetrics(d); })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const [liveMarketCap, setLiveMarketCap] = useState<number | null>(null);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);

  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/stock-price/${ticker.toUpperCase()}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!controller.signal.aborted && d?.price != null) setLivePrice(d); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ticker]);

  // 2026-06-01: KR(.KS/.KQ) 종목은 allCompanies(US-only)에 없어 minimal page 로 렌더.
  //   company-kr(DART) 로 한글명 + 재무를 채워 KR 페이지 충실화.
  interface KrAnnual { fiscalYear?: string; revenueKRW?: number; operatingIncomeKRW?: number; netIncomeKRW?: number; totalAssetsKRW?: number; totalEquityKRW?: number; totalLiabilitiesKRW?: number; operatingCFKRW?: number; capexKRW?: number; freeCashFlowKRW?: number; dividendsPaidKRW?: number; operatingMarginPct?: number; netMarginPct?: number; roePct?: number; debtRatioPct?: number }
  interface KrCorpInfo { corpNameEng?: string; ceo?: string; establishedDate?: string; address?: string; homepage?: string; indutyCode?: string; phone?: string }
  interface KrProfile { corpName?: string; latestAnnual?: KrAnnual; annuals?: KrAnnual[]; revenueYoYPct?: number; source?: string; corpInfo?: KrCorpInfo }
  const [krProfile, setKrProfile] = useState<KrProfile | null>(null);
  const [krDesc, setKrDesc] = useState<string | null>(null);
  useEffect(() => {
    if (!ticker || !/\.(KS|KQ)$/i.test(ticker)) return;
    const ctrl = new AbortController();
    const code = ticker.replace(/\.(KS|KQ)$/i, '');
    fetch(`/api/company-kr/${code}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error && !ctrl.signal.aborted) setKrProfile(d); })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [ticker]);
  // 사업 개요 — 동적 생성(Ollama, DART/SEC grounded, Redis TTL). 정적 아님.
  //   2026-06-04: KR+US 모두. 정적 프로필(allCompanies) 있는 종목은 skip(이미 description 보유) — minimal 페이지 전용.
  useEffect(() => {
    if (!ticker || company) return; // company(allCompanies) 있으면 정적 description 사용
    const ctrl = new AbortController();
    const code = ticker.replace(/\.(KS|KQ)$/i, '');
    fetch(`/api/company-desc/${code}?locale=${encodeURIComponent(locale)}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.description && !ctrl.signal.aborted) setKrDesc(d.description); })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [ticker, locale, company]);

  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/market-caps?ticker=${ticker.toUpperCase()}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!controller.signal.aborted) {
          const cap = d?.caps?.[ticker.toUpperCase()] ?? null;
          if (cap != null) setLiveMarketCap(cap);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    setNewsLoading(true);
    fetch(`/api/company-news?ticker=${ticker.toUpperCase()}&locale=${encodeURIComponent(locale)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!controller.signal.aborted && d?.news?.length) setCompanyNews(d); })
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setNewsLoading(false); });
    return () => controller.abort();
  }, [ticker, locale]);

  // ── Yahoo recommended stocks ──────────────────────────────────────────────
  interface RecEntry { symbol: string; score: number; price: number | null; changePct: number | null; }
  const [recs, setRecs] = useState<RecEntry[]>([]);
  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/company-recs/${ticker.toUpperCase()}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!controller.signal.aborted && d?.recs?.length) setRecs(d.recs); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ticker]);

  // ── Live financials from SEC EDGAR XBRL 10-K filings (24h cache) ────────────
  interface AnnualFin {
    fy: number; periodEnd: string;
    revenueUSD: number | null; operatingIncomeUSD: number | null; netIncomeUSD: number | null;
    epsDiluted: number | null; totalAssetsUSD: number | null; totalLiabilitiesUSD: number | null;
    equityUSD: number | null; operatingCFUSD: number | null; investingCFUSD: number | null;
    financingCFUSD: number | null; rdExpenseUSD: number | null; capexUSD: number | null;
    buybacksUSD: number | null; dividendsUSD: number | null;
    operatingMarginPct: number | null; roePct: number | null; roaPct: number | null; debtRatioPct: number | null;
  }
  interface QuarterlyFin {
    label: string; fy: number; fp: string; periodEnd: string;
    revenueUSD: number; yoyPct: number | null;
  }
  const [liveFinancials, setLiveFinancials] = useState<{
    revenueFormatted: string;
    fiscalYear: number;
    periodEnd: string;
    source: string;
    annuals: AnnualFin[];
    latestAnnual: AnnualFin | null;
    quarterlyRevenue: QuarterlyFin[];
  } | null>(null);

  function fmtUsd(v: number | null | undefined): string {
    if (v == null) return '-';
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/company-financials/${ticker.toUpperCase()}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!controller.signal.aborted && data && data.revenueFormatted) {
          setLiveFinancials({
            revenueFormatted: data.revenueFormatted,
            fiscalYear: data.fiscalYear,
            periodEnd: data.periodEnd,
            source: data.source,
            annuals: data.annuals ?? [],
            latestAnnual: data.latestAnnual ?? null,
            quarterlyRevenue: data.quarterlyRevenue ?? [],
          });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/price-history?ticker=${ticker.toUpperCase()}&days=90`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!controller.signal.aborted && d?.points?.length) setPriceHistory(d.points); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ticker]);

  // ── Analyst price targets + recommendation breakdown (Finnhub) ─────────────
  interface AnalystData {
    targetHigh: number | null; targetLow: number | null;
    targetMean: number | null; targetMedian: number | null;
    lastUpdated: string | null;
    strongBuy: number; buy: number; hold: number; sell: number; strongSell: number;
    totalAnalysts: number; period: string | null;
  }
  const [analystData, setAnalystData] = useState<AnalystData | null>(null);
  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/analyst-target/${ticker.toUpperCase()}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!controller.signal.aborted && d && (d.targetMean != null || d.totalAnalysts > 0)) {
          setAnalystData(d);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ticker]);

  // ── IV summary (Bloomberg-style options 내재변동성) ─────────────────────────
  interface IvData {
    atmIv30d: number | null;
    atmIv90d: number | null;
    termSlope: number | null;
    skew25d: number | null;
    putCallRatio: number | null;
    qualityScore: number;
    source: string;
  }
  const [ivData, setIvData] = useState<IvData | null>(null);
  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/iv/${ticker.toUpperCase()}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!controller.signal.aborted && d && d.atmIv30d != null) setIvData(d);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ticker]);

  if (!company) {
    // Minimal live page for tickers not in static dataset (IPX, AMRZ, KR .KS/.KQ 등).
    const isKRTicker = /\.(KS|KQ)$/i.test(ticker);
    const liveCompanyName = krProfile?.corpName ?? ticker.toUpperCase();
    const fmtKRW = (n: number) => `₩${Math.round(n).toLocaleString()}`;
    // 조/억 단위 compact (333,605,938,000,000 → 333.6조)
    const fmtKRWc = (n: number) => {
      const abs = Math.abs(n);
      if (abs >= 1e12) return `₩${(n / 1e12).toFixed(1)}조`;
      if (abs >= 1e8) return `₩${(n / 1e8).toFixed(0)}억`;
      return `₩${Math.round(n).toLocaleString()}`;
    };
    const krAnnual = krProfile?.latestAnnual;
    const krAnnuals = krProfile?.annuals ?? [];
    // 2026-06-04: KR 공급망/세그먼트 (큐레이션 사실 데이터) — US 풀페이지 parity.
    const krSC = krSupplyChain[ticker.toUpperCase()];
    const KR_REL_LABEL: Record<KrRelType, string> = { supplier: '공급사', customer: '고객사', partner: '파트너', competitor: '경쟁사' };
    const KR_REL_ORDER: KrRelType[] = ['supplier', 'customer', 'partner', 'competitor'];
    const KR_REL_STYLE: Record<KrRelType, string> = {
      supplier: 'text-blue-600 bg-blue-50', customer: 'text-emerald-600 bg-emerald-50',
      partner: 'text-violet-600 bg-violet-50', competitor: 'text-amber-600 bg-amber-50',
    };
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-heading font-bold text-cf-text-primary">{liveCompanyName}</h1>
          <p className="text-cf-text-secondary text-sm mt-0.5">{isKRTicker ? `DART 공시 + 실시간 시세 (Naver) · ${ticker.toUpperCase()}` : 'SEC 공시 + 실시간 데이터'}</p>
        </div>
        {/* Live price — KR(Naver)/US(Yahoo) */}
        {livePrice?.price != null && (
          <div className="cf-card p-4 mb-4">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold tabular-nums text-cf-text-primary">
                {livePrice.currency === 'KRW' ? fmtKRW(livePrice.price) : `$${livePrice.price.toFixed(2)}`}
              </span>
              {livePrice.changePct != null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full tabular-nums ${livePrice.changePct >= 0 ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                  {livePrice.changePct >= 0 ? '+' : ''}{livePrice.changePct.toFixed(2)}%
                </span>
              )}
            </div>
            {((livePrice.week52High != null && livePrice.week52Low != null) || livePrice.volume != null) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-cf-text-secondary">
                {livePrice.week52High != null && livePrice.week52Low != null && (<span>52주 {livePrice.currency === 'KRW' ? `${fmtKRW(livePrice.week52Low)}~${fmtKRW(livePrice.week52High)}` : `$${livePrice.week52Low.toFixed(0)}~$${livePrice.week52High.toFixed(0)}`}</span>)}
                {livePrice.volume != null && (<span>거래량 {livePrice.volume.toLocaleString()}</span>)}
              </div>
            )}
          </div>
        )}
        {/* 사업 개요 (LLM 생성, 라이브 DART grounded — 정적 아님, Redis TTL 캐시) */}
        {krDesc && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-2">사업 개요</h2>
            <p className="text-sm text-cf-text-secondary leading-relaxed">{krDesc}</p>
            <p className="text-[10px] text-cf-text-secondary/50 mt-2">AI 요약 (DART 기업정보 기반) · 자동 갱신</p>
          </div>
        )}
        {/* 기업 정보 (DART company.json 라이브 — 본사/설립/대표/홈페이지) */}
        {krProfile?.corpInfo && (krProfile.corpInfo.ceo || krProfile.corpInfo.address || krProfile.corpInfo.establishedDate) && (() => {
          const ci = krProfile.corpInfo!;
          const estFmt = ci.establishedDate && /^\d{8}$/.test(ci.establishedDate)
            ? `${ci.establishedDate.slice(0, 4)}.${ci.establishedDate.slice(4, 6)}.${ci.establishedDate.slice(6, 8)}` : ci.establishedDate;
          const hp = ci.homepage ? (ci.homepage.startsWith('http') ? ci.homepage : `https://${ci.homepage}`) : null;
          return (
            <div className="cf-card p-4 mb-4">
              <h2 className="text-sm font-bold text-cf-text-primary mb-3">기업 정보</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
                {ci.corpNameEng && (<div className="flex justify-between gap-2"><span className="text-cf-text-secondary">영문명</span><span className="text-cf-text-primary font-medium text-right">{ci.corpNameEng}</span></div>)}
                {ci.ceo && (<div className="flex justify-between gap-2"><span className="text-cf-text-secondary">대표이사</span><span className="text-cf-text-primary font-medium text-right">{ci.ceo}</span></div>)}
                {estFmt && (<div className="flex justify-between gap-2"><span className="text-cf-text-secondary">설립일</span><span className="text-cf-text-primary font-medium text-right">{estFmt}</span></div>)}
                {ci.address && (<div className="flex justify-between gap-2 sm:col-span-2"><span className="text-cf-text-secondary shrink-0">본사</span><span className="text-cf-text-primary font-medium text-right">{ci.address}</span></div>)}
                {hp && (<div className="flex justify-between gap-2"><span className="text-cf-text-secondary">홈페이지</span><a href={hp} target="_blank" rel="noopener noreferrer" className="text-cf-primary font-medium text-right hover:underline truncate">{ci.homepage}</a></div>)}
              </div>
              <p className="text-[10px] text-cf-text-secondary/50 mt-2">DART 전자공시 · 라이브</p>
            </div>
          );
        })()}
        {/* KR DART 재무 (SEC 미해당 KR 종목) — 2026-06-03: 4개 → 전체 DART 필드 + 2년 추이 */}
        {krAnnual?.revenueKRW != null && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-3">재무 (DART {krAnnual.fiscalYear})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">매출{krProfile?.revenueYoYPct != null ? ` (YoY ${krProfile.revenueYoYPct}%)` : ''}</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.revenueKRW)}</p></div>
              {krAnnual.operatingIncomeKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">영업이익{krAnnual.operatingMarginPct != null ? ` (${krAnnual.operatingMarginPct}%)` : ''}</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.operatingIncomeKRW)}</p></div>)}
              {krAnnual.netIncomeKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">순이익{krAnnual.netMarginPct != null ? ` (${krAnnual.netMarginPct}%)` : ''}</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.netIncomeKRW)}</p></div>)}
              {krAnnual.roePct != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">ROE</p><p className="text-sm font-bold">{krAnnual.roePct}%</p></div>)}
              {krAnnual.totalAssetsKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">총자산</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.totalAssetsKRW)}</p></div>)}
              {krAnnual.totalEquityKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">자본총계</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.totalEquityKRW)}</p></div>)}
              {krAnnual.totalLiabilitiesKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">부채총계</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.totalLiabilitiesKRW)}</p></div>)}
              {krAnnual.debtRatioPct != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">부채비율</p><p className="text-sm font-bold">{krAnnual.debtRatioPct}%</p></div>)}
              {krAnnual.operatingCFKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">영업현금흐름</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.operatingCFKRW)}</p></div>)}
              {krAnnual.capexKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">CAPEX(유형자산취득)</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.capexKRW)}</p></div>)}
              {krAnnual.freeCashFlowKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">잉여현금흐름(FCF)</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.freeCashFlowKRW)}</p></div>)}
              {krAnnual.dividendsPaidKRW != null && (<div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">배당지급</p><p className="text-sm font-bold">{fmtKRWc(krAnnual.dividendsPaidKRW)}</p></div>)}
            </div>
            {krAnnuals.length > 1 && (
              <div className="mt-3 flex items-end gap-2 text-[10px] text-cf-text-secondary">
                {[...krAnnuals].reverse().filter(a => a.revenueKRW != null).map((a) => (
                  <span key={a.fiscalYear} className="px-2 py-1 rounded bg-white/5">FY{a.fiscalYear}: {fmtKRWc(a.revenueKRW!)}</span>
                ))}
              </div>
            )}
            <p className="text-[10px] text-cf-text-secondary/50 mt-2">{krProfile?.source ?? 'DART 전자공시'} · FY{krAnnual.fiscalYear}</p>
          </div>
        )}
        {/* 매출 세그먼트 (사업보고서 부문별 — 큐레이션 사실) */}
        {krSC?.segments && krSC.segments.length > 0 && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-3">사업 부문별 매출</h2>
            <div className="space-y-2">
              {krSC.segments.map((seg) => (
                <div key={seg.name}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-cf-text-primary font-medium">{seg.name}</span>
                    <span className="text-cf-text-secondary tabular-nums">{seg.percentage}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-cf-primary/70" style={{ width: `${Math.min(100, seg.percentage)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-cf-text-secondary/50 mt-2">사업보고서 부문별 매출 비중 · 구조 데이터</p>
          </div>
        )}
        {/* 공급망 관계 (공급사/고객사/파트너/경쟁사 — 큐레이션 사실) */}
        {krSC?.relationships && krSC.relationships.length > 0 && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-3">{t('supplyChainRelationships')}</h2>
            <div className="space-y-3">
              {KR_REL_ORDER.filter(type => krSC.relationships.some(r => r.type === type)).map((type) => (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${KR_REL_STYLE[type]}`}>{KR_REL_LABEL[type]}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {krSC.relationships.filter(r => r.type === type).map((rel, i) => {
                      const inner = (
                        <>
                          <span className="text-xs font-medium text-cf-text-primary group-hover:text-cf-primary">{rel.targetName}{rel.targetTicker ? <span className="text-[10px] text-cf-text-secondary ml-1 font-mono">{rel.targetTicker.replace(/\.(KS|KQ)$/, '')}</span> : null}</span>
                          <span className="text-[10px] text-cf-text-secondary text-right">{rel.products.join(', ')}</span>
                        </>
                      );
                      return rel.targetTicker
                        ? <Link key={i} href={`/company/${rel.targetTicker}`} className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-white/5 transition-colors group">{inner}</Link>
                        : <div key={i} className="flex items-center justify-between gap-2 p-1.5 rounded">{inner}</div>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-cf-text-secondary/50 mt-2">주요 공급사·고객사·경쟁사 · 구조 데이터(공개 사실)</p>
          </div>
        )}
        {/* 90일 주가 차트 (KR Naver/US Yahoo) */}
        {priceHistory.length > 1 && (() => {
          const first = priceHistory[0].close;
          const last = priceHistory[priceHistory.length - 1].close;
          const pct90 = ((last - first) / first) * 100;
          const isUp = pct90 >= 0;
          const min = Math.min(...priceHistory.map(p => p.close));
          const max = Math.max(...priceHistory.map(p => p.close));
          const pad = (max - min) * 0.06;
          const sym = livePrice?.currency === 'KRW' ? '₩' : '$';
          return (
            <div className="cf-card p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-cf-text-primary">90일 주가</span>
                <span className={`text-xs font-bold tabular-nums ${isUp ? 'text-green-600' : 'text-red-600'}`}>{isUp ? '+' : ''}{pct90.toFixed(2)}% <span className="font-normal text-cf-text-secondary">(90d)</span></span>
              </div>
              <div className="h-16">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={priceHistory} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <YAxis domain={[min - pad, max + pad]} hide />
                    <Line type="monotone" dataKey="close" dot={false} strokeWidth={1.5} stroke={isUp ? '#16a34a' : '#dc2626'} />
                    <Tooltip formatter={(v) => [`${sym}${Number(v).toLocaleString()}`, '']} labelFormatter={(l) => String(l)} contentStyle={{ fontSize: '11px', padding: '4px 8px' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()}
        {/* 애널리스트 목표가 (KR 목표가 존재 — 등급분포는 Yahoo 미제공) */}
        {analystData && analystData.targetMean != null && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-3">애널리스트 목표가</h2>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-cf-text-secondary">평균 목표가</span>
              <span className="text-lg font-extrabold text-cf-text-primary">{livePrice?.currency === 'KRW' ? fmtKRW(analystData.targetMean) : `$${analystData.targetMean.toFixed(2)}`}</span>
            </div>
            {livePrice?.price != null && (() => {
              const upside = ((analystData.targetMean! - livePrice.price) / livePrice.price) * 100;
              return (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-cf-text-secondary">상승여력</span>
                  <span className={`font-semibold ${upside >= 0 ? 'text-green-600' : 'text-red-600'}`}>{upside >= 0 ? '+' : ''}{upside.toFixed(1)}%</span>
                </div>
              );
            })()}
            {analystData.targetLow != null && analystData.targetHigh != null && (
              <div className="flex items-center justify-between text-xs text-cf-text-secondary mt-1">
                <span>{livePrice?.currency === 'KRW' ? `${fmtKRW(analystData.targetLow)} — ${fmtKRW(analystData.targetHigh)}` : `$${analystData.targetLow.toFixed(0)} — $${analystData.targetHigh.toFixed(0)}`}</span>
                <span className="opacity-60">범위</span>
              </div>
            )}
          </div>
        )}
        {/* 관련 종목 (peer) */}
        {recs.length > 0 && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-3">관련 종목</h2>
            <div className="space-y-1">
              {recs.slice(0, 6).map((rec) => (
                <Link key={rec.symbol} href={`/company/${rec.symbol}`} className="flex items-center justify-between p-1.5 rounded hover:bg-white/5 transition-colors group">
                  <span className="text-xs font-mono font-bold text-cf-text-primary group-hover:text-cf-primary">{rec.symbol}</span>
                  {rec.changePct != null && (<span className={`text-[11px] font-semibold ${rec.changePct >= 0 ? 'text-green-600' : 'text-red-600'}`}>{rec.changePct >= 0 ? '+' : ''}{rec.changePct.toFixed(2)}%</span>)}
                </Link>
              ))}
            </div>
          </div>
        )}
        {/* Live financials if available */}
        {liveFinancials?.revenueFormatted && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-3">재무 심화 — {liveFinancials.fiscalYear}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {liveFinancials.latestAnnual?.revenueUSD != null && (
                <div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">매출</p><p className="text-sm font-bold">{liveFinancials.revenueFormatted}</p></div>
              )}
              {liveFinancials.latestAnnual?.netIncomeUSD != null && (
                <div className="cf-card p-3"><p className="text-[10px] text-cf-text-secondary">순이익</p><p className="text-sm font-bold">${(liveFinancials.latestAnnual.netIncomeUSD / 1e6).toFixed(0)}M</p></div>
              )}
            </div>
            <p className="text-[10px] text-cf-text-secondary/50 mt-2">{liveFinancials.source} · {liveFinancials.periodEnd}</p>
          </div>
        )}
        {/* News if available */}
        {companyNews && companyNews.news.length > 0 && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-3">최신 뉴스</h2>
            <div className="space-y-2">
              {companyNews.news.slice(0, 5).map((n, i) =>
                n.link
                  ? <a key={i} href={n.link} target="_blank" rel="noopener noreferrer" className="block text-xs text-cf-text-primary hover:text-cf-accent truncate">{n.title}</a>
                  : <span key={i} className="block text-xs text-cf-text-secondary truncate">{n.title}</span>
              )}
            </div>
          </div>
        )}
        {/* Institutional signals */}
        {signals.length > 0 && (
          <div className="cf-card p-4 mb-4">
            <h2 className="text-sm font-bold text-cf-text-primary mb-3">기관 시그널</h2>
            <div className="space-y-1">
              {signals.slice(0, 5).map((s, i) => (
                <p key={i} className="text-xs text-cf-text-secondary">{s?.institution ?? "—"} · {s?.action ?? "—"} · {s?.estimatedValue ?? "—"}</p>
              ))}
            </div>
          </div>
        )}
        <div className="text-center mt-8">
          <Link href="/explore" className="cf-btn-secondary text-sm px-4 py-2">
            {t('backToExplorer')}
          </Link>
        </div>
      </div>
    );
  }

  const pieData = company.revenue.segments.map((s) => ({
    name: s.name,
    value: s.percentage,
  }));

  const productBarData = company.products.map((p) => ({
    name: p.name.length > 15 ? p.name.slice(0, 15) + '...' : p.name,
    share: p.revenueShare,
  }));

  const groupedRelationships = company.relationships.reduce(
    (acc, rel) => {
      if (!acc[rel.type]) acc[rel.type] = [];
      acc[rel.type].push(rel);
      return acc;
    },
    {} as Record<string, typeof company.relationships>
  );

  const getAiAnalysis = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Analyze ${company.name} (${company.ticker}) in the context of its supply chain position. Company sector: ${company.sector}. Key products: ${company.products.map((p) => p.name).join(', ')}. Key relationships: ${company.relationships.slice(0, 5).map((r) => `${r.type}: ${r.targetId}`).join(', ')}. Provide a concise investment-relevant analysis.`,
          type: 'company_analysis',
          ticker: company.ticker,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAiAnalysis(data.analysis);
    } catch {
      setAiAnalysis('AI analysis is currently unavailable. Please try again later.');
    }
    setAiLoading(false);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs overrides={{ [company.ticker]: { label: company.name } }} />

      {/* Back */}
      <Link
        href="/explore"
        className="inline-flex items-center gap-2 text-sm text-cf-text-secondary hover:text-cf-primary transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('backToExplorer')}
      </Link>

      {/* Header — always visible */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h1 className="text-3xl font-heading font-bold text-cf-text-primary">
            {company.name}
          </h1>
          <span className="font-mono text-sm font-bold bg-cf-primary/10 text-cf-primary px-3 py-1 rounded-lg">
            {company.ticker}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-cf-text-secondary capitalize">
            {company.role}
          </span>
          {livePrice?.price != null && (
            <div className="ml-1">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold tabular-nums text-cf-text-primary">
                  {livePrice.currency === 'USD' ? '$' : ''}{livePrice.price.toFixed(2)}
                </span>
                {livePrice.changePct != null && (
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full tabular-nums ${
                    livePrice.changePct >= 0
                      ? 'text-green-700 bg-green-50'
                      : 'text-red-600 bg-red-50'
                  }`}>
                    {livePrice.changePct >= 0 ? '+' : ''}{livePrice.changePct.toFixed(2)}%
                  </span>
                )}
                {livePrice.marketState && livePrice.marketState !== 'REGULAR' && (
                  <span className="text-[10px] text-cf-text-secondary/60 font-medium">
                    {livePrice.marketState === 'PRE' ? t('preMarket') : livePrice.marketState === 'POST' ? t('postMarket') : livePrice.marketState}
                  </span>
                )}
                {liveMarketCap != null && (
                  <span className="text-xs text-cf-text-secondary font-medium ml-1">
                    {t('marketCap', { val: fmtUsd(liveMarketCap) })}
                  </span>
                )}
              </div>
              {(livePrice.volume != null || livePrice.dayHigh != null) && (
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-cf-text-secondary font-mono">
                  {livePrice.volume != null && (
                    <span>{t('volume')}: {fmtVol(livePrice.volume)}</span>
                  )}
                  {livePrice.dayHigh != null && livePrice.dayLow != null && (
                    <span>{t('dayRange')}: {livePrice.dayLow.toFixed(2)} – {livePrice.dayHigh.toFixed(2)}</span>
                  )}
                  {livePrice.week52High != null && livePrice.week52Low != null && (
                    <span>{t('week52Range')}: {livePrice.week52Low.toFixed(2)} – {livePrice.week52High.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="text-cf-text-secondary leading-relaxed mb-4"><T text={company.description} /></p>
        <div className="flex items-center gap-3 flex-wrap">
          <ShareButtons title={`${company.name} (${company.ticker}) - Supply Chain Analysis | Flowvium`} />
          <Link
            href={`/compare/${company.ticker.toLowerCase()}-vs-nvda`}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border border-cf-border hover:border-cf-primary hover:text-cf-primary transition-colors text-cf-text-secondary"
          >
            <span>⇄</span> Compare
          </Link>
          <button
            onClick={() => setTerminalView((v) => !v)}
            className={`inline-flex items-center gap-2 text-xs font-mono font-bold px-3 py-1.5 rounded transition-colors ${
              terminalView
                ? 'bg-amber-500 text-black hover:bg-amber-400'
                : 'bg-gray-800 text-amber-400 hover:bg-gray-700 border border-gray-600'
            }`}
          >
            <span className="text-[10px]">▣</span>
            {terminalView ? t('standardView') : t('terminalView')}
          </button>
        </div>
      </div>

      {/* 90-day stock price chart */}
      {priceHistory.length > 1 && (() => {
        const first = priceHistory[0].close;
        const last = priceHistory[priceHistory.length - 1].close;
        const pct90 = ((last - first) / first) * 100;
        const isUp = pct90 >= 0;
        const min = Math.min(...priceHistory.map(p => p.close));
        const max = Math.max(...priceHistory.map(p => p.close));
        const pad = (max - min) * 0.06;
        return (
          <div className="cf-card p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-cf-text-secondary">{t('priceChart90d')}</span>
              <span className={`text-xs font-bold tabular-nums ${isUp ? 'text-green-600' : 'text-red-600'}`}>
                {isUp ? '+' : ''}{pct90.toFixed(2)}% <span className="font-normal text-cf-text-secondary">(90d)</span>
              </span>
            </div>
            <div className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={priceHistory} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                  <YAxis domain={[min - pad, max + pad]} hide />
                  <Line
                    type="monotone" dataKey="close" dot={false} strokeWidth={1.5}
                    stroke={isUp ? '#16a34a' : '#dc2626'}
                  />
                  <Tooltip
                    formatter={(v) => {
                      const cur = livePrice?.currency;
                      const sym = cur === 'USD' ? '$' : cur === 'KRW' ? '₩' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'JPY' ? '¥' : cur ? cur + ' ' : '$';
                      return [`${sym}${Number(v).toFixed(2)}`, ''];
                    }}
                    labelFormatter={(l) => String(l)}
                    contentStyle={{ fontSize: '11px', padding: '4px 8px' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-cf-text-secondary mt-1">{t('priceChartSource')}</p>
          </div>
        );
      })()}

      {terminalView ? (
        <SupplyChainMap company={company} />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Products & Revenue */}
          <div className="cf-card p-6">
            <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-6">
              {t('productsAndRevenue')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Products bar chart */}
              <div>
                <h3 className="text-sm font-bold text-cf-text-primary mb-3">
                  {t('productRevenueShare')}
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={productBarData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip formatter={(v) => `${v}%`} />
                      <Bar dataKey="share" fill="#4F8FBF" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Revenue pie */}
              <div>
                <h3 className="text-sm font-bold text-cf-text-primary mb-1">
                  {t('revenueBreakdown')} ({liveFinancials?.revenueFormatted ?? company.revenue.total})
                </h3>
                {liveFinancials ? (
                  <p className="text-[10px] text-emerald-600 mb-3 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    FY{liveFinancials.fiscalYear} · {liveFinancials.periodEnd} · {liveFinancials.source}
                  </p>
                ) : (
                  <p className="text-[10px] text-cf-text-secondary/60 mb-3">{t('staticDataFinancials')}</p>
                )}
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        dataKey="value"
                        paddingAngle={2}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => `${v}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-1 mt-2">
                  {pieData.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-1.5 text-xs">
                      <div
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="text-cf-text-secondary truncate">
                        {item.name} ({item.value}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Revenue segments table with customer breakdown */}
            <div className="mt-6 space-y-2">
              <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
                <Users2 className="w-4 h-4 text-cf-primary" />
                {t('segmentCompositionAndCustomers')}
              </h3>
              {company.revenue.segments.map((s, idx) => (
                <SegmentRow key={s.name} seg={s} idx={idx} topCustomersLabel={t('topCustomers')} liveRevenueUSD={liveFinancials?.latestAnnual?.revenueUSD} />
              ))}
            </div>

            {/* Product descriptions */}
            <div className="mt-6">
              <h3 className="text-sm font-bold text-cf-text-primary mb-3">{t('productDetails')}</h3>
              <div className="space-y-2">
                {company.products.map((p, i) => (
                  <div key={i} className="rounded-lg bg-gray-50 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-cf-text-primary">{p.name}</span>
                      <span className="text-xs font-bold text-cf-primary bg-blue-50 px-2 py-0.5 rounded-full">{p.revenueShare}%</span>
                    </div>
                    <p className="text-xs text-cf-text-secondary leading-relaxed">{p.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── 재무 심화 (SEC EDGAR XBRL) ── */}
          {liveFinancials && liveFinancials.latestAnnual && (
            <div className="cf-card p-6">
              <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
                <h2 className="text-xl font-heading font-bold text-cf-text-primary flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                  {t('financialsDeep')} — FY{liveFinancials.fiscalYear}
                </h2>
                <span className="text-[10px] text-emerald-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {liveFinancials.source} · {liveFinancials.periodEnd}
                </span>
              </div>

              {/* Key metrics grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                {[
                  { label: t('finRevenue'), val: fmtUsd(liveFinancials.latestAnnual.revenueUSD) },
                  { label: t('finOperatingIncome'), val: fmtUsd(liveFinancials.latestAnnual.operatingIncomeUSD) },
                  { label: t('finNetIncome'), val: fmtUsd(liveFinancials.latestAnnual.netIncomeUSD) },
                  { label: t('finEpsDiluted'), val: liveFinancials.latestAnnual.epsDiluted != null ? `$${liveFinancials.latestAnnual.epsDiluted.toFixed(2)}` : '-' },
                  { label: t('finOperatingMargin'), val: liveFinancials.latestAnnual.operatingMarginPct != null ? `${liveFinancials.latestAnnual.operatingMarginPct}%` : '-' },
                  { label: t('finRoe'), val: liveFinancials.latestAnnual.roePct != null ? `${liveFinancials.latestAnnual.roePct}%` : '-' },
                  { label: t('finRoa'), val: liveFinancials.latestAnnual.roaPct != null ? `${liveFinancials.latestAnnual.roaPct}%` : '-' },
                  { label: t('finDebtRatio'), val: liveFinancials.latestAnnual.debtRatioPct != null ? `${liveFinancials.latestAnnual.debtRatioPct}%` : '-' },
                ].map(m => (
                  <div key={m.label} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-cf-text-secondary mb-0.5">{m.label}</p>
                    <p className="text-sm font-bold text-cf-text-primary">{m.val}</p>
                  </div>
                ))}
              </div>

              {/* Revenue trend chart */}
              {liveFinancials.annuals.length > 1 && (
                <div className="mb-5">
                  <p className="text-xs font-bold text-cf-text-secondary mb-2">{t('revenueTrendAnnual')}</p>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[...liveFinancials.annuals].reverse().map(a => ({
                        fy: `FY${a.fy}`,
                        rev: a.revenueUSD != null ? parseFloat((a.revenueUSD / 1e9).toFixed(1)) : null,
                        net: a.netIncomeUSD != null ? parseFloat((a.netIncomeUSD / 1e9).toFixed(1)) : null,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="fy" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} unit="B" />
                        <Tooltip formatter={(v) => `$${v}B`} />
                        <Bar dataKey="rev" name={t('finRevenue')} fill="#4F8FBF" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="net" name={t('finNetIncome')} fill="#5CB88A" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Quarterly revenue Y/Y growth */}
              {liveFinancials.quarterlyRevenue.length > 1 && (
                <div className="mb-5">
                  <p className="text-xs font-bold text-cf-text-secondary mb-2">{t('revenueTrendQuarterly')}</p>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={[...liveFinancials.quarterlyRevenue].reverse().map(q => ({
                        quarter: q.label,
                        rev: q.revenueUSD != null ? parseFloat((q.revenueUSD / 1e9).toFixed(1)) : null,
                        yoy: q.yoyPct,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="quarter" tick={{ fontSize: 9 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 9 }} unit="B" width={32} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} unit="%" width={35} />
                        <Tooltip formatter={(v, name) => name === 'Y/Y%' ? `${v}%` : `$${v}B`} />
                        <Bar yAxisId="left" dataKey="rev" name={t('finRevenue')} fill="#4F8FBF" radius={[2, 2, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="yoy" name="Y/Y%" stroke="#E8A945" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Balance sheet + Cash flows + Other */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] font-bold text-cf-text-secondary uppercase tracking-wider mb-2">{t('balanceSheet')}</p>
                  <div className="space-y-1.5">
                    {[
                      { label: t('totalAssets'), val: fmtUsd(liveFinancials.latestAnnual.totalAssetsUSD) },
                      { label: t('totalLiabilities'), val: fmtUsd(liveFinancials.latestAnnual.totalLiabilitiesUSD) },
                      { label: t('equity'), val: fmtUsd(liveFinancials.latestAnnual.equityUSD) },
                    ].map(m => (
                      <div key={m.label} className="flex justify-between text-xs">
                        <span className="text-cf-text-secondary">{m.label}</span>
                        <span className="font-medium text-cf-text-primary">{m.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-cf-text-secondary uppercase tracking-wider mb-2">{t('cashFlows')}</p>
                  <div className="space-y-1.5">
                    {[
                      { label: t('operatingCF'), val: fmtUsd(liveFinancials.latestAnnual.operatingCFUSD) },
                      { label: t('investingCF'), val: fmtUsd(liveFinancials.latestAnnual.investingCFUSD) },
                      { label: t('financingCF'), val: fmtUsd(liveFinancials.latestAnnual.financingCFUSD) },
                    ].map(m => (
                      <div key={m.label} className="flex justify-between text-xs">
                        <span className="text-cf-text-secondary">{m.label}</span>
                        <span className="font-medium text-cf-text-primary">{m.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-cf-text-secondary uppercase tracking-wider mb-2">{t('investShareholder')}</p>
                  <div className="space-y-1.5">
                    {[
                      { label: 'R&D', val: fmtUsd(liveFinancials.latestAnnual.rdExpenseUSD) },
                      { label: 'CapEx', val: fmtUsd(liveFinancials.latestAnnual.capexUSD) },
                      { label: t('buybacks'), val: fmtUsd(liveFinancials.latestAnnual.buybacksUSD) },
                      { label: t('dividends'), val: fmtUsd(liveFinancials.latestAnnual.dividendsUSD) },
                    ].map(m => (
                      <div key={m.label} className="flex justify-between text-xs">
                        <span className="text-cf-text-secondary">{m.label}</span>
                        <span className="font-medium text-cf-text-primary">{m.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-cf-text-secondary/50 mt-4">{t('financialsSource')}</p>
            </div>
          )}

          {/* R&D Pipeline */}
          {effectiveRdPipeline && effectiveRdPipeline.length > 0 && (
            <div className="cf-card p-6">
              <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-6 flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-purple-500" />
                {t('rdPipeline')}
              </h2>
              <div className="space-y-3">
                {effectiveRdPipeline!.map((item, i) => {
                  const stageColors: Record<string, string> = {
                    research: 'bg-purple-50 border-purple-200 text-purple-700',
                    development: 'bg-blue-50 border-blue-200 text-blue-700',
                    validation: 'bg-amber-50 border-amber-200 text-amber-700',
                    commercial: 'bg-green-50 border-green-200 text-green-700',
                  };
                  const stageKey = `rdStage${item.stage.charAt(0).toUpperCase()}${item.stage.slice(1)}` as
                    'rdStageResearch' | 'rdStageDevelopment' | 'rdStageValidation' | 'rdStageCommercial';
                  return (
                    <div key={i} className="border border-cf-border rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${stageColors[item.stage]}`}>
                            {t(stageKey)}
                          </span>
                          <span className="text-sm font-medium text-cf-text-primary">{item.name}</span>
                        </div>
                        {item.targetDate && (
                          <span className="text-xs text-cf-text-secondary whitespace-nowrap flex-shrink-0">{item.targetDate}</span>
                        )}
                      </div>
                      <p className="text-xs text-cf-text-secondary leading-relaxed">{item.description}</p>
                      {item.budget && (
                        <p className="text-xs mt-1.5 text-cf-primary font-medium">{t('budget')}: {item.budget}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Supply Chain Relationships */}
          <div className="cf-card p-6">
            <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-6">
              {t('supplyChainRelationships')}
            </h2>
            {Object.entries(groupedRelationships).map(([type, rels]) => (
              <div key={type} className="mb-6 last:mb-0">
                <h3
                  className="text-sm font-bold capitalize mb-3 flex items-center gap-2"
                  style={{ color: relationshipColors[type] }}
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: relationshipColors[type] }}
                  />
                  {type === 'supplier'
                    ? t('suppliers')
                    : type === 'customer'
                    ? t('customers')
                    : type === 'competitor'
                    ? t('competitors')
                    : t('partners')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {rels.map((rel, i) => {
                    const target = allCompanies.find(
                      (c) => c.id === rel.targetId || c.ticker === rel.targetId
                    );
                    return (
                      <Link
                        key={i}
                        href={`/company/${target?.ticker || rel.targetId}`}
                        className="p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-cf-text-primary text-sm group-hover:text-cf-primary transition-colors">
                            {target?.name || rel.targetId}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-cf-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-xs text-cf-text-secondary">
                          {rel.products.join(', ')}
                        </p>
                        {rel.revenueImpact && (
                          <p className="text-xs mt-1 text-cf-primary font-medium">
                            {t('impact')}: {rel.revenueImpact}
                          </p>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Macro & Market Context */}
          {(() => {
            const sc = sectorContextMap[company.sector];
            const mi = effectiveMacroImpact;
            if (!sc && !mi) return null;
            return (
              <div className="cf-card p-6">
                <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-5 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-cf-primary" />
                  {t('macroAndMarketContext')}
                </h2>
                {/* Sector phase */}
                {sc && (
                  <div className="bg-cf-primary/5 rounded-lg px-4 py-3 mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-cf-primary uppercase tracking-wide">{sc.name}</span>
                      <a href={sc.googleNewsUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-cf-primary hover:underline flex items-center gap-1">
                        {t('sectorNews')} <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <p className="text-sm text-cf-primary font-medium leading-relaxed">{sc.phase}</p>
                  </div>
                )}
                {/* Key data grid */}
                {sc && sc.keyData.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                    {sc.keyData.map((kd) => {
                      const liveVal = liveMetrics ? getLiveValue(kd.label, liveMetrics) : null;
                      const displayValue = liveVal != null ? formatLiveValue(kd.label, liveVal) : kd.value;
                      return (
                      <div key={kd.label} className="bg-gray-50 rounded-lg p-2.5">
                        <p className="text-[10px] text-cf-text-secondary mb-0.5">{kd.label}</p>
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-sm font-bold text-cf-text-primary">{displayValue}</span>
                          {kd.trend === 'up' && <TrendingUp className="w-3 h-3 text-green-500" />}
                          {kd.trend === 'down' && <TrendingDown className="w-3 h-3 text-red-500" />}
                          {kd.trend === 'neutral' && <Minus className="w-3 h-3 text-gray-400" />}
                          {liveVal != null && <span style={{color:'#22c55e',fontSize:'0.7em',fontWeight:600}}>● live</span>}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
                {/* Company-specific macro impact */}
                {mi && (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider mb-1">{t('macroSummary')}</p>
                      <p className="text-sm text-cf-text-secondary leading-relaxed">{mi.summary}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          {t('macroTailwinds', { company: company.ticker })}
                        </p>
                        <ul className="space-y-1.5">
                          {mi.tailwinds.map((tw, i) => (
                            <li key={i} className="text-xs text-cf-text-secondary flex items-start gap-1.5 leading-relaxed">
                              <span className="text-green-500 mt-0.5 flex-shrink-0">▲</span>
                              {tw}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <ArrowDownRight className="w-3.5 h-3.5" />
                          {t('macroHeadwinds', { company: company.ticker })}
                        </p>
                        <ul className="space-y-1.5">
                          {mi.headwinds.map((hw, i) => (
                            <li key={i} className="text-xs text-cf-text-secondary flex items-start gap-1.5 leading-relaxed">
                              <span className="text-red-400 mt-0.5 flex-shrink-0">▼</span>
                              {hw}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
                {/* Next catalysts */}
                {sc && sc.nextCatalysts.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-cf-border">
                    <p className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider mb-2">{t('nextCatalysts')}</p>
                    <div className="flex flex-wrap gap-2">
                      {sc.nextCatalysts.map((cat, i) => (
                        <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full flex items-center gap-1">
                          <span className="text-amber-500">◆</span>
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Supply Chain Issues */}
          {(() => {
            const updates = companySupplyChainUpdates[company.ticker];
            if (!updates || updates.length === 0) return null;
            return (
              <div className="cf-card p-6">
                <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-5 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-cf-accent" />
                  {t('supplyChainIssues')}
                </h2>
                <div className="space-y-3">
                  {updates.map((upd: SupplyChainUpdate, i: number) => (
                    <div key={i} className={`border-l-4 rounded-r-lg p-4 ${impactColors[upd.impact]}`}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${updateTypeColors[upd.type]}`}>
                            {typeLabels[upd.type]}
                          </span>
                          <span className="text-xs font-bold text-cf-text-primary">{upd.title}</span>
                        </div>
                        <span className="text-xs text-cf-text-secondary whitespace-nowrap flex-shrink-0">{upd.date}</span>
                      </div>
                      <p className="text-sm text-cf-text-secondary leading-relaxed">{upd.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Institutional Signals */}
          {signals.length > 0 && (
            <div className="cf-card p-6">
              <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-6">
                {t('institutionalSignals')}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-cf-border">
                      <th className="text-left py-2 text-cf-text-secondary font-medium">{t('institution')}</th>
                      <th className="text-left py-2 text-cf-text-secondary font-medium">{t('action')}</th>
                      <th className="text-right py-2 text-cf-text-secondary font-medium">{t('value')}</th>
                      <th className="text-right py-2 text-cf-text-secondary font-medium">{t('quarter')}</th>
                      <th className="text-right py-2 text-cf-text-secondary font-medium">{t('filingDate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signals.map((sig) => (
                      <tr key={sig.id} className="border-b border-cf-border/50">
                        <td className="py-2.5 text-cf-text-primary font-medium">{sig.institution}</td>
                        <td className="py-2.5">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${actionColors[sig.action]}`}>
                            {actionIcons[sig.action]}
                            {sig.action.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="text-right py-2.5 text-cf-text-primary font-medium">{sig.estimatedValue}</td>
                        <td className="text-right py-2.5 text-cf-text-secondary text-xs">
                          {sig.quarterEnd.slice(0, 7).replace('-', '.').replace('-', '.')}
                        </td>
                        <td className="text-right py-2.5 text-cf-text-secondary text-xs whitespace-nowrap">
                          {sig.filingDate}
                          {(sig.action === 'accumulating' || sig.action === 'new_position') && <span className="ml-1 text-green-600 font-bold">↑</span>}
                          {(sig.action === 'reducing' || sig.action === 'exit') && <span className="ml-1 text-red-500 font-bold">↓</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 지분율 변화 (13F Ownership) */}
          {(() => {
            const ownershipEntry = newsGapData.find(n => n.ticker === company.ticker);
            if (!ownershipEntry?.ownershipData?.length) return null;
            const owned = ownershipEntry.ownershipData;
            const actionColor: Record<string, string> = {
              new: 'bg-blue-50 text-blue-700 border border-blue-200',
              increased: 'bg-green-50 text-green-700 border border-green-200',
              maintained: 'bg-gray-50 text-gray-600 border border-gray-200',
              reduced: 'bg-red-50 text-red-600 border border-red-200',
            };
            const actionLabel: Record<string, string> = {
              new: t('actionNew'),
              increased: t('actionIncreased'),
              maintained: t('actionMaintained'),
              reduced: t('actionReduced'),
            };
            return (
              <div className="cf-card p-6">
                <div className="flex items-center gap-2 mb-5">
                  <Users2 className="w-5 h-5 text-cf-primary" />
                  <h2 className="text-xl font-heading font-bold text-cf-text-primary">{t('ownershipStatus')}</h2>
                  <span className="text-xs text-cf-text-secondary ml-1">{t('ownershipAs13f')} · {owned[0]?.quarter}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-cf-border bg-gray-50">
                        <th className="text-left py-2 px-3 text-cf-text-secondary font-medium text-xs">{t('institution')}</th>
                        <th className="text-center py-2 px-3 text-cf-text-secondary font-medium text-xs">{t('ownershipChange')}</th>
                        <th className="text-right py-2 px-3 text-cf-text-secondary font-medium text-xs">{t('ownershipPct')}</th>
                        <th className="text-right py-2 px-3 text-cf-text-secondary font-medium text-xs">{t('ownershipPrevPct')}</th>
                        <th className="text-right py-2 px-3 text-cf-text-secondary font-medium text-xs">{t('ownershipShares')}</th>
                        <th className="text-right py-2 px-3 text-cf-text-secondary font-medium text-xs">{t('ownershipValue')}</th>
                        <th className="text-center py-2 px-3 text-cf-text-secondary font-medium text-xs">SEC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {owned.map((o, i) => {
                        const diff = o.prevPct !== undefined ? o.pctOfShares - o.prevPct : null;
                        return (
                          <tr key={i} className="border-b border-cf-border/50 hover:bg-gray-50 transition-colors">
                            <td className="py-2.5 px-3 font-medium text-cf-text-primary">{o.institution}</td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${actionColor[o.action]}`}>
                                {actionLabel[o.action]}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold tabular-nums">
                              <span className={o.action === 'increased' || o.action === 'new' ? 'text-green-600' : o.action === 'reduced' ? 'text-red-500' : 'text-cf-text-primary'}>
                                {o.pctOfShares.toFixed(2)}%
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right text-xs tabular-nums text-cf-text-secondary">
                              {o.prevPct !== undefined ? (
                                <span className="flex items-center justify-end gap-1">
                                  {o.prevPct.toFixed(2)}%
                                  {diff !== null && diff !== 0 && (
                                    <span className={`font-bold ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                      {diff > 0 ? '+' : ''}{diff.toFixed(2)}%p
                                    </span>
                                  )}
                                </span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="py-2.5 px-3 text-right text-xs tabular-nums text-cf-text-secondary">
                              {o.sharesM !== undefined ? t('sharesUnit', { n: o.sharesM.toFixed(1) }) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-xs font-medium text-cf-text-primary">
                              ${o.valueM.toLocaleString()}M
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <a href={o.secUrl} target="_blank" rel="noopener noreferrer"
                                className="text-[10px] text-cf-primary hover:underline flex items-center justify-center gap-0.5">
                                <ExternalLink className="w-3 h-3" />
                                13F
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Total institutional ownership */}
                {(() => {
                  const total = owned.reduce((s, o) => s + o.pctOfShares, 0);
                  const totalVal = owned.reduce((s, o) => s + o.valueM, 0);
                  return (
                    <div className="mt-3 pt-3 border-t border-cf-border flex items-center gap-4 flex-wrap text-xs text-cf-text-secondary">
                      <span>{t('ownershipTotalPct')}: <span className="font-bold text-cf-text-primary">{total.toFixed(2)}%</span></span>
                      <span>{t('ownershipTotalValue')}: <span className="font-bold text-cf-text-primary">${totalVal.toLocaleString()}M</span></span>
                      <span className="ml-auto">{t('ownershipBasis')}</span>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* Latest News + AI Summary */}
          <div className="cf-card p-6">
            <h2 className="text-xl font-heading font-bold text-cf-text-primary flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-cf-accent" />
              {t('latestNews')}
            </h2>
            {newsLoading ? (
              <div className="flex items-center gap-2 text-cf-text-secondary py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">{t('loadingNews')}</span>
              </div>
            ) : !companyNews ? (
              <p className="text-sm text-cf-text-secondary">{t('noNews')}</p>
            ) : (
              <div className="space-y-4">
                {companyNews.summary && (
                  <div className="bg-cf-primary/5 border border-cf-primary/20 rounded-lg p-4">
                    <p className="text-[10px] font-bold text-cf-primary uppercase tracking-wide mb-1.5">{t('newsAiSummary')}</p>
                    <p className="text-sm text-cf-text-primary leading-relaxed">{companyNews.summary}</p>
                  </div>
                )}
                <div className="space-y-2">
                  {companyNews.news.slice(0, 5).map((item, i) => (
                    <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                      className="block p-3 rounded-lg hover:bg-white/5 transition-colors group border border-transparent hover:border-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-cf-text-primary leading-snug group-hover:text-cf-primary transition-colors line-clamp-2">{item.title}</p>
                          {item.description && (
                            <p className="text-xs text-cf-text-secondary mt-0.5 line-clamp-1">{item.description}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-cf-text-secondary/60 flex-shrink-0 whitespace-nowrap">{item.source}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI Analysis */}
          <div className="cf-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-heading font-bold text-cf-text-primary flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-cf-accent" />
                {t('aiAnalysis')}
              </h2>
              <button
                onClick={getAiAnalysis}
                disabled={aiLoading}
                className="cf-btn-primary gap-2 text-sm"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('analyzing')}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {t('getAiAnalysis')}
                  </>
                )}
              </button>
            </div>
            {aiAnalysis ? (
              <div className="text-sm text-cf-text-secondary leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-4">
                {aiAnalysis}
              </div>
            ) : (
              <p className="text-sm text-cf-text-secondary">
                {t('aiPrompt', { company: company.name })}
              </p>
            )}
          </div>

          {/* Related Macro Themes */}
          {(() => {
            const narratives = getNarrativesByTicker(company.ticker);
            if (narratives.length === 0) return null;
            return (
              <div className="cf-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-heading font-bold text-cf-text-primary flex items-center gap-2">
                    <Brain className="w-5 h-5 text-cf-primary" />
                    {t('relatedMacroThemes')}
                  </h2>
                  <Link href="/intelligence" className="text-xs text-cf-primary hover:underline flex items-center gap-1">
                    {t('viewAllThemes')} <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="space-y-3">
                  {narratives.map((n) => (
                    <div key={n.id} className={`rounded-lg border p-4 ${n.color.split(' ').filter(c => c.startsWith('bg') || c.startsWith('border')).join(' ')}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-cf-text-primary">{n.title}</p>
                          <p className="text-xs text-cf-text-secondary mt-0.5 leading-relaxed">{n.summary}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {n.keyConceptsEn.slice(0, 3).map((kc) => (
                              <span key={kc} className="text-[10px] bg-white/80 border border-current/20 text-cf-text-secondary px-1.5 py-0.5 rounded">{kc}</span>
                            ))}
                          </div>
                        </div>
                        {n.blogSlug && (
                          <Link
                            href={`/blog/${n.blogSlug}`}
                            className="flex-shrink-0 text-xs font-medium text-cf-primary hover:underline whitespace-nowrap flex items-center gap-1 mt-0.5"
                          >
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Company Info */}
          <div className="cf-card p-6">
            <h3 className="text-lg font-heading font-bold text-cf-text-primary mb-4">
              {t('companyInfo')}
            </h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Building2 className="w-4 h-4 text-cf-text-secondary mt-0.5" />
                <div>
                  <p className="text-xs text-cf-text-secondary">{t('headquarters')}</p>
                  <p className="text-sm text-cf-text-primary">{company.headquarters}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-cf-text-secondary mt-0.5" />
                <div>
                  <p className="text-xs text-cf-text-secondary">{t('founded')}</p>
                  <p className="text-sm text-cf-text-primary">{company.founded}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Users className="w-4 h-4 text-cf-text-secondary mt-0.5" />
                <div>
                  <p className="text-xs text-cf-text-secondary">{t('employees')}</p>
                  <p className="text-sm text-cf-text-primary">
                    {liveEmployees ?? company.employees}
                    {liveEmployees && <span className="text-[10px] text-emerald-500 ml-1">live</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Globe className="w-4 h-4 text-cf-text-secondary mt-0.5" />
                <div>
                  <p className="text-xs text-cf-text-secondary">{t('website')}</p>
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-cf-primary hover:underline flex items-center gap-1"
                  >
                    {company.website.replace('https://', '').replace('www.', '')}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* News Gap */}
          {newsGap && (
            <div className="cf-card p-6">
              <h3 className="text-lg font-heading font-bold text-cf-text-primary mb-4 flex items-center gap-2">
                <Gauge className="w-5 h-5" />
                {t('newsGapScore')}
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-cf-text-secondary">{t('gapScore')}</span>
                    <span
                      className={`text-lg font-bold ${
                        newsGap.gapScore >= 70
                          ? 'text-cf-accent'
                          : newsGap.gapScore >= 40
                          ? 'text-cf-primary'
                          : 'text-cf-success'
                      }`}
                    >
                      {newsGap.gapScore}
                    </span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${newsGap.gapScore}%`,
                        background:
                          newsGap.gapScore >= 70
                            ? 'linear-gradient(90deg, #E8A945, #D97171)'
                            : newsGap.gapScore >= 40
                            ? 'linear-gradient(90deg, #4F8FBF, #6CB4A8)'
                            : '#5CB88A',
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-cf-text-secondary mt-1">
                    <span>{t('lowGap')}</span>
                    <span>{t('highGap')}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-cf-text-secondary">{t('ibActivity')}</p>
                    <p className="text-lg font-bold text-cf-primary">
                      {newsGap.ibActivityScore}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-cf-text-secondary">{t('mediaScore')}</p>
                    <p className="text-lg font-bold text-cf-text-primary">
                      {newsGap.mediaScore}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Cascade Position */}
          {cascadePosition && (
            <div className="cf-card p-6">
              <h3 className="text-lg font-heading font-bold text-cf-text-primary mb-4">
                {t('cascadePosition')}
              </h3>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-cf-text-secondary mb-1">{t('roleInCascade')}</p>
                  <p className="text-sm font-medium text-cf-text-primary capitalize">
                    {cascadePosition.step.role.replace('_', ' ')}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-cf-text-secondary mb-1">{t('typicalDelay')}</p>
                  <p className="text-sm font-medium text-cf-text-primary">
                    {cascadePosition.step.typicalDelay}
                  </p>
                </div>
                <p className="text-xs text-cf-text-secondary leading-relaxed">
                  <T text={cascadePosition.step.reason} />
                </p>
                <Link
                  href={`/cascade/${cascadePosition.pattern.sector}`}
                  className="cf-btn-secondary w-full justify-center gap-2 text-sm"
                >
                  {t('viewFullCascade')}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}

          {/* Related Stocks */}
          {recs.length > 0 && (
            <div className="cf-card p-5">
              <h3 className="text-base font-heading font-bold text-cf-text-primary mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cf-primary" />
                {t('relatedStocks')}
              </h3>
              <div className="space-y-2">
                {recs.map((rec) => (
                  <Link
                    key={rec.symbol}
                    href={`/company/${rec.symbol}`}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors group"
                  >
                    <span className="text-sm font-mono font-bold text-cf-text-primary group-hover:text-cf-primary transition-colors">
                      {rec.symbol}
                    </span>
                    <div className="flex items-center gap-2 text-right">
                      {rec.price != null && (
                        <span className="text-xs text-cf-text-primary font-medium">
                          ${rec.price.toFixed(2)}
                        </span>
                      )}
                      {rec.changePct != null && (
                        <span className={`text-[11px] font-semibold ${rec.changePct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {rec.changePct >= 0 ? '+' : ''}{rec.changePct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Analyst Consensus */}
          {analystData && (analystData.targetMean != null || analystData.totalAnalysts > 0) && (
            <div className="cf-card p-5">
              <h3 className="text-base font-heading font-bold text-cf-text-primary mb-3 flex items-center gap-2">
                <Target className="w-4 h-4 text-cf-primary" />
                {t('analystConsensus')}
              </h3>
              {analystData.targetMean != null && (
                <div className="mb-3">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-xs text-cf-text-secondary">{t('analystTarget')}</span>
                    <span className="text-lg font-extrabold text-cf-text-primary">
                      ${analystData.targetMean.toFixed(2)}
                    </span>
                  </div>
                  {livePrice?.price != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-cf-text-secondary">{t('analystUpside')}</span>
                      {(() => {
                        const upside = ((analystData.targetMean! - livePrice.price) / livePrice.price) * 100;
                        return (
                          <span className={`font-semibold ${upside >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {upside >= 0 ? '+' : ''}{upside.toFixed(1)}%
                          </span>
                        );
                      })()}
                    </div>
                  )}
                  {analystData.targetLow != null && analystData.targetHigh != null && (
                    <div className="flex items-center justify-between text-xs text-cf-text-secondary mt-1">
                      <span>${analystData.targetLow.toFixed(0)} — ${analystData.targetHigh.toFixed(0)}</span>
                      <span className="opacity-60">{t('analystRange')}</span>
                    </div>
                  )}
                </div>
              )}
              {analystData.totalAnalysts > 0 && (
                <div>
                  <div className="flex items-center justify-between text-xs text-cf-text-secondary mb-1.5">
                    <span>{t('analystRatings')}</span>
                    <span>{analystData.totalAnalysts} {t('analystCount')}</span>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden gap-px">
                    {analystData.strongBuy + analystData.buy > 0 && (
                      <div
                        className="bg-green-500"
                        style={{ width: `${((analystData.strongBuy + analystData.buy) / analystData.totalAnalysts) * 100}%` }}
                        title={`Buy: ${analystData.strongBuy + analystData.buy}`}
                      />
                    )}
                    {analystData.hold > 0 && (
                      <div
                        className="bg-amber-400"
                        style={{ width: `${(analystData.hold / analystData.totalAnalysts) * 100}%` }}
                        title={`Hold: ${analystData.hold}`}
                      />
                    )}
                    {analystData.sell + analystData.strongSell > 0 && (
                      <div
                        className="bg-red-500"
                        style={{ width: `${((analystData.sell + analystData.strongSell) / analystData.totalAnalysts) * 100}%` }}
                        title={`Sell: ${analystData.sell + analystData.strongSell}`}
                      />
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] text-cf-text-secondary mt-1">
                    <span className="text-green-400">{t('analystBuy')} {analystData.strongBuy + analystData.buy}</span>
                    <span className="text-amber-400">{t('analystHold')} {analystData.hold}</span>
                    <span className="text-red-400">{t('analystSell')} {analystData.sell + analystData.strongSell}</span>
                  </div>
                </div>
              )}
              {analystData.period && (
                <p className="text-[10px] text-cf-text-secondary/40 mt-2">{t('finnhubPeriod', { period: analystData.period })}</p>
              )}
            </div>
          )}

          {/* Options 내재변동성 (IV) — Bloomberg-style 패리티 + Brent 역산 */}
          {ivData && ivData.atmIv30d != null && (
            <div className="cf-card p-5">
              <h3 className="text-base font-heading font-bold text-cf-text-primary mb-3 flex items-center gap-2">
                <Gauge className="w-4 h-4 text-cf-primary" />
                옵션 내재변동성 (IV)
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-cf-text-secondary mb-0.5">30d ATM IV</p>
                  <p className="text-lg font-extrabold tabular-nums">{(ivData.atmIv30d * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-cf-text-secondary mb-0.5">90d ATM IV</p>
                  <p className="text-lg font-extrabold tabular-nums">{ivData.atmIv90d != null ? `${(ivData.atmIv90d * 100).toFixed(1)}%` : '—'}</p>
                </div>
                <div>
                  <p className="text-cf-text-secondary mb-0.5">Term Slope (90-30)</p>
                  <p className={`text-sm font-bold tabular-nums ${ivData.termSlope != null ? (ivData.termSlope > 0.005 ? 'text-emerald-500' : ivData.termSlope < -0.005 ? 'text-rose-500' : '') : ''}`}>
                    {ivData.termSlope != null ? `${ivData.termSlope >= 0 ? '+' : ''}${(ivData.termSlope * 100).toFixed(2)}pp` : '—'}
                  </p>
                  <p className="text-[10px] text-cf-text-secondary mt-0.5">
                    {ivData.termSlope != null && ivData.termSlope < -0.005 ? 'backwardation' : ivData.termSlope != null && ivData.termSlope > 0.005 ? 'contango' : 'flat'}
                  </p>
                </div>
                <div>
                  <p className="text-cf-text-secondary mb-0.5">25Δ Skew</p>
                  <p className={`text-sm font-bold tabular-nums ${ivData.skew25d != null && ivData.skew25d > 0.02 ? 'text-rose-500' : ''}`}>
                    {ivData.skew25d != null ? `${ivData.skew25d >= 0 ? '+' : ''}${(ivData.skew25d * 100).toFixed(2)}pp` : '—'}
                  </p>
                  <p className="text-[10px] text-cf-text-secondary mt-0.5">
                    {ivData.skew25d != null && ivData.skew25d > 0.02 ? 'put 비싸짐 (downside fear)' : '대칭'}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-cf-text-secondary">
                <span>품질: {ivData.qualityScore}/100 · {ivData.putCallRatio != null ? `P/C ${ivData.putCallRatio.toFixed(2)}` : ''}</span>
                <Link href="/volatility" className="text-cf-primary hover:underline">전체 스크리너 →</Link>
              </div>
            </div>
          )}

          {/* 섹터 현황 */}
          {(() => {
            const sc = sectorContextMap[company.sector];
            if (!sc) return null;
            return (
              <div className="cf-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-heading font-bold text-cf-text-primary flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cf-primary" />
                    {t('sectorStatus')} — {sc.name}
                  </h3>
                  <a href={sc.googleNewsUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-cf-primary hover:underline flex items-center gap-1">
                    {t('sectorNews')} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="bg-cf-primary/5 rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-cf-primary font-medium leading-relaxed">{sc.phase}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {sc.keyData.map((kd) => {
                    const liveVal = liveMetrics ? getLiveValue(kd.label, liveMetrics) : null;
                    const displayValue = liveVal != null ? formatLiveValue(kd.label, liveVal) : kd.value;
                    return (
                    <div key={kd.label} className="bg-gray-50 rounded-lg p-2">
                      <p className="text-[10px] text-cf-text-secondary mb-0.5">{kd.label}</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-xs font-bold text-cf-text-primary">{displayValue}</span>
                        {kd.trend === 'up' && <TrendingUp className="w-3 h-3 text-green-500" />}
                        {kd.trend === 'down' && <TrendingDown className="w-3 h-3 text-red-500" />}
                        {kd.trend === 'neutral' && <Minus className="w-3 h-3 text-gray-400" />}
                        {liveVal != null && <span style={{color:'#22c55e',fontSize:'0.7em',fontWeight:600}}>● live</span>}
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div className="mb-3">
                  <p className="text-[10px] font-bold text-cf-text-secondary uppercase tracking-wider mb-1.5">{t('keyThemes')}</p>
                  <ul className="space-y-1">
                    {sc.themes.slice(0, 3).map((theme, i) => (
                      <li key={i} className="text-[11px] text-cf-text-secondary flex items-start gap-1.5">
                        <span className="text-cf-primary mt-0.5">•</span>
                        {theme}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-cf-text-secondary uppercase tracking-wider mb-1.5">{t('nextCatalysts')}</p>
                  <ul className="space-y-1">
                    {sc.nextCatalysts.slice(0, 2).map((cat, i) => (
                      <li key={i} className="text-[11px] text-cf-text-secondary flex items-start gap-1.5">
                        <span className="text-amber-500 mt-0.5">◆</span>
                        {cat}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      )}
    </div>
  );
}

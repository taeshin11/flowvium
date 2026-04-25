'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { type NewsGapEntry, edgarTicker } from '@/data/news-gap';
import { sectorContextMap } from '@/data/sector-context';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
  Cell,
} from 'recharts';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Minus,
  Newspaper,
  Zap,
  Database,
  ChevronDown,
  ChevronUp,
  Building2,
  ExternalLink,
  Calendar,
  Globe,
  BarChart2,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import ShareButtons from '@/components/ShareButtons';
import dynamic from 'next/dynamic';

const StockSupplyModal = dynamic(() => import('@/components/StockSupplyModal'), { ssr: false });

function quarterToFilingDate(quarter: string): string {
  const parts = quarter.split(' ');
  const q = parts[0];
  const year = parseInt(parts[1] || '2025');
  if (q === 'Q4') return `${year + 1}.02.14`;
  if (q === 'Q3') return `${year}.11.14`;
  if (q === 'Q2') return `${year}.08.14`;
  return `${year}.05.15`;
}

function estimatePrevPct(pct: number, action: string): number {
  if (action === 'new') return 0;
  if (action === 'increased') return parseFloat((pct * 0.72).toFixed(2));
  if (action === 'reduced') return parseFloat((pct * 1.38).toFixed(2));
  return pct;
}

function GapBar({ score }: { score: number }) {
  const color =
    score >= 80 ? 'from-red-500 to-amber-500'
    : score >= 60 ? 'from-amber-500 to-yellow-500'
    : score >= 40 ? 'from-yellow-500 to-blue-500'
    : 'from-blue-500 to-green-500';
  return (
    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all`} style={{ width: `${score}%` }} />
    </div>
  );
}

const sectorColors: Record<string, string> = {
  semiconductors: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'ai-cloud': 'bg-blue-50 text-blue-700 border-blue-200',
  'ev-battery': 'bg-green-50 text-green-700 border-green-200',
  defense: 'bg-red-50 text-red-700 border-red-200',
  'pharma-biotech': 'bg-purple-50 text-purple-700 border-purple-200',
};

interface NewsGapPageProps {
  initialEntries: NewsGapEntry[];
  lastUpdated: string;
  source: 'live' | 'cached' | 'static';
  updatedTickers: number;
}

interface LiveNewsItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

function fmtPubDate(pubDate: string): string {
  try {
    return new Date(pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return pubDate;
  }
}

function GapCard({ entry }: { entry: NewsGapEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [showSupply, setShowSupply] = useState(false);
  const [liveNews, setLiveNews] = useState<LiveNewsItem[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const t = useTranslations('newsGap');

  useEffect(() => {
    if (!expanded || liveNews !== null) return;
    let cancelled = false;
    setNewsLoading(true);
    fetch(`/api/company-news?ticker=${encodeURIComponent(entry.ticker)}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.news) setLiveNews(d.news as LiveNewsItem[]); })
      .catch(() => { /* fall back to static */ })
      .finally(() => { if (!cancelled) setNewsLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, entry.ticker, liveNews]);
  const sectorClass = sectorColors[entry.sector] ?? 'bg-gray-50 text-gray-700 border-gray-200';

  return (
    <>
    {showSupply && <StockSupplyModal ticker={entry.ticker} onClose={() => setShowSupply(false)} />}
    <div className="cf-card overflow-hidden hover:shadow-lg transition-all">
      {/* Collapsed row */}
      <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        {/* Company */}
        <div className="lg:col-span-3">
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/company/${entry.ticker}`} className="font-mono font-bold text-cf-primary text-lg hover:underline">
              {entry.ticker}
            </Link>
            {entry.gapScore >= 70 && <AlertTriangle className="w-4 h-4 text-cf-accent flex-shrink-0" />}
          </div>
          <p className="text-sm font-medium text-cf-text-primary">{entry.companyName}</p>
          <span className={`inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${sectorClass}`}>
            {entry.sector.replace('-', ' / ')}
          </span>
        </div>

        {/* Scores */}
        <div className="lg:col-span-4 space-y-2.5">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-cf-text-secondary flex items-center gap-1"><TrendingUp className="w-3 h-3" /> 기관 활동</span>
              <span className="font-bold text-cf-primary">{entry.ibActivityScore}</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-cf-primary" style={{ width: `${entry.ibActivityScore}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-cf-text-secondary flex items-center gap-1"><Newspaper className="w-3 h-3" /> 미디어 보도</span>
              <span className="font-bold text-cf-text-primary">{entry.mediaScore}</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-cf-text-secondary" style={{ width: `${entry.mediaScore}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-cf-text-secondary flex items-center gap-1 font-bold"><Eye className="w-3 h-3" /> 갭 점수</span>
              <span className={`font-bold text-lg ${entry.gapScore >= 70 ? 'text-cf-accent' : entry.gapScore >= 40 ? 'text-cf-primary' : 'text-cf-success'}`}>
                {entry.gapScore}
              </span>
            </div>
            <GapBar score={entry.gapScore} />
          </div>
        </div>

        {/* Preview: top article + top IB action */}
        <div className="lg:col-span-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="font-bold text-cf-text-secondary uppercase tracking-wider mb-1.5">미디어 보도</p>
            {entry.recentArticles[0] ? (
              <div>
                <p className="text-cf-text-secondary leading-relaxed mb-1">
                  &quot;{entry.recentArticles[0].title}&quot;
                </p>
                <span className="inline-flex items-center gap-1 text-cf-text-muted">
                  <Calendar className="w-3 h-3" />
                  {entry.recentArticles[0].date}
                  {entry.recentArticles[0].source && (
                    <span className="text-gray-400">· {entry.recentArticles[0].source}</span>
                  )}
                </span>
              </div>
            ) : (
              <p className="text-cf-text-secondary italic">최소 보도</p>
            )}
          </div>
          <div>
            <p className="font-bold text-cf-primary uppercase tracking-wider mb-1.5">기관 행동</p>
            <p className="text-cf-text-primary leading-relaxed">{entry.ibActions[0]}</p>
          </div>
        </div>

        {/* Expand toggle + 수급 button */}
        <div className="lg:col-span-1 flex flex-col items-end gap-1.5">
          <button
            onClick={() => setShowSupply(true)}
            className="flex items-center gap-1 text-[10px] font-bold text-violet-600 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-lg transition-colors border border-violet-200"
          >
            <BarChart2 className="w-3 h-3" />
            수급
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-cf-text-secondary hover:text-cf-primary transition-colors px-2 py-1 rounded-lg hover:bg-gray-100"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-cf-border/50 bg-gray-50/60 p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 미디어 보도 전체 */}
          <div>
            <h4 className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Newspaper className="w-3.5 h-3.5" /> 미디어 보도
              {liveNews !== null && <span className="text-[9px] text-emerald-500 font-normal">실시간</span>}
              {newsLoading && <RefreshCw className="w-3 h-3 animate-spin text-cf-text-secondary" />}
            </h4>
            {newsLoading && !liveNews ? (
              <p className="text-xs text-cf-text-secondary italic">뉴스 로딩 중…</p>
            ) : liveNews && liveNews.length > 0 ? (
              <div className="space-y-2">
                {liveNews.slice(0, 6).map((article, i) => (
                  <div key={i} className="bg-white rounded-lg p-3 border border-cf-border/50">
                    <a href={article.link || `https://news.google.com/search?q=${encodeURIComponent(entry.ticker)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs font-medium text-cf-text-primary hover:text-cf-primary flex items-start gap-1 leading-relaxed group">
                      &quot;{article.title}&quot;
                      <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-40 group-hover:opacity-100" />
                    </a>
                    <div className="flex items-center gap-1.5 mt-1.5 text-cf-text-muted text-xs">
                      <Calendar className="w-3 h-3" />
                      <span>{fmtPubDate(article.pubDate)}</span>
                      {article.source && <><span className="text-gray-300">·</span><span className="font-medium">{article.source}</span></>}
                    </div>
                  </div>
                ))}
                <a href={`https://news.google.com/search?q=${encodeURIComponent(entry.companyName + ' ' + entry.ticker)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-cf-primary hover:underline mt-1">
                  Google News에서 더 보기 <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : entry.recentArticles.length === 0 ? (
              <p className="text-xs text-cf-text-secondary italic">최근 30일 보도 없음 — 강한 침묵 신호</p>
            ) : (
              <div className="space-y-2">
                {entry.recentArticles.map((article, i) => {
                  const href = article.url || `https://news.google.com/search?q=${encodeURIComponent(article.title + ' ' + entry.ticker)}`;
                  return (
                    <div key={i} className="bg-white rounded-lg p-3 border border-cf-border/50">
                      <a href={href} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-medium text-cf-text-primary hover:text-cf-primary flex items-start gap-1 leading-relaxed group">
                        &quot;{article.title}&quot;
                        <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-40 group-hover:opacity-100" />
                      </a>
                      <div className="flex items-center gap-1.5 mt-1.5 text-cf-text-muted text-xs">
                        <Calendar className="w-3 h-3" />
                        <span>{article.date}</span>
                        {article.source && <><span className="text-gray-300">·</span><span className="font-medium">{article.source}</span></>}
                      </div>
                    </div>
                  );
                })}
                <a href={`https://news.google.com/search?q=${encodeURIComponent(entry.companyName + ' ' + entry.ticker)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-cf-primary hover:underline mt-1">
                  Google News에서 더 보기 <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* 기관 보유 현황 (13F) */}
          <div>
            <h4 className="text-xs font-bold text-cf-primary uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> {t('institutionalHoldings')}
            </h4>
            <div className="bg-white rounded-lg border border-cf-border/50 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-cf-border/50">
                    <th className="text-left py-2 px-3 text-cf-text-secondary font-medium">{t('institution')}</th>
                    <th className="text-right py-2 px-3 text-cf-text-secondary font-medium">{t('position')}</th>
                    <th className="text-right py-2 px-3 text-cf-text-secondary font-medium">{t('ownershipPct')}</th>
                    <th className="text-center py-2 px-3 text-cf-text-secondary font-medium">{t('trend')}</th>
                    <th className="text-center py-2 px-3 text-cf-text-secondary font-medium">{t('filingDate')}</th>
                    <th className="text-center py-2 px-3 text-cf-text-secondary font-medium">13F</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.ownershipData.map((o, i) => {
                    const prevPct = o.prevPct !== undefined ? o.prevPct : estimatePrevPct(o.pctOfShares, o.action);
                    const diff = parseFloat((o.pctOfShares - prevPct).toFixed(2));
                    const filingDate = quarterToFilingDate(o.quarter);
                    return (
                      <tr key={i} className="border-b border-cf-border/30 last:border-0">
                        <td className="py-2 px-3 font-medium text-cf-text-primary">{o.institution}</td>
                        <td className="py-2 px-3 text-right font-mono text-cf-text-secondary">
                          ${o.valueM >= 1000 ? `${(o.valueM / 1000).toFixed(1)}B` : `${o.valueM}M`}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <span className="font-bold text-cf-primary">{o.pctOfShares.toFixed(2)}%</span>
                          {o.action !== 'maintained' && o.action !== 'new' && (
                            <span className={`ml-1 text-[10px] ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                              {diff > 0 ? `↑+${diff}` : diff < 0 ? `↓${diff}` : ''}
                            </span>
                          )}
                          {o.action === 'new' && (
                            <span className="ml-1 text-[10px] text-blue-600">↑신규</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                            o.action === 'new' ? 'bg-blue-50 text-blue-700' :
                            o.action === 'increased' ? 'bg-green-50 text-green-700' :
                            o.action === 'reduced' ? 'bg-red-50 text-red-700' :
                            'bg-gray-50 text-gray-600'
                          }`}>
                            {o.action === 'new' ? t('actionNew') : o.action === 'increased' ? t('actionIncreased') : o.action === 'reduced' ? t('actionReduced') : t('actionMaintained')}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center text-cf-text-secondary whitespace-nowrap">
                          {filingDate}
                          <div className="text-[10px] text-cf-text-secondary/60">{o.quarter}</div>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <a href={o.secUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-cf-primary hover:underline">
                            SEC <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <a href={edgarTicker(entry.ticker)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-cf-text-secondary hover:text-cf-primary mt-2">
              EDGAR에서 {entry.ticker} 관련 전체 13F 보기 <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* 요약 */}
          <div>
            <h4 className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> {t('institutionalActivitySummary')}
            </h4>
            <div className="space-y-2 mb-4">
              {entry.ibActions.map((action, i) => (
                <div key={i} className="bg-white rounded-lg p-3 border border-cf-border/50 flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-cf-primary/10 text-cf-primary text-xs font-bold flex-shrink-0 flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-xs text-cf-text-primary leading-relaxed">{action}</p>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-lg p-3 border border-cf-border/50">
              <p className="text-xs font-bold text-cf-text-primary mb-2">{t('signalStrength')}</p>
              <div className="space-y-1.5 text-xs text-cf-text-secondary">
                <div className="flex justify-between">
                  <span>기관 활동 수준</span>
                  <span className={`font-bold ${entry.ibActivityLevel === 'high' ? 'text-cf-primary' : 'text-cf-text-secondary'}`}>
                    {entry.ibActivityLevel === 'high' ? t('activityHigh') : entry.ibActivityLevel === 'medium' ? t('activityMedium') : t('activityLow')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>미디어 커버리지</span>
                  <span className={`font-bold ${entry.mediaScore <= 20 ? 'text-cf-accent' : 'text-cf-text-secondary'}`}>
                    {entry.mediaScore <= 20 ? t('coverageMinimal') : entry.mediaScore <= 50 ? t('activityLow') : t('activityMedium')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>갭 점수</span>
                  <span className={`font-bold text-sm ${entry.gapScore >= 70 ? 'text-cf-accent' : 'text-cf-primary'}`}>
                    {entry.gapScore} / 100
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 섹터 현황 */}
        {(() => {
          const sc = sectorContextMap[entry.sector];
          if (!sc) return null;
          return (
            <div className="bg-white rounded-xl border border-cf-border/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5" /> 섹터 현황 — {sc.name}
                </h4>
                <a href={sc.googleNewsUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-cf-primary hover:underline">
                  <Globe className="w-3 h-3" /> 섹터 뉴스
                </a>
              </div>

              {/* Phase */}
              <div className="bg-cf-primary/5 rounded-lg px-3 py-2 mb-3 text-xs font-medium text-cf-primary">
                현재 국면: {sc.phase}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Key data */}
                <div>
                  <p className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider mb-2">핵심 지표</p>
                  <div className="grid grid-cols-2 gap-2">
                    {sc.keyData.map((kd, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-2 border border-cf-border/30">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-cf-text-muted leading-tight">{kd.label}</span>
                          {kd.trend === 'up' ? <TrendingUp className="w-3 h-3 text-green-500 flex-shrink-0" />
                            : kd.trend === 'down' ? <TrendingDown className="w-3 h-3 text-red-500 flex-shrink-0" />
                            : <Minus className="w-3 h-3 text-gray-400 flex-shrink-0" />}
                        </div>
                        <p className="text-xs font-bold text-cf-text-primary">{kd.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Themes */}
                <div>
                  <p className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider mb-2">핵심 테마</p>
                  <ul className="space-y-1">
                    {sc.themes.map((theme, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-cf-text-secondary leading-relaxed">
                        <span className="text-cf-primary font-bold flex-shrink-0 mt-0.5">·</span>
                        {theme}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* ETFs + Catalysts */}
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider mb-2">관련 ETF</p>
                    <div className="flex flex-wrap gap-1.5">
                      {sc.etfs.map((etf) => (
                        <span key={etf} className="px-2 py-0.5 rounded-full bg-cf-primary/10 text-cf-primary text-xs font-mono font-bold">
                          {etf}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-cf-text-secondary uppercase tracking-wider mb-2">다음 주요 이벤트</p>
                    <ul className="space-y-1">
                      {sc.nextCatalysts.map((cat, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-cf-text-secondary leading-relaxed">
                          <Calendar className="w-3 h-3 text-cf-accent flex-shrink-0 mt-0.5" />
                          {cat}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        </div>
      )}
    </div>
    </>
  );
}

// ── Types for news cascade ────────────────────────────────────────────────────
interface CascadeEffect {
  asset: string;
  direction: 'positive' | 'negative' | 'neutral';
  magnitude: 'high' | 'medium' | 'low';
  reason: string;
  timeframe: string;
}
interface NewsArticle {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  source: string;
  summary: string;
  cascades: CascadeEffect[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
  importance: 'high' | 'medium' | 'low';
}

function NewsCascadeSection() {
  const t = useTranslations('newsGap');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setFetchError(false);
    fetch('/api/news-cascade', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { articles: NewsArticle[] }) => { if (!controller.signal.aborted) setArticles(d.articles ?? []); })
      .catch((e) => { if (!controller.signal.aborted && e?.name !== 'AbortError') setFetchError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  };

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sentimentColor = {
    bullish: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    bearish: 'text-red-600 bg-red-50 border-red-200',
    neutral: 'text-slate-600 bg-slate-50 border-slate-200',
  };
  const importanceColor = {
    high: 'bg-red-500',
    medium: 'bg-amber-400',
    low: 'bg-slate-300',
  };
  const dirIcon = (dir: string) =>
    dir === 'positive' ? <ArrowUpRight className="w-3 h-3 text-emerald-500" />
    : dir === 'negative' ? <ArrowDownRight className="w-3 h-3 text-red-500" />
    : <Minus className="w-3 h-3 text-slate-400" />;
  const magColor = { high: 'text-red-600', medium: 'text-amber-600', low: 'text-slate-500' };

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          <h2 className="text-lg font-heading font-bold text-cf-text-primary">실시간 뉴스 Cascade 분석</h2>
          <span className="text-xs text-cf-text-secondary bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            AI (EXAONE)
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-cf-text-secondary hover:text-cf-primary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </button>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0,1,2,3].map(i => (
            <div key={i} className="h-24 rounded-xl bg-cf-border/30 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && (fetchError || articles.length === 0) && (
        <div className="cf-card p-6 text-center space-y-3">
          <p className="text-cf-text-secondary text-sm">
            {fetchError ? '뉴스를 불러오는 중 오류가 발생했습니다.' : '현재 표시할 뉴스가 없습니다.'}
          </p>
          {fetchError && (
            <button
              onClick={load}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-cf-primary/10 text-cf-primary border border-cf-primary/20 hover:bg-cf-primary/20 transition-colors"
            >
              다시 시도
            </button>
          )}
        </div>
      )}

      {!loading && articles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {articles.map((a) => (
            <div
              key={a.id}
              className="cf-card p-4 cursor-pointer hover:border-cf-primary/30 transition-all"
              onClick={() => setExpanded(expanded === a.id ? null : a.id)}
            >
              {/* Header */}
              <div className="flex items-start gap-2 mb-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${importanceColor[a.importance]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-cf-text-primary leading-snug line-clamp-2">{a.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-cf-text-secondary">{a.source}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${sentimentColor[a.sentiment]}`}>
                      {a.sentiment === 'bullish' ? t('bullish') : a.sentiment === 'bearish' ? t('bearish') : t('neutral')}
                    </span>
                  </div>
                </div>
                <a
                  href={a.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex-shrink-0 text-cf-text-secondary hover:text-cf-primary"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Summary */}
              <p className="text-xs text-cf-text-secondary leading-relaxed mb-2 line-clamp-2">{a.summary}</p>

              {/* Cascade pills */}
              <div className="flex flex-wrap gap-1">
                {a.cascades.slice(0, 3).map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-cf-border/60 text-cf-text-secondary">
                    {dirIcon(c.direction)}
                    {c.asset}
                  </span>
                ))}
              </div>

              {/* Expanded cascade detail */}
              {expanded === a.id && (
                <div className="mt-3 border-t border-cf-border pt-3 space-y-2">
                  {a.cascades.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className="flex items-center gap-1 flex-shrink-0 w-28">
                        {dirIcon(c.direction)}
                        <span className="font-semibold text-cf-text-primary truncate">{c.asset}</span>
                      </div>
                      <div className="flex-1">
                        <span className={`text-[10px] font-bold mr-1 ${magColor[c.magnitude]}`}>
                          [{c.magnitude === 'high' ? '강' : c.magnitude === 'medium' ? '중' : '약'}]
                        </span>
                        <span className="text-cf-text-secondary">{c.reason}</span>
                        <span className="ml-1 text-[10px] text-cf-text-muted">({c.timeframe})</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewsGapPage({
  initialEntries,
  lastUpdated,
  source,
  updatedTickers,
}: NewsGapPageProps) {
  const t = useTranslations('newsGap');
  const locale = useLocale();
  const [sortBy, setSortBy] = useState<'gap' | 'ib' | 'media'>('gap');

  const sorted = useMemo(() => {
    const copy = [...initialEntries];
    if (sortBy === 'gap') copy.sort((a, b) => b.gapScore - a.gapScore);
    else if (sortBy === 'ib') copy.sort((a, b) => b.ibActivityScore - a.ibActivityScore);
    else copy.sort((a, b) => a.mediaScore - b.mediaScore);
    return copy;
  }, [sortBy, initialEntries]);

  const scatterData = initialEntries.map((d) => ({
    x: d.mediaScore,
    y: d.ibActivityScore,
    z: d.gapScore,
    ticker: d.ticker,
    name: d.companyName,
    isSignal: d.gapScore >= 60,
  }));

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: (typeof scatterData)[0] }> }) => {
    if (!active || !payload?.[0]) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 rounded-lg shadow-lg border border-cf-border text-sm">
        <p className="font-bold text-cf-text-primary">{data.ticker} — {data.name}</p>
        <p className="text-cf-text-secondary">Media: {data.x} | IB: {data.y}</p>
        <p className="font-medium" style={{ color: data.isSignal ? '#E8A945' : '#6B7B8D' }}>
          Gap Score: {data.z}
        </p>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cf-accent/10 text-cf-accent text-sm font-medium mb-4">
          <EyeOff className="w-4 h-4" />
          {t('title')}
        </div>
        <h1 className="text-4xl font-heading font-bold text-cf-text-primary mb-4">
          {t.rich('silenceIsSignal', { accent: (chunks) => <span className="text-cf-accent">{chunks}</span> })}
        </h1>
        <div className="flex justify-center items-center gap-3 mb-4 flex-wrap">
          <ShareButtons title="News Gap Analyzer - The Silence IS the Signal | Flowvium" />
          {source === 'cached' ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium border border-blue-200">
              <Database className="w-3.5 h-3.5" />실시간 데이터 ({updatedTickers}개 티커) · {new Date(lastUpdated).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : source === 'live' ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-semibold border border-green-200">
              <Zap className="w-3.5 h-3.5" />방금 갱신 · {updatedTickers}개 티커 · {new Date(lastUpdated).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200" title="Alpha Vantage 뉴스·EDGAR 13F 데이터가 아직 수집되지 않아 리서치 기반 정적 데이터를 표시 중입니다. 다음 cron 실행(02:00 UTC)에 갱신 예정">
              <Database className="w-3.5 h-3.5" />리서치 기준 데이터 (2026-Q1) · 자동 갱신 대기 중
            </div>
          )}
        </div>
        <p className="text-lg text-cf-text-secondary max-w-2xl mx-auto">{t('heroExplanation')}</p>

        {/* Data freshness explainer */}
        <div className="max-w-2xl mx-auto mt-4 text-[11px] text-cf-text-muted bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <span className="font-semibold text-cf-text-secondary">데이터 갱신 주기:</span>
          {' '}기관 지분(EDGAR 13F) — 매일 02:00 UTC 크론 ·{' '}
          미디어 커버리지(Alpha Vantage) — 매일 25개 티커 배치 ·{' '}
          정적 기준 데이터는 2026-Q1 리서치 기반
        </div>
      </div>

      {/* Scatter Plot */}
      <div className="cf-card p-6 mb-8">
        <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-2">{t('ibVsMedia')}</h2>
        <p className="text-sm text-cf-text-secondary mb-6">
          {t.rich('ibVsMediaDesc', { accent: (chunks) => <span className="font-bold text-cf-accent">{chunks}</span> })}
        </p>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 40, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis type="number" dataKey="x" name="Media Coverage" domain={[0, 100]} tick={{ fontSize: 11 }}
                label={{ value: 'Media Coverage Score', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: '#6B7B8D' } }} />
              <YAxis type="number" dataKey="y" name="IB Activity" domain={[0, 100]} tick={{ fontSize: 11 }}
                label={{ value: 'IB Activity Score', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 12, fill: '#6B7B8D' } }} />
              <ZAxis type="number" dataKey="z" range={[60, 300]} />
              <Tooltip content={<CustomTooltip />} />
              <Scatter data={scatterData} fill="#4F8FBF">
                {scatterData.map((entry, i) => (
                  <Cell key={i} fill={entry.isSignal ? '#E8A945' : '#4F8FBF'} opacity={0.85} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-6 mt-3 text-xs text-cf-text-secondary justify-center">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-cf-accent" />{t('highGapSignal')}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-cf-primary" />{t('normal')}</span>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-3 mb-5">
        <span className="text-sm font-medium text-cf-text-secondary">{t('sortBy')}:</span>
        {[
          { key: 'gap' as const, label: t('gapScore') },
          { key: 'ib' as const, label: t('ibActivity') },
          { key: 'media' as const, label: t('mediaLowFirst') },
        ].map((opt) => (
          <button key={opt.key} onClick={() => setSortBy(opt.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              sortBy === opt.key ? 'bg-cf-primary text-white' : 'bg-white text-cf-text-secondary border border-gray-200 hover:bg-gray-50'
            }`}>
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-cf-text-muted">{t('clickToExpand')}</span>
      </div>

      {/* AI News Cascade */}
      <NewsCascadeSection />

      {/* Gap Cards */}
      <div className="space-y-3 mb-12">
        {sorted.map((entry) => (
          <GapCard key={entry.ticker} entry={entry} />
        ))}
      </div>

      {/* Explanation */}
      <div className="cf-card p-8 border-l-4 border-cf-accent">
        <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-4">{t('howNewsGapWorks')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-cf-text-secondary leading-relaxed">
          <div>
            <h3 className="font-bold text-cf-text-primary mb-2">{t('theTheory')}</h3>
            <p>{t('theTheoryText')}</p>
          </div>
          <div>
            <h3 className="font-bold text-cf-text-primary mb-2">{t('whySilenceMatters')}</h3>
            <p>{t('whySilenceMattersText')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

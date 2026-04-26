'use client';

import { useMemo, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { allCompanies, type Company } from '@/data/companies';
import { institutionalSignals } from '@/data/institutional-signals';
import { newsGapData } from '@/data/news-gap';
import { cascadePatterns } from '@/data/cascades';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Plus,
  LogOut,
  Building2,
  Users,
  Globe,
  Calendar,
  GitCompare,
  Search,
  ChevronRight,
  Zap,
  AlertCircle,
} from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';

const marketCapOrder = { titan: 5, mega: 4, large: 3, mid: 2, small: 1 };
const roleColors: Record<string, string> = {
  leader: 'text-blue-700 bg-blue-100',
  intermediary: 'text-purple-700 bg-purple-100',
  supplier: 'text-green-700 bg-green-100',
  customer: 'text-orange-700 bg-orange-100',
};
const actionIcons: Record<string, React.ReactNode> = {
  accumulating: <TrendingUp className="w-3.5 h-3.5" />,
  reducing: <TrendingDown className="w-3.5 h-3.5" />,
  new_position: <Plus className="w-3.5 h-3.5" />,
  exit: <LogOut className="w-3.5 h-3.5" />,
};
const actionColors: Record<string, string> = {
  accumulating: 'text-green-600 bg-green-50',
  reducing: 'text-red-600 bg-red-50',
  new_position: 'text-blue-600 bg-blue-50',
  exit: 'text-orange-600 bg-orange-50',
};

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="w-full bg-cf-border rounded-full h-2">
      <div
        className="h-2 rounded-full transition-all duration-700"
        style={{ width: `${(value / max) * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

function CompanyColumn({ company, side }: { company: Company; side: 'left' | 'right' }) {
  const t = useTranslations('compare');
  const mcLabel: Record<string, string> = { titan: t('mcTitan'), mega: t('mcMega'), large: t('mcLarge'), mid: t('mcMid'), small: t('mcSmall') };
  const signals = institutionalSignals.filter((s) => s.ticker === company.ticker).slice(0, 3);
  const ngEntry = newsGapData.find((e) => e.ticker === company.ticker);
  const cascades = cascadePatterns.filter((c) =>
    c.sequence.some((s) => s.ticker === company.ticker)
  );

  const isLeft = side === 'left';
  const accentColor = isLeft ? '#4F8FBF' : '#6CB4A8';

  interface LivePrice { price: number | null; change: number | null; changePct: number | null; currency: string; }
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/stock-price/${company.ticker}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!controller.signal.aborted && d?.price != null) setLivePrice(d); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [company.ticker]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="cf-card p-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 text-white text-xl font-bold font-mono"
          style={{ backgroundColor: accentColor }}
        >
          {company.ticker.slice(0, 3)}
        </div>
        <h2 className="text-xl font-heading font-bold text-cf-text-primary mb-1">{company.name}</h2>
        <p className="text-sm text-cf-text-secondary mb-3">{company.ticker} · {company.sector}</p>
        <div className="flex items-center justify-center gap-2">
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${roleColors[company.role] || 'text-gray-600 bg-gray-100'}`}>
            {company.role}
          </span>
          <span className="text-xs font-medium px-2 py-1 rounded-full text-gray-600 bg-gray-100">
            {mcLabel[company.marketCap] || company.marketCap}
          </span>
        </div>
        {livePrice?.price != null && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="text-xl font-bold tabular-nums text-cf-text-primary">
              {livePrice.currency === 'USD' ? '$' : livePrice.currency === 'KRW' ? '₩' : livePrice.currency === 'EUR' ? '€' : livePrice.currency + ' '}
              {livePrice.price.toFixed(2)}
            </span>
            {livePrice.changePct != null && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${livePrice.changePct >= 0 ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                {livePrice.changePct >= 0 ? '+' : ''}{livePrice.changePct.toFixed(2)}%
              </span>
            )}
          </div>
        )}
        <Link
          href={`/company/${company.ticker}`}
          className="inline-flex items-center gap-1 text-xs text-cf-primary mt-3 hover:underline"
        >
          {t('fullProfile')} <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Description */}
      <div className="cf-card p-5">
        <h3 className="text-sm font-semibold text-cf-text-primary mb-2">{t('about')}</h3>
        <p className="text-xs text-cf-text-secondary leading-relaxed line-clamp-5">{company.description}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-start gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-cf-text-secondary mt-0.5 shrink-0" />
            <div>
              <p className="text-cf-text-secondary">{t('founded')}</p>
              <p className="font-medium text-cf-text-primary">{company.founded}</p>
            </div>
          </div>
          <div className="flex items-start gap-1.5">
            <Users className="w-3.5 h-3.5 text-cf-text-secondary mt-0.5 shrink-0" />
            <div>
              <p className="text-cf-text-secondary">{t('employees')}</p>
              <p className="font-medium text-cf-text-primary">{company.employees}</p>
            </div>
          </div>
          <div className="flex items-start gap-1.5 col-span-2">
            <Building2 className="w-3.5 h-3.5 text-cf-text-secondary mt-0.5 shrink-0" />
            <div>
              <p className="text-cf-text-secondary">{t('headquarters')}</p>
              <p className="font-medium text-cf-text-primary">{company.headquarters}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Segments */}
      <div className="cf-card p-5">
        <h3 className="text-sm font-semibold text-cf-text-primary mb-1">{t('revenue')}</h3>
        <p className="text-lg font-bold text-cf-text-primary mb-4">{company.revenue.total}</p>
        <div className="space-y-2">
          {company.revenue.segments.slice(0, 5).map((seg) => (
            <div key={seg.name}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-cf-text-secondary truncate max-w-[65%]">{seg.name}</span>
                <span className="font-medium text-cf-text-primary">{seg.percentage}%</span>
              </div>
              <ScoreBar value={seg.percentage} color={accentColor} />
            </div>
          ))}
        </div>
      </div>

      {/* News Gap */}
      <div className="cf-card p-5">
        <h3 className="text-sm font-semibold text-cf-text-primary mb-3">{t('newsGapSignal')}</h3>
        {ngEntry ? (
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-cf-text-secondary">{t('gapScoreLabel')}</span>
                <span className="font-bold" style={{ color: accentColor }}>{ngEntry.gapScore}</span>
              </div>
              <ScoreBar value={ngEntry.gapScore} color={accentColor} />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-cf-text-secondary">{t('ibActivityScore')}</span>
                <span className="font-bold" style={{ color: accentColor }}>{ngEntry.ibActivityScore}</span>
              </div>
              <ScoreBar value={ngEntry.ibActivityScore} color={accentColor} />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-cf-text-secondary">{t('mediaCoverageScore')}</span>
                <span className="font-bold text-cf-text-primary">{ngEntry.mediaScore}</span>
              </div>
              <ScoreBar value={ngEntry.mediaScore} color="#94a3b8" />
            </div>
            <p className="text-xs text-cf-text-secondary mt-2">
              {t('ibActivityLabel')}: <span className={`font-medium ${ngEntry.ibActivityLevel === 'high' ? 'text-green-600' : ngEntry.ibActivityLevel === 'medium' ? 'text-yellow-600' : 'text-gray-500'}`}>{ngEntry.ibActivityLevel.toUpperCase()}</span>
            </p>
          </div>
        ) : (
          <p className="text-xs text-cf-text-secondary">{t('noNewsGapData')}</p>
        )}
      </div>

      {/* Institutional Signals */}
      <div className="cf-card p-5">
        <h3 className="text-sm font-semibold text-cf-text-primary mb-3">{t('institutionalSignals')}</h3>
        {signals.length > 0 ? (
          <div className="space-y-3">
            {signals.map((sig) => (
              <div key={sig.id} className="border-b border-cf-border pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${actionColors[sig.action]}`}>
                    {actionIcons[sig.action]}
                    {sig.action.replace('_', ' ')}
                  </span>
                  <span className="text-xs font-bold text-cf-text-primary">{sig.estimatedValue}</span>
                </div>
                <p className="text-xs text-cf-text-secondary truncate">{sig.institution}</p>
                <p className="text-xs text-cf-text-secondary">{sig.filingDate}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-cf-text-secondary">{t('noSignals')}</p>
        )}
      </div>

      {/* Cascade Appearances */}
      <div className="cf-card p-5">
        <h3 className="text-sm font-semibold text-cf-text-primary mb-3">{t('cascadePatterns')}</h3>
        {cascades.length > 0 ? (
          <div className="space-y-2">
            {cascades.slice(0, 3).map((c) => {
              const step = c.sequence.find((s) => s.ticker === company.ticker);
              return (
                <Link
                  key={c.id}
                  href={`/cascade/${c.sector}`}
                  className="block text-xs border border-cf-border rounded-lg p-3 hover:border-cf-primary/40 hover:bg-cf-primary/5 transition-all"
                >
                  <p className="font-medium text-cf-text-primary truncate">{c.sectorName}</p>
                  <p className="text-cf-text-secondary mt-0.5">
                    {t('roleLabel')}: <span className="font-medium">{step?.role.replace('_', ' ')}</span>
                    {step?.typicalDelay && <span className="ml-2">· {step.typicalDelay}</span>}
                  </p>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-cf-text-secondary">{t('noCascades')}</p>
        )}
      </div>

      {/* Supply Chain Relationships */}
      <div className="cf-card p-5">
        <h3 className="text-sm font-semibold text-cf-text-primary mb-3">{t('keyRelationships')}</h3>
        <div className="space-y-2">
          {company.relationships.slice(0, 5).map((rel, i) => {
            const related = allCompanies.find((c) => c.id === rel.targetId);
            return (
              <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-cf-border last:border-0">
                <div>
                  <span className="font-medium text-cf-text-primary">
                    {related ? related.ticker : rel.targetId.toUpperCase()}
                  </span>
                  {related && <span className="text-cf-text-secondary ml-1">· {related.name}</span>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[rel.type] || 'text-gray-600 bg-gray-100'}`}>
                  {rel.type}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TickerSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const suggestions = useMemo(() => {
    if (!query || query.length < 1) return [];
    const q = query.toUpperCase();
    return allCompanies
      .filter(
        (c) =>
          c.ticker.toUpperCase().includes(q) ||
          c.name.toUpperCase().includes(q)
      )
      .slice(0, 8);
  }, [query]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-cf-border rounded-xl px-4 py-2.5 bg-white focus-within:border-cf-primary transition-colors">
        <Search className="w-4 h-4 text-cf-text-secondary shrink-0" />
        <input
          type="text"
          value={query || value}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="flex-1 text-sm outline-none bg-transparent text-cf-text-primary placeholder-cf-text-secondary"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-cf-border rounded-xl shadow-xl overflow-hidden">
          {suggestions.map((c) => (
            <button
              key={c.ticker}
              className="w-full text-left px-4 py-2.5 hover:bg-cf-primary/5 flex items-center justify-between gap-2 transition-colors"
              onClick={() => {
                onChange(c.ticker);
                setQuery('');
              }}
            >
              <span className="font-mono font-bold text-cf-primary text-sm">{c.ticker}</span>
              <span className="text-xs text-cf-text-secondary truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ComparePage({ slug }: { slug: string }) {
  const t = useTranslations('compare');
  const mcLabel: Record<string, string> = { titan: t('mcTitan'), mega: t('mcMega'), large: t('mcLarge'), mid: t('mcMid'), small: t('mcSmall') };
  // Parse slug: "nvda-vs-amd" → ['NVDA', 'AMD']
  const parts = slug.toUpperCase().split('-VS-');
  const initialTicker1 = parts[0] || 'NVDA';
  const initialTicker2 = parts[1] || 'AMD';

  const [ticker1, setTicker1] = useState(initialTicker1);
  const [ticker2, setTicker2] = useState(initialTicker2);

  const company1 = allCompanies.find((c) => c.ticker.toUpperCase() === ticker1.toUpperCase());
  const company2 = allCompanies.find((c) => c.ticker.toUpperCase() === ticker2.toUpperCase());

  // Revenue comparison chart data
  const revenueChartData = useMemo(() => {
    if (!company1 || !company2) return [];
    const allSegments = new Set([
      ...company1.revenue.segments.map((s) => s.name),
      ...company2.revenue.segments.map((s) => s.name),
    ]);
    return Array.from(allSegments)
      .slice(0, 5)
      .map((name) => ({
        name: name.length > 16 ? name.slice(0, 16) + '…' : name,
        [company1.ticker]: company1.revenue.segments.find((s) => s.name === name)?.percentage || 0,
        [company2.ticker]: company2.revenue.segments.find((s) => s.name === name)?.percentage || 0,
      }));
  }, [company1, company2]);

  const ngEntry1 = newsGapData.find((e) => e.ticker === ticker1);
  const ngEntry2 = newsGapData.find((e) => e.ticker === ticker2);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs overrides={{ compare: { label: 'Compare' }, [slug]: { label: `${ticker1} vs ${ticker2}` } }} />

      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <GitCompare className="w-6 h-6 text-cf-primary" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-cf-text-primary">
            {t('title')}
          </h1>
        </div>
        <p className="text-cf-text-secondary">{t('subtitle')}</p>
      </div>

      {/* Ticker Selector */}
      <div className="cf-card p-5 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <div>
            <label className="block text-xs font-medium text-cf-text-secondary mb-1.5">{t('companyA')}</label>
            <TickerSearch
              value={ticker1}
              onChange={setTicker1}
              placeholder={t('searchPlaceholder')}
            />
          </div>
          <div className="flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-cf-border flex items-center justify-center">
              <ArrowRight className="w-5 h-5 text-cf-text-secondary" />
            </div>
            <span className="mx-3 text-sm font-bold text-cf-text-secondary">VS</span>
            <div className="w-10 h-10 rounded-full bg-cf-border flex items-center justify-center">
              <ArrowLeft className="w-5 h-5 text-cf-text-secondary" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-cf-text-secondary mb-1.5">{t('companyB')}</label>
            <TickerSearch
              value={ticker2}
              onChange={setTicker2}
              placeholder={t('searchPlaceholder')}
            />
          </div>
        </div>
        {(!company1 || !company2) && (
          <div className="mt-3 flex items-center gap-2 text-sm text-amber-600">
            <AlertCircle className="w-4 h-4" />
            {!company1 && <span>{t('notFound', { ticker: ticker1 })} </span>}
            {!company2 && <span>{t('notFound', { ticker: ticker2 })}</span>}
          </div>
        )}
      </div>

      {/* Quick Summary Bar */}
      {company1 && company2 && (
        <div className="cf-card p-5 mb-8 bg-gradient-to-r from-cf-primary/5 to-cf-secondary/5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
            {[
              {
                label: t('marketCapTier'),
                v1: mcLabel[company1.marketCap]?.split(' ')[0],
                v2: mcLabel[company2.marketCap]?.split(' ')[0],
                winner:
                  (marketCapOrder[company1.marketCap] || 0) > (marketCapOrder[company2.marketCap] || 0) ? 'left' : 'right',
              },
              {
                label: t('chainRole'),
                v1: company1.role,
                v2: company2.role,
                winner: null,
              },
              {
                label: t('gapScore'),
                v1: ngEntry1 ? String(ngEntry1.gapScore) : 'N/A',
                v2: ngEntry2 ? String(ngEntry2.gapScore) : 'N/A',
                winner:
                  ngEntry1 && ngEntry2
                    ? ngEntry1.gapScore > ngEntry2.gapScore
                      ? 'left'
                      : 'right'
                    : null,
                tooltip: t('gapScoreTooltip'),
              },
              {
                label: t('ibActivity'),
                v1: ngEntry1 ? String(ngEntry1.ibActivityScore) : 'N/A',
                v2: ngEntry2 ? String(ngEntry2.ibActivityScore) : 'N/A',
                winner:
                  ngEntry1 && ngEntry2
                    ? ngEntry1.ibActivityScore > ngEntry2.ibActivityScore
                      ? 'left'
                      : 'right'
                    : null,
              },
            ].map((row) => (
              <div key={row.label}>
                <p className="text-xs text-cf-text-secondary mb-2">{row.label}</p>
                <div className="flex items-center justify-center gap-3">
                  <span
                    className={`font-bold ${row.winner === 'left' ? 'text-cf-primary text-base' : 'text-cf-text-primary'}`}
                  >
                    {row.v1}
                  </span>
                  <span className="text-cf-text-secondary text-xs">vs</span>
                  <span
                    className={`font-bold ${row.winner === 'right' ? 'text-cf-secondary text-base' : 'text-cf-text-primary'}`}
                  >
                    {row.v2}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revenue Chart */}
      {company1 && company2 && revenueChartData.length > 0 && (
        <div className="cf-card p-5 mb-8">
          <h2 className="text-base font-heading font-bold text-cf-text-primary mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-cf-primary" />
            {t('revenueMix')}
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revenueChartData} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                angle={-30}
                textAnchor="end"
                interval={0}
              />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`]} />
              <Bar dataKey={company1.ticker} fill="#4F8FBF" radius={[3, 3, 0, 0]} />
              <Bar dataKey={company2.ticker} fill="#6CB4A8" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-6 mt-2 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#4F8FBF' }} />
              <span>{company1.ticker}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#6CB4A8' }} />
              <span>{company2.ticker}</span>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-side columns */}
      {company1 && company2 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CompanyColumn company={company1} side="left" />
          <CompanyColumn company={company2} side="right" />
        </div>
      ) : (
        <div className="cf-card p-12 text-center">
          <GitCompare className="w-12 h-12 text-cf-text-secondary mx-auto mb-4" />
          <p className="text-cf-text-secondary">{t('enterTwoTickers')}</p>
          <p className="text-xs text-cf-text-secondary mt-2">{t('tryExample')}</p>
        </div>
      )}

      {/* Popular comparisons */}
      <div className="mt-10 cf-card p-5">
        <h3 className="text-sm font-semibold text-cf-text-primary mb-3">{t('popularComparisons')}</h3>
        <div className="flex flex-wrap gap-2">
          {[
            ['NVDA', 'AMD'],
            ['TSLA', 'RIVN'],
            ['V', 'MA'],
            ['ALB', 'FCX'],
            ['LMT', 'RTX'],
            ['LLY', 'NVO'],
            ['MSFT', 'GOOGL'],
            ['SMCI', 'DELL'],
            ['MU', 'KLAC'],
            ['COIN', 'MSTR'],
          ].map(([t1, t2]) => (
            <Link
              key={`${t1}-${t2}`}
              href={`/compare/${t1.toLowerCase()}-vs-${t2.toLowerCase()}`}
              className="text-xs px-3 py-1.5 rounded-full border border-cf-border hover:border-cf-primary hover:bg-cf-primary/5 transition-all text-cf-text-secondary hover:text-cf-primary"
            >
              {t1} vs {t2}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

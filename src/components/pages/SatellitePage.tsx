'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Satellite, Factory, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Minus, ExternalLink, Zap, Hammer, PackageOpen, TrendingDown as TrendingDownIcon } from 'lucide-react';

interface FactorySignal {
  id: string;
  ticker: string;
  name: string;
  country: string;
  tags: string[];
  significance: 'critical' | 'major' | 'moderate';
  activityScore: number | null;
  vehicleDensity: 'low' | 'medium' | 'high' | null;
  cloudCoverage: 'clear' | 'partial' | 'heavy' | null;
  loadingActivity: 'inactive' | 'normal' | 'busy' | null;
  constructionVisible: boolean | null;
  confidence: 'low' | 'medium' | 'high' | null;
  summary: string | null;
  imageDate: string | null;
  scannedAt: string;
  error?: string;
}

const COUNTRY_FLAGS: Record<string, string> = {
  TW: '🇹🇼', KR: '🇰🇷', US: '🇺🇸', NL: '🇳🇱', CN: '🇨🇳', JP: '🇯🇵', DE: '🇩🇪',
};

// ── Signal interpretation logic ───────────────────────────────────────────────
const STOCK_TAGS = new Set(['NVDA','AMD','AAPL','TSM','INTC','ASML','MU','TSLA','NIO','QCOM','ARM','LMT']);

interface SignalInsight {
  id: string;
  type: 'active' | 'construction' | 'shipping' | 'quiet';
  factory: FactorySignal;
  headline: string;
  subtext: string;
  tickers: string[];
  direction: 'positive' | 'negative' | 'neutral';
}

function buildInsights(signals: FactorySignal[]): SignalInsight[] {
  const insights: SignalInsight[] = [];

  for (const f of signals) {
    const score = f.activityScore ?? 0;
    const affectedTickers = f.tags.filter(t => STOCK_TAGS.has(t));

    if (score >= 75 && f.loadingActivity === 'busy') {
      insights.push({
        id: f.id + '-active-busy',
        type: 'active',
        factory: f,
        headline: `${f.name} 극도로 활발 (${score}점)`,
        subtext: `주차장 밀집 + 하역 급증 → 공급망 풀 가동 신호. ${affectedTickers.slice(0,3).join('/')} 수혜 가능`,
        tickers: affectedTickers.slice(0, 4),
        direction: 'positive',
      });
    } else if (score >= 70) {
      insights.push({
        id: f.id + '-active',
        type: 'active',
        factory: f,
        headline: `${f.name} 가동률 상승 (${score}점)`,
        subtext: `평상시 대비 활동 증가. ${affectedTickers.slice(0,3).join('/')} 공급망 긍정 신호`,
        tickers: affectedTickers.slice(0, 3),
        direction: 'positive',
      });
    }

    if (f.constructionVisible) {
      insights.push({
        id: f.id + '-construction',
        type: 'construction',
        factory: f,
        headline: `${f.name} 신규 공사 가시`,
        subtext: `설비 증설·확장 진행 중. CapEx 집행 → 다음 분기 생산능력 확대 예고`,
        tickers: [f.ticker, ...affectedTickers.slice(0,2)].filter((t,i,a)=>a.indexOf(t)===i).slice(0,3),
        direction: 'positive',
      });
    }

    if (f.loadingActivity === 'busy' && score < 70) {
      insights.push({
        id: f.id + '-shipping',
        type: 'shipping',
        factory: f,
        headline: `${f.name} 하역 급증`,
        subtext: `출하량 증가 감지. 재고 출고 또는 원자재 입고 증가`,
        tickers: affectedTickers.slice(0, 3),
        direction: 'positive',
      });
    }

    if (score > 0 && score <= 25 && f.significance === 'critical') {
      insights.push({
        id: f.id + '-quiet',
        type: 'quiet',
        factory: f,
        headline: `${f.name} 조용 (${score}점)`,
        subtext: `핵심 시설 가동률 급감. 수요 부진 또는 계획 유지보수 가능성`,
        tickers: affectedTickers.slice(0, 3),
        direction: 'negative',
      });
    }
  }

  // 우선순위: 극도로 활발 > 공사 > 조용 (최대 4개)
  return insights
    .sort((a, b) => {
      const order: Record<SignalInsight['type'], number> = { active: 0, construction: 1, shipping: 2, quiet: 3 };
      return order[a.type] - order[b.type];
    })
    .slice(0, 5);
}

function SignalInsightsPanel({ signals }: { signals: FactorySignal[] }) {
  const insights = buildInsights(signals);
  if (insights.length === 0) return null;

  const typeConfig: Record<SignalInsight['type'], { icon: React.ReactNode; bg: string; border: string; badge: string }> = {
    active: {
      icon: <Zap className="w-4 h-4" />,
      bg: 'bg-red-50 dark:bg-red-500/10',
      border: 'border-red-200 dark:border-red-500/30',
      badge: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
    },
    construction: {
      icon: <Hammer className="w-4 h-4" />,
      bg: 'bg-orange-50 dark:bg-orange-500/10',
      border: 'border-orange-200 dark:border-orange-500/30',
      badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
    },
    shipping: {
      icon: <PackageOpen className="w-4 h-4" />,
      bg: 'bg-amber-50 dark:bg-amber-500/10',
      border: 'border-amber-200 dark:border-amber-500/30',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
    },
    quiet: {
      icon: <TrendingDownIcon className="w-4 h-4" />,
      bg: 'bg-blue-50 dark:bg-blue-500/10',
      border: 'border-blue-200 dark:border-blue-500/30',
      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
    },
  };

  return (
    <div className="mb-8 rounded-2xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/80 dark:bg-violet-500/10 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Satellite className="w-4 h-4 text-violet-600" />
        <h2 className="text-sm font-bold text-violet-900 dark:text-violet-300">핵심 공급망 신호</h2>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 font-medium">
          Sentinel-2 · AI 해석
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {insights.map(ins => {
          const cfg = typeConfig[ins.type];
          const flag = COUNTRY_FLAGS[ins.factory.country] ?? '🌐';
          return (
            <div key={ins.id} className={`rounded-xl border p-3.5 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                  {cfg.icon}
                  {ins.type === 'active' ? '활발' : ins.type === 'construction' ? '신규공사' : ins.type === 'shipping' ? '출하증가' : '조용'}
                </div>
                <span className="text-base">{flag}</span>
              </div>
              <p className="text-sm font-bold text-cf-text-primary leading-tight mb-1">{ins.headline}</p>
              <p className="text-xs text-cf-text-secondary leading-relaxed mb-2">{ins.subtext}</p>
              {ins.tickers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className={`text-[10px] font-semibold mr-0.5 ${ins.direction === 'positive' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {ins.direction === 'positive' ? '▲' : '▼'}
                  </span>
                  {ins.tickers.map(t => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/70 dark:bg-white/10 font-mono font-bold text-cf-primary">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-red-500' : score >= 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono font-bold tabular-nums w-7 text-right">{score}</span>
    </div>
  );
}

function ScoreLabel({ score }: { score: number }) {
  if (score >= 70) return <span className="text-xs text-red-500 font-medium flex items-center gap-0.5"><TrendingUp className="w-3 h-3" />활발</span>;
  if (score <= 30) return <span className="text-xs text-emerald-500 font-medium flex items-center gap-0.5"><TrendingDown className="w-3 h-3" />조용</span>;
  return <span className="text-xs text-gray-500 font-medium flex items-center gap-0.5"><Minus className="w-3 h-3" />보통</span>;
}

function SignificanceBadge({ sig }: { sig: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    critical: { label: '핵심', cls: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' },
    major:    { label: '주요', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' },
    moderate: { label: '보통', cls: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400' },
  };
  const { label, cls } = map[sig] ?? map.moderate;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`}>{label}</span>;
}

function FactoryCard({ f }: { f: FactorySignal }) {
  const flag = COUNTRY_FLAGS[f.country] ?? '🌐';
  const hasScore = f.activityScore != null;
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="cf-card p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Satellite image thumbnail */}
      {!imgFailed && (
        <div className="relative rounded-lg overflow-hidden bg-gray-100 dark:bg-white/5" style={{ aspectRatio: '1/1' }}>
          <img
            src={`/api/satellite-image?id=${f.id}`}
            alt={`Sentinel-2 ${f.name}`}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
            <span className="text-[10px] text-white/80 font-medium">Sentinel-2 · ESA</span>
            {f.imageDate && <span className="text-[10px] text-white/60 ml-1">{f.imageDate}</span>}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-base leading-none">{flag}</span>
            <span className="text-xs font-mono font-bold text-cf-primary">{f.ticker}</span>
            <SignificanceBadge sig={f.significance} />
          </div>
          <p className="text-sm font-semibold text-cf-text-primary leading-tight">{f.name}</p>
        </div>
        {hasScore && <ScoreLabel score={f.activityScore!} />}
      </div>

      {/* Activity bar */}
      {hasScore ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-cf-text-secondary">활동 지수</span>
            {f.imageDate && <span className="text-xs text-cf-text-secondary/60">{f.imageDate}</span>}
          </div>
          <ActivityBar score={f.activityScore!} />
        </div>
      ) : (
        <div className="text-xs text-cf-text-secondary/60 italic">
          {f.error ? `스캔 실패: ${f.error.slice(0, 60)}` : '데이터 없음'}
        </div>
      )}

      {/* Details */}
      {hasScore && (
        <div className="grid grid-cols-3 gap-1 text-xs">
          <div className="cf-card-inner px-2 py-1 text-center">
            <div className="text-cf-text-secondary/60">차량</div>
            <div className="font-medium capitalize">{f.vehicleDensity ?? '-'}</div>
          </div>
          <div className="cf-card-inner px-2 py-1 text-center">
            <div className="text-cf-text-secondary/60">하역</div>
            <div className="font-medium capitalize">{f.loadingActivity ?? '-'}</div>
          </div>
          <div className="cf-card-inner px-2 py-1 text-center">
            <div className="text-cf-text-secondary/60">구름</div>
            <div className="font-medium capitalize">{f.cloudCoverage ?? '-'}</div>
          </div>
        </div>
      )}

      {/* Summary */}
      {f.summary && (
        <p className="text-xs text-cf-text-secondary leading-relaxed border-t border-cf-border pt-2">
          {f.summary}
        </p>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {f.tags.slice(0, 4).map(tag => (
          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-cf-primary/10 text-cf-primary font-medium">
            {tag}
          </span>
        ))}
        {f.constructionVisible && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400 font-medium">
            🔨 신규공사
          </span>
        )}
      </div>
    </div>
  );
}

// ── Theme grouping ────────────────────────────────────────────────────────────
const THEMES = [
  { key: 'foundry',   label: '파운드리',    emoji: '🏭', match: (f: FactorySignal) => f.tags.includes('foundry') },
  { key: 'memory',    label: '메모리',      emoji: '💾', match: (f: FactorySignal) => f.tags.includes('memory') },
  { key: 'equipment', label: '장비/소재',   emoji: '🔬', match: (f: FactorySignal) => f.tags.includes('EUV') || f.tags.includes('lithography') },
  { key: 'assembly',  label: '조립',        emoji: '📱', match: (f: FactorySignal) => f.tags.includes('assembly') && f.tags.includes('AAPL') },
  { key: 'ev',        label: '배터리/EV',   emoji: '⚡', match: (f: FactorySignal) => f.tags.includes('EV') || f.tags.includes('battery') },
] as const;

export default function SatellitePage() {
  const t = useTranslations('satellite');
  const [signals, setSignals] = useState<FactorySignal[]>([]);
  const [dataDate, setDataDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'low'>('all');

  useEffect(() => {
    setLoading(true);
    fetch('/api/satellite-signals', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setSignals(d.signals ?? []);
        setDataDate(d.dataDate ?? null);
      })
      .catch(() => setError('API 요청 실패'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = signals.filter(s => {
    if (filter === 'critical') return s.significance === 'critical';
    if (filter === 'high') return (s.activityScore ?? 0) >= 70;
    if (filter === 'low') return (s.activityScore ?? 100) <= 30;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.activityScore == null && b.activityScore == null) return 0;
    if (a.activityScore == null) return 1;
    if (b.activityScore == null) return -1;
    return b.activityScore - a.activityScore;
  });

  const criticalCount = signals.filter(s => (s.activityScore ?? 0) >= 70).length;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-violet-500/10">
            <Satellite className="w-6 h-6 text-violet-500" />
          </div>
          <h1 className="text-3xl font-heading font-bold text-cf-text-primary">{t('title')}</h1>
        </div>
        <p className="text-cf-text-secondary max-w-2xl">{t('subtitle')}</p>

        {/* Data source badge */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 font-medium">
            ESA Sentinel-2 · 10m 해상도
          </span>
          <span className="text-xs px-2 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400 font-medium">
            Claude Vision 분석
          </span>
          {dataDate && (
            <span className="text-xs text-cf-text-secondary/60">
              마지막 스캔: {dataDate}
            </span>
          )}
        </div>
      </div>

      {/* ── Signal Insights ─────────────────────────────────────────────── */}
      {signals.length > 0 && <SignalInsightsPanel signals={signals} />}

      {/* Stats row */}
      {signals.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: '모니터링 공장', value: signals.length, sub: '개 시설' },
            { label: '활발한 공장', value: criticalCount, sub: '활동 지수 ≥70' },
            { label: '핵심 시설', value: signals.filter(s => s.significance === 'critical').length, sub: 'critical' },
            { label: '신규 공사', value: signals.filter(s => s.constructionVisible).length, sub: '개 시설' },
          ].map(stat => (
            <div key={stat.label} className="cf-card p-4 text-center">
              <div className="text-2xl font-bold text-cf-text-primary">{stat.value}</div>
              <div className="text-xs text-cf-text-secondary mt-0.5">{stat.label}</div>
              <div className="text-[10px] text-cf-text-secondary/60">{stat.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {signals.length > 0 && (
        <div className="flex gap-1 mb-6 flex-wrap">
          {(['all', 'critical', 'high', 'low'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === f
                  ? 'bg-cf-primary text-white'
                  : 'bg-white dark:bg-white/[0.06] text-cf-text-secondary border border-cf-border hover:border-cf-primary/30'
              }`}
            >
              {{ all: '전체', critical: '핵심 시설', high: '⚠️ 활발', low: '💤 조용' }[f]}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-cf-text-secondary">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          <span>스캔 데이터 로딩 중...</span>
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-500 py-8">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      ) : signals.length === 0 ? (
        // No data state — setup instructions
        <div className="cf-card p-8 text-center max-w-2xl mx-auto">
          <Satellite className="w-12 h-12 text-violet-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-cf-text-primary mb-2">{t('noDataTitle')}</h2>
          <p className="text-cf-text-secondary mb-6">{t('noDataDesc')}</p>

          <div className="text-left bg-gray-50 dark:bg-white/5 rounded-xl p-4 mb-4 space-y-3">
            <p className="text-xs font-semibold text-cf-text-secondary uppercase tracking-wider">{t('setupSteps')}</p>
            {[
              { step: '1', text: 'dataspace.copernicus.eu 에서 무료 계정 생성 (5분)', href: 'https://dataspace.copernicus.eu' },
              { step: '2', text: '.env.local 에 COPERNICUS_EMAIL + COPERNICUS_PASSWORD 추가', href: null },
              { step: '3', text: 'npm run scan:satellite 실행 (12개 공장 자동 스캔)', href: null },
            ].map(item => (
              <div key={item.step} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/20 text-violet-500 text-xs font-bold flex items-center justify-center">
                  {item.step}
                </span>
                <span className="text-sm text-cf-text-secondary flex-1">{item.text}</span>
                {item.href && (
                  <a href={item.href} target="_blank" rel="noopener noreferrer"
                     className="text-cf-primary hover:underline flex-shrink-0">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>

          <div className="text-xs text-cf-text-secondary/60 bg-blue-50 dark:bg-blue-500/10 rounded-lg p-3">
            <strong>데이터 소스:</strong> ESA Sentinel-2 (10m 해상도, 5일 주기) · Claude Vision 분석<br />
            <strong>비용:</strong> 완전 무료 — Copernicus는 EU 공공 서비스, Claude API는 기존 키 사용
          </div>
        </div>
      ) : filter !== 'all' ? (
        /* Filtered: flat grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sorted.map(f => <FactoryCard key={f.id} f={f} />)}
        </div>
      ) : (
        /* Themed sections */
        <div className="space-y-8">
          {THEMES.map(theme => {
            const group = signals.filter(theme.match).sort((a, b) =>
              (b.activityScore ?? 0) - (a.activityScore ?? 0)
            );
            if (group.length === 0) return null;
            const avgScore = Math.round(group.reduce((s, f) => s + (f.activityScore ?? 0), 0) / group.length);
            const topScore = group[0]?.activityScore ?? 0;
            return (
              <section key={theme.key}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xl">{theme.emoji}</span>
                  <h2 className="text-base font-semibold text-cf-text-primary">{theme.label}</h2>
                  <span className="text-xs text-cf-text-secondary/60">{group.length}개 시설</span>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-xs text-cf-text-secondary/60">섹터 평균</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      avgScore >= 70 ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                      : avgScore >= 50 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400'
                      : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400'
                    }`}>
                      {avgScore}
                    </span>
                    {topScore >= 75 && <span className="text-[10px] text-red-500 font-medium">⚠️ 최고 {topScore}</span>}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {group.map(f => <FactoryCard key={f.id} f={f} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Methodology note */}
      <div className="mt-8 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-cf-border text-xs text-cf-text-secondary">
        <div className="flex items-start gap-2">
          <Factory className="w-4 h-4 flex-shrink-0 mt-0.5 text-cf-text-secondary/60" />
          <div>
            <strong className="text-cf-text-primary">{t('methodologyTitle')}</strong>
            <p className="mt-1">{t('methodologyDesc')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

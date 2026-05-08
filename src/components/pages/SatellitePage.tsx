'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Satellite, Factory, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';

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

  return (
    <div className="cf-card p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sorted.map(f => <FactoryCard key={f.id} f={f} />)}
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

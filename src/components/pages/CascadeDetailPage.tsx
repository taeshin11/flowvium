'use client';

import { useMemo, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { cascadePatterns, type CascadeStep } from '@/data/cascades';
import { useTranslatedText } from '@/hooks/useTranslatedText';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  TrendingUp,
  TrendingDown,
  Clock,
  Zap,
  CheckCircle2,
  Activity,
} from 'lucide-react';
import ShareButtons from '@/components/ShareButtons';
import Breadcrumbs from '@/components/Breadcrumbs';

function T({ text }: { text: string }) {
  const translated = useTranslatedText(text);
  return <>{translated}</>;
}

const roleColors: Record<string, { bg: string; text: string; border: string }> = {
  leader: { bg: 'bg-cf-primary/10', text: 'text-cf-primary', border: 'border-cf-primary' },
  first_follower: {
    bg: 'bg-cf-secondary/10',
    text: 'text-cf-secondary',
    border: 'border-cf-secondary',
  },
  mid_cap: { bg: 'bg-cf-accent/10', text: 'text-cf-accent', border: 'border-cf-accent' },
  late_mover: { bg: 'bg-gray-100', text: 'text-cf-text-secondary', border: 'border-gray-300' },
};

// roleLabels moved to translation keys cascade.roleLabels.*

function CascadeFlowStep({ step, index, total }: { step: CascadeStep; index: number; total: number }) {
  const t = useTranslations('cascade');
  const colors = roleColors[step.role] || roleColors.late_mover;

  return (
    <div className="flex items-start gap-4">
      {/* Timeline */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div
          className={`w-10 h-10 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center font-bold text-sm border-2 ${colors.border}`}
        >
          {index + 1}
        </div>
        {index < total - 1 && (
          <div className="w-0.5 h-16 bg-gradient-to-b from-cf-border to-transparent mt-1" />
        )}
      </div>

      {/* Content */}
      <div className="cf-card p-4 flex-1 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-cf-text-primary">{step.ticker}</span>
            <span className="text-sm text-cf-text-secondary">{step.companyName}</span>
          </div>
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${colors.bg} ${colors.text}`}
          >
            {t(`roleLabels.${step.role}`)}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-3.5 h-3.5 text-cf-text-secondary" />
          <span className="text-xs text-cf-text-secondary font-medium">
            <T text={step.typicalDelay} />
          </span>
        </div>
        <p className="text-sm text-cf-text-secondary leading-relaxed"><T text={step.reason} /></p>
      </div>
    </div>
  );
}

export default function CascadeDetailPage({ sector }: { sector: string }) {
  const t = useTranslations('cascade');
  const tExplore = useTranslations('explore');

  const patterns = useMemo(
    () => cascadePatterns.filter((p) => p.sector === sector),
    [sector]
  );

  // Live prices for all tickers in this cascade
  interface LivePrice { price: number | null; changePct: number | null; ret1w?: number | null }
  const [livePrices, setLivePrices] = useState<Map<string, LivePrice>>(new Map());

  useEffect(() => {
    if (!patterns.length) return;
    const tickers = Array.from(new Set(patterns.flatMap(p => [p.leaderTicker, ...p.sequence.map(s => s.ticker)])));
    const ctrl = new AbortController();
    fetch(`/api/batch-prices?tickers=${tickers.join(',')}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then((d: { prices?: Record<string, { price: number | null; changePct: number | null; ret1w?: number | null }> }) => {
        if (ctrl.signal.aborted || !d?.prices) return;
        const m = new Map<string, LivePrice>();
        for (const [t, v] of Object.entries(d.prices)) m.set(t, v);
        setLivePrices(m);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [patterns]);

  if (patterns.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-20 text-center">
        <h1 className="text-2xl font-heading font-bold text-cf-text-primary mb-4">
          {t('notFound')}
        </h1>
        <p className="text-cf-text-secondary mb-6">
          {t('notFoundDesc', { sector })}
        </p>
        <Link href="/cascade" className="cf-btn-primary">
          {t('backToCascades')}
        </Link>
      </div>
    );
  }

  const primary = patterns[0];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs overrides={{ [sector]: { label: `${tExplore(`sectors.${sector}`)} ${t('title')}` } }} />

      <Link
        href="/cascade"
        className="inline-flex items-center gap-2 text-sm text-cf-text-secondary hover:text-cf-primary transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('backToCascades')}
      </Link>

      {/* Header */}
      <div className="mb-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
          <h1 className="text-3xl font-heading font-bold text-cf-text-primary">
            {tExplore(`sectors.${sector}`)} {t('title')}
          </h1>
          <ShareButtons title={`${tExplore(`sectors.${sector}`)} ${t('title')} | Flowvium`} />
        </div>
        <p className="text-lg text-cf-text-secondary max-w-3xl">{t('cascadeDescription')}</p>
      </div>

      {patterns.map((pattern) => {
        const leaderPrice = livePrices.get(pattern.leaderTicker);
        const leaderRet1w = leaderPrice?.ret1w ?? null;
        // 활성 cascade 감지: 리더가 1주간 ±5% 이상 움직임
        const isActive = leaderRet1w != null && Math.abs(leaderRet1w) >= 5;
        const isPositive = leaderRet1w != null && leaderRet1w >= 5;
        return (
        <div key={pattern.id} className="mb-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-cf-primary/10 flex items-center justify-center">
              <Zap className="w-6 h-6 text-cf-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-heading font-bold text-cf-text-primary">
                  {pattern.leaderName} ({pattern.leaderTicker}) {t('earningsCascade')}
                </h2>
                {isActive && (
                  <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full border animate-pulse ${
                    isPositive ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-red-50 text-red-700 border-red-300'
                  }`}>
                    <Activity className="w-3 h-3" />
                    CASCADE {isPositive ? '상승' : '하락'} 진행중 {leaderRet1w! >= 0 ? '+' : ''}{leaderRet1w!.toFixed(1)}% 1W
                  </span>
                )}
                {leaderPrice?.price && (
                  <span className="text-sm font-mono text-gray-600">
                    ${leaderPrice.price.toFixed(2)}
                    {leaderPrice.changePct != null && (
                      <span className={`ml-1 ${leaderPrice.changePct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {leaderPrice.changePct >= 0 ? '+' : ''}{leaderPrice.changePct.toFixed(2)}%
                      </span>
                    )}
                  </span>
                )}
              </div>
              <p className="text-sm text-cf-text-secondary">
                {t('stepsAndEvents', { steps: pattern.sequence.length, events: pattern.historicalOccurrences.length })}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Flow Visualization */}
            <div>
              <h3 className="text-lg font-heading font-bold text-cf-text-primary mb-6">
                {t('cascadeFlow')}
              </h3>

              {/* Horizontal mini-flow at top */}
              <div className="cf-card p-4 mb-6 overflow-x-auto">
                <div className="flex items-center gap-2 min-w-max">
                  {pattern.sequence.map((step, i) => {
                    const colors = roleColors[step.role] || roleColors.late_mover;
                    return (
                      <div key={step.ticker} className="flex items-center gap-2">
                        <Link
                          href={`/company/${step.ticker}`}
                          className={`flex flex-col items-center p-3 rounded-xl ${colors.bg} hover:shadow-md transition-all min-w-[80px]`}
                        >
                          <span className={`font-mono font-bold text-sm ${colors.text}`}>
                            {step.ticker}
                          </span>
                          <span className="text-[10px] text-cf-text-secondary mt-1">
                            {step.typicalDelay}
                          </span>
                        </Link>
                        {i < pattern.sequence.length - 1 && (
                          <ArrowRight className="w-4 h-4 text-cf-text-secondary/40 flex-shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Detailed vertical flow */}
              <div className="pl-2">
                {pattern.sequence.map((step, i) => (
                  <CascadeFlowStep
                    key={step.ticker}
                    step={step}
                    index={i}
                    total={pattern.sequence.length}
                  />
                ))}
              </div>
            </div>

            {/* Historical Occurrences */}
            <div>
              <h3 className="text-lg font-heading font-bold text-cf-text-primary mb-6">
                {t('historicalOccurrences')}
              </h3>
              <div className="space-y-4">
                {pattern.historicalOccurrences.map((event, i) => {
                  const isPositive =
                    event.leaderMove.includes('+') || event.leaderMove.toLowerCase().includes('beat');

                  return (
                    <div key={i} className="cf-card p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Calendar className="w-4 h-4 text-cf-text-secondary" />
                        <span className="text-sm font-medium text-cf-text-primary">
                          {event.date}
                        </span>
                        {isPositive ? (
                          <TrendingUp className="w-4 h-4 text-cf-success" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-cf-danger" />
                        )}
                      </div>

                      <div className="space-y-2">
                        <div>
                          <p className="text-xs font-medium text-cf-text-secondary uppercase tracking-wider mb-1">
                            {t('trigger')}
                          </p>
                          <p className="text-sm text-cf-text-primary"><T text={event.trigger} /></p>
                        </div>

                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium text-cf-text-secondary uppercase tracking-wider">
                            {t('leaderMove')}:
                          </p>
                          <span
                            className={`text-sm font-bold ${
                              isPositive ? 'text-cf-success' : 'text-cf-danger'
                            }`}
                          >
                            <T text={event.leaderMove} />
                          </span>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-cf-text-secondary uppercase tracking-wider mb-1">
                            {t('cascadeResult')}
                          </p>
                          <p className="text-sm text-cf-text-secondary leading-relaxed">
                            <T text={event.cascadeResult} />
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Current Status */}
              <div className="cf-card p-5 mt-6 border-l-4 border-cf-success">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-cf-success" />
                  <h4 className="font-heading font-bold text-cf-text-primary">
                    {t('currentStatus')}
                  </h4>
                </div>
                <p className="text-sm text-cf-text-secondary">
                  {t('currentStatusDesc', { ticker: pattern.leaderTicker })}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <span className="w-2 h-2 rounded-full bg-cf-success animate-pulse" />
                  <span className="text-xs font-medium text-cf-success">{t('monitoring')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}

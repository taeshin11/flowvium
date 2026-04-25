'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { cascadePatterns } from '@/data/cascades';
import { ArrowRight, Layers, TrendingUp, Clock, Hash } from 'lucide-react';

const sectorColors: Record<string, string> = {
  semiconductors: '#6366f1',
  'ai-cloud': '#3b82f6',
  'ev-battery': '#22c55e',
  defense: '#ef4444',
  'pharma-biotech': '#a855f7',
};

export default function CascadePage() {
  const t = useTranslations('cascade');

  interface LeaderPrice { price: number | null; changePct: number | null; currency: string; }
  const [leaderPrices, setLeaderPrices] = useState<Map<string, LeaderPrice>>(new Map());

  useEffect(() => {
    const tickers = Array.from(new Set(cascadePatterns.map(p => p.leaderTicker)));
    if (!tickers.length) return;
    const controller = new AbortController();
    fetch(`/api/batch-prices?tickers=${tickers.join(',')}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: { prices: Record<string, { price: number | null; changePct: number | null }> }) => {
        if (controller.signal.aborted) return;
        const map = new Map<string, LeaderPrice>();
        for (const [ticker, entry] of Object.entries(d.prices ?? {})) {
          map.set(ticker, { price: entry.price, changePct: entry.changePct, currency: 'USD' });
        }
        setLeaderPrices(map);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Group by sector
  const bySector = cascadePatterns.reduce(
    (acc, p) => {
      if (!acc[p.sector]) acc[p.sector] = [];
      acc[p.sector].push(p);
      return acc;
    },
    {} as Record<string, typeof cascadePatterns>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cf-accent/10 text-cf-accent text-sm font-medium mb-4">
          <Layers className="w-4 h-4" />
          {t('tracker')}
        </div>
        <h1 className="text-4xl font-heading font-bold text-cf-text-primary mb-4">
          {t('leaderToMidcap')}
        </h1>
        <p className="text-lg text-cf-text-secondary max-w-2xl mx-auto">
          {t('subtitle')}. {t('cascadeDescription')}
        </p>
      </div>

      <div className="space-y-8">
        {Object.entries(bySector).map(([sector, patterns]) => (
          <div key={sector}>
            <h2
              className="text-xl font-heading font-bold mb-4 flex items-center gap-2"
              style={{ color: sectorColors[sector] || '#888' }}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: sectorColors[sector] || '#888' }}
              />
              {patterns[0].sectorName}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {patterns.map((pattern) => (
                <Link
                  key={pattern.id}
                  href={`/cascade/${pattern.sector}`}
                  className="cf-card p-6 group hover:shadow-lg transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-heading font-bold text-cf-text-primary group-hover:text-cf-primary transition-colors">
                        {pattern.leaderName} Cascade
                      </h3>
                      <p className="text-xs text-cf-text-secondary mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{t('leader')}: {pattern.leaderTicker}</span>
                        {(() => {
                          const lp = leaderPrices.get(pattern.leaderTicker);
                          if (!lp?.price) return null;
                          const sym = lp.currency === 'USD' ? '$' : lp.currency === 'KRW' ? '₩' : lp.currency === 'EUR' ? '€' : lp.currency + ' ';
                          return (
                            <span className="font-mono font-bold text-cf-text-primary">
                              {sym}{lp.price.toFixed(2)}
                              {lp.changePct != null && (
                                <span className={`ml-1 ${lp.changePct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {lp.changePct >= 0 ? '+' : ''}{lp.changePct.toFixed(2)}%
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </p>
                    </div>
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: sectorColors[sector] || '#888' }}
                    >
                      {pattern.leaderTicker.slice(0, 2)}
                    </div>
                  </div>

                  <p className="text-sm text-cf-text-secondary mb-4 line-clamp-2">
                    {pattern.description}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-cf-text-secondary mb-4">
                    <span className="flex items-center gap-1">
                      <Hash className="w-3.5 h-3.5" />
                      {t('steps', { count: pattern.sequence.length })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {pattern.sequence[pattern.sequence.length - 1]?.typicalDelay}
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" />
                      {t('events', { count: pattern.historicalOccurrences.length })}
                    </span>
                  </div>

                  {/* Mini cascade flow */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-1">
                    {pattern.sequence.slice(0, 5).map((step, i) => (
                      <div key={step.ticker} className="flex items-center gap-1 flex-shrink-0">
                        <span
                          className={`text-xs font-mono px-2 py-1 rounded ${
                            step.role === 'leader'
                              ? 'bg-cf-primary/10 text-cf-primary font-bold'
                              : step.role === 'first_follower'
                              ? 'bg-cf-secondary/10 text-cf-secondary'
                              : step.role === 'mid_cap'
                              ? 'bg-cf-accent/10 text-cf-accent'
                              : 'bg-gray-100 text-cf-text-secondary'
                          }`}
                        >
                          {step.ticker}
                        </span>
                        {i < Math.min(pattern.sequence.length, 5) - 1 && (
                          <ArrowRight className="w-3 h-3 text-cf-text-secondary/40 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                    {pattern.sequence.length > 5 && (
                      <span className="text-xs text-cf-text-secondary">
                        {t('more', { count: pattern.sequence.length - 5 })}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

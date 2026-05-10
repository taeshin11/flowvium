'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { GitMerge, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

interface CascadeEffectItem { asset: string; direction: 'positive' | 'negative' | 'neutral'; magnitude: 'high' | 'medium' | 'low'; reason: string; timeframe: string; }
interface NewsWithCascadeItem { id: string; title: string; source: string; pubDate: string; summary: string; cascades: CascadeEffectItem[]; sentiment: 'bullish' | 'bearish' | 'neutral'; importance: 'high' | 'medium' | 'low'; }

const SENTIMENT_STYLE: Record<string, { cls: string }> = {
  bullish:  { cls: 'bg-green-50 text-green-700 border-green-200' },
  bearish:  { cls: 'bg-red-50 text-red-700 border-red-200' },
  neutral:  { cls: 'bg-gray-50 text-gray-600 border-gray-200' },
};
const IMPORTANCE_STYLE: Record<string, { cls: string }> = {
  high:   { cls: 'border-l-4 border-l-red-400' },
  medium: { cls: 'border-l-4 border-l-amber-400' },
  low:    { cls: 'border-l-4 border-l-gray-300' },
};
const CASCADE_DIR_STYLE: Record<string, { icon: string; cls: string }> = {
  positive: { icon: '▲', cls: 'text-green-600 bg-green-50' },
  negative: { icon: '▼', cls: 'text-red-600 bg-red-50' },
  neutral:  { icon: '→', cls: 'text-gray-500 bg-gray-50' },
};

export default function NewsCascadeTab() {
  const t = useTranslations('intelligence');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const targetArticleId = searchParams.get('articleId');
  const [news, setNews] = useState<NewsWithCascadeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const didScrollRef = useRef(false);
  const SENTIMENT_LABEL: Record<string, string> = {
    bullish: t('ncSentimentBullish'),
    bearish: t('ncSentimentBearish'),
    neutral: t('ncSentimentNeutral'),
  };
  const MAG_LABEL: Record<string, string> = {
    high: t('ncMagHigh'),
    medium: t('ncMagMedium'),
    low: t('ncMagLow'),
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/news-cascade', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!controller.signal.aborted) setNews(Array.isArray(d) ? d : (d.articles ?? d.news ?? d.items ?? [])); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  // ?articleId=… 가 있으면 해당 기사 자동 expand + scroll into view (홈 LiveFeed 클릭 진입용)
  useEffect(() => {
    if (!targetArticleId || loading || news.length === 0 || didScrollRef.current) return;
    // article.id 가 없는 경우 title 로 매칭 (latest-updates fallback id 와 일치)
    const match = news.find(n => n.id === targetArticleId || n.title === targetArticleId);
    if (!match) return;
    setExpanded(match.id);
    const node = itemRefs.current.get(match.id);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      didScrollRef.current = true;
    }
  }, [targetArticleId, loading, news]);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">{t('ncLoading')}</span>
    </div>
  );

  if (!news.length) return (
    <div className="cf-card p-8 text-center text-cf-text-secondary text-sm">
      {t('ncEmpty')}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="cf-card p-4 bg-gradient-to-r from-slate-50 to-amber-50 border-amber-100">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">📡</div>
          <div>
            <h3 className="text-sm font-bold text-cf-text-primary mb-1">{t('ncTitle')}</h3>
            <p className="text-xs text-cf-text-secondary leading-relaxed">{t('ncDesc')}</p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {news.map((item) => {
          const isOpen = expanded === item.id;
          const ss = SENTIMENT_STYLE[item.sentiment] ?? SENTIMENT_STYLE.neutral;
          const imp = IMPORTANCE_STYLE[item.importance] ?? IMPORTANCE_STYLE.low;
          const isHighlighted = targetArticleId && (item.id === targetArticleId || item.title === targetArticleId);
          return (
            <div
              key={item.id}
              ref={(el) => { itemRefs.current.set(item.id, el); }}
              className={`cf-card overflow-hidden ${imp.cls} ${isHighlighted ? 'ring-2 ring-cf-primary ring-offset-2' : ''}`}
            >
              <div className="p-4">
                <div className="flex items-start gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ss.cls}`}>{SENTIMENT_LABEL[item.sentiment] ?? SENTIMENT_LABEL.neutral}</span>
                      <span className="text-[10px] text-cf-text-secondary">{item.source}</span>
                      <span className="text-[10px] text-gray-400">{new Date(item.pubDate).toLocaleDateString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <h4 className="text-sm font-bold text-cf-text-primary leading-snug">{item.title}</h4>
                    {item.summary && <p className="text-xs text-cf-text-secondary mt-1 leading-relaxed">{item.summary}</p>}
                  </div>
                </div>
                {item.cascades.length > 0 && (
                  <button
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${isOpen ? 'bg-cf-primary/10 border-cf-primary/30 text-cf-primary' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                  >
                    <GitMerge className="w-3 h-3" />
                    {isOpen ? t('ncCascadeCollapse', { count: item.cascades.length }) : t('ncCascadeExpand', { count: item.cascades.length })}
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="border-t border-cf-border bg-gray-50/50 px-4 py-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {item.cascades.map((c, i) => {
                      const ds = CASCADE_DIR_STYLE[c.direction] ?? CASCADE_DIR_STYLE.neutral;
                      return (
                        <div key={i} className={`flex items-center gap-2 text-xs p-2.5 rounded-xl bg-white border ${c.direction === 'positive' ? 'border-green-100' : c.direction === 'negative' ? 'border-red-100' : 'border-gray-100'}`}>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-bold ${ds.cls}`}>{ds.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-cf-text-primary">{c.asset}</div>
                            <div className="text-cf-text-secondary leading-tight">{c.reason}</div>
                            <div className="text-gray-400 text-[10px]">{c.timeframe}</div>
                          </div>
                          <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${c.magnitude === 'high' ? 'bg-red-50 text-red-500' : c.magnitude === 'medium' ? 'bg-amber-50 text-amber-500' : 'bg-gray-50 text-gray-400'}`}>
                            {MAG_LABEL[c.magnitude] ?? MAG_LABEL.low}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

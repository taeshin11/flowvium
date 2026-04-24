'use client';

import { useEffect, useState, useCallback } from 'react';
import type { UpdateItem } from '@/app/api/latest-updates/route';
import { TrendingUp, TrendingDown, Minus, Loader2, RefreshCw } from 'lucide-react';
import { Link } from '@/i18n/routing';

function DirectionIcon({ direction }: { direction?: 'up' | 'down' | 'neutral' }) {
  if (direction === 'up') return <TrendingUp className="w-3 h-3 flex-shrink-0" style={{ color: '#10b981' }} />;
  if (direction === 'down') return <TrendingDown className="w-3 h-3 flex-shrink-0" style={{ color: '#ef4444' }} />;
  return <Minus className="w-3 h-3 flex-shrink-0 text-slate-400" />;
}

export default function LiveFeed() {
  const [items, setItems] = useState<UpdateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchItems = useCallback(async (isManual = false, signal?: AbortSignal) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch('/api/latest-updates', signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setItems(data.items ?? []);
      setLastFetched(new Date());
      setError(false);
    } catch {
      if (signal?.aborted) return;
      setError(true);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchItems(false, controller.signal);
    const interval = setInterval(() => fetchItems(false, controller.signal), 5 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchItems]);

  const timeAgo = lastFetched
    ? `${lastFetched.getHours().toString().padStart(2, '0')}:${lastFetched.getMinutes().toString().padStart(2, '0')} 기준`
    : '';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[120px] gap-2 text-cf-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">로딩 중...</span>
      </div>
    );
  }

  if (error || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[120px] gap-3 text-cf-text-secondary">
        <RefreshCw className="w-6 h-6 opacity-40" />
        <span className="text-sm opacity-60">업데이트 데이터를 불러올 수 없습니다</span>
        <button
          onClick={() => fetchItems(true)}
          className="text-xs px-3 py-1 rounded-full border border-white/10 hover:bg-white/5 transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ maxHeight: '480px' }}>
      {/* Header row with refresh button */}
      <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b border-white/5 flex-shrink-0">
        <span className="text-[10px] text-cf-text-secondary/50">{timeAgo}</span>
        <button
          onClick={() => fetchItems(true)}
          disabled={refreshing}
          className="flex items-center gap-1 text-[10px] text-cf-text-secondary/60 hover:text-cf-text-secondary transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0">
        <div className="space-y-0.5">
          {items.map((item) => <FeedItem key={item.id} item={item} />)}
        </div>
      </div>
    </div>
  );
}

function FeedItem({ item }: { item: UpdateItem }) {
  const inner = (
    <div className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-black/5 transition-colors cursor-pointer">
      <span
        className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white mt-0.5 leading-tight"
        style={{ backgroundColor: item.badgeColor }}
      >
        {item.badge}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1">
          <DirectionIcon direction={item.direction} />
          <p className="text-xs font-semibold text-cf-text-primary leading-snug line-clamp-1 flex-1">
            {item.headline}
          </p>
        </div>
        {item.sub && (
          <p className="text-[10px] text-cf-text-secondary line-clamp-1 mt-0.5">
            {item.sub}
          </p>
        )}
        {item.source && (
          <p className="text-[9px] text-cf-text-secondary/40 mt-0.5">
            출처: {item.source}
          </p>
        )}
      </div>
      <span className="flex-shrink-0 text-[10px] text-cf-text-secondary/60 mt-0.5 whitespace-nowrap">{item.time}</span>
    </div>
  );

  if (item.link) {
    return <Link href={item.link as Parameters<typeof Link>[0]['href']}>{inner}</Link>;
  }
  return inner;
}

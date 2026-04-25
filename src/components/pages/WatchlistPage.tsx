'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, RefreshCw, X, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';

interface PriceData {
  ticker: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  currency: string;
  marketState: string | null;
  updatedAt: string;
  error?: string;
  loading?: boolean;
}

const STORAGE_KEY = 'flowvium_watchlist';
const MAX_ITEMS = 30;
const REFRESH_MS = 5 * 60 * 1000;

function marketStateLabel(state: string | null, t: ReturnType<typeof useTranslations>): string {
  if (state === 'PRE') return t('preMarket');
  if (state === 'POST') return t('postMarket');
  return t('regular');
}

function loadTickers(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveTickers(tickers: string[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
}

export default function WatchlistPage() {
  const t = useTranslations('watchlist');
  const [tickers, setTickers] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [input, setInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setTickers(loadTickers());
  }, []);

  const fetchSingle = async (ticker: string, signal: AbortSignal): Promise<PriceData> => {
    try {
      const res = await fetch(`/api/stock-price/${encodeURIComponent(ticker)}`, { signal });
      if (signal.aborted) return { ticker, price: null, change: null, changePct: null, currency: 'USD', marketState: null, updatedAt: new Date().toISOString() };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) return { ...data, ticker, loading: false };
      return { ...data, loading: false };
    } catch {
      if (signal.aborted) return { ticker, price: null, change: null, changePct: null, currency: 'USD', marketState: null, updatedAt: new Date().toISOString() };
      return { ticker, price: null, change: null, changePct: null, currency: 'USD', marketState: null, updatedAt: new Date().toISOString(), error: 'fetch failed' };
    }
  };

  const refreshAll = async (tickerList: string[]) => {
    if (!tickerList.length) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);

    setPrices(prev => {
      const next = { ...prev };
      for (const t of tickerList) next[t] = { ...(prev[t] ?? {}), ticker: t, loading: true, price: prev[t]?.price ?? null, change: prev[t]?.change ?? null, changePct: prev[t]?.changePct ?? null, currency: 'USD', marketState: null, updatedAt: prev[t]?.updatedAt ?? '' };
      return next;
    });

    try {
      const res = await fetch(`/api/batch-prices?tickers=${tickerList.join(',')}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const d = res.ok ? await res.json() : { prices: {} };
      const now = new Date().toISOString();
      setPrices(prev => {
        const next = { ...prev };
        for (const tk of tickerList) {
          const entry = d.prices?.[tk];
          next[tk] = entry
            ? { ticker: tk, price: entry.price, change: entry.change, changePct: entry.changePct, currency: 'USD', marketState: entry.marketState ?? null, updatedAt: now, loading: false }
            : { ticker: tk, price: null, change: null, changePct: null, currency: 'USD', marketState: null, updatedAt: now, loading: false, error: 'not found' };
        }
        return next;
      });
    } catch {
      if (!controller.signal.aborted) {
        const now = new Date().toISOString();
        setPrices(prev => {
          const next = { ...prev };
          for (const tk of tickerList) next[tk] = { ...prev[tk], ticker: tk, loading: false, updatedAt: now };
          return next;
        });
      }
    }
    if (!controller.signal.aborted) setRefreshing(false);
  };

  // Auto-fetch on mount + interval
  useEffect(() => {
    const list = loadTickers();
    setTickers(list);
    if (list.length) refreshAll(list);

    const iv = setInterval(() => {
      const current = loadTickers();
      if (current.length) refreshAll(current);
    }, REFRESH_MS);

    return () => {
      clearInterval(iv);
      abortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTicker = async () => {
    const sym = input.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, '');
    setAddError(null);
    if (!sym) return;
    if (tickers.includes(sym)) { setInput(''); return; }
    if (tickers.length >= MAX_ITEMS) { setAddError(t('maxItems')); return; }

    const newList = [...tickers, sym];
    setTickers(newList);
    saveTickers(newList);
    setInput('');

    // Fetch price for the new ticker
    const controller = new AbortController();
    const data = await fetchSingle(sym, controller.signal);
    if (data.error && !data.price) {
      setAddError(t('invalidTicker'));
      // Remove it
      const filtered = newList.filter(t => t !== sym);
      setTickers(filtered);
      saveTickers(filtered);
      return;
    }
    setPrices(prev => ({ ...prev, [sym]: data }));
  };

  const removeTicker = (sym: string) => {
    const newList = tickers.filter(t => t !== sym);
    setTickers(newList);
    saveTickers(newList);
    setPrices(prev => { const next = { ...prev }; delete next[sym]; return next; });
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-cf-text-primary">{t('title')}</h1>
        {tickers.length > 0 && (
          <button
            onClick={() => refreshAll(tickers)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-40 text-cf-text-secondary"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('refreshAll')}
          </button>
        )}
      </div>

      {/* Add ticker input */}
      <div className="cf-card p-4 mb-6">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); setAddError(null); }}
            onKeyDown={e => e.key === 'Enter' && addTicker()}
            placeholder={t('addPlaceholder')}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-cf-text-primary placeholder:text-cf-text-secondary/50 focus:outline-none focus:border-cf-primary/40"
            maxLength={10}
          />
          <button
            onClick={addTicker}
            disabled={!input.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-cf-primary/20 hover:bg-cf-primary/30 border border-cf-primary text-cf-primary text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('add')}
          </button>
        </div>
        {addError && (
          <p className="text-xs text-red-400 mt-2">{addError}</p>
        )}
      </div>

      {/* Watchlist table */}
      {tickers.length === 0 ? (
        <div className="cf-card p-12 flex flex-col items-center gap-3 text-cf-text-secondary">
          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-2xl">📋</div>
          <p className="font-semibold">{t('empty')}</p>
          <p className="text-xs text-center opacity-60 max-w-xs">{t('emptyDesc')}</p>
        </div>
      ) : (
        <div className="cf-card divide-y divide-white/5">
          {tickers.map(sym => {
            const p = prices[sym];
            const isLoading = !p || p.loading;
            const hasError = p?.error && !p?.price;
            const pos = (p?.changePct ?? 0) >= 0;
            return (
              <div key={sym} className="flex items-center gap-4 px-4 py-3 hover:bg-white/3 transition-colors group">
                {/* Ticker */}
                <div className="w-20 flex-shrink-0">
                  <span className="text-sm font-bold text-cf-text-primary tabular-nums">{sym}</span>
                </div>

                {/* Price + change */}
                <div className="flex-1 min-w-0">
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-cf-text-secondary" />
                  ) : hasError ? (
                    <span className="text-xs text-red-400">—</span>
                  ) : (
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-lg font-extrabold tabular-nums text-cf-text-primary">
                        {p.currency === 'USD' ? '$' : ''}{p.price?.toFixed(2) ?? '—'}
                      </span>
                      {p.changePct != null && (
                        <div className={`flex items-center gap-1 text-sm font-bold tabular-nums ${pos ? 'text-green-600' : 'text-red-500'}`}>
                          {pos ? <TrendingUp className="w-3.5 h-3.5" /> : p.changePct < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5 text-gray-400" />}
                          {p.change != null && <span>{p.change > 0 ? '+' : ''}{p.change.toFixed(2)}</span>}
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${pos ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                            {p.changePct > 0 ? '+' : ''}{p.changePct.toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Market state */}
                <div className="hidden sm:block w-24 text-right flex-shrink-0">
                  {!isLoading && !hasError && p?.marketState && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      p.marketState === 'PRE' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                      p.marketState === 'POST' ? 'bg-purple-50 text-purple-600 border-purple-200' :
                      'bg-green-50 text-green-600 border-green-200'
                    }`}>
                      {marketStateLabel(p.marketState, t)}
                    </span>
                  )}
                </div>

                {/* Remove */}
                <button
                  onClick={() => removeTicker(sym)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-red-50 text-red-400 transition-all flex-shrink-0"
                  title={t('remove')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-cf-text-secondary/40 mt-4 text-center">
        Yahoo Finance · {t('maxItems')} · 5분 자동 갱신
      </p>
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Loader2, RefreshCw, TrendingUp, TrendingDown, ExternalLink, Users, AlertTriangle, Zap, Globe, Building2, DollarSign, Filter, X, Flame } from 'lucide-react';
import { UNIVERSE_SEARCH } from '@/data/universe-search';

// 2026-06-12: korea-flow 종목명이 Naver 영어명("SK Hynix")으로 옴 — ko 사용자에겐 한글명 표시
//   (UNIVERSE_SEARCH 권위 소스, 6자리 코드 매핑). 비-ko locale 은 영어명 유지.
const KR_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  UNIVERSE_SEARCH.filter(c => /\.(KS|KQ)$/.test(c.ticker)).map(c => [c.ticker.slice(0, 6), c.name]),
);
import { Link } from '@/i18n/routing';
import type { InsiderTransaction, OwnershipAlert } from '@/lib/edgar-insider';
import type { OptionsFlowAlert } from '@/lib/unusual-whales';
import type { NPortFundSnapshot, NPortTickerAggregate } from '@/lib/edgar-nport';
import type { BlockTrade } from '@/lib/polygon';

// options / blocks 탭은 유료 API 의존 → 비활성. UI 컴포넌트만 유지 (재활성 옵션).
type Tab = 'insider' | 'ownership' | 'korea' | 'nport';

interface KoreaFlowPayload {
  updatedAt: string;
  tradingDay: string;
  topForeignBuy: KoreaRow[];
  topForeignSell: KoreaRow[];
  topInstBuy: KoreaRow[];
  topInstSell: KoreaRow[];
  totalTickers: number;
  fallback?: boolean;
  fallbackReason?: string;
  effectiveTradingDays?: number;
}
interface KoreaRow {
  ticker: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  foreignerNetBuy: number | null;
  institutionNetBuy: number | null;
  individualNetBuy: number | null;
  closePrice: number | null;
  changePct: number | null;
}

function fmtUsd(v: number | null): string {
  if (v == null) return '-';
  if (v >= 1_000_000_000) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtKrw(v: number | null): string {
  if (v == null || v === 0) return '-';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '+';
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1e12).toFixed(2)}조`;
  if (abs >= 100_000_000) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 10_000) return `${sign}${(abs / 1e4).toFixed(0)}만`;
  return `${sign}${abs}`;
}

function fmtTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}

function insiderRoleLabel(t: InsiderTransaction): string {
  if (t.officerTitle) return t.officerTitle;
  if (t.isOfficer) return 'Officer';
  if (t.isDirector) return 'Director';
  if (t.isTenPercentOwner) return '10%+ Holder';
  return 'Insider';
}

function buyReason(ix: InsiderTransaction, t: ReturnType<typeof useTranslations<'insider'>>): string {
  const val = ix.transactionValueUsd ?? 0;
  const code = ix.transactionCode;
  if (code === 'A') return t('brAutoAcquire');
  if (code === 'M' || code === 'X' || code === 'C') return t('brOptionExercise');
  if (code === 'G') return t('brGift');
  if (code === 'P') {
    if (ix.isTenPercentOwner && val >= 500_000) return t('brMajorShareholderBig');
    if (ix.isTenPercentOwner) return t('brMajorShareholder');
    if (ix.isOfficer && val >= 1_000_000) return t('brExecutiveBig');
    if (ix.isOfficer && val >= 200_000) return t('brExecutive');
    if (ix.isDirector && val >= 200_000) return t('brDirectorBig');
    if (ix.isDirector) return t('brDirector');
    if (val >= 1_000_000) return t('brLargeOpenMarket');
    return t('brOpenMarket');
  }
  return t('brInsider');
}

export default function InsiderPage() {
  const t = useTranslations('insider');
  const [tab, setTab] = useState<Tab>('insider');

  // Data state per tab
  const [insider, setInsider] = useState<InsiderTransaction[]>([]);
  const [ownership, setOwnership] = useState<OwnershipAlert[]>([]);
  const [options, setOptions] = useState<OptionsFlowAlert[]>([]);
  const [optionsConfigured, setOptionsConfigured] = useState<boolean>(true);
  const [korea, setKorea] = useState<KoreaFlowPayload | null>(null);
  const [koreaPeriod, setKoreaPeriod] = useState<'1d' | '1w' | '4w' | '13w'>('1d');
  const [koreaLoading, setKoreaLoading] = useState(false);
  const [nportFunds, setNportFunds] = useState<NPortFundSnapshot[]>([]);
  const [nportByTicker, setNportByTicker] = useState<NPortTickerAggregate[]>([]);
  const [blocks, setBlocks] = useState<BlockTrade[]>([]);
  const [blocksConfigured, setBlocksConfigured] = useState<boolean>(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tickerFilter, setTickerFilter] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (force = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    if (force) setRefreshing(true); else setLoading(true);
    const q = force ? '?refresh=1' : '';
    try {
      const [iRes, oRes, xRes, kRes, nRes, bRes] = await Promise.allSettled([
        fetch(`/api/insider-trades${q}`, { signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(`/api/ownership-alerts${q}`, { signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(`/api/options-flow${q}`, { signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(`/api/korea-flow${q}`, { signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(`/api/nport-holdings${q}`, { signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(`/api/block-trades${q}`, { signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      ]);
      if (signal.aborted) return;
      if (iRes.status === 'fulfilled') setInsider(iRes.value.items ?? []);
      if (oRes.status === 'fulfilled') setOwnership(oRes.value.items ?? []);
      if (xRes.status === 'fulfilled') {
        setOptions(xRes.value.items ?? []);
        setOptionsConfigured(xRes.value.configured !== false);
      }
      if (kRes.status === 'fulfilled') setKorea(kRes.value ?? null);
      if (nRes.status === 'fulfilled') {
        setNportFunds(nRes.value.funds ?? []);
        setNportByTicker(nRes.value.byTicker ?? []);
      }
      if (bRes.status === 'fulfilled') {
        setBlocks(bRes.value.items ?? []);
        setBlocksConfigured(bRes.value.configured !== false);
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const loadKorea = useCallback(async (period: '1d' | '1w' | '4w' | '13w') => {
    setKoreaLoading(true);
    try {
      const res = await fetch(`/api/korea-flow?period=${period}`);
      if (res.ok) setKorea(await res.json());
    } finally {
      setKoreaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'korea' && koreaPeriod !== '1d') loadKorea(koreaPeriod);
  }, [koreaPeriod, tab, loadKorea]);

  const TABS: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'insider',   label: t('tabInsider'),   icon: <Users className="w-4 h-4" />,         count: insider.length },
    { id: 'korea',     label: t('tabKorea'),     icon: <Globe className="w-4 h-4" />,          count: korea ? (korea.topForeignBuy.length + korea.topForeignSell.length) : 0 },
    { id: 'ownership', label: t('tabOwnership'), icon: <AlertTriangle className="w-4 h-4" />, count: ownership.length },
    { id: 'nport',     label: t('tabNport'),     icon: <Building2 className="w-4 h-4" />,     count: nportFunds.length },
  ];

  // ── Filter + cluster insider transactions by ticker ─────────────────────
  const tf = tickerFilter.trim().toUpperCase();
  const insiderFiltered = tf ? insider.filter(i => i.ticker === tf || i.issuerName.toUpperCase().includes(tf)) : insider;
  const ownershipFiltered = tf ? ownership.filter(a => a.ticker === tf || a.issuerName.toUpperCase().includes(tf)) : ownership;
  const nportFilteredByTicker = tf ? nportByTicker.filter(a => a.ticker === tf) : nportByTicker;
  const blocksFiltered = tf ? blocks.filter(b => b.ticker === tf) : blocks;

  // Cluster: tickers with 3+ insider transactions in the feed (unusual concentration)
  const clusterMap = new Map<string, InsiderTransaction[]>();
  for (const x of insider) {
    if (!x.ticker) continue;
    const arr = clusterMap.get(x.ticker) ?? [];
    arr.push(x);
    clusterMap.set(x.ticker, arr);
  }
  const clusters = Array.from(clusterMap.entries())
    .filter(([, arr]) => arr.length >= 3)
    .map(([ticker, arr]) => {
      const buys = arr.filter(x => x.direction === 'buy').length;
      const sells = arr.filter(x => x.direction === 'sell').length;
      const totalValue = arr.reduce((s, x) => s + (x.transactionValueUsd ?? 0), 0);
      return { ticker, count: arr.length, buys, sells, totalValue };
    })
    .sort((a, b) => b.count - a.count);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-cf-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>{t('loading')}</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-cf-text-primary flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400" />
            {t('title')}
          </h1>
          <p className="text-sm text-cf-text-secondary mt-1">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </button>
      </div>

      {/* Explainer */}
      <div className="cf-card p-4 mb-4 bg-gradient-to-br from-amber-500/5 to-orange-500/5 border border-amber-500/10">
        <p className="text-xs font-bold text-cf-text-primary mb-1.5">💡 {t('explainerTitle')}</p>
        <p className="text-[11px] text-cf-text-secondary leading-relaxed">{t('explainerBody')}</p>
      </div>

      {/* Ticker filter + cluster badges */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex-1 max-w-sm">
          <Filter className="w-3.5 h-3.5 text-cf-text-secondary" />
          <input
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value)}
            placeholder={t('tickerFilterPlaceholder')}
            className="flex-1 bg-transparent text-xs outline-none text-cf-text-primary placeholder:text-cf-text-secondary/50 uppercase"
          />
          {tickerFilter && (
            <button onClick={() => setTickerFilter('')} className="text-cf-text-secondary hover:text-cf-text-primary">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {clusters.length > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-cf-text-secondary flex-wrap">
            <Flame className="w-3 h-3 text-orange-400" />
            <span>{t('clusters')}<span className="opacity-50 font-normal"> (숫자 = 기간 내 신고 건수)</span>:</span>
            {clusters.slice(0, 5).map(c => (
              <button
                key={c.ticker}
                onClick={() => { setTickerFilter(c.ticker); setTab('insider'); }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.buys > c.sells ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}
                title={`${c.ticker}: ${c.count}건 신고 (매수 ${c.buys}건 / 매도 ${c.sells}건)`}
              >
                {c.ticker} · {c.count}건
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1 border-b border-white/5">
        {TABS.map(x => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === x.id
                ? 'bg-cf-accent/10 text-cf-accent border-b-2 border-cf-accent'
                : 'text-cf-text-secondary hover:text-cf-text-primary'
            }`}
          >
            {x.icon}
            {x.label}
            {x.count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === x.id ? 'bg-cf-accent/20' : 'bg-white/10'}`}>
                {x.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'insider' && (
        <div className="cf-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/5">
              <tr className="text-[10px] text-cf-text-secondary">
                <th className="px-3 py-2 text-left">{t('th.filed')}</th>
                <th className="px-3 py-2 text-left">{t('th.ticker')}</th>
                <th className="px-3 py-2 text-left">{t('th.insider')}</th>
                <th className="px-3 py-2 text-left">{t('th.role')}</th>
                <th className="px-3 py-2 text-left">{t('th.action')}</th>
                <th className="px-3 py-2 text-right">{t('th.shares')}</th>
                <th className="px-3 py-2 text-right">{t('th.price')}</th>
                <th className="px-3 py-2 text-right">{t('th.value')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {insiderFiltered.map(ix => (
                <tr key={ix.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary font-mono whitespace-nowrap">{fmtTime(ix.filedAt)}</td>
                  <td className="px-3 py-2.5">
                    {ix.ticker ? (
                      <Link href={`/company/${ix.ticker}` as Parameters<typeof Link>[0]['href']} className="font-bold text-cf-accent hover:underline">
                        {ix.ticker}
                      </Link>
                    ) : <span className="text-[11px] text-cf-text-secondary truncate max-w-[100px] inline-block">{ix.issuerName}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-primary max-w-[160px] truncate">{ix.insiderName}</td>
                  <td className="px-3 py-2.5 text-[10px] text-cf-text-secondary">{insiderRoleLabel(ix)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      {ix.direction === 'buy' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                          <TrendingUp className="w-3 h-3" /> {t('buy')}
                        </span>
                      ) : ix.direction === 'sell' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
                          <TrendingDown className="w-3 h-3" /> {t('sell')}
                        </span>
                      ) : (
                        <span className="text-[10px] text-cf-text-secondary/50">{ix.transactionCode}</span>
                      )}
                      {ix.direction === 'buy' && (
                        <span className="text-[9px] text-cf-text-secondary/60 leading-tight">{buyReason(ix, t)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-right">{ix.shares?.toLocaleString() ?? '-'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-right">{ix.pricePerShare != null ? `$${ix.pricePerShare.toFixed(2)}` : '-'}</td>
                  <td className={`px-3 py-2.5 font-mono text-sm font-bold text-right ${ix.direction === 'buy' ? 'text-emerald-400' : ix.direction === 'sell' ? 'text-red-400' : ''}`}>
                    {fmtUsd(ix.transactionValueUsd)}
                  </td>
                  <td className="px-3 py-2.5">
                    <a href={ix.filingUrl} target="_blank" rel="noopener noreferrer" className="text-cf-text-secondary/60 hover:text-cf-accent">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {insiderFiltered.length === 0 && <div className="py-12 text-center text-sm text-cf-text-secondary">{t('empty')}</div>}
        </div>
      )}

      {tab === 'ownership' && (
        <div className="cf-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/5">
              <tr className="text-[10px] text-cf-text-secondary">
                <th className="px-3 py-2 text-left">{t('th.filed')}</th>
                <th className="px-3 py-2 text-left">{t('th.ticker')}</th>
                <th className="px-3 py-2 text-left">{t('th.issuer')}</th>
                <th className="px-3 py-2 text-left">{t('th.filer')}</th>
                <th className="px-3 py-2 text-left">{t('th.formType')}</th>
                <th className="px-3 py-2 text-right">{t('th.percent')}</th>
                <th className="px-3 py-2 text-right">{t('th.sharesOwned')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {ownershipFiltered.map(a => (
                <tr key={a.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary font-mono whitespace-nowrap">{fmtTime(a.filedAt)}</td>
                  <td className="px-3 py-2.5">
                    {a.ticker ? (
                      <Link href={`/company/${a.ticker}` as Parameters<typeof Link>[0]['href']} className="font-bold text-cf-accent hover:underline">
                        {a.ticker}
                      </Link>
                    ) : <span className="text-[10px] text-cf-text-secondary/40">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-primary max-w-[180px] truncate">{a.issuerName}</td>
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary max-w-[180px] truncate">{a.filerName || '-'}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${a.formType.startsWith('13D') ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                      {a.formType}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm font-bold text-right text-cf-accent">
                    {a.percentOwned != null ? `${a.percentOwned.toFixed(1)}%` : '-'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-right text-cf-text-secondary">
                    {a.sharesOwned != null ? a.sharesOwned.toLocaleString() : '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <a href={a.filingUrl} target="_blank" rel="noopener noreferrer" className="text-cf-text-secondary/60 hover:text-cf-accent">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ownershipFiltered.length === 0 && <div className="py-12 text-center text-sm text-cf-text-secondary">{t('empty')}</div>}
        </div>
      )}

      {/* N-PORT — mutual fund monthly holdings */}
      {tab === 'nport' && (
        <div className="space-y-4">
          <div className="text-[11px] text-cf-text-secondary">
            {t('nportExplainer')}
          </div>
          <div className="cf-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/5">
                <tr className="text-[10px] text-cf-text-secondary">
                  <th className="px-3 py-2 text-left">{t('th.ticker')}</th>
                  <th className="px-3 py-2 text-right">{t('th.totalValue')}</th>
                  <th className="px-3 py-2 text-right">{t('th.fundCount')}</th>
                  <th className="px-3 py-2 text-left">{t('th.topFunds')}</th>
                </tr>
              </thead>
              <tbody>
                {nportFilteredByTicker.map(agg => (
                  <tr key={agg.ticker} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5">
                      <Link href={`/company/${agg.ticker}` as Parameters<typeof Link>[0]['href']} className="font-bold text-cf-accent hover:underline">
                        {agg.ticker}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-sm font-bold text-right text-emerald-400">{fmtUsd(agg.totalValueUsd)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-right">{agg.funds.length}</td>
                    <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary">
                      {agg.funds.slice(0, 3).map((f, i) => (
                        <span key={i} className="inline-block mr-2">
                          <span className="text-cf-text-primary">{f.fund.slice(0, 28)}</span>
                          <span className="text-cf-text-secondary/60 ml-1">{fmtUsd(f.valueUsd)}{f.pctOfNav != null ? ` (${f.pctOfNav.toFixed(1)}% NAV)` : ''}</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nportFilteredByTicker.length === 0 && (
              <div className="py-12 text-center text-sm text-cf-text-secondary">{t('empty')}</div>
            )}
          </div>
        </div>
      )}

      {/* blocks/options 탭 UI 제거됨 — 유료 API 의존 (2026-05-23). 재활성 시 git 복원 */}

      {tab === 'korea' && korea && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap justify-between">
            <div className="flex items-center gap-1.5">
              {(['1d', '1w', '4w', '13w'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => { setKoreaPeriod(p); if (p !== koreaPeriod) loadKorea(p); }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${koreaPeriod === p ? 'bg-cf-accent text-white' : 'bg-white/5 text-cf-text-secondary hover:bg-white/10'}`}
                >
                  {p === '1d' ? t('korPeriod1d') : p === '1w' ? t('korPeriod1w') : p === '4w' ? t('korPeriod4w') : t('korPeriod13w')}
                </button>
              ))}
              {koreaLoading && <span className="text-[10px] text-cf-text-secondary animate-pulse">{t('loading')}</span>}
            </div>
            <span className="text-[11px] text-cf-text-secondary">
              {korea.tradingDay} · {korea.totalTickers.toLocaleString()}{t('tickers')}
            </span>
          </div>
          {koreaPeriod !== '1d' && (
            <div className="text-[10px] text-cf-text-secondary/60 px-1">
              {/* effectiveTradingDays 가 cfg.tradingDays 와 다르면 fallback 라벨 우선 표시 */}
              {korea.effectiveTradingDays && korea.effectiveTradingDays < (koreaPeriod === '1w' ? 5 : koreaPeriod === '4w' ? 20 : 65)
                ? t('korPeriodDesc', { days: korea.effectiveTradingDays })
                : t('korPeriodDesc', { days: koreaPeriod === '1w' ? 5 : koreaPeriod === '4w' ? 20 : 65 })}
            </div>
          )}
          {korea.fallback && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-cf-text-secondary border border-white/10">
              {t('koreaFallback')}
            </span>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <KoreaTable title={`🟢 ${t('foreignTopBuy')}`} rows={korea.topForeignBuy} field="foreignerNetBuy" positive fallback={korea.fallback} />
            <KoreaTable title={`🔴 ${t('foreignTopSell')}`} rows={korea.topForeignSell} field="foreignerNetBuy" fallback={korea.fallback} />
            <KoreaTable title={`🟢 ${t('instTopBuy')}`} rows={korea.topInstBuy} field="institutionNetBuy" positive fallback={korea.fallback} />
            <KoreaTable title={`🔴 ${t('instTopSell')}`} rows={korea.topInstSell} field="institutionNetBuy" fallback={korea.fallback} />
          </div>
        </div>
      )}
      {tab === 'korea' && !korea && (
        <div className="cf-card p-8 text-center text-sm text-cf-text-secondary">{t('empty')}</div>
      )}

      <p className="text-[10px] text-cf-text-secondary/40 mt-4">{t('sources')}</p>
    </div>
  );
}

function KoreaTable({ title, rows, field, positive, fallback }: {
  title: string;
  rows: KoreaRow[];
  field: 'foreignerNetBuy' | 'institutionNetBuy';
  positive?: boolean;
  fallback?: boolean;
}) {
  const locale = useLocale();
  return (
    <div className="cf-card overflow-hidden">
      <p className="text-xs font-bold text-cf-text-primary px-3 py-2 border-b border-white/5">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.slice(0, 10).map((r, i) => (
            <tr key={r.ticker} className="border-b border-white/5 last:border-0">
              <td className="px-3 py-2 text-[11px] text-cf-text-secondary w-6 text-right">{i + 1}</td>
              <td className="px-3 py-2">
                <span className="text-[12px] font-semibold text-cf-text-primary">{locale === 'ko' ? (KR_NAME_BY_CODE[r.ticker] ?? r.name) : r.name}</span>
                <span className="ml-1.5 text-[9px] font-mono text-cf-text-secondary/50">{r.ticker}</span>
              </td>
              <td className="px-3 py-2 text-[9px] text-cf-text-secondary/60 hidden sm:table-cell">{r.market}</td>
              <td className="px-3 py-2 font-mono text-xs text-right text-cf-text-secondary">
                {r.closePrice != null ? r.closePrice.toLocaleString() : '-'}
              </td>
              <td className={`px-3 py-2 font-mono text-xs font-bold text-right ${(r.changePct ?? 0) > 0 ? 'text-red-400' : (r.changePct ?? 0) < 0 ? 'text-blue-400' : 'text-cf-text-secondary'}`}>
                {r.changePct != null ? `${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(2)}%` : '-'}
              </td>
              {!fallback && (
                <td className={`px-3 py-2 font-mono text-xs font-bold text-right ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtKrw(r[field])}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={fallback ? 5 : 6} className="px-3 py-4 text-center text-[11px] text-cf-text-secondary">-</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

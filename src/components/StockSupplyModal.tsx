'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  X, TrendingUp, TrendingDown, Minus, BarChart3,
  AlertTriangle, ShieldCheck, Users, Building2,
  Activity, ExternalLink
} from 'lucide-react';

interface OwnershipRecord {
  institution: string;
  valueM: number;
  pctOfShares: number;
  prevPct?: number;
  sharesM?: number;
  quarter: string;
  action: string;
  secUrl: string;
}

interface InsiderTransaction {
  name: string;
  relation: string;
  date: string;
  shares: number;
  value: number;
  text: string;
  isBuy: boolean;
}

interface LiveInstitution {
  name: string;
  pctHeld: number;
  shares: number;
  value: number;
  reportDate: string;
}

interface DailyVolume {
  date: string;
  volume: number;
  close: number;
}

interface SupplyData {
  ticker: string;
  companyName: string;
  price: number | null;
  changePct: number | null;
  ret1w: number | null;
  ret1m: number | null;
  volumeRatio: number | null;
  avgVol10d: number | null;
  avgVol3m: number | null;
  dailyVolume: DailyVolume[];
  marketCap: number | null;
  sharesOutstanding: number | null;
  instHeld: number | null;
  insiderHeld: number | null;
  shortPct: number | null;
  shortRatio: number | null;
  ownership13F: OwnershipRecord[];
  liveInstitutions: LiveInstitution[];
  insiderTransactions: InsiderTransaction[];
  supplyScore: number;
  supplyFactors: string[];
  supplyLabel: string;
  updatedAt: string;
  cached: boolean;
}

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null || isNaN(n)) return '—';
  return n.toFixed(decimals);
}

function fmtLarge(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? '#22c55e' : score >= 55 ? '#84cc16' : score >= 45 ? '#eab308' : score >= 30 ? '#f97316' : '#ef4444';
  const pct = score;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={color} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${pct} ${100 - pct}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-black" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-xs font-bold" style={{ color }}>{label}</span>
    </div>
  );
}

function VolumeBar({ daily }: { daily: DailyVolume[] }) {
  const t = useTranslations('supply');
  if (!daily.length) return null;
  const volumes = daily.map(d => d.volume).filter(v => v > 0);
  if (!volumes.length) {
    return <p className="text-[10px] text-gray-400 italic py-4">{t('volNoData')}</p>;
  }
  const maxVol = Math.max(...volumes);
  const minVol = Math.min(...volumes);
  const range = maxVol - minVol;
  // Normalize to 20~100 range so smallest bar is still visible and differences stand out
  const normHeight = (v: number) => {
    if (range <= 0) return 60;
    return 20 + ((v - minVol) / range) * 80;
  };
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5 h-20">
        {daily.map((d, i) => {
          const h = normHeight(d.volume);
          const isUp = i > 0 ? d.close >= daily[i - 1].close : true;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              <div
                className={`w-full rounded-t-sm ${isUp ? 'bg-green-400' : 'bg-red-400'} transition-all hover:opacity-80`}
                style={{ height: `${h}%`, minHeight: '4px' }}
              />
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-[9px] rounded px-1 py-0.5 whitespace-nowrap z-10">
                {d.date}: {(d.volume / 1e6).toFixed(1)}M · ${d.close.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-400 leading-snug">
        <span className="inline-block w-2 h-2 rounded bg-green-400 mr-1" />{t('volLegendUp')} ·
        <span className="inline-block w-2 h-2 rounded bg-red-400 mx-1" />{t('volLegendDown')} · {t('volLegendHeight')}
      </p>
    </div>
  );
}

interface Props {
  ticker: string;
  onClose: () => void;
}

export default function StockSupplyModal({ ticker, onClose }: Props) {
  const t = useTranslations('supply');
  const [data, setData] = useState<SupplyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'institutions' | 'insiders' | 'ownership'>('overview');

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock-supply?ticker=${ticker}`, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (signal?.aborted) return;
      setData(await res.json());
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  // Close on Escape
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-black text-lg text-violet-600">{ticker}</span>
              {data && <span className="text-sm text-gray-500">{data.companyName}</span>}
            </div>
            {data?.price && (
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-base font-bold">${fmt(data.price, 2)}</span>
                {data.changePct != null && (
                  <span className={`text-xs font-bold ${data.changePct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {data.changePct >= 0 ? '+' : ''}{data.changePct.toFixed(2)}%
                  </span>
                )}
                {data.ret1w != null && (
                  <span className={`text-xs font-bold ${data.ret1w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {data.ret1w >= 0 ? '+' : ''}{fmt(data.ret1w)}% {t('week1')}
                  </span>
                )}
                {data.ret1m != null && (
                  <span className={`text-xs ${data.ret1m >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                    {data.ret1m >= 0 ? '+' : ''}{fmt(data.ret1m)}% {t('month1')}
                  </span>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-100 px-5">
          {(['overview', 'institutions', 'insiders', 'ownership'] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
                tab === tabKey ? 'border-violet-600 text-violet-600' : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {t(`tab.${tabKey}`)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
              <p className="text-sm text-gray-400">{t('loading')}</p>
            </div>
          )}
          {error && (
            <div className="py-8 text-center">
              <p className="text-sm text-red-500 mb-2">{error}</p>
              <button onClick={() => fetchData()} className="text-xs text-violet-600 underline">{t('retry')}</button>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* OVERVIEW TAB */}
              {tab === 'overview' && (
                <div className="space-y-5">
                  {/* Score + metrics */}
                  <div className="flex items-start gap-5">
                    <ScoreGauge score={data.supplyScore} label={data.supplyLabel} />
                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-[10px] text-gray-400 font-medium mb-1">{t('instHeld')}</p>
                        <p className="text-base font-bold">{data.instHeld != null ? `${(data.instHeld * 100).toFixed(1)}%` : '—'}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-[10px] text-gray-400 font-medium mb-1">{t('shortPct')}</p>
                        <p className={`text-base font-bold ${(data.shortPct ?? 0) > 0.1 ? 'text-red-500' : 'text-gray-800'}`}>
                          {data.shortPct != null ? `${(data.shortPct * 100).toFixed(1)}%` : '—'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-[10px] text-gray-400 font-medium mb-1">{t('shortRatio')}</p>
                        <p className="text-base font-bold">{data.shortRatio != null ? `${fmt(data.shortRatio)}${t('shortRatioDays')}` : '—'}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-[10px] text-gray-400 font-medium mb-1">{t('volumeRatio')}</p>
                        <p className={`text-base font-bold ${(data.volumeRatio ?? 1) > 1.5 ? 'text-green-600' : (data.volumeRatio ?? 1) < 0.7 ? 'text-orange-500' : 'text-gray-800'}`}>
                          {data.volumeRatio != null ? `${fmt(data.volumeRatio)}×` : '—'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-[10px] text-gray-400 font-medium mb-1">{t('marketCap')}</p>
                        <p className="text-base font-bold">{fmtLarge(data.marketCap)}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-[10px] text-gray-400 font-medium mb-1">{t('insiderHeld')}</p>
                        <p className="text-base font-bold">{data.insiderHeld != null ? `${(data.insiderHeld * 100).toFixed(1)}%` : '—'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Supply factors */}
                  {data.supplyFactors.length > 0 && (
                    <div className="rounded-xl border border-gray-100 p-4">
                      <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">{t('factors')}</p>
                      <div className="flex flex-wrap gap-2">
                        {data.supplyFactors.map((f, i) => (
                          <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Volume chart */}
                  {data.dailyVolume.length > 0 && (
                    <div className="rounded-xl border border-gray-100 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t('volumeTrend')}</p>
                        {data.avgVol10d && (
                          <span className="text-[10px] text-gray-400">
                            10D Avg: {(data.avgVol10d / 1e6).toFixed(1)}M | 3M Avg: {data.avgVol3m ? (data.avgVol3m / 1e6).toFixed(1) : '—'}M
                          </span>
                        )}
                      </div>
                      <VolumeBar daily={data.dailyVolume} />
                    </div>
                  )}
                </div>
              )}

              {/* INSTITUTIONS TAB */}
              {tab === 'institutions' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">{t('liveHolders')}</p>
                  {data.liveInstitutions.length > 0 ? (
                    data.liveInstitutions.map((inst, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                        <div className="flex items-center gap-3">
                          <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{inst.name}</p>
                            <p className="text-[10px] text-gray-400">{inst.reportDate}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold">{(inst.pctHeld * 100).toFixed(2)}%</p>
                          <p className="text-[10px] text-gray-400">{fmtLarge(inst.value)}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-6">{t('noData')}</p>
                  )}
                </div>
              )}

              {/* INSIDERS TAB */}
              {tab === 'insiders' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">{t('insiderNote')}</p>
                  {data.insiderTransactions.length > 0 ? (
                    data.insiderTransactions.map((tx, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100">
                        <div className={`mt-0.5 p-1.5 rounded-full flex-shrink-0 ${tx.isBuy ? 'bg-green-50' : 'bg-red-50'}`}>
                          {tx.isBuy ? <TrendingUp className="w-3.5 h-3.5 text-green-600" /> : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-800 truncate">{tx.name}</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${tx.isBuy ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                              {tx.isBuy ? t('buy') : t('sell')}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{tx.relation} · {tx.date}</p>
                          {tx.text && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tx.text}</p>}
                        </div>
                        {tx.value > 0 && (
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-bold">{fmtLarge(tx.value)}</p>
                            <p className="text-[10px] text-gray-400">{tx.shares.toLocaleString()} sh</p>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-6">{t('noInsiders')}</p>
                  )}
                </div>
              )}

              {/* 13F OWNERSHIP TAB */}
              {tab === 'ownership' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">{t('ownershipNote')}</p>
                  {data.ownership13F.length > 0 ? (
                    data.ownership13F.map((o, i) => {
                      const diff = o.prevPct !== undefined ? o.pctOfShares - o.prevPct : null;
                      const actionColor = o.action === 'new' || o.action === 'increased'
                        ? 'text-green-600 bg-green-50' : o.action === 'reduced' ? 'text-red-500 bg-red-50' : 'text-gray-500 bg-gray-50';
                      return (
                        <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-gray-100">
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${actionColor}`}>
                              {o.action === 'new' ? t('newPos') : o.action === 'increased' ? t('increased') : o.action === 'reduced' ? t('reduced') : t('maintained')}
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{o.institution}</p>
                              <p className="text-[10px] text-gray-400">{o.quarter}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold">{o.pctOfShares.toFixed(2)}%</p>
                            {diff !== null && diff !== 0 && (
                              <p className={`text-[10px] font-bold ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {diff > 0 ? '+' : ''}{diff.toFixed(2)}%p
                              </p>
                            )}
                            <a href={o.secUrl} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-violet-500 hover:underline flex items-center gap-0.5 justify-end mt-0.5">
                              SEC <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-6">{t('no13F')}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {data && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[10px] text-gray-400">
              {t('source')}: Yahoo Finance · SEC EDGAR · 13F
              {data.cached && ` · ${t('cached')}`}
            </span>
            <span className="text-[10px] text-gray-400">
              {new Date(data.updatedAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

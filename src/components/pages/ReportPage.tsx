'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, BarChart3, Target, Shield, Layers } from 'lucide-react';
import Sparkline from '@/components/Sparkline';
import { UNIVERSE_SEARCH } from '@/data/universe-search';
import { useTranslatedText } from '@/hooks/useTranslatedText';

// 2026-06-12: 주력사업 세그먼트명 번역 (사용자 "번역이 안 되는 경우") — XBRL 추출 세그먼트명은
//   영문. 숫자(%·YoY)는 번역 LLM 에 노출하지 않고 이름부만 번역 — 숫자 환각/훼손 원천 차단.
function TName({ text }: { text: string }) {
  const translated = useTranslatedText(text);
  return <>{translated}</>;
}
// 2026-06-14: 주력제품 목록은 제품명(고유명사/코드: H100·PECVD·GeForce RTX)을 **번역 안 함**.
//   배경(사용자 "이런거 깨지는건 왜 이래?"): 로컬 모델이 영숫자 코드 토큰을 번역하려다 모지바케
//   (¶4◇¦��c◆) 출력. 제품코드는 한/영 공통이라 번역 무의미 — 원문 그대로가 정확·결정론적·GPU 0.
//   퍼센트/연결자는 그대로. (산문 설명은 businessDesc 가 담당, 그쪽은 번역.)
function TBizSummary({ text }: { text: string }) {
  return <>{String(text)}</>;
}
import type { InvestmentStrategy, PortfolioItem, SectorWeight, RiskEvent } from '@/app/api/investment-strategy/route';
import type { HistoryMeta } from '@/app/api/investment-strategy/history/route';

// 2026-06-04: ticker → 회사명 (이름 우선 표시, 코드는 작게). stopLossRationale 등 name 없는 항목용 fallback.
const TICKER_NAME: Record<string, string> = Object.fromEntries(UNIVERSE_SEARCH.map(c => [c.ticker, c.name]));
function displayName(ticker: string, fallback?: string): string {
  const n = (fallback && fallback !== ticker) ? fallback : (TICKER_NAME[ticker] ?? '');
  return n || ticker;
}

// ── KPI types ─────────────────────────────────────────────────────────────────
interface KpiState<T> { loading: boolean; error: boolean; value: T | null; }

type Tr = (k: string, vals?: Record<string, string | number | Date>) => string;

function humanAge(ms: number, t: Tr): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t('ageJustNow');
  const m = Math.floor(s / 60);
  if (m < 60) return t('ageMin', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('ageHour', { n: h });
  return t('ageDay', { n: Math.floor(h / 24) });
}

function freshnessDot(ms: number): string {
  if (ms < 10 * 60 * 1000) return 'bg-emerald-500';
  if (ms < 60 * 60 * 1000) return 'bg-amber-400';
  return 'bg-gray-400';
}

// ── Stance config — no label (computed in component with t()) ─────────────────
function stanceConfig(stance: string) {
  if (stance === 'bullish') return { icon: <TrendingUp className="w-5 h-5" />, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' };
  if (stance === 'bearish') return { icon: <TrendingDown className="w-5 h-5" />, color: 'text-red-600', bg: 'bg-red-50 border-red-200' };
  return { icon: <Minus className="w-5 h-5" />, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' };
}

function riskConfig(level: string) {
  if (level === 'high') return { color: 'text-red-600', bg: 'bg-red-50 border-red-200' };
  if (level === 'low') return { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' };
  return { color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' };
}

function confidenceBadge(c: string) {
  if (c === 'high') return 'bg-emerald-100 text-emerald-700';
  if (c === 'low') return 'bg-gray-100 text-gray-500';
  return 'bg-amber-100 text-amber-700';
}

function fmtSignalDate(d?: string): string {
  if (!d) return '';
  // YYYYMMDD (DART format)
  if (/^\d{8}$/.test(d)) return `${d.slice(4, 6)}-${d.slice(6, 8)}`;
  // YYYY-MM-DDTHH:MM (ISO with time)
  if (d.includes('T')) {
    const [datePart, timePart] = d.split('T');
    const [, mm, dd] = datePart.split('-');
    return `${mm}-${dd} ${timePart.slice(0, 5)}`;
  }
  // YYYY-MM-DD
  if (d.length === 10) return d.slice(5);
  // YYYY-MM (cascade month-level)
  return d;
}

function parseEntryZone(zone: string): { lower: number | null; upper: number | null } {
  const rangeMatch = zone.match(/\$?([\d,]+(?:\.\d+)?)\s*[-–]\s*\$?([\d,]+(?:\.\d+)?)/);
  if (rangeMatch) {
    return {
      lower: parseFloat(rangeMatch[1].replace(',', '')),
      upper: parseFloat(rangeMatch[2].replace(',', '')),
    };
  }
  const single = zone.match(/\$?([\d,]+(?:\.\d+)?)/);
  if (single) {
    const v = parseFloat(single[1].replace(',', ''));
    return { lower: v * 0.98, upper: v * 1.02 };
  }
  return { lower: null, upper: null };
}

function safetyBadge(currentPrice: number | undefined, entryZone: string, t: Tr): { label: string; cls: string } | null {
  if (!currentPrice) return null;
  if (!entryZone || entryZone === '-' || /market|±|N\/A/i.test(entryZone)) return null;
  const { lower, upper } = parseEntryZone(entryZone);
  if (!upper) return null;
  // Sanity check: prices should be within reasonable range (not "1%" parsed as $1)
  if (currentPrice > 0 && upper > 0 && (currentPrice / upper > 20 || upper / currentPrice > 20)) return null;
  if (currentPrice > upper * 1.03) {
    const overPct = Math.round((currentPrice - upper) / upper * 100);
    return { label: t('priceExpensive', { pct: overPct }), cls: 'bg-red-50 text-red-600 border border-red-200' };
  }
  if (!lower || currentPrice >= lower * 0.97) {
    return { label: t('priceEntry'), cls: 'bg-amber-50 text-amber-700 border border-amber-200' };
  }
  const discPct = Math.round((lower - currentPrice) / lower * 100);
  return { label: t('priceCheap', { pct: discPct }), cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
}

function impactBadge(impact: string) {
  if (impact === 'high') return 'bg-red-100 text-red-700';
  if (impact === 'low') return 'bg-gray-100 text-gray-600';
  return 'bg-amber-100 text-amber-700';
}

// ── KPI Pill ──────────────────────────────────────────────────────────────────
function Pill({ loading, error, label, body, cls, sparkline, tooltip }: {
  loading: boolean; error: boolean; label: string; body: string; cls: string;
  sparkline?: number[] | null; tooltip?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap select-none
          ${loading ? 'bg-gray-50 border-gray-200 text-gray-400' : error ? 'bg-gray-50 border-gray-200 text-gray-400' : cls}
          ${tooltip ? 'cursor-pointer' : ''}`}
        onMouseEnter={() => tooltip && setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => tooltip && setOpen(v => !v)}
      >
        {sparkline && sparkline.length > 3 && (
          <span className="inline-block w-10 h-4 mr-0.5 flex-shrink-0">
            <Sparkline values={sparkline} width={40} height={16} />
          </span>
        )}
        <span className="text-[10px] font-normal opacity-70">{label}</span>
        <span>{loading ? '…' : error ? '-' : body}</span>
        {tooltip && <span className="text-[9px] opacity-50 ml-0.5">?</span>}
      </div>
      {open && tooltip && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-gray-200 bg-white shadow-lg p-2.5 text-xs text-gray-700 leading-relaxed pointer-events-none">
          {tooltip}
        </div>
      )}
    </div>
  );
}

// ── Sell Recommendation Card (2026-05-29 신설) ────────────────────────────────
type SellItem = {
  ticker: string; name?: string; sector?: string; market?: 'us' | 'kr';
  currentPrice?: string; entryPrice?: string | null; target?: string | null; stopLoss?: string | null;
  pnlPct?: number | null; heldDays?: number; score?: number; ruleId?: string; entryDate?: string | null; firstSellDate?: string | null;
  rationale?: string; sellType?: string; urgency?: 'high' | 'medium' | 'low'; buyConflict?: string;
  sellLadder?: { pct: number; price: string; label: string; action: string }[];
};

// 2026-06-12: 매도 유형 배지 (사용자 "익절인지 위험이탈인지 구분 안 됨" — POSCO 익절 사건).
//   ruleId 기반 결정론 분류 — 🟢 익절 / 🔴 손절·방어 / 🟠 종목 악화 / 🔵 시장 환경.
function sellKind(ruleId?: string): { key: string; cls: string; icon: string } | null {
  if (!ruleId) return null;
  if (ruleId === 'price_target_near' || ruleId === 'rotation_profit')
    return { key: 'sellKindProfit', cls: 'text-green-700 bg-green-50 border-green-200', icon: '🟢' };
  if (ruleId.startsWith('price_stop') || ruleId === 'rotation_loss')
    return { key: 'sellKindStop', cls: 'text-red-700 bg-red-50 border-red-200', icon: '🔴' };
  if (/^(tech_|fund_|guru_)/.test(ruleId) || ['micro_news_negative', 'micro_insider_selling', 'micro_13f_distribution'].includes(ruleId))
    return { key: 'sellKindWeak', cls: 'text-orange-700 bg-orange-50 border-orange-200', icon: '🟠' };
  return { key: 'sellKindMacro', cls: 'text-blue-700 bg-blue-50 border-blue-200', icon: '🔵' };
}
function SellCard({ item }: { item: SellItem }) {
  const locale = useLocale();
  const t = useTranslations('report');
  const urgencyColor = item.urgency === 'high' ? 'border-red-300 bg-red-50' :
                       item.urgency === 'medium' ? 'border-orange-300 bg-orange-50' :
                       'border-gray-200 bg-white';
  const urgencyTag = item.urgency === 'high' ? '🔴' : item.urgency === 'medium' ? '🟠' : '⚪';
  const pnlColor = (item.pnlPct ?? 0) >= 0 ? 'text-green-700' : 'text-red-700';
  return (
    <div className={`rounded-lg border p-2.5 ${urgencyColor}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-bold text-sm text-gray-900">
          {urgencyTag} <Link href={`/${locale}/company/${item.ticker}`} className="text-violet-700 hover:text-violet-900 hover:underline">{displayName(item.ticker, item.name)}</Link> <span className="text-[10px] font-normal text-gray-400 font-mono">{item.ticker}</span>
        </span>
        {item.pnlPct != null && (
          <span className={`text-xs font-semibold ${pnlColor}`}>
            {item.pnlPct >= 0 ? '+' : ''}{item.pnlPct.toFixed(1)}%
          </span>
        )}
      </div>
      {/* 2026-06-12 v2 (사용자 "잘 보이게 분할 익절 하세요 식으로"): 행동 지시 스트립 — 카드 상단 전폭 */}
      {(() => { const k = sellKind(item.ruleId); return k ? (
        <p className={`text-[11px] font-bold border rounded-md px-2 py-1 mb-1.5 ${k.cls}`}>{k.icon} {t(k.key)}</p>
      ) : null; })()}
      <p className="text-xs text-gray-700 mb-1.5 leading-snug">{item.rationale}</p>
      {item.buyConflict && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 mb-1.5 leading-snug">⚖️ {item.buyConflict}</p>
      )}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-gray-500 mb-2">
        <span>현재 {item.currentPrice}</span>
        {item.entryPrice && <span>· entry {item.entryPrice}{item.entryDate ? ` (매수추천 ${item.entryDate.slice(5).replace('-', '/')})` : ''}</span>}
        {item.target && <span>· target {item.target}</span>}
        {item.stopLoss && <span>· stop {item.stopLoss}</span>}
        <span>· 보유 {item.heldDays}일</span>
        {item.firstSellDate && <span>· 매도권장 {item.firstSellDate.slice(5).replace('-', '/')}부터</span>}
      </div>
      {Array.isArray(item.sellLadder) && item.sellLadder.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-200 space-y-0.5">
          <p className="text-[10px] font-bold text-gray-600 mb-0.5">📉 {t('sellLadderTitle')}</p>
          {item.sellLadder.map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="font-bold text-gray-700 min-w-[2.5rem]">{step.pct}%</span>
              <span className="text-gray-600">@ {step.price}</span>
              <span className="text-gray-500">— {step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Portfolio Card ────────────────────────────────────────────────────────────
function PortfolioCard({ item, rank }: { item: PortfolioItem; rank: number }) {
  const t = useTranslations('report');
  const locale = useLocale();
  const confidenceLabel = item.confidence === 'high' ? t('confidenceHigh') : item.confidence === 'low' ? t('confidenceLow') : t('confidenceMedium');
  const badge = safetyBadge(item.currentPrice, item.entryZone, t as Tr);
  const isWatch = item.action === 'watch';
  return (
    <div className={`rounded-xl overflow-hidden hover:shadow-md transition-shadow ${isWatch ? 'border-2 border-orange-400 bg-orange-50' : 'border border-gray-200 bg-white'}`}>
      {isWatch && (
        <div className="bg-orange-500 px-4 py-2">
          <div className="flex items-start gap-1.5">
            <span className="text-xs font-bold text-white shrink-0">⚠️ 관망</span>
            <span className="text-xs text-orange-100 leading-relaxed">
              {item.critiqueNote ?? item.riskNote ?? '현재가 고점권 — 조정 후 재진입 검토'}
            </span>
          </div>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${isWatch ? 'bg-orange-400' : 'bg-gradient-to-br from-violet-500 to-blue-500'}`}>
              {rank}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/${locale}/company/${item.ticker}`} className="font-bold text-violet-700 hover:text-violet-900 hover:underline">{displayName(item.ticker, item.name)}</Link>
                <span className="text-[10px] font-normal text-gray-400 font-mono">{item.ticker}</span>
                {item.action === 'buy' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500 text-white">{t('actionBuy')}</span>
                )}
                {isWatch && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-500 text-white border border-orange-600">⚠️ {t('actionWatch')}</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${confidenceBadge(item.confidence)}`}>
                  {confidenceLabel}
                </span>
              </div>
              <p className="text-xs text-gray-500">{item.sector}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-violet-600 text-sm">{item.allocation}%</p>
            <p className="text-[10px] text-gray-400">{t('allocWeight')}</p>
          </div>
        </div>
        {/* Current price — prominent */}
        {item.currentPrice != null && (
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-gray-900 font-mono">${item.currentPrice.toFixed(item.currentPrice >= 100 ? 2 : 2)}</span>
            <span className="text-xs text-gray-400">{t('currentPrice')}</span>
          </div>
        )}
        <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{item.rationale}</p>
        {item.critiqueNote && (
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 leading-relaxed">
            ✏️ {item.critiqueNote}
          </p>
        )}

        {/* Entry zone + target — always visible */}
        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-400">{t('entryZone')}</span>
            <span className="font-semibold text-gray-800 font-mono">{item.entryZone}</span>
          </div>
          <span className="text-gray-200">·</span>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-400">{t('targetPrice')}</span>
            <span className="font-semibold text-emerald-600 font-mono">{item.target}</span>
            {item.targetBull && (
              <span className="text-[10px] text-violet-600 font-semibold ml-0.5">
                / 🚀{item.targetBull}
              </span>
            )}
          </div>
          {badge && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badge.cls}`}>{badge.label}</span>
          )}
          {/* Stop loss — always visible */}
          {item.stopLoss && (
            <>
              <span className="text-gray-200">·</span>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-gray-400">{t('stopLoss')}</span>
                <span className="font-semibold text-red-600 font-mono">{item.stopLoss}</span>
              </div>
            </>
          )}
        </div>
        {/* IV → 평이한 설명 (손절 칸 옆/아래). atmIv30d 연율 → 일간 기대등락(=IV/√252) + 변동 수준 + 옵션 skew 심리 */}
        {item.impliedVol != null && (() => {
          const iv = item.impliedVol as number;
          const daily = (iv / 15.87).toFixed(1); // 연율 IV → 일간 (√252 ≈ 15.87)
          const level = iv < 20 ? t('ivLevelLow')
            : iv < 35 ? t('ivLevelMid')
            : iv < 55 ? t('ivLevelHigh') : t('ivLevelExtreme');
          // skew25d = σ(25Δ put) − σ(25Δ call): +면 하락 헤지 수요(방어), −면 콜 매수 우위(상승 기대)
          const skewMsg = item.ivSkew == null ? null
            : item.ivSkew >= 1.5 ? t('ivSkewDown')
            : item.ivSkew <= -1.5 ? t('ivSkewUp') : t('ivSkewNeutral');
          // 2026-06-06: 변동성 수준별 색상 + 연율 라벨(33.9% = 연율 기준임을 명시)
          const ivColor = iv < 20 ? 'text-emerald-600' : iv < 35 ? 'text-sky-600' : iv < 55 ? 'text-amber-600' : 'text-red-600';
          const ivBg = iv < 20 ? 'bg-emerald-50 border-emerald-200' : iv < 35 ? 'bg-sky-50 border-sky-200' : iv < 55 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
          return (
            <div className={`mt-1.5 inline-flex items-start gap-1 text-[11px] leading-relaxed border rounded px-1.5 py-0.5 ${ivBg}`}
                 title="ATM 30일 옵션 내재변동성 (연율 기준). 옵션시장이 기대하는 향후 1년 변동폭 — 하루 환산 = IV÷√252.">
              <span className="shrink-0">📊</span>
              <span className="text-gray-600">
                {t('ivPlainVol')} <span className={`font-bold ${ivColor}`}>{iv}%</span>
                <span className="text-gray-400"> {t('ivAnnualized')}</span> ({level}) · {t('ivPlainDaily', { daily })}
                {skewMsg ? ` · ${skewMsg}` : ''}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Detail section — always visible */}
      {(item.action === 'buy' || isWatch) && (item.businessSummary || item.businessDesc || item.catalysts?.length || item.fundamentalBasis || item.technicalBasis || item.riskNote || item.entryRationale || item.targetRationale || item.critiqueNote) && (
        <div className={`border-t px-4 py-3 space-y-2.5 ${isWatch ? 'border-orange-200 bg-orange-50/60' : 'border-gray-100 bg-gray-50'}`}>
          {(item.businessSummary || item.businessDesc) && (
            <div className="bg-white rounded-lg border border-violet-100 px-2.5 py-1.5">
              <p className="text-[10px] font-bold text-violet-700 mb-0.5">{t('businessLabel')}</p>
              {item.businessSummary && <p className="text-xs text-gray-800 font-medium leading-relaxed"><TBizSummary text={item.businessSummary} /></p>}
              {item.businessDesc && <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5"><TName text={item.businessDesc} /></p>}
            </div>
          )}
          {item.catalysts && item.catalysts.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">{t('catalystsLabel')}</p>
              <ul className="space-y-0.5">
                {item.catalysts.map((c, i) => (
                  <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                    <span className="text-emerald-500 mt-0.5 shrink-0">▸</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(item.fundamentalBasis || item.technicalBasis) && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {item.fundamentalBasis && (
                <div className="bg-white rounded-lg border border-gray-100 px-2.5 py-1.5">
                  <p className="text-[10px] font-bold text-violet-600 mb-0.5">{t('fundamentalBasisLabel')}</p>
                  <p className="text-xs text-gray-700 leading-relaxed">{item.fundamentalBasis}</p>
                </div>
              )}
              {item.technicalBasis && (
                <div className="bg-white rounded-lg border border-gray-100 px-2.5 py-1.5">
                  <p className="text-[10px] font-bold text-blue-600 mb-0.5">{t('technicalBasisLabel')}</p>
                  <p className="text-xs text-gray-700 leading-relaxed">{item.technicalBasis}</p>
                </div>
              )}
            </div>
          )}
          {item.riskNote && !isWatch && (
            <div className="bg-red-50 rounded-lg border border-red-100 px-2.5 py-1.5">
              <p className="text-[10px] font-bold text-red-600 mb-0.5">{t('riskNoteLabel')}</p>
              <p className="text-xs text-red-700 leading-relaxed">{item.riskNote}</p>
            </div>
          )}
          {item.riskNote && isWatch && item.critiqueNote && item.riskNote !== item.critiqueNote && (
            <div className="bg-orange-50 rounded-lg border border-orange-200 px-2.5 py-1.5">
              <p className="text-[10px] font-bold text-orange-700 mb-0.5">⚠️ {t('riskNoteLabel')}</p>
              <p className="text-xs text-orange-800 leading-relaxed">{item.riskNote}</p>
            </div>
          )}
          {item.entryRationale && (
            <div className="text-xs">
              <span className="text-gray-400 mr-1">📍 {t('entryRationaleLabel')}</span>
              <span className="text-gray-700">{item.entryRationale}</span>
            </div>
          )}
          {item.targetRationale && (
            <div className="text-xs">
              <span className="text-gray-400 mr-1">🎯 {t('targetRationaleLabel')}</span>
              <span className="text-gray-700">{item.targetRationale}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sector Bar ────────────────────────────────────────────────────────────────
function SectorBar({ item }: { item: SectorWeight }) {
  const t = useTranslations('report');
  const stanceColor = item.stance === 'overweight' ? 'bg-emerald-500' : item.stance === 'underweight' ? 'bg-red-400' : 'bg-gray-400';
  const stanceTxt = item.stance === 'overweight' ? 'text-emerald-600' : item.stance === 'underweight' ? 'text-red-500' : 'text-gray-500';
  const stanceLabel = item.stance === 'overweight' ? t('sectorOverweight') : item.stance === 'underweight' ? t('sectorUnderweight') : t('sectorNeutral');
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0">
        <p className="text-xs font-medium text-gray-700 truncate">{item.sector}</p>
        <p className={`text-[10px] ${stanceTxt}`}>{stanceLabel}</p>
      </div>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${stanceColor}`} style={{ width: `${Math.min(item.pct, 100)}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-600 w-8 text-right shrink-0">{item.pct}%</span>
      <p className="text-[10px] text-gray-400 hidden sm:block truncate max-w-[140px]">{item.reason}</p>
    </div>
  );
}

// ── Risk Event Row ────────────────────────────────────────────────────────────
function RiskEventRow({ event }: { event: RiskEvent }) {
  const t = useTranslations('report');
  const impactLabel = event.impact === 'high' ? t('impactHigh') : event.impact === 'medium' ? t('impactMedium') : t('impactLow');
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex flex-col items-center shrink-0 pt-0.5">
        <span className="text-[10px] font-bold text-gray-400">{event.date.slice(5)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-gray-800">{event.event}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${impactBadge(event.impact)}`}>
            {impactLabel}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{event.watchFor}</p>
      </div>
    </div>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────
function sourceBadge(src: string): { label: string; cls: string } {
  const s = src.toLowerCase();
  if (s.includes('70b') || s.includes('groq')) return { label: 'GROQ 70b', cls: 'bg-violet-100 text-violet-700 border-violet-200' };
  if (s.includes('gemini')) return { label: 'Gemini', cls: 'bg-blue-100 text-blue-700 border-blue-200' };
  if (s.includes('fallback') || s.includes('data')) return { label: 'Fallback', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  return { label: src || 'AI', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ReportPage() {
  const t = useTranslations('report');
  const locale = useLocale();

  const [data, setData] = useState<InvestmentStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);

  // History
  const [historyItems, setHistoryItems] = useState<HistoryMeta[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyExpired, setHistoryExpired] = useState(false);

  // KPI strip
  const [fg,    setFg]    = useState<KpiState<{ score: number }>>({ loading: true, error: false, value: null });
  const [spy,   setSpy]   = useState<KpiState<{ ret1w: number }>>({ loading: true, error: false, value: null });
  const [curve, setCurve] = useState<KpiState<{ spread: number; inverted: boolean }>>({ loading: true, error: false, value: null });
  const [vix,   setVix]   = useState<KpiState<{ level: number | null }>>({ loading: true, error: false, value: null });
  const [fomc,  setFomc]  = useState<KpiState<{ label: string; probCut: number }>>({ loading: true, error: false, value: null });
  const [spySpark, setSpySpark] = useState<number[] | null>(null);
  const kpiAbortRef = useRef<AbortController | null>(null);

  // 주요 뉴스 (news-cascade) — 48시간 이내 fresh only
  interface NewsItem {
    id: string;
    title: string;
    summary: string;
    link: string;
    pubDate?: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    importance: 'high' | 'medium' | 'low';
    cascades?: Array<{ asset: string; direction: 'positive' | 'negative' | 'neutral'; magnitude: 'high' | 'medium' | 'low'; reason: string }>;
  }
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);

  // 2026-06-13: 장중 보고서 회원 게이트 — null=확인중(게이트 미적용, 깜빡임 방지), true/false 확정
  const [member, setMember] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/member').then(r => r.json()).then(d => setMember(!!d.member)).catch(() => setMember(false));
  }, []);
  const GATED_SESSIONS = ['noon', 'afternoon', 'evening', 'midnight'];
  const dataSession = (data as unknown as { session?: string } | null)?.session;
  const gated = member === false && !!dataSession && GATED_SESSIONS.includes(dataSession);

  const fetchStrategy = useCallback(async (force = false) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams();
      if (force) params.set('force', '1');
      params.set('locale', locale);
      const res = await fetch(`/api/investment-strategy?${params}`, { signal: ctrl.signal, cache: 'no-store' });
      if (ctrl.signal.aborted) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as InvestmentStrategy;
      if (!ctrl.signal.aborted) setData(json);
    } catch {
      // leave previous data visible on refresh fail
    } finally {
      if (!ctrl.signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [locale]);

  const fetchKpis = useCallback(async () => {
    kpiAbortRef.current?.abort();
    const ctrl = new AbortController();
    kpiAbortRef.current = ctrl;
    const { signal } = ctrl;

    setFg({ loading: true, error: false, value: null });
    setSpy({ loading: true, error: false, value: null });
    setCurve({ loading: true, error: false, value: null });
    setVix({ loading: true, error: false, value: null });
    setFomc({ loading: true, error: false, value: null });

    void fetch('/api/fear-greed', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const us = (j?.byCountry ?? []).find((x: { id?: string }) => x?.id === 'us');
      if (!signal.aborted) setFg({ loading: false, error: !us, value: us ? { score: us.score } : null });
    }).catch(() => { if (!signal.aborted) setFg({ loading: false, error: true, value: null }); });

    void fetch('/api/capital-flows', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const assets: Array<{ ticker?: string; ret1w?: number }> = j?.assets ?? [];
      const spyRow = assets.find(a => a.ticker === 'SPY');
      if (!signal.aborted) setSpy({ loading: false, error: !spyRow, value: spyRow ? { ret1w: spyRow.ret1w ?? 0 } : null });
    }).catch(() => { if (!signal.aborted) setSpy({ loading: false, error: true, value: null }); });

    void fetch('/api/yield-curve', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const raw = j?.spread2s10sCurrent ?? j?.spread ?? j?.spreadBp;
      // spread2s10sCurrent is in % (e.g. 0.51 = 51bp); legacy spreadBp already in bp
      const sp = raw != null ? (j?.spread2s10sCurrent != null ? Math.round(raw * 100) : raw) : null;
      if (!signal.aborted) setCurve({ loading: false, error: sp == null, value: sp != null ? { spread: sp, inverted: sp < 0 } : null });
    }).catch(() => { if (!signal.aborted) setCurve({ loading: false, error: true, value: null }); });

    void fetch('/api/volatility', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const level = j?.vix30d ?? j?.vix ?? null;
      if (!signal.aborted) setVix({ loading: false, error: level == null, value: { level } });
    }).catch(() => { if (!signal.aborted) setVix({ loading: false, error: true, value: null }); });

    void fetch('/api/fedwatch', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const next = (j?.meetings ?? [])[0];
      if (!signal.aborted) setFomc({ loading: false, error: !next, value: next ? { label: next.label, probCut: next.probCut25 ?? 0 } : null });
    }).catch(() => { if (!signal.aborted) setFomc({ loading: false, error: true, value: null }); });

    void fetch('/api/price-history?ticker=SPY&days=30', { signal }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(j => {
      const closes = (j?.prices ?? []).map((p: { close?: number }) => p.close).filter(Boolean);
      if (!signal.aborted && closes.length > 3) setSpySpark(closes);
    }).catch(() => {});
  }, []);

  // Load history list
  useEffect(() => {
    fetch('/api/investment-strategy/history', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setHistoryItems(d.items ?? []))
      .catch(() => {});
  }, []);

  // Load specific historical report when tab selected
  const loadHistoricalReport = useCallback(async (redisKey: string, generatedAt: string) => {
    setSelectedHistoryId(generatedAt);
    setHistoryExpired(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/investment-strategy/history?key=${encodeURIComponent(redisKey)}`, { cache: 'no-store' });
      const d = await res.json();
      if (d.report) {
        setData(d.report);
      } else {
        // 키 만료 또는 삭제된 경우 — 현재 데이터 유지하되 만료 표시
        setHistoryExpired(true);
      }
    } catch { setHistoryExpired(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchStrategy();
    fetchKpis();
    const iv = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => {
      clearInterval(iv);
      abortRef.current?.abort();
      kpiAbortRef.current?.abort();
    };
  }, [fetchStrategy, fetchKpis]);

  useEffect(() => {
    // 주요 뉴스 fetch (news-cascade, locale 인식). 48시간 이내만 통과 (stale 차단)
    setNewsLoading(true);
    fetch(`/api/news-cascade?locale=${encodeURIComponent(locale)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const cutoff = Date.now() - 48 * 3600 * 1000;
        const fresh = (d.articles ?? []).filter((a: NewsItem) => {
          if (!a.pubDate) return false;
          const ts = new Date(a.pubDate).getTime();
          return isFinite(ts) && ts >= cutoff;
        });
        setNews(fresh);
      })
      .catch(() => {})
      .finally(() => setNewsLoading(false));
  }, [locale]);

  const ageMs = data ? nowTick - new Date(data.generatedAt).getTime() : 0;
  const sb = data ? sourceBadge(data.source) : null;

  // ── Loading: data 없을 때만 최소 스피너 (보통은 stale/fallback이 즉시 옴) ──
  if (loading && !data) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex flex-col items-center gap-3 text-gray-400 py-20">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          <p className="text-sm">{t('loadingText')}</p>
        </div>
      </div>
    );
  }

  const stanceCfg = data ? stanceConfig(data.stance) : null;
  const riskCfg = data ? riskConfig(data.riskLevel) : null;
  const stanceLabel = data ? (data.stance === 'bullish' ? t('stanceBullish') : data.stance === 'bearish' ? t('stanceBearish') : t('stanceNeutral')) : '';
  const riskLevelLabel = data ? (data.riskLevel === 'high' ? t('riskHigh') : data.riskLevel === 'low' ? t('riskLow') : t('riskMedium')) : '';

  const stanceIcon = (s: string) => s === 'bullish' ? '↑' : s === 'bearish' ? '↓' : '→';
  const stanceColor = (s: string) => s === 'bullish' ? 'text-emerald-600' : s === 'bearish' ? 'text-red-500' : 'text-amber-600';

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">

      {/* ── History Tabs ──────────────────────────────────────────────────── */}
      {historyItems.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <div className="flex gap-1.5 pb-1 min-w-max">
            <button
              onClick={() => { setSelectedHistoryId(null); setHistoryExpired(false); fetchStrategy(); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all border
                ${selectedHistoryId === null
                  ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t('latestReport')}
            </button>
            {historyItems.map((item) => (
              <button
                key={item.generatedAt || item.key}
                onClick={() => loadHistoricalReport(item.key, item.generatedAt)}
                className={`flex flex-col items-start px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all border
                  ${selectedHistoryId === item.generatedAt
                    ? 'bg-gray-800 text-white border-gray-800 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
              >
                <span className="font-medium flex items-center gap-1">
                  <span className={stanceColor(item.stance)}>{stanceIcon(item.stance)}</span>
                  {item.kstDate}
                  {item.source && item.source === 'fallback' && (
                    <span className="text-[9px] opacity-40 font-normal">F</span>
                  )}
                </span>
                <span className="text-[10px] opacity-60">{item.sessionLabel}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 히스토리 만료 배너 ──────────────────────────────────────────────── */}
      {historyExpired && selectedHistoryId && (
        <div className="mb-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          <span>⚠️</span>
          <span>{t('historyExpiredNote')}</span>
          <button
            onClick={() => { setSelectedHistoryId(null); setHistoryExpired(false); fetchStrategy(); }}
            className="ml-auto text-amber-600 underline font-medium"
          >{t('latestReport')}</button>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('pageTitle')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('pageDesc')}</p>
        </div>
        <div className="flex items-center gap-2">
          {sb && (
            <span className={`text-[10px] px-2 py-1 rounded border font-medium ${sb.cls}`}>{sb.label}</span>
          )}
          {data && (
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className={`w-1.5 h-1.5 rounded-full ${freshnessDot(ageMs)}`} />
              {new Date(data.generatedAt).toLocaleString()}
            </span>
          )}
          <button
            onClick={() => fetchStrategy(false)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </button>
        </div>
      </div>

      {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-5">
        <Pill loading={fg.loading} error={fg.error} label="F&G" cls={`${fg.value && fg.value.score > 70 ? 'bg-red-50 text-red-700 border-red-200' : fg.value && fg.value.score >= 45 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}
          body={fg.value ? `${fg.value.score}` : '-'} tooltip={t('tipFg')} />
        <Pill loading={spy.loading} error={spy.error} label="SPY" cls={`${spy.value && spy.value.ret1w >= 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}
          body={spy.value ? `${spy.value.ret1w > 0 ? '+' : ''}${spy.value.ret1w.toFixed(2)}%` : '-'} sparkline={spySpark} tooltip={t('tipSpy')} />
        <Pill loading={curve.loading} error={curve.error} label="10Y-2Y" cls={`${curve.value && curve.value.inverted ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}
          body={curve.value ? `${curve.value.spread > 0 ? '+' : ''}${curve.value.spread}bp` : '-'} tooltip={t('tipCurve')} />
        <Pill loading={vix.loading} error={vix.error} label="VIX" cls={`${vix.value && (vix.value.level ?? 0) > 25 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}
          body={vix.value?.level != null ? `${vix.value.level.toFixed(1)}` : '-'} tooltip={t('tipVix')} />
        <Pill loading={fomc.loading} error={fomc.error} label="FOMC" cls="bg-violet-50 text-violet-700 border-violet-200"
          body={fomc.value ? `${fomc.value.label} ${fomc.value.probCut}%` : '-'} tooltip={t('tipFomc')} />
      </div>

      {/* ── No data fallback ──────────────────────────────────────────────── */}
      {!data && (
        <div className="text-center py-12 text-gray-400">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-400" />
          <p>{t('error')}</p>
        </div>
      )}

      {data && (
        <>
          {/* ── 2026-06-06: 급락 위험 조기경보 — 리스크 높을 때 시각적으로 강하게(사용자 요청) ── */}
          {data.earlyWarning && ['high', 'severe'].includes(data.earlyWarning.level) && (
            <div className={`rounded-2xl border-2 p-4 mb-5 ${data.earlyWarning.level === 'severe' ? 'border-red-500 bg-red-50 animate-pulse shadow-lg shadow-red-200' : 'border-orange-400 bg-orange-50'}`}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-2xl">{data.earlyWarning.level === 'severe' ? '🚨' : '⚠️'}</span>
                <span className={`font-extrabold text-lg ${data.earlyWarning.level === 'severe' ? 'text-red-700' : 'text-orange-700'}`}>
                  {t('ewTitle')} — {data.earlyWarning.level === 'severe' ? t('ewSevere') : t('ewHigh')}
                </span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${data.earlyWarning.level === 'severe' ? 'bg-red-600 text-white' : 'bg-orange-500 text-white'}`}>
                  {t('ewScore')} {data.earlyWarning.score}/100
                </span>
              </div>
              <ul className="space-y-0.5">
                {data.earlyWarning.drivers.map((d, i) => (
                  <li key={i} className="text-xs text-gray-800 flex items-start gap-1.5"><span className="text-red-500 mt-0.5 shrink-0">▸</span><span>{d}</span></li>
                ))}
              </ul>
              <p className="text-[10px] text-gray-500 mt-2">{t('ewNote')}</p>
            </div>
          )}
          {/* ── Investment Stance Hero ─────────────────────────────────────── */}
          <div className={`rounded-2xl border p-5 mb-5 ${stanceCfg!.bg}`}>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <div className={`flex items-center gap-2 font-bold text-lg ${stanceCfg!.color}`}>
                {stanceCfg!.icon}
                <span>{stanceLabel}</span>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${riskCfg!.bg} ${riskCfg!.color}`}>
                {t('riskLabel')} {riskLevelLabel}
              </span>
              {data.cached && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{t('cached')}</span>}
            </div>
            {data.dataAsOf && (
              <p className="text-[10px] text-gray-400 mt-0.5 mb-1.5">
                {t('dataAsOf')} {new Date(data.dataAsOf).toLocaleString()}
              </p>
            )}
            <p className="text-sm font-medium text-gray-800 leading-relaxed">{data.thesis}</p>
          </div>

          {/* ── 종합 판단 (2026-06-13): US·거시 / KR 별도 박스, 각자 독립 stance ── */}
          {(() => {
            const mv = (data as unknown as { marketVerdict?: { verdict: string; reasons: string[]; reasonRegions?: string[]; krVerdict?: { verdict: string; reasons: string[] } } }).marketVerdict;
            if (!mv?.verdict) return null;
            const cfg: Record<string, { icon: string; cls: string }> = {
              buy_dip:       { icon: '🟢', cls: 'border-emerald-400 bg-emerald-50 text-emerald-800' },
              accumulate:    { icon: '🟩', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
              neutral_ready: { icon: '🟡', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
              neutral:       { icon: '⚪', cls: 'border-gray-300 bg-gray-50 text-gray-700' },
              wait:          { icon: '🟠', cls: 'border-orange-300 bg-orange-50 text-orange-800' },
              defensive:     { icon: '🔴', cls: 'border-red-400 bg-red-50 text-red-800' },
            };
            const renderList = (items: string[]) => (
              <ul className="space-y-1">
                {items.map((r, i) => (
                  <li key={i} className="text-xs leading-relaxed flex items-start gap-1.5"><span className="opacity-50 mt-0.5 shrink-0">▸</span><span><TName text={r} /></span></li>
                ))}
              </ul>
            );
            const box = (title: string, verdict: string, body: React.ReactNode) => {
              const c = cfg[verdict] ?? cfg.neutral;
              return (
                <div className={`rounded-xl border-2 p-4 ${c.cls}`}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-lg">{c.icon}</span>
                    <span className="font-extrabold text-base">{title}: {t(`verdict_${verdict}`)}</span>
                  </div>
                  {body}
                  <p className="text-[10px] opacity-60 mt-2">{t('verdictNote')}</p>
                </div>
              );
            };
            const hasKr = mv.krVerdict?.verdict && Array.isArray(mv.krVerdict.reasons);
            if (hasKr) {
              // 두 박스: 🇺🇸 미국·거시 / 🇰🇷 한국 — 각자 독립 stance (사용자 "다른 박스로 종합판단 따로")
              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
                  {box(`🇺🇸 ${t('verdictUsTitle')}`, mv.verdict, renderList(mv.reasons))}
                  {box(`🇰🇷 ${t('verdictKrTitle')}`, mv.krVerdict!.verdict, renderList(mv.krVerdict!.reasons))}
                </div>
              );
            }
            // 구버전 보고서(krVerdict 없음): 단일 박스 + reasonRegions 그룹 fallback
            const regions = Array.isArray(mv.reasonRegions) && mv.reasonRegions.length === mv.reasons.length ? mv.reasonRegions : null;
            let body: React.ReactNode;
            if (!regions) body = renderList(mv.reasons);
            else {
              const groups: { key: string; label: string; items: string[] }[] = [
                { key: 'global', label: t('verdictRegionGlobal'), items: [] },
                { key: 'us', label: `🇺🇸 ${t('verdictRegionUs')}`, items: [] },
                { key: 'kr', label: `🇰🇷 ${t('verdictRegionKr')}`, items: [] },
              ];
              mv.reasons.forEach((r, i) => { (groups.find(x => x.key === (regions[i] || 'global')) ?? groups[0]).items.push(r); });
              body = <div className="space-y-2.5">{groups.filter(g => g.items.length > 0).map(g => (<div key={g.key}><p className="text-[11px] font-bold opacity-70 mb-0.5">{g.label}</p>{renderList(g.items)}</div>))}</div>;
            }
            return <div className="mb-5">{box(t('verdictTitle'), mv.verdict, body)}</div>;
          })()}

          {/* ── 작전주 매집 감시 (2026-06-14): 오르기 前 매집 의심 + KRX 공식 소수계좌 거래집중 ── */}
          {(() => {
            const mw = (data as unknown as { manipulationWatch?: { items?: Array<{ ticker: string; name: string; score: number; signals?: string[]; official?: { fewAccount?: boolean; reason?: string | null } | null; runup20dPct?: number | null }>; officialFewAccount?: number; stale?: boolean } }).manipulationWatch;
            if (!mw?.items?.length) return null;
            return (
              <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 mb-5">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xl">🚨</span>
                  <span className="font-extrabold text-base text-rose-800">{t('manipWatchTitle')}</span>
                  <span className="text-[11px] font-medium text-rose-600">{t('manipWatchSubtitle')}</span>
                  {mw.stale && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">stale</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {mw.items.slice(0, 8).map((it, i) => (
                    <a key={`${it.ticker}-${i}`} href={`/company/${it.ticker}`} className="block rounded-lg bg-white border border-rose-200 p-2.5 hover:border-rose-400 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-sm text-gray-800 truncate">{it.name} <span className="font-mono text-[10px] text-gray-400">{it.ticker}</span></span>
                        {it.official?.fewAccount
                          ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500 text-white font-bold shrink-0">{t('manipWatchFewAccount')}</span>
                          : <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-200 text-rose-700 font-bold shrink-0 tabular-nums">{it.score}</span>}
                      </div>
                      <p className="text-[10px] text-gray-500 leading-tight line-clamp-2">{(it.signals ?? []).slice(0, 3).join(' · ')}</p>
                    </a>
                  ))}
                </div>
                <p className="text-[10px] text-rose-600/70 mt-2">{t('manipWatchNote')}</p>
              </div>
            );
          })()}

          {/* ── 2026-06-13: 장중 보고서 회원 게이트 (사용자 "장중 보고서는 회원가입 해야") ──
              noon/afternoon/evening/midnight = 비회원에게 stance·종합판단까지만 + 가입 카드.
              morning(07:00)은 전체 무료(맛보기). 이메일 등록 즉시 해제 (쿠키 1년). */}
          {gated ? (
            <MemberGate onUnlock={() => setMember(true)} t={t} />
          ) : (
          <>
          {/* ── S6: 시장 내러티브 (Why + Watch + Story) ─────────────────────── */}
          {data.marketNarrative && (
            <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50 p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-sm font-bold text-amber-800">📖 {t('marketNarrativeTitle')}</span>
                {data.marketNarrative.sessionNote && (
                  <span className="text-[10px] text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">{data.marketNarrative.sessionNote}</span>
                )}
              </div>
              <div className="space-y-2">
                {Array.isArray(data.marketNarrative.hotThemes) && data.marketNarrative.hotThemes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    {(data.marketNarrative.hotThemes as string[]).map((theme: string, i: number) => (
                      <span key={i} className="text-[11px] font-semibold text-orange-700 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full">🔥 {theme}</span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 text-sm"><span className="font-semibold text-amber-700 shrink-0 w-14">{t('narrativeWhy')}</span><span className="text-gray-700 leading-relaxed">{data.marketNarrative.why}</span></div>
                <div className="flex gap-2 text-sm"><span className="font-semibold text-amber-700 shrink-0 w-14">{t('narrativeWatch')}</span><span className="text-gray-700 leading-relaxed">{data.marketNarrative.watch}</span></div>
                <div className="flex gap-2 text-sm"><span className="font-semibold text-amber-700 shrink-0 w-14">{t('narrativeStory')}</span><span className="text-gray-700 leading-relaxed">{data.marketNarrative.story}</span></div>
              </div>
            </div>
          )}

          {/* ── S6.5: 주요 뉴스 (news-cascade) ─────────────────────────────── */}
          {(newsLoading || news.length > 0) && (
            <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-blue-800">📰 {t('newsTitle')}</span>
                <span className="text-[10px] text-blue-600">{t('newsSubtitle')}</span>
              </div>
              {newsLoading && news.length === 0 ? (
                <div className="text-xs text-blue-500 text-center py-3">{t('newsLoading')}</div>
              ) : (
                <div className="space-y-2">
                  {news
                    .sort((a, b) => {
                      // importance high 먼저, 그 다음 pubDate desc (최신 우선)
                      const impDiff = (a.importance === 'high' ? -1 : 0) - (b.importance === 'high' ? -1 : 0);
                      if (impDiff !== 0) return impDiff;
                      return new Date(b.pubDate ?? 0).getTime() - new Date(a.pubDate ?? 0).getTime();
                    })
                    .slice(0, 5)
                    .map(n => {
                      const sentColor = n.sentiment === 'bullish' ? 'text-emerald-600 bg-emerald-100'
                        : n.sentiment === 'bearish' ? 'text-red-600 bg-red-100'
                        : 'text-gray-600 bg-gray-100';
                      const impDot = n.importance === 'high' ? 'bg-red-500' : n.importance === 'medium' ? 'bg-amber-500' : 'bg-gray-300';
                      const ageMs = n.pubDate ? Date.now() - new Date(n.pubDate).getTime() : null;
                      const ageStr = ageMs != null && isFinite(ageMs)
                        ? (ageMs < 3600_000 ? `${Math.floor(ageMs / 60_000)}m`
                          : ageMs < 86400_000 ? `${Math.floor(ageMs / 3600_000)}h`
                          : `${Math.floor(ageMs / 86400_000)}d`)
                        : null;
                      return (
                        <a
                          key={n.id}
                          href={n.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg border border-blue-200 bg-white p-3 hover:border-blue-400 hover:shadow-sm transition"
                        >
                          <div className="flex items-start gap-2 mb-1">
                            <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${impDot}`} />
                            <h4 className="text-sm font-semibold text-gray-900 leading-snug flex-1">{n.title}</h4>
                            {ageStr && <span className="text-[10px] text-gray-400 font-mono shrink-0">{ageStr}</span>}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${sentColor}`}>
                              {n.sentiment === 'bullish' ? '↑' : n.sentiment === 'bearish' ? '↓' : '·'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed line-clamp-2 ml-4">{n.summary}</p>
                          {n.cascades && n.cascades.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2 ml-4">
                              {n.cascades.slice(0, 4).map((c, i) => (
                                <span
                                  key={i}
                                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                    c.direction === 'positive' ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                                    : c.direction === 'negative' ? 'border-red-300 text-red-700 bg-red-50'
                                    : 'border-gray-300 text-gray-600 bg-gray-50'
                                  }`}
                                  title={c.reason}
                                >
                                  {c.asset} {c.direction === 'positive' ? '↑' : c.direction === 'negative' ? '↓' : '→'}
                                </span>
                              ))}
                            </div>
                          )}
                        </a>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* ── Buy Recommendations strip ─────────────────────────────────── */}
          {data.portfolio.some(p => p.action === 'buy') && (
            <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="text-xs font-bold text-emerald-700 shrink-0">{t('buyNow')}</span>
              {data.portfolio.filter(p => p.action === 'buy').map(p => (
                <span key={p.ticker} className="inline-flex items-center gap-1 text-xs font-semibold bg-emerald-600 text-white px-2.5 py-1 rounded-full">
                  {displayName(p.ticker, p.name)}
                  <span className="font-normal opacity-80 text-[10px]">{p.allocation}%</span>
                </span>
              ))}
              {data.dataAsOf && (
                <span className="ml-auto text-[10px] text-emerald-600 opacity-70 shrink-0">
                  {t('dataAsOf')} {new Date(data.dataAsOf).toLocaleString()}
                </span>
              )}
            </div>
          )}

          {/* ── 3-col analysis ────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <BarChart3 className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-700">{t('analysisMacro')}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{data.macroAnalysis}</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Target className="w-4 h-4 text-violet-600" />
                <span className="text-xs font-bold text-violet-700">{t('analysisTechnical')}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{data.technicalAnalysis}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-700">{t('analysisFundamental')}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{data.fundamentalAnalysis}</p>
            </div>
          </div>

          {/* ── S4: 기회 신호 (숏스퀴즈 + 내부자) ──────────────────────────── */}
          {(data.shortSqueeze?.length || data.insiderSignals?.length) && (
            <div className="mb-5 rounded-xl border border-orange-100 bg-orange-50 p-4">
              <p className="text-sm font-bold text-orange-800 mb-3">⚡ {t('opportunitySignalsTitle')}</p>
              {data.topOpportunity && (
                <p className="text-xs text-orange-700 bg-orange-100 rounded-lg px-3 py-2 mb-3 font-medium">{data.topOpportunity}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.shortSqueeze?.length ? (
                  <div>
                    <p className="text-xs font-bold text-orange-700 mb-2">🔥 {t('shortSqueezeLabel')}</p>
                    {data.shortSqueeze.map((s, i) => (
                      <div key={i} className="mb-2 text-xs">
                        <span className="font-bold text-orange-800">{displayName(s.ticker)}</span>
                        <span className="text-orange-600 ml-1">score={s.score}</span>
                        <p className="text-gray-600 mt-0.5">{s.timing}</p>
                        <p className="text-red-500 text-[10px]">{t('riskLabel')}: {s.risk}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {data.insiderSignals?.length ? (
                  <div>
                    <p className="text-xs font-bold text-orange-700 mb-2">👤 {t('insiderSignalsLabel')}</p>
                    {data.insiderSignals.map((s, i) => (
                      <div key={i} className="mb-2 text-xs">
                        <span className="font-bold text-orange-800">{displayName(s.ticker)}</span>
                        <span className="text-orange-600 ml-1">{s.filings}{t('filingUnit')}</span>
                        {s.dateRange && (
                          <span className="text-gray-400 ml-1 text-[10px]">({s.dateRange})</span>
                        )}
                        <p className="text-gray-600 mt-0.5">{s.significance}</p>
                        <p className="text-gray-500 text-[10px]">{s.pattern}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* ── S4b: 위기 포착 (내부자 매도 + BB 극단 + 어닝스 미스 등) ──── */}
          {data.crisisSignals?.length ? (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-900 mb-3">🚨 {t('crisisSignalsTitle')}</p>
              <div className="space-y-2">
                {data.crisisSignals.map((s, i) => {
                  const severityBadge = s.severity === 'high'
                    ? 'bg-red-600 text-white'
                    : s.severity === 'medium'
                    ? 'bg-amber-500 text-white'
                    : 'bg-gray-400 text-white';
                  const severityLabel = s.severity === 'high'
                    ? t('crisisSeverityHigh')
                    : s.severity === 'medium'
                    ? t('crisisSeverityMedium')
                    : t('crisisSeverityLow');
                  const typeLabel = s.type === 'insider_selling' ? t('crisisTypeInsiderSelling')
                    : s.type === 'earnings_miss' ? t('crisisTypeEarningsMiss')
                    : s.type === 'bb_overextended' ? t('crisisTypeBBOverextended')
                    : s.type === 'institutional_exit' ? t('crisisTypeInstitutionalExit')
                    : s.type === 'guidance_cut' ? t('crisisTypeGuidanceCut')
                    : t('crisisTypeMacroRisk');
                  const rowBg = s.severity === 'high'
                    ? 'border-red-200 bg-red-50'
                    : s.severity === 'medium'
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-gray-200 bg-gray-50';
                  return (
                    <div key={i} className={`rounded-lg border p-2.5 ${rowBg}`}>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${severityBadge}`}>{severityLabel}</span>
                        <span className="text-xs font-bold text-gray-900">{displayName(s.ticker)} <span className="text-[10px] font-normal text-gray-400 font-mono">{s.ticker}</span></span>
                        <span className="text-[10px] text-gray-500 bg-white/70 rounded px-1.5 py-0.5 border border-gray-200">{typeLabel}</span>
                      </div>
                      <p className="text-xs text-gray-800 font-medium leading-snug">{s.signal}</p>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {s.action && (
                          <span className="text-[10px] text-red-700 font-semibold">
                            ▶ {t('crisisActionLabel')}: {s.action}
                          </span>
                        )}
                        {s.evidence && (
                          <span className="text-[10px] text-gray-500 font-mono truncate max-w-[200px]">
                            {t('crisisEvidenceLabel')}: {s.evidence}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ── Portfolio (시장별 분리 — F25) ────────────────────────────── */}
          {data.portfolio.length > 0 && (() => {
            // portfolioByMarket 있으면 분리 표시, 없으면 fallback 으로 자체 분류
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pbm = (data as any).portfolioByMarket as { us?: typeof data.portfolio; kr?: typeof data.portfolio } | undefined;
            const us = pbm?.us ?? data.portfolio.filter(p => !p.ticker?.endsWith('.KS') && !p.ticker?.endsWith('.KQ'));
            const kr = pbm?.kr ?? data.portfolio.filter(p => p.ticker?.endsWith('.KS') || p.ticker?.endsWith('.KQ'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const focus = (data as any).sessionFocus as { primary?: string; label?: string; marketWeight?: Record<string, number> } | undefined;
            return (
              <div className="mb-5">
                <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-violet-500" />
                  {t('portfolioTitle')}
                  {focus?.label && (
                    <span className="ml-2 text-[10px] font-normal text-violet-600 bg-violet-50 rounded px-2 py-0.5">
                      📍 {focus.label} (primary: {focus.primary?.toUpperCase()})
                    </span>
                  )}
                </h2>
                {us.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                      🇺🇸 US Market <span className="text-[10px] text-gray-500 font-normal">({us.length} 종목)</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {us.map((item, i) => (
                        <PortfolioCard key={item.ticker} item={item} rank={i + 1} />
                      ))}
                    </div>
                  </div>
                )}
                {kr.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                      🇰🇷 KR Market <span className="text-[10px] text-gray-500 font-normal">({kr.length} 종목)</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {kr.map((item, i) => (
                        <PortfolioCard key={item.ticker} item={item} rank={us.length + i + 1} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── 매도 추천 (2026-05-29 신설 — 과거 buy 추천 중 stop/target/회전 후보) ── */}
          {(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sell = (data as any).sellRecommendations as { us?: SellItem[]; kr?: SellItem[]; total?: number } | undefined;
            if (!sell || (sell.total ?? 0) === 0) return null;
            const usSell = sell.us ?? [];
            const krSell = sell.kr ?? [];
            return (
              <div className="mb-5 rounded-xl border border-orange-100 bg-orange-50/40 p-4">
                <h2 className="text-sm font-bold text-orange-900 mb-3 flex items-center gap-2">
                  📤 {t('sellRecommendationsTitle')}
                  <span className="text-[10px] font-normal text-orange-600 bg-orange-100 rounded px-2 py-0.5">
                    {t('sellRecommendationsSubtitle')}
                  </span>
                </h2>
                {usSell.length > 0 && (
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold text-orange-800 mb-2">🇺🇸 US ({usSell.length})</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {usSell.map((s) => <SellCard key={s.ticker} item={s} />)}
                    </div>
                  </div>
                )}
                {krSell.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-orange-800 mb-2">🇰🇷 KR ({krSell.length})</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {krSell.map((s) => <SellCard key={s.ticker} item={s} />)}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── S5: 리스크 관리 (손절선 설정 근거 + 헤징) ──────────────────────────── */}
          {(data.stopLossRationale?.length || data.hedgingSuggestion) && (
            <div className="mb-5 rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-800 mb-3">🛡️ {t('riskManagementTitle')}</p>
              {data.portfolioRiskNote && (
                <p className="text-xs text-red-700 bg-red-100 rounded-lg px-3 py-2 mb-3">{data.portfolioRiskNote}</p>
              )}
              {data.hedgingSuggestion && (
                <p className="text-xs text-gray-700 mb-3">💡 {data.hedgingSuggestion}</p>
              )}
              {data.stopLossRationale?.length ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-red-700">{t('stopLossRationaleLabel')}</p>
                  {data.stopLossRationale.map((s, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="min-w-[6.5rem] shrink-0"><Link href={`/${locale}/company/${s.ticker}`} className="font-bold text-red-800 hover:underline">{displayName(s.ticker)}</Link> <span className="text-[9px] font-normal text-gray-400 font-mono">{s.ticker}</span></span>
                      <span className="text-gray-600">{s.rationale}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* ── Sector Allocation ─────────────────────────────────────────── */}
          {data.sectorAllocation.length > 0 && (
            <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-500" />
                {t('sectorTitle')}
              </h2>
              <div className="space-y-3">
                {data.sectorAllocation.map(item => (
                  <SectorBar key={item.sector} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* ── ETF 전략 (2026-06-04) ──────────────────────────────────────── */}
          {data.etfStrategy?.length ? (
            <div className="mb-5 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-violet-500" />
                {t('etfTitle')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.etfStrategy.map((e) => {
                  const catCls = e.category === 'broad' ? 'bg-blue-100 text-blue-700'
                    : e.category === 'sector' ? 'bg-violet-100 text-violet-700'
                    : e.category === 'region' ? 'bg-emerald-100 text-emerald-700'
                    : e.category === 'bond' ? 'bg-gray-200 text-gray-700'
                    : 'bg-amber-100 text-amber-700';
                  const act = e.action ?? 'buy';
                  const actCls = act === 'buy' ? 'bg-emerald-500 text-white'
                    : act === 'avoid' ? 'bg-red-500 text-white'
                    : act === 'hedge' ? 'bg-amber-500 text-white'
                    : 'bg-gray-300 text-gray-700'; // watch
                  const chg = e.changePct;
                  return (
                    <div key={e.ticker} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${actCls}`}>{t(`etfAction_${act}`)}</span>
                          <Link href={`/${locale}/company/${e.ticker}`} className="font-bold text-sm text-violet-700 hover:underline shrink-0">{e.name}</Link>
                          <span className="text-[10px] text-gray-400 font-mono truncate">{e.ticker}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${catCls}`}>{t(`etfCat_${e.category}`)}</span>
                        </div>
                        {e.price != null && (
                          <span className="text-[11px] font-semibold text-gray-700 shrink-0">
                            ${e.price.toFixed(2)}{chg != null && <span className={chg >= 0 ? ' text-green-600' : ' text-red-600'}> {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%</span>}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 leading-snug">{e.rationale}</p>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-2">{t('etfNote')}</p>
            </div>
          ) : null}

          {/* ── S8: 기업 변화 모니터링 ────────────────────────────────────── */}
          {data.companyChanges?.length ? (
            <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-sm font-bold text-blue-900 mb-3">🏢 {t('companyChangesTitle')}</p>
              <div className="space-y-2">
                {data.companyChanges.map((c, i) => {
                  const sentColor = c.sentiment === 'positive' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : c.sentiment === 'negative' ? 'text-red-700 bg-red-50 border-red-200'
                    : 'text-gray-600 bg-gray-50 border-gray-200';
                  const guidanceIcon = c.guidance === 'raised' ? '▲' : c.guidance === 'lowered' ? '▼' : '→';
                  return (
                    <div key={i} className={`rounded-lg border px-3 py-2 ${sentColor}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs">{displayName(c.ticker, c.name)}</span>
                          <span className="text-[10px] font-normal opacity-60 font-mono">{c.ticker}</span>
                          {c.latestQuarter && <span className="text-[10px] opacity-70">{c.latestQuarter}</span>}
                          {c.revenueYoY != null && c.revenueYoY !== 0 && (
                            <span className="text-[10px] font-semibold">
                              {c.revenueYoY >= 0 ? '+' : ''}{c.revenueYoY.toFixed(1)}% {t('companyChangesYoY')}
                            </span>
                          )}
                        </div>
                        {c.guidance && c.guidance !== 'unknown' && (
                          <span className="text-[10px] font-semibold">{guidanceIcon} {t('guidanceLabel')} {c.guidance}</span>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed">{c.keyChange}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ── S9: 공급망 변화 모니터링 ──────────────────────────────────── */}
          {(data.supplyChainChanges?.length ?? 0) > 0 && (
            <div className="mb-5 rounded-xl border border-violet-100 bg-violet-50 p-4">
              <p className="text-sm font-bold text-violet-900 mb-3">🔗 {t('supplyChainChangesTitle')}</p>
              <div className="space-y-2">
                {data.supplyChainChanges!.map((s, i) => {
                  const dirColor = s.direction === 'positive'
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : s.direction === 'negative'
                    ? 'text-red-700 bg-red-50 border-red-200'
                    : 'text-gray-600 bg-gray-50 border-gray-200';
                  const dirIcon = s.direction === 'positive' ? '▲' : s.direction === 'negative' ? '▼' : '—';
                  return (
                    <div key={i} className={`rounded-lg border p-2.5 ${dirColor}`}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-xs">{displayName(s.ticker)}</span>
                        <span className="text-[10px] font-normal opacity-60 font-mono">{s.ticker}</span>
                        <span className="text-[10px] opacity-70">{dirIcon} {s.direction}</span>
                        <span className="text-[10px] opacity-60 bg-white/60 rounded px-1">{s.source}</span>
                        {s.date && <span className="text-[10px] opacity-60 font-mono">{fmtSignalDate(s.date)}</span>}
                        <span className="text-[10px] opacity-60">신뢰도 {s.conviction}</span>
                      </div>
                      {/* 2026-06-06: 평이 설명 우선, 원문 공시제목은 작게(증빙) */}
                      {(s as { summary?: string }).summary ? (
                        <>
                          <p className="text-[11px] leading-relaxed font-medium">{(s as { summary?: string }).summary}</p>
                          <p className="text-[10px] leading-relaxed opacity-50 mt-0.5">📄 {s.headline}</p>
                        </>
                      ) : (
                        <p className="text-[11px] leading-relaxed">{s.headline}</p>
                      )}
                      {/* 2026-06-13: 계약 상세 (금액·상대방·매출대비%) — 사용자 "내용 안나오네" */}
                      {(() => {
                        const c = s as { contractAmountWon?: number | null; contractCounterparty?: string | null; contractRevenuePct?: number | null };
                        const parts: string[] = [];
                        if (c.contractAmountWon != null) {
                          const w = c.contractAmountWon;
                          parts.push(w >= 1e12 ? `₩${(w / 1e12).toFixed(2)}조` : w >= 1e8 ? `₩${Math.round(w / 1e8).toLocaleString()}억` : `₩${Math.round(w).toLocaleString()}`);
                        }
                        if (c.contractCounterparty) parts.push(`${t('contractCounterparty')} ${c.contractCounterparty}`);
                        if (c.contractRevenuePct != null) parts.push(`${t('contractRevImpact')} ${c.contractRevenuePct}%`);
                        return parts.length ? <p className="text-[10px] mt-1 font-semibold opacity-90">💰 {parts.join(' · ')}</p> : null;
                      })()}
                      {s.downstreamBeneficiaries?.length ? (
                        <p className="text-[10px] mt-1 opacity-70">
                          ↘ 수혜: {s.downstreamBeneficiaries.join(', ')}
                        </p>
                      ) : null}
                      {s.upstreamRisks?.length ? (
                        <p className="text-[10px] mt-0.5 opacity-70">
                          ↗ 위험: {s.upstreamRisks.join(', ')}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Risk Events ───────────────────────────────────────────────── */}
          {data.riskEvents.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                {t('riskEventsTitle')}
              </h2>
              <div>
                {data.riskEvents.map((ev, i) => (
                  <RiskEventRow key={i} event={ev} />
                ))}
              </div>
            </div>
          )}

          </>
          )}

          {/* ── Disclaimer ────────────────────────────────────────────────── */}
          <p className="text-[10px] text-gray-400 mt-4 leading-relaxed">
            {t('disclaimer')}
          </p>
        </>
      )}
    </div>
  );
}

// ── 회원 게이트 카드 (2026-06-13) — 이메일 등록 = 즉시 해제 ─────────────────────
function MemberGate({ onUnlock, t }: { onUnlock: () => void; t: Tr }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr(false);
    try {
      const r = await fetch('/api/member', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      if (r.ok) onUnlock(); else setErr(true);
    } catch { setErr(true); }
    setBusy(false);
  };
  return (
    <div className="my-6 rounded-2xl border-2 border-violet-200 bg-gradient-to-b from-violet-50 to-white p-8 text-center">
      <p className="text-2xl mb-2">🔓</p>
      <h2 className="text-lg font-bold text-gray-900 mb-1.5">{t('gateTitle')}</h2>
      <p className="text-sm text-gray-600 mb-5 max-w-md mx-auto leading-relaxed">{t('gateBody')}</p>
      <div className="flex gap-2 max-w-sm mx-auto">
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={t('gateEmailPlaceholder')}
          className="flex-1 px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
        />
        <button onClick={submit} disabled={busy}
          className="px-4 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap">
          {t('gateSubmit')}
        </button>
      </div>
      {err && <p className="text-xs text-red-500 mt-2">{t('gateError')}</p>}
      <p className="text-[10px] text-gray-400 mt-4">{t('gateFreeNote')}</p>
    </div>
  );
}

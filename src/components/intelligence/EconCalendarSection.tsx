'use client';

import { useState, useEffect, useMemo } from 'react';
import { Calendar, Loader2, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { getUpcomingEvents, daysUntil, type EconEvent } from '@/data/econ-calendar';
import type { EconCalEvent, EconCalResponse } from '@/app/api/economic-calendar/route';

const IMPACT_STYLE: Record<'high' | 'medium' | 'low', { badge: string; dot: string }> = {
  high:   { badge: 'bg-red-100 text-red-700 border-red-200',       dot: 'bg-red-500' },
  medium: { badge: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  low:    { badge: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
};

function DaysChip({ days, today, tomorrow, later }: { days: number; today: string; tomorrow: string; later: string }) {
  if (days === 0) return <span className="text-[11px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{today}</span>;
  if (days === 1) return <span className="text-[11px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">{tomorrow}</span>;
  return <span className="text-[11px] text-cf-text-secondary bg-cf-bg px-1.5 py-0.5 rounded border border-cf-border">{later}</span>;
}

function fmtNum(n: number | null, unit: string | null): string {
  if (n == null) return '–';
  const suffix = unit ? ` ${unit}` : '';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K${suffix}`;
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}${suffix}`;
}

// Normalize live event for display
function liveToRow(e: EconCalEvent): {
  date: string; time: string | null; impact: 'high' | 'medium' | 'low';
  title: string; note: string | null;
} {
  const timeEt = e.time
    ? (() => {
        // Convert UTC HH:MM:SS → ET (UTC-4 in DST)
        const [h, m] = e.time.split(':').map(Number);
        const etH = ((h - 4) + 24) % 24;
        return `${String(etH).padStart(2, '0')}:${String(m).padStart(2, '0')} ET`;
      })()
    : null;

  const parts: string[] = [];
  if (e.actual != null) parts.push(`Actual: ${fmtNum(e.actual, e.unit)}`);
  if (e.estimate != null) parts.push(`Est: ${fmtNum(e.estimate, e.unit)}`);
  if (e.prev != null) parts.push(`Prev: ${fmtNum(e.prev, e.unit)}`);

  return {
    date: e.date,
    time: timeEt,
    impact: e.impact,
    title: e.event,
    note: parts.length ? parts.join(' · ') : null,
  };
}

export default function EconCalendarSection() {
  const t = useTranslations('intelligence');
  const locale = useLocale();
  const todayObj = useMemo(() => new Date(), []);
  const staticEvents = useMemo(() => getUpcomingEvents(todayObj, 10), [todayObj]);

  const [liveData, setLiveData] = useState<EconCalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = (signal?: AbortSignal) => {
    const today = todayObj.toISOString().slice(0, 10);
    const to = new Date(todayObj.getTime() + 14 * 86400000).toISOString().slice(0, 10);
    setLoading(true);
    setError(false);
    fetch(`/api/economic-calendar?from=${today}&to=${to}`, signal ? { signal } : {})
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<EconCalResponse>; })
      .then(d => { if (!signal?.aborted) setLiveData(d); })
      .catch(() => { if (!signal?.aborted) setError(true); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  };

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Use live if we have events, else fallback to static
  const useLive = !error && liveData?.source === 'finnhub' && (liveData.events.length > 0);

  type Row = { date: string; time: string | null; impact: 'high' | 'medium' | 'low'; title: string; note: string | null };

  const rows: Row[] = useMemo(() => {
    if (useLive) {
      return liveData!.events
        .filter(e => e.impact === 'high' || e.impact === 'medium')
        .map(liveToRow);
    }
    // Static fallback
    return staticEvents.map((e: EconEvent) => ({
      date: e.date,
      time: e.time ?? null,
      impact: e.impact as 'high' | 'medium' | 'low',
      title: e.titleKo,
      note: e.noteKo ?? null,
    }));
  }, [useLive, liveData, staticEvents]);

  const grouped = useMemo(() =>
    rows.reduce<Record<string, Row[]>>((acc, r) => {
      (acc[r.date] ??= []).push(r);
      return acc;
    }, {}),
  [rows]);

  if (!loading && rows.length === 0) return null;

  return (
    <div className="cf-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-cf-primary flex-shrink-0" />
        <h3 className="text-sm font-bold text-cf-text-primary">{t('ecTitle')}</h3>
        {useLive && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
            {t('ecLive')}
          </span>
        )}
        {!useLive && !loading && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
            {t('ecStatic')}
          </span>
        )}
        <span className="ml-auto text-[10px] text-cf-text-secondary">{t('ecTimezone')}</span>
        {!loading && (
          <button
            onClick={() => load()}
            className="text-cf-text-secondary hover:text-cf-primary transition-colors"
            title={t('ecRefresh')}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
        {loading && <Loader2 className="w-3 h-3 animate-spin text-cf-text-secondary" />}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-cf-text-secondary py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs">{t('ecLoading')}</span>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([date, evts]) => {
            const days = daysUntil(date, todayObj);
            const d = new Date(date + 'T12:00:00');
            const dateLabel = d.toLocaleDateString(locale, { month: 'short', day: 'numeric', weekday: 'short' });

            return (
              <div key={date} className="flex gap-3">
                <div className="flex-shrink-0 w-[72px] text-right pt-0.5">
                  <div className="text-xs text-cf-text-secondary leading-tight">{dateLabel}</div>
                  <div className="mt-0.5">
                    <DaysChip days={days} today={t('ecToday')} tomorrow={t('ecTomorrow')} later={t('ecDaysLater', { days })} />
                  </div>
                </div>

                <div className="flex-1 space-y-1.5 border-l border-cf-border pl-3">
                  {evts.map((e, i) => {
                    const imp = IMPACT_STYLE[e.impact];
                    return (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${imp.dot}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {e.time && <span className="text-[10px] text-cf-text-secondary">{e.time}</span>}
                            <span className={`text-[10px] font-semibold px-1 py-px rounded border ${imp.badge}`}>{e.impact}</span>
                          </div>
                          <p className="text-xs font-semibold text-cf-text-primary leading-snug mt-0.5">{e.title}</p>
                          {e.note && (
                            <p className="text-[10px] text-cf-text-secondary mt-0.5">{e.note}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-cf-text-secondary mt-3 pt-2 border-t border-cf-border/50">
        {useLive ? t('ecFootnoteLive') : t('ecFootnote')}
      </p>
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import { Calendar } from 'lucide-react';
import { getUpcomingEvents, daysUntil, type EconEvent } from '@/data/econ-calendar';

const IMPACT_STYLE: Record<EconEvent['impact'], { badge: string; dot: string }> = {
  high:   { badge: 'bg-red-100 text-red-700 border-red-200',    dot: 'bg-red-500' },
  medium: { badge: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  low:    { badge: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
};

const CATEGORY_COLOR: Record<string, string> = {
  Fed:    'text-indigo-600',
  GDP:    'text-blue-600',
  Jobs:   'text-emerald-600',
  CPI:    'text-orange-600',
  PPI:    'text-amber-600',
  PCE:    'text-red-600',
  PMI:    'text-teal-600',
  Retail: 'text-purple-600',
};

function DaysChip({ days }: { days: number }) {
  if (days === 0) return <span className="text-[11px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">오늘</span>;
  if (days === 1) return <span className="text-[11px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">내일</span>;
  if (days <= 7)  return <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">{days}일 후</span>;
  return <span className="text-[11px] text-cf-text-secondary bg-cf-bg px-1.5 py-0.5 rounded border border-cf-border">{days}일 후</span>;
}

export default function EconCalendarSection() {
  const today = useMemo(() => new Date(), []);
  const events = useMemo(() => getUpcomingEvents(today, 10), [today]);

  if (events.length === 0) return null;

  // Group events by date for cleaner display
  const grouped = events.reduce<Record<string, EconEvent[]>>((acc, e) => {
    (acc[e.date] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="cf-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-cf-primary flex-shrink-0" />
        <h3 className="text-sm font-bold text-cf-text-primary">주요 매크로 이벤트 캘린더</h3>
        <span className="ml-auto text-[10px] text-cf-text-secondary">ET 기준</span>
      </div>

      <div className="space-y-3">
        {Object.entries(grouped).map(([date, evts]) => {
          const days = daysUntil(date, today);
          const d = new Date(date + 'T12:00:00');
          const dateLabel = d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });

          return (
            <div key={date} className="flex gap-3">
              {/* Date column */}
              <div className="flex-shrink-0 w-[72px] text-right pt-0.5">
                <div className="text-xs text-cf-text-secondary leading-tight">{dateLabel}</div>
                <div className="mt-0.5"><DaysChip days={days} /></div>
              </div>

              {/* Events column */}
              <div className="flex-1 space-y-1.5 border-l border-cf-border pl-3">
                {evts.map((e, i) => {
                  const imp = IMPACT_STYLE[e.impact];
                  const catColor = CATEGORY_COLOR[e.category] ?? 'text-cf-text-secondary';
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <span className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${imp.dot}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-bold uppercase tracking-wide ${catColor}`}>{e.category}</span>
                          {e.time && <span className="text-[10px] text-cf-text-secondary">{e.time}</span>}
                          <span className={`text-[10px] font-semibold px-1 py-px rounded border ${imp.badge}`}>{e.impact}</span>
                        </div>
                        <p className="text-xs font-semibold text-cf-text-primary leading-snug mt-0.5">{e.titleKo}</p>
                        {e.noteKo && (
                          <p className="text-[10px] text-cf-text-secondary mt-0.5">{e.noteKo}</p>
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

      <p className="text-[10px] text-cf-text-secondary mt-3 pt-2 border-t border-cf-border/50">
        출처: Federal Reserve · BLS · BEA 공식 발표 일정 · 날짜는 변경될 수 있습니다
      </p>
    </div>
  );
}

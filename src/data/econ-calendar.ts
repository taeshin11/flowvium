export type EventImpact = 'high' | 'medium' | 'low';

export interface EconEvent {
  date: string;       // YYYY-MM-DD
  time?: string;      // e.g. "14:00 ET"
  title: string;
  titleKo: string;
  category: string;
  impact: EventImpact;
  note?: string;
  noteKo?: string;
}

// 2026 economic calendar — major US macro events
// Sources: Federal Reserve, BLS, BEA release schedules
export const ECON_EVENTS_2026: EconEvent[] = [
  // ── FOMC ──────────────────────────────────────────────────────────────────────
  { date: '2026-04-29', time: '–', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-04-30', time: '14:00 ET', title: 'FOMC Rate Decision + Powell Press Conf', titleKo: 'FOMC 금리 결정 + 파월 기자회견', category: 'Fed', impact: 'high', note: 'Market expects 25bp cut', noteKo: '시장 25bp 인하 예상' },
  { date: '2026-06-09', time: '–', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-06-10', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high', note: 'Summary of Economic Projections', noteKo: 'SEP 점도표 발표 회의' },
  { date: '2026-07-28', time: '–', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-07-29', time: '14:00 ET', title: 'FOMC Rate Decision', titleKo: 'FOMC 금리 결정', category: 'Fed', impact: 'high' },
  { date: '2026-09-15', time: '–', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-09-16', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high' },
  { date: '2026-10-27', time: '–', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-10-28', time: '14:00 ET', title: 'FOMC Rate Decision', titleKo: 'FOMC 금리 결정', category: 'Fed', impact: 'high' },
  { date: '2026-12-08', time: '–', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-12-09', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high' },

  // ── GDP ───────────────────────────────────────────────────────────────────────
  { date: '2026-04-30', time: '08:30 ET', title: 'Q1 2026 GDP (Advance)', titleKo: 'Q1 GDP 1차 속보치', category: 'GDP', impact: 'high', note: 'First read on Q1 economic growth', noteKo: '1분기 성장률 첫 속보' },
  { date: '2026-05-28', time: '08:30 ET', title: 'Q1 2026 GDP (2nd Estimate)', titleKo: 'Q1 GDP 2차 수정치', category: 'GDP', impact: 'medium' },
  { date: '2026-06-25', time: '08:30 ET', title: 'Q1 2026 GDP (3rd Estimate)', titleKo: 'Q1 GDP 3차 확정치', category: 'GDP', impact: 'low' },
  { date: '2026-07-30', time: '08:30 ET', title: 'Q2 2026 GDP (Advance)', titleKo: 'Q2 GDP 1차 속보치', category: 'GDP', impact: 'high' },

  // ── NFP (Non-Farm Payrolls) ──────────────────────────────────────────────────
  { date: '2026-05-01', time: '08:30 ET', title: 'April Jobs Report (NFP)', titleKo: '4월 고용지표 (비농업취업자수)', category: 'Jobs', impact: 'high', note: 'First Friday rule — key market mover', noteKo: '가장 중요한 고용 지표' },
  { date: '2026-06-05', time: '08:30 ET', title: 'May Jobs Report (NFP)', titleKo: '5월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2026-07-02', time: '08:30 ET', title: 'June Jobs Report (NFP)', titleKo: '6월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2026-08-07', time: '08:30 ET', title: 'July Jobs Report (NFP)', titleKo: '7월 고용지표', category: 'Jobs', impact: 'high' },

  // ── CPI ───────────────────────────────────────────────────────────────────────
  { date: '2026-05-13', time: '08:30 ET', title: 'April CPI Inflation', titleKo: '4월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2026-06-10', time: '08:30 ET', title: 'May CPI Inflation', titleKo: '5월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2026-07-15', time: '08:30 ET', title: 'June CPI Inflation', titleKo: '6월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2026-08-12', time: '08:30 ET', title: 'July CPI Inflation', titleKo: '7월 CPI 소비자물가', category: 'CPI', impact: 'high' },

  // ── PPI ───────────────────────────────────────────────────────────────────────
  { date: '2026-05-14', time: '08:30 ET', title: 'April PPI Producer Prices', titleKo: '4월 PPI 생산자물가', category: 'PPI', impact: 'medium' },
  { date: '2026-06-11', time: '08:30 ET', title: 'May PPI Producer Prices', titleKo: '5월 PPI 생산자물가', category: 'PPI', impact: 'medium' },
  { date: '2026-07-14', time: '08:30 ET', title: 'June PPI Producer Prices', titleKo: '6월 PPI 생산자물가', category: 'PPI', impact: 'medium' },

  // ── PCE (Fed's preferred inflation gauge) ─────────────────────────────────────
  { date: '2026-04-30', time: '08:30 ET', title: 'March PCE Price Index', titleKo: '3월 PCE 물가 (연준 선호 지표)', category: 'PCE', impact: 'high', note: "Fed's preferred inflation measure", noteKo: '연준이 가장 중시하는 물가 지표' },
  { date: '2026-05-29', time: '08:30 ET', title: 'April PCE Price Index', titleKo: '4월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2026-06-26', time: '08:30 ET', title: 'May PCE Price Index', titleKo: '5월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2026-07-31', time: '08:30 ET', title: 'June PCE Price Index', titleKo: '6월 PCE 물가', category: 'PCE', impact: 'high' },

  // ── ISM ───────────────────────────────────────────────────────────────────────
  { date: '2026-05-01', time: '10:00 ET', title: 'ISM Manufacturing PMI', titleKo: 'ISM 제조업 PMI', category: 'PMI', impact: 'medium' },
  { date: '2026-05-05', time: '10:00 ET', title: 'ISM Services PMI', titleKo: 'ISM 서비스업 PMI', category: 'PMI', impact: 'medium' },
  { date: '2026-06-01', time: '10:00 ET', title: 'ISM Manufacturing PMI', titleKo: 'ISM 제조업 PMI', category: 'PMI', impact: 'medium' },

  // ── Retail Sales ──────────────────────────────────────────────────────────────
  { date: '2026-05-15', time: '08:30 ET', title: 'April Retail Sales', titleKo: '4월 소매판매', category: 'Retail', impact: 'medium' },
  { date: '2026-06-16', time: '08:30 ET', title: 'May Retail Sales', titleKo: '5월 소매판매', category: 'Retail', impact: 'medium' },
];

// Return only events on or after today, sorted ascending
export function getUpcomingEvents(today: Date, limit = 12): EconEvent[] {
  const todayStr = today.toISOString().slice(0, 10);
  return ECON_EVENTS_2026
    .filter(e => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

export function daysUntil(dateStr: string, today: Date): number {
  const target = new Date(dateStr + 'T00:00:00');
  const diff = target.getTime() - new Date(today.toISOString().slice(0, 10) + 'T00:00:00').getTime();
  return Math.ceil(diff / 86400000);
}

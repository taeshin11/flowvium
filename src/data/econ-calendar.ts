export type EventImpact = 'high' | 'medium' | 'low';

export interface EconEvent {
  date: string;
  time?: string;
  title: string;
  titleKo: string;
  category: string;
  impact: EventImpact;
  note?: string;
  noteKo?: string;
}

// Static fallback economic calendar for major US macro events.
// Annual update: refresh after Fed/BLS/BEA/Census publish official next-year calendars.
export const ECON_EVENTS: EconEvent[] = [
  { date: '2026-04-29', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-04-30', time: '14:00 ET', title: 'FOMC Rate Decision + Powell Press Conference', titleKo: 'FOMC 금리 결정 + 파월 기자회견', category: 'Fed', impact: 'high' },
  { date: '2026-06-09', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-06-10', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high', note: 'Summary of Economic Projections', noteKo: '경제전망요약 발표' },
  { date: '2026-07-28', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-07-29', time: '14:00 ET', title: 'FOMC Rate Decision', titleKo: 'FOMC 금리 결정', category: 'Fed', impact: 'high' },
  { date: '2026-09-15', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-09-16', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high' },
  { date: '2026-10-27', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-10-28', time: '14:00 ET', title: 'FOMC Rate Decision', titleKo: 'FOMC 금리 결정', category: 'Fed', impact: 'high' },
  { date: '2026-12-08', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2026-12-09', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high' },
  { date: '2027-01-28', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2027-01-29', time: '14:00 ET', title: 'FOMC Rate Decision', titleKo: 'FOMC 금리 결정', category: 'Fed', impact: 'high' },
  { date: '2027-03-17', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2027-03-18', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high' },
  { date: '2027-04-29', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2027-04-30', time: '14:00 ET', title: 'FOMC Rate Decision', titleKo: 'FOMC 금리 결정', category: 'Fed', impact: 'high' },
  { date: '2027-06-16', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2027-06-17', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high' },
  { date: '2027-07-28', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2027-07-29', time: '14:00 ET', title: 'FOMC Rate Decision', titleKo: 'FOMC 금리 결정', category: 'Fed', impact: 'high' },
  { date: '2027-09-15', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2027-09-16', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high' },
  { date: '2027-10-27', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2027-10-28', time: '14:00 ET', title: 'FOMC Rate Decision', titleKo: 'FOMC 금리 결정', category: 'Fed', impact: 'high' },
  { date: '2027-12-08', time: 'All day', title: 'FOMC Meeting Day 1', titleKo: 'FOMC 1일차', category: 'Fed', impact: 'high' },
  { date: '2027-12-09', time: '14:00 ET', title: 'FOMC Rate Decision + SEP/Dot Plot', titleKo: 'FOMC 금리 결정 + 점도표', category: 'Fed', impact: 'high' },

  { date: '2026-04-30', time: '08:30 ET', title: 'Q1 2026 GDP (Advance)', titleKo: '2026년 1분기 GDP 속보치', category: 'GDP', impact: 'high' },
  { date: '2026-05-28', time: '08:30 ET', title: 'Q1 2026 GDP (2nd Estimate)', titleKo: '2026년 1분기 GDP 2차 추정치', category: 'GDP', impact: 'medium' },
  { date: '2026-06-25', time: '08:30 ET', title: 'Q1 2026 GDP (3rd Estimate)', titleKo: '2026년 1분기 GDP 확정치', category: 'GDP', impact: 'low' },
  { date: '2026-07-30', time: '08:30 ET', title: 'Q2 2026 GDP (Advance)', titleKo: '2026년 2분기 GDP 속보치', category: 'GDP', impact: 'high' },
  { date: '2026-10-29', time: '08:30 ET', title: 'Q3 2026 GDP (Advance)', titleKo: '2026년 3분기 GDP 속보치', category: 'GDP', impact: 'high' },
  { date: '2027-01-29', time: '08:30 ET', title: 'Q4 2026 GDP (Advance)', titleKo: '2026년 4분기 GDP 속보치', category: 'GDP', impact: 'high' },
  { date: '2027-04-29', time: '08:30 ET', title: 'Q1 2027 GDP (Advance)', titleKo: '2027년 1분기 GDP 속보치', category: 'GDP', impact: 'high' },
  { date: '2027-07-29', time: '08:30 ET', title: 'Q2 2027 GDP (Advance)', titleKo: '2027년 2분기 GDP 속보치', category: 'GDP', impact: 'high' },
  { date: '2027-10-28', time: '08:30 ET', title: 'Q3 2027 GDP (Advance)', titleKo: '2027년 3분기 GDP 속보치', category: 'GDP', impact: 'high' },

  { date: '2026-05-01', time: '08:30 ET', title: 'April Jobs Report (NFP)', titleKo: '4월 고용지표 (비농업 고용)', category: 'Jobs', impact: 'high', note: 'First Friday rule; key market mover', noteKo: '첫 금요일 발표, 핵심 시장 변수' },
  { date: '2026-06-05', time: '08:30 ET', title: 'May Jobs Report (NFP)', titleKo: '5월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2026-07-02', time: '08:30 ET', title: 'June Jobs Report (NFP)', titleKo: '6월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2026-08-07', time: '08:30 ET', title: 'July Jobs Report (NFP)', titleKo: '7월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2026-09-04', time: '08:30 ET', title: 'August Jobs Report (NFP)', titleKo: '8월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2026-10-02', time: '08:30 ET', title: 'September Jobs Report (NFP)', titleKo: '9월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2026-11-06', time: '08:30 ET', title: 'October Jobs Report (NFP)', titleKo: '10월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2026-12-04', time: '08:30 ET', title: 'November Jobs Report (NFP)', titleKo: '11월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-01-08', time: '08:30 ET', title: 'December Jobs Report (NFP)', titleKo: '12월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-02-05', time: '08:30 ET', title: 'January Jobs Report (NFP)', titleKo: '1월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-03-05', time: '08:30 ET', title: 'February Jobs Report (NFP)', titleKo: '2월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-04-02', time: '08:30 ET', title: 'March Jobs Report (NFP)', titleKo: '3월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-05-07', time: '08:30 ET', title: 'April Jobs Report (NFP)', titleKo: '4월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-06-04', time: '08:30 ET', title: 'May Jobs Report (NFP)', titleKo: '5월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-07-02', time: '08:30 ET', title: 'June Jobs Report (NFP)', titleKo: '6월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-08-06', time: '08:30 ET', title: 'July Jobs Report (NFP)', titleKo: '7월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-09-03', time: '08:30 ET', title: 'August Jobs Report (NFP)', titleKo: '8월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-10-01', time: '08:30 ET', title: 'September Jobs Report (NFP)', titleKo: '9월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-11-05', time: '08:30 ET', title: 'October Jobs Report (NFP)', titleKo: '10월 고용지표', category: 'Jobs', impact: 'high' },
  { date: '2027-12-03', time: '08:30 ET', title: 'November Jobs Report (NFP)', titleKo: '11월 고용지표', category: 'Jobs', impact: 'high' },

  { date: '2026-05-13', time: '08:30 ET', title: 'April CPI Inflation', titleKo: '4월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2026-06-10', time: '08:30 ET', title: 'May CPI Inflation', titleKo: '5월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2026-07-15', time: '08:30 ET', title: 'June CPI Inflation', titleKo: '6월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2026-08-12', time: '08:30 ET', title: 'July CPI Inflation', titleKo: '7월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2027-01-13', time: '08:30 ET', title: 'December CPI Inflation', titleKo: '12월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2027-04-14', time: '08:30 ET', title: 'March CPI Inflation', titleKo: '3월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2027-07-14', time: '08:30 ET', title: 'June CPI Inflation', titleKo: '6월 CPI 소비자물가', category: 'CPI', impact: 'high' },
  { date: '2027-10-13', time: '08:30 ET', title: 'September CPI Inflation', titleKo: '9월 CPI 소비자물가', category: 'CPI', impact: 'high' },

  { date: '2026-05-14', time: '08:30 ET', title: 'April PPI Producer Prices', titleKo: '4월 PPI 생산자물가', category: 'PPI', impact: 'medium' },
  { date: '2026-06-11', time: '08:30 ET', title: 'May PPI Producer Prices', titleKo: '5월 PPI 생산자물가', category: 'PPI', impact: 'medium' },
  { date: '2026-07-14', time: '08:30 ET', title: 'June PPI Producer Prices', titleKo: '6월 PPI 생산자물가', category: 'PPI', impact: 'medium' },
  { date: '2027-01-14', time: '08:30 ET', title: 'December PPI Producer Prices', titleKo: '12월 PPI 생산자물가', category: 'PPI', impact: 'medium' },
  { date: '2027-04-15', time: '08:30 ET', title: 'March PPI Producer Prices', titleKo: '3월 PPI 생산자물가', category: 'PPI', impact: 'medium' },
  { date: '2027-07-15', time: '08:30 ET', title: 'June PPI Producer Prices', titleKo: '6월 PPI 생산자물가', category: 'PPI', impact: 'medium' },
  { date: '2027-10-14', time: '08:30 ET', title: 'September PPI Producer Prices', titleKo: '9월 PPI 생산자물가', category: 'PPI', impact: 'medium' },

  { date: '2026-04-30', time: '08:30 ET', title: 'March PCE Price Index', titleKo: '3월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2026-05-29', time: '08:30 ET', title: 'April PCE Price Index', titleKo: '4월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2026-06-26', time: '08:30 ET', title: 'May PCE Price Index', titleKo: '5월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2026-07-31', time: '08:30 ET', title: 'June PCE Price Index', titleKo: '6월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2027-01-29', time: '08:30 ET', title: 'December PCE Price Index', titleKo: '12월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2027-04-30', time: '08:30 ET', title: 'March PCE Price Index', titleKo: '3월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2027-07-30', time: '08:30 ET', title: 'June PCE Price Index', titleKo: '6월 PCE 물가', category: 'PCE', impact: 'high' },
  { date: '2027-10-29', time: '08:30 ET', title: 'September PCE Price Index', titleKo: '9월 PCE 물가', category: 'PCE', impact: 'high' },

  { date: '2026-05-01', time: '10:00 ET', title: 'ISM Manufacturing PMI', titleKo: 'ISM 제조업 PMI', category: 'PMI', impact: 'medium' },
  { date: '2026-05-05', time: '10:00 ET', title: 'ISM Services PMI', titleKo: 'ISM 서비스업 PMI', category: 'PMI', impact: 'medium' },
  { date: '2026-06-01', time: '10:00 ET', title: 'ISM Manufacturing PMI', titleKo: 'ISM 제조업 PMI', category: 'PMI', impact: 'medium' },
  { date: '2027-01-04', time: '10:00 ET', title: 'ISM Manufacturing PMI', titleKo: 'ISM 제조업 PMI', category: 'PMI', impact: 'medium' },
  { date: '2027-01-06', time: '10:00 ET', title: 'ISM Services PMI', titleKo: 'ISM 서비스업 PMI', category: 'PMI', impact: 'medium' },
  { date: '2027-07-01', time: '10:00 ET', title: 'ISM Manufacturing PMI', titleKo: 'ISM 제조업 PMI', category: 'PMI', impact: 'medium' },

  { date: '2026-05-15', time: '08:30 ET', title: 'April Retail Sales', titleKo: '4월 소매판매', category: 'Retail', impact: 'medium' },
  { date: '2026-06-16', time: '08:30 ET', title: 'May Retail Sales', titleKo: '5월 소매판매', category: 'Retail', impact: 'medium' },
  { date: '2027-01-15', time: '08:30 ET', title: 'December Retail Sales', titleKo: '12월 소매판매', category: 'Retail', impact: 'medium' },
  { date: '2027-04-15', time: '08:30 ET', title: 'March Retail Sales', titleKo: '3월 소매판매', category: 'Retail', impact: 'medium' },
  { date: '2027-07-16', time: '08:30 ET', title: 'June Retail Sales', titleKo: '6월 소매판매', category: 'Retail', impact: 'medium' },
  { date: '2027-10-15', time: '08:30 ET', title: 'September Retail Sales', titleKo: '9월 소매판매', category: 'Retail', impact: 'medium' },
];

export function getUpcomingEvents(today: Date, limit = 12): EconEvent[] {
  const todayStr = today.toISOString().slice(0, 10);
  return ECON_EVENTS
    .filter(e => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

export function daysUntil(dateStr: string, today: Date): number {
  const target = new Date(`${dateStr}T00:00:00`);
  const current = new Date(`${today.toISOString().slice(0, 10)}T00:00:00`);
  return Math.ceil((target.getTime() - current.getTime()) / 86400000);
}

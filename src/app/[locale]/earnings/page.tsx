import EarningsPage from '@/components/pages/EarningsPage';
import { generateSeoMetadata } from '@/lib/seo';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return generateSeoMetadata({
    title: '실적 캘린더 — Flowvium',
    description: '이번 주·이번 달 실적 발표 예정 종목. EPS·매출 컨센서스 vs 실제 surprise를 한눈에.',
    path: '/earnings',
    locale: params.locale,
    keywords: ['earnings calendar', '실적 캘린더', 'EPS', 'consensus', 'Finnhub'],
  });
}

export default function Page() {
  return <EarningsPage />;
}

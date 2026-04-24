import WatchlistPage from '@/components/pages/WatchlistPage';
import { generateSeoMetadata } from '@/lib/seo';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  return generateSeoMetadata({
    title: '관심 종목 — Flowvium',
    description: '관심 종목을 추가하고 실시간 주가와 일간 변동률을 한 눈에 확인하세요.',
    path: '/watchlist',
    locale: params.locale,
    keywords: ['watchlist', '관심 종목', 'live stock price', '실시간 주가'],
  });
}

export default function Page() {
  return <WatchlistPage />;
}

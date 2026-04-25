import WatchlistPage from '@/components/pages/WatchlistPage';
import { generateSeoMetadata } from '@/lib/seo';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'seo' });
  return generateSeoMetadata({
    title: t('watchlistTitle'),
    description: t('watchlistDescription'),
    path: '/watchlist',
    locale: params.locale,
    keywords: ['watchlist', 'live stock price', 'portfolio tracker'],
  });
}

export default function Page() {
  return <WatchlistPage />;
}

import EarningsPage from '@/components/pages/EarningsPage';
import { generateSeoMetadata } from '@/lib/seo';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'seo' });
  return generateSeoMetadata({
    title: t('earningsTitle'),
    description: t('earningsDescription'),
    path: '/earnings',
    locale: params.locale,
    keywords: ['earnings calendar', 'EPS', 'consensus', 'Finnhub', 'earnings surprise'],
  });
}

export default function Page() {
  return <EarningsPage />;
}

import VolatilityPage from '@/components/pages/VolatilityPage';
import { generateSeoMetadata } from '@/lib/seo';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'volatility' });
  return generateSeoMetadata({
    title: t('seoTitle'),
    description: t('seoDescription'),
    path: '/volatility',
    locale: params.locale,
    keywords: ['implied volatility', 'IV rank', 'options skew', 'term structure'],
  });
}

export default function Page() {
  return <VolatilityPage />;
}

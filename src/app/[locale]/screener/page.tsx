import ScreenerPage from '@/components/pages/ScreenerPage';
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
    title: t('screenerTitle'),
    description: t('screenerDescription'),
    path: '/screener',
    locale: params.locale,
    keywords: ['stock screener', 'institutional buying', 'short squeeze', '13F'],
  });
}

export default function Page() {
  return <ScreenerPage />;
}

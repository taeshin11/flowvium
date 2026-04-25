import HeatmapPage from '@/components/pages/HeatmapPage';
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
    title: t('heatmapTitle'),
    description: t('heatmapDescription'),
    path: '/heatmap',
    locale: params.locale,
    keywords: ['market heatmap', 'sector ETF', 'stock heatmap', 'S&P 500'],
  });
}

export default function Page() {
  return <HeatmapPage />;
}

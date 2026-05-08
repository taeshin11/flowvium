import SatellitePage from '@/components/pages/SatellitePage';
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
    title: t('satelliteTitle'),
    description: t('satelliteDescription'),
    path: '/satellite',
    locale: params.locale,
    keywords: ['satellite monitoring', 'factory activity', 'supply chain', 'Sentinel-2', 'semiconductor fab'],
  });
}

export default function Page() {
  return <SatellitePage />;
}

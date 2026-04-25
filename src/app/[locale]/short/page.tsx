import ShortPage from '@/components/pages/ShortPage';
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
    title: t('shortTitle'),
    description: t('shortDescription'),
    path: '/short',
    locale: params.locale,
    keywords: ['short interest', 'short squeeze', 'days to cover', 'FINRA', 'SEC'],
  });
}

export default function Page() {
  return <ShortPage />;
}

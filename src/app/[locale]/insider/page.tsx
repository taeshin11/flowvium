import InsiderPage from '@/components/pages/InsiderPage';
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
    title: t('insiderTitle'),
    description: t('insiderDescription'),
    path: '/insider',
    locale: params.locale,
    keywords: ['Form 4', 'insider trading', '13D', '13G', 'options flow', 'SEC EDGAR'],
  });
}

export default function Page() {
  return <InsiderPage />;
}

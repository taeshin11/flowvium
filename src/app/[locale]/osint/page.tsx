import OSINTPage from '@/components/pages/OSINTPage';
import { generateSeoMetadata } from '@/lib/seo';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'osint' });
  return generateSeoMetadata({
    title: t('pageTitle'),
    description: 'OSINT fund-flow tracking: crypto wallet analysis, OFAC sanctions lookup, corporate structure reverse-lookup',
    path: '/osint',
    locale: params.locale,
    keywords: ['OSINT', 'fund tracking', 'crypto wallet', 'OFAC sanctions', 'dark money'],
  });
}

export default function Page() {
  return <OSINTPage />;
}

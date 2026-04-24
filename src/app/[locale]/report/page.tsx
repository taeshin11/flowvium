import ReportPage from '@/components/pages/ReportPage';
import { generateSeoMetadata } from '@/lib/seo';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'report' });
  return generateSeoMetadata({
    title: t('title'),
    description: 'AI-powered daily brief: global money flows, institutional signals, supply chain alerts',
    path: '/report',
    locale: params.locale,
    keywords: ['AI report', 'market brief', 'institutional signals', 'money flows'],
  });
}

export default function Page() {
  return <ReportPage />;
}

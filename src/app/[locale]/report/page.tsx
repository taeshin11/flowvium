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
  const ts = await getTranslations({ locale: params.locale, namespace: 'seo' });
  return generateSeoMetadata({
    title: t('title'),
    description: ts('reportDescription'),   // 2026-11-07: 한국어 화면에 영어 설명이 나가고 있었다
    path: '/report',
    locale: params.locale,
    keywords: ['AI report', 'market brief', 'institutional signals', 'money flows'],
  });
}

export default function Page() {
  return <ReportPage />;
}

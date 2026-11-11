import CompanyPage from '@/components/pages/CompanyPage';
import { generateSeoMetadata } from '@/lib/seo';
import { allCompanies } from '@/data/companies';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { companyName, companyCode } from '@/lib/company-seo.mjs';
import { companySeoData } from '@/lib/company-seo-data';

export async function generateMetadata({
  params,
}: {
  params: { locale: string; ticker: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'seo' });
  // 2026-11-07: 한국어 화면은 한국 이름·6자리 코드("삼성전자(005930) 주가·실적·주요 거래처") — lib/company-seo 머리말.
  const name = companyName(params.ticker, params.locale, companySeoData());
  const code = companyCode(params.ticker);
  const company = allCompanies.find((c) => c.ticker.toLowerCase() === params.ticker.toLowerCase());

  return generateSeoMetadata({
    title: name ? t('companyTitle', { name, code }) : t('companyTitleCode', { code }),
    description: t('companyDescription', { name: name ?? code }),
    path: `/company/${params.ticker}`,
    locale: params.locale,
    keywords: [
      (name ?? company?.name ?? params.ticker).toLowerCase(),
      params.ticker.toUpperCase(),
      'supply chain analysis',
      'institutional signals',
      'revenue breakdown',
    ],
  });
}

export default function Page({ params }: { params: { locale: string; ticker: string } }) {
  // 2026-11-11: 화면 제목도 그 언어의 회사명 — 한국어 화면에 'Samsung Electronics' 가 떴다(눈검증, 3/3 상의).
  const name = companyName(params.ticker, params.locale, companySeoData());
  return <CompanyPage ticker={params.ticker} displayName={name ?? undefined} />;
}

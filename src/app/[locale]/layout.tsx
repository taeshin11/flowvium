import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import FeedbackWidget from '@/components/FeedbackWidget';
import { generateSeoMetadata } from '@/lib/seo';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'seo' });
  return generateSeoMetadata({
    title: t('homeTitle'),
    description: t('homeDescription'),
    locale: params.locale,
    keywords: [
      'supply chain',
      'institutional buying',
      'cascade trading',
      '13F filings',
      'mid-cap stocks',
    ],
  });
}

const BASE_URL = 'https://flowvium.net';

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${BASE_URL}/#organization`,
      name: 'THE ELIOT K FINANCIAL',
      url: BASE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${BASE_URL}/opengraph-image`,
        width: 1200,
        height: 630,
      },
      sameAs: [
        'https://twitter.com/flowvium_app',
      ],
    },
    {
      '@type': 'WebApplication',
      '@id': `${BASE_URL}/#webapp`,
      name: 'Flowvium',
      url: BASE_URL,
      description:
        'Track where smart money flows through the supply chain. Free institutional flow tracker, supply chain maps, and leader-to-midcap cascade analysis.',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      inLanguage: ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'de', 'fr', 'pt', 'hi', 'ar', 'vi', 'th', 'id', 'ru', 'tr'],
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      creator: {
        '@type': 'Organization',
        name: 'THE ELIOT K FINANCIAL',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      url: BASE_URL,
      name: 'Flowvium',
      inLanguage: 'en',
      publisher: {
        '@id': `${BASE_URL}/#organization`,
      },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${BASE_URL}/en/explore?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <Navbar />
      <main className="min-h-screen">{children}</main>
      <Footer />
      <FeedbackWidget />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </NextIntlClientProvider>
  );
}

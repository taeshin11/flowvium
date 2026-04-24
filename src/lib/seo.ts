import { Metadata } from 'next';

const BASE_URL = 'https://flowvium.vercel.app';
const SITE_NAME = 'Flowvium';
const DEFAULT_DESC =
  'Track where smart money flows through the supply chain. Free institutional flow tracker, supply chain maps, and leader-to-midcap cascade analysis.';

/** All supported locales — must match sitemap.ts and [locale] routing */
const ALL_LOCALES = [
  'en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'de', 'fr',
  'pt', 'hi', 'ar', 'vi', 'th', 'id', 'ru', 'tr',
] as const;

export function generateSeoMetadata({
  title,
  description = DEFAULT_DESC,
  path = '',
  locale = 'en',
  keywords = [],
}: {
  title: string;
  description?: string;
  path?: string;
  locale?: string;
  keywords?: string[];
}): Metadata {
  // opengraph-image.tsx generates the OG image dynamically per-locale
  const ogImageUrl = `${BASE_URL}/${locale === 'en' ? '' : locale + '/'}opengraph-image`;
  // localePrefix: 'as-needed' — default locale (en) has no /en/ prefix in URLs
  const canonicalUrl = locale === 'en' ? `${BASE_URL}${path}` : `${BASE_URL}/${locale}${path}`;
  // Avoid double site-name: "Flowvium — X | Flowvium" → "Flowvium — X"
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  // Build hreflang — English uses root path (no /en/ prefix), others use /{locale}/
  const languages: Record<string, string> = {
    'x-default': `${BASE_URL}${path}`,
    'en': `${BASE_URL}${path}`,
  };
  for (const loc of ALL_LOCALES.filter(l => l !== 'en')) {
    languages[loc] = `${BASE_URL}/${loc}${path}`;
  }

  return {
    title: fullTitle,
    description,
    keywords: [
      'supply chain tracker',
      'institutional flow',
      'smart money',
      'investment tracker',
      ...keywords,
    ],
    authors: [{ name: 'THE ELIOT K FINANCIAL' }],
    creator: 'THE ELIOT K FINANCIAL',
    publisher: 'THE ELIOT K FINANCIAL',
    metadataBase: new URL(BASE_URL),
    alternates: {
      canonical: canonicalUrl,
      languages,
    },
    openGraph: {
      title: fullTitle,
      description,
      url: canonicalUrl,
      siteName: SITE_NAME,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
      locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImageUrl],
      creator: '@flowvium_app',
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large' as const,
        'max-snippet': -1,
      },
    },
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || '',
      // Bing Webmaster (also covers Yahoo Japan, DuckDuckGo)
      other: {
        'msvalidate.01': process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION || '',
        // Naver Search Advisor (Korea)
        'naver-site-verification': process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION || '',
        // Baidu Webmaster (China)
        'baidu-site-verification': process.env.NEXT_PUBLIC_BAIDU_SITE_VERIFICATION || '',
        // Yandex Webmaster (Russia)
        'yandex-verification': process.env.NEXT_PUBLIC_YANDEX_VERIFICATION || '',
      },
    },
  };
}

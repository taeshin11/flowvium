import { Metadata } from 'next';
import { routing } from '@/i18n/routing';
import { alternateLanguages } from './seo-alternates.mjs';
import { verificationCodes } from './seo-verification.mjs';

const BASE_URL = 'https://flowvium.net';
const SITE_NAME = 'Flowvium';
const DEFAULT_DESC =
  'Track where smart money flows through the supply chain. Free institutional flow tracker, supply chain maps, and leader-to-midcap cascade analysis.';

// 언어 목록은 i18n/routing 하나에서만 — 따로 들고 있다가 없는 13개 언어판을 구글에 알렸다(lib/seo-alternates 머리말).

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
  const languages: Record<string, string> = alternateLanguages(path, routing.locales, BASE_URL);

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
      // 쉼표로 여러 개 — 새 코드를 받아도 기존 코드는 남긴다(2026-11-08, lib/seo-verification).
      google: verificationCodes(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION),
      // Bing Webmaster (also covers Yahoo Japan, DuckDuckGo)
      other: {
        'msvalidate.01': verificationCodes(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION),
        // Naver Search Advisor (Korea)
        'naver-site-verification': verificationCodes(process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION),
        // Baidu Webmaster (China)
        'baidu-site-verification': process.env.NEXT_PUBLIC_BAIDU_SITE_VERIFICATION || '',
        // Yandex Webmaster (Russia)
        'yandex-verification': process.env.NEXT_PUBLIC_YANDEX_VERIFICATION || '',
      },
    },
  };
}

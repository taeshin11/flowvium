import { routing } from '@/i18n/routing';
import { MetadataRoute } from 'next';
import { sitemapTickers } from '@/lib/company-seo.mjs';
import { companySeoData } from '@/lib/company-seo-data';
import { sectors } from '@/data/sectors';
import { blogPosts } from '@/data/blog-posts';
import { glossaryTerms } from '@/data/glossary';
import { listCloseDates } from '@/lib/market-close-data';

const BASE_URL = 'https://flowvium.net';
const locales = routing.locales;   // 목록은 i18n/routing 하나에서만 정한다

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: MetadataRoute.Sitemap = [];
  const companyTickers = sitemapTickers(companySeoData());

  // Static pages
  const staticPages = [
    '', '/explore', '/cascade', '/signals', '/news-gap', '/about', '/blog', '/how-to-use', '/privacy', '/terms',
    '/heatmap', '/screener', '/short', '/insider', '/report', '/earnings', '/intelligence', '/osint', '/glossary',
    '/paper-trading', '/fear-greed',
  ];

  // localePrefix: 'as-needed' — default locale (en) has no /en/ prefix
  const localeBase = (locale: string, path: string) =>
    locale === 'en' ? `${BASE_URL}${path}` : `${BASE_URL}/${locale}${path}`;

  // 2026-11-11 날짜별 한국 증시 마감(성장 점검 A): 본문이 한국어뿐이라 한국어판만 싣는다(다른 언어판은 noindex·canonical=ko).
  routes.push({ url: `${BASE_URL}/ko/market-close`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 });
  for (const date of listCloseDates()) {
    routes.push({ url: `${BASE_URL}/ko/market-close/${date}`, lastModified: new Date(`${date}T18:00:00+09:00`), changeFrequency: 'monthly', priority: 0.7 });
  }

  for (const locale of locales) {
    for (const page of staticPages) {
      routes.push({
        url: localeBase(locale, page),
        lastModified: new Date(),
        changeFrequency: page === '' ? 'daily' : 'weekly',
        priority: page === '' ? 1 : 0.8,
      });
    }

    // Sector pages
    for (const sector of sectors) {
      routes.push({
        url: localeBase(locale, `/explore/${sector.id}`),
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
      routes.push({
        url: localeBase(locale, `/cascade/${sector.id}`),
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }

    // Company pages
    // 2026-11-07: 큐레이션 + 종목 풀의 한국 종목(이름 아는 것) — 종전엔 한국 종목 3개뿐이었다(lib/company-seo).
    for (const ticker of companyTickers) {
      routes.push({
        url: localeBase(locale, `/company/${ticker}`),
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }

    // Blog pages
    for (const post of blogPosts) {
      routes.push({
        url: localeBase(locale, `/blog/${post.slug}`),
        lastModified: new Date(post.publishDate),
        changeFrequency: 'monthly',
        priority: 0.5,
      });
    }

    // Glossary term pages
    for (const gt of glossaryTerms) {
      routes.push({
        url: localeBase(locale, `/glossary/${gt.slug}`),
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }

    // Fear & Greed market pages
    const fearGreedMarkets = ['us', 'korea', 'japan', 'china', 'europe', 'uk', 'india', 'brazil', 'taiwan', 'australia'];
    for (const market of fearGreedMarkets) {
      routes.push({
        url: localeBase(locale, `/fear-greed/${market}`),
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }
  }

  return routes;
}

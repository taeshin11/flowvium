import { MetadataRoute } from 'next';
import { allCompanies } from '@/data/companies';
import { sectors } from '@/data/sectors';
import { blogPosts } from '@/data/blog-posts';
import { glossaryTerms } from '@/data/glossary';

const BASE_URL = 'https://flowvium.net';
const locales = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'de', 'fr', 'pt', 'hi', 'ar', 'vi', 'th', 'id', 'ru', 'tr'];

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: MetadataRoute.Sitemap = [];

  // Static pages
  const staticPages = [
    '', '/explore', '/cascade', '/signals', '/news-gap', '/about', '/blog', '/how-to-use', '/privacy', '/terms',
    '/heatmap', '/screener', '/short', '/insider', '/report', '/earnings', '/intelligence', '/osint', '/glossary',
  ];

  // localePrefix: 'as-needed' — default locale (en) has no /en/ prefix
  const localeBase = (locale: string, path: string) =>
    locale === 'en' ? `${BASE_URL}${path}` : `${BASE_URL}/${locale}${path}`;

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
    for (const company of allCompanies) {
      routes.push({
        url: localeBase(locale, `/company/${company.ticker}`),
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

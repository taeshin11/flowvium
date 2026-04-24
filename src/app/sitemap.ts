import { MetadataRoute } from 'next';
import { allCompanies } from '@/data/companies';
import { sectors } from '@/data/sectors';
import { blogPosts } from '@/data/blog-posts';

const BASE_URL = 'https://flowvium.vercel.app';
const locales = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'de', 'fr', 'pt', 'hi', 'ar', 'vi', 'th', 'id', 'ru', 'tr'];

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: MetadataRoute.Sitemap = [];

  // Static pages
  const staticPages = [
    '', '/explore', '/cascade', '/signals', '/news-gap', '/about', '/blog', '/how-to-use', '/privacy', '/terms',
    '/heatmap', '/screener', '/short', '/insider', '/report', '/earnings', '/intelligence', '/osint', '/watchlist',
  ];

  for (const locale of locales) {
    for (const page of staticPages) {
      routes.push({
        url: `${BASE_URL}/${locale}${page}`,
        lastModified: new Date(),
        changeFrequency: page === '' ? 'daily' : 'weekly',
        priority: page === '' ? 1 : 0.8,
      });
    }

    // Sector pages
    for (const sector of sectors) {
      routes.push({
        url: `${BASE_URL}/${locale}/explore/${sector.id}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
      routes.push({
        url: `${BASE_URL}/${locale}/cascade/${sector.id}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }

    // Company pages
    for (const company of allCompanies) {
      routes.push({
        url: `${BASE_URL}/${locale}/company/${company.ticker}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }

    // Blog pages
    for (const post of blogPosts) {
      routes.push({
        url: `${BASE_URL}/${locale}/blog/${post.slug}`,
        lastModified: new Date(post.publishDate),
        changeFrequency: 'monthly',
        priority: 0.5,
      });
    }
  }

  return routes;
}

import { blogPosts, getBlogPostBySlug } from '@/data/blog-posts';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { generateSeoMetadata } from '@/lib/seo';
import { getTranslations } from 'next-intl/server';
import { translateBlogPost } from '@/lib/blog-translate';
import BlogArticleClient from './BlogArticleClient';

// Only pre-render English at build time — other locales are translated on-demand via Redis cache.
// Pre-rendering all 16 locales × N posts at build time exhausts Groq's 100k TPD free tier.
export function generateStaticParams() {
  return blogPosts.map((post) => ({ locale: 'en', slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'seo' });
  const post = getBlogPostBySlug(params.slug);
  if (!post) return { title: 'Not Found' };
  return generateSeoMetadata({
    title: `${post.title} - ${t('homeTitle')}`,
    description: post.metaDescription,
    path: `/blog/${params.slug}`,
    locale: params.locale,
    keywords: [
      'supply chain blog',
      post.sector,
      'investment analysis',
      'cascade trading',
    ],
  });
}

const BASE_URL = 'https://flowvium.net';

export default async function BlogArticlePage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const post = getBlogPostBySlug(params.slug);
  if (!post) return notFound();

  const { title: translatedTitle, content: translatedContent } = await translateBlogPost(
    params.locale,
    post.slug,
    post.title,
    post.metaDescription,
    post.content,
  );

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: translatedTitle,
    description: post.metaDescription,
    datePublished: post.publishDate,
    dateModified: post.publishDate,
    author: { '@type': 'Organization', name: 'THE ELIOT K FINANCIAL', url: BASE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'Flowvium',
      logo: { '@type': 'ImageObject', url: `${BASE_URL}/opengraph-image`, width: 1200, height: 630 },
    },
    url: `${BASE_URL}/${params.locale === 'en' ? '' : params.locale + '/'}blog/${post.slug}`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${BASE_URL}/blog/${post.slug}` },
    articleSection: post.sector,
    inLanguage: params.locale,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <BlogArticleClient
        post={post}
        translatedTitle={translatedTitle}
        translatedContent={translatedContent}
      />
    </>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { BlogPost } from '@/data/blog-posts';
import { Calendar, Clock, ArrowRight } from 'lucide-react';
// 2026-08-22: 섹터 슬러그를 그대로 찍어 /ko/blog 에 'semiconductors'·'defense' 가 노출됐다.
import { useSectorLabel } from '@/hooks/useSectorLabel';

const sectorColors: Record<string, string> = {
  semiconductors: 'bg-blue-100 text-blue-700',
  'ai-cloud': 'bg-purple-100 text-purple-700',
  'ev-battery': 'bg-green-100 text-green-700',
  defense: 'bg-amber-100 text-amber-700',
  'pharma-biotech': 'bg-red-100 text-red-700',
  macro: 'bg-slate-100 text-slate-700',
  all: 'bg-gray-100 text-gray-700',
};

export default function BlogClient({ posts }: { posts: BlogPost[] }) {
  const t = useTranslations('nav');

  const sectorLabel = useSectorLabel();
  const tBlog = useTranslations('blog');
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-heading font-bold text-cf-text-primary mb-4">
          Flowvium {t('blog')}
        </h1>
        <p className="text-lg text-cf-text-secondary max-w-2xl mx-auto">
          Deep dives into supply chain investing, institutional flow analysis, and cascade
          trading strategies.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="cf-card p-6 flex flex-col hover:shadow-lg transition-all duration-200 group"
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  sectorColors[post.sector] || sectorColors.all
                }`}
              >
                {post.sector === 'all' ? tBlog('strategy') : sectorLabel(post.sector)}
              </span>
              <span className="text-xs text-cf-text-secondary flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {post.readTime}
              </span>
            </div>

            <h2 className="text-lg font-heading font-bold text-cf-text-primary mb-2 group-hover:text-cf-primary transition-colors">
              {post.title}
            </h2>

            <p className="text-sm text-cf-text-secondary mb-4 flex-1 line-clamp-3">
              {post.metaDescription}
            </p>

            <div className="flex items-center justify-between mt-auto pt-4 border-t border-cf-border">
              <span className="text-xs text-cf-text-secondary flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {new Date(post.publishDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <span className="text-sm text-cf-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                Read
                <ArrowRight className="w-4 h-4" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

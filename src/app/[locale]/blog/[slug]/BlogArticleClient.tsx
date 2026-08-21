'use client';

import { Link } from '@/i18n/routing';
import { ArrowLeft, Calendar, Clock } from 'lucide-react';
import type { BlogPost } from '@/data/blog-posts';
import ShareButtons from '@/components/ShareButtons';
import Breadcrumbs from '@/components/Breadcrumbs';
import EmailCTA from '@/components/EmailCTA';
import { useTranslations } from 'next-intl';
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

function renderContent(content: string) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<div key={key++} className="h-4" />);
    } else if (trimmed.startsWith('## ')) {
      elements.push(
        <h2
          key={key++}
          className="text-2xl font-heading font-bold text-cf-text-primary mt-8 mb-4"
        >
          {trimmed.replace('## ', '')}
        </h2>
      );
    } else if (trimmed.startsWith('### ')) {
      elements.push(
        <h3
          key={key++}
          className="text-xl font-heading font-bold text-cf-text-primary mt-6 mb-3"
        >
          {trimmed.replace('### ', '')}
        </h3>
      );
    } else if (/^\d+\./.test(trimmed)) {
      elements.push(
        <p key={key++} className="text-cf-text-secondary leading-relaxed pl-6 mb-1">
          {trimmed}
        </p>
      );
    } else {
      elements.push(
        <p key={key++} className="text-cf-text-secondary leading-relaxed mb-4">
          {trimmed}
        </p>
      );
    }
  }
  return elements;
}

export default function BlogArticleClient({
  post,
  translatedTitle,
  translatedContent,
}: {
  post: BlogPost;
  translatedTitle?: string;
  translatedContent?: string;
}) {
  const sectorLabel = useSectorLabel();
  const tBlog = useTranslations('blog');
  const displayTitle = translatedTitle || post.title;
  const displayContent = translatedContent || post.content;
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12">
      <Breadcrumbs overrides={{ [post.slug]: { label: post.title } }} />

      <Link
        href="/blog"
        className="inline-flex items-center gap-2 text-sm text-cf-text-secondary hover:text-cf-primary transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Blog
      </Link>

      <header className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              sectorColors[post.sector] || sectorColors.all
            }`}
          >
            {post.sector === 'all' ? tBlog('strategy') : sectorLabel(post.sector)}
          </span>
          <span className="text-sm text-cf-text-secondary flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {post.readTime}
          </span>
          <span className="text-sm text-cf-text-secondary flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {new Date(post.publishDate).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>

        <h1 className="text-4xl font-heading font-bold text-cf-text-primary leading-tight mb-4">
          {displayTitle}
        </h1>
        <ShareButtons title={`${displayTitle} | Flowvium Blog`} />
      </header>

      <div className="prose-cf">{renderContent(displayContent)}</div>

      <EmailCTA />

      <footer className="mt-12 pt-8 border-t border-cf-border">
        <div className="cf-card p-6 bg-cf-primary/5 border-cf-primary/20">
          <p className="text-sm text-cf-text-secondary">
            <strong className="text-cf-text-primary">Disclaimer:</strong> This article is for
            informational purposes only and does not constitute financial advice. Always conduct
            your own research before making investment decisions.
          </p>
        </div>
      </footer>
    </article>
  );
}

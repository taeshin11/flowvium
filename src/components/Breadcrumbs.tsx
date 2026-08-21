'use client';

import { useTranslations, useMessages } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { Link } from '@/i18n/routing';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbOverride {
  label?: string;
}

interface BreadcrumbsProps {
  overrides?: Record<string, BreadcrumbOverride>;
}

function formatSegment(segment: string): string {
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** URL 세그먼트(kebab) → nav 키(camel). news-gap → newsGap */
function segmentKey(segment: string): string {
  return segment.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export default function Breadcrumbs({ overrides = {} }: BreadcrumbsProps) {
  const t = useTranslations('common');
  const tNav = useTranslations('nav');
  const messages = useMessages() as Record<string, unknown> | undefined;
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // 2026-08-22: 종전엔 formatSegment(URL) 만 썼다. 'company' → 'Company' 로 타이틀케이스만
  //   하는 함수라 16개 로케일 전부에서 브레드크럼이 영문이었고, JSON-LD 구조화 데이터에도
  //   영문으로 실려 검색엔진에 그대로 노출됐다(실측: /ko/company/005930.KS 의 english_leak).
  //   nav 네임스페이스에 같은 이름의 키가 이미 있으므로 그걸 재사용한다 — 새 카탈로그를
  //   만들면 같은 목록이 두 곳이 되고 한쪽만 고쳐진다.
  //   존재 여부는 messages 로 확인한다(t() 는 없는 키에 예외를 던진다).
  const navMsgs = (messages as { nav?: Record<string, unknown> } | undefined)?.nav ?? {};
  const navLabel = (segment: string): string | null => {
    for (const k of [segment, segmentKey(segment)]) {
      if (Object.prototype.hasOwnProperty.call(navMsgs, k)) return tNav(k);
    }
    return null;
  };

  const crumbs = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const label = overrides[segment]?.label || navLabel(segment) || formatSegment(segment);
    const isLast = index === segments.length - 1;
    return { href, label, isLast, segment };
  });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: t('home'),
        item: 'https://flowvium.net',
      },
      ...crumbs.map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 2,
        name: crumb.label,
        item: `https://flowvium.net${crumb.href}`,
      })),
    ],
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center flex-wrap gap-1 text-sm text-cf-text-secondary">
          <li className="flex items-center">
            <Link
              href="/"
              className="hover:text-cf-primary transition-colors flex items-center gap-1"
            >
              <Home className="w-3.5 h-3.5" />
              <span className="sr-only">{t('home')}</span>
            </Link>
          </li>
          {crumbs.map((crumb) => (
            <li key={crumb.href} className="flex items-center">
              <ChevronRight className="w-3.5 h-3.5 mx-1 text-cf-text-secondary/50" />
              {crumb.isLast ? (
                <span className="text-cf-text-primary font-medium">{crumb.label}</span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hover:text-cf-primary transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}

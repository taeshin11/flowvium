import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { glossaryTerms, getGlossaryTermBySlug } from '@/data/glossary';

export function generateStaticParams() {
  const params: { locale: string; term: string }[] = [];
  for (const locale of ["ko","en","ja","zh-CN","zh-TW","es","fr","de","pt","ru","ar","hi","id","th","tr","vi"]) {
    for (const t of glossaryTerms) {
      params.push({ locale, term: t.slug });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; term: string };
}): Promise<Metadata> {
  const t = getGlossaryTermBySlug(params.term);
  if (!t) return { title: 'Not Found' };
  const isKo = params.locale === 'ko';
  return {
    title: isKo
      ? `${t.termKo} 뜻 — 투자 용어 사전 | Flowvium`
      : `${t.term} Definition — Investment Glossary | Flowvium`,
    description: isKo ? t.definitionKo.substring(0, 160) : t.definition.substring(0, 160),
  };
}

export default function GlossaryTermPage({
  params,
}: {
  params: { locale: string; term: string };
}) {
  const t = getGlossaryTermBySlug(params.term);
  if (!t) return notFound();

  const isKo = params.locale === 'ko';

  const categoryColors: Record<string, string> = {
    valuation: 'bg-blue-100 text-blue-800',
    fundamental: 'bg-green-100 text-green-800',
    technical: 'bg-purple-100 text-purple-800',
    macro: 'bg-orange-100 text-orange-800',
    derivatives: 'bg-red-100 text-red-800',
    etf: 'bg-teal-100 text-teal-800',
    crypto: 'bg-yellow-100 text-yellow-800',
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/${params.locale}/glossary`}
          className="text-sm text-blue-600 hover:underline"
        >
          {isKo ? '← 용어 사전으로 돌아가기' : '← Back to Glossary'}
        </Link>
      </div>

      <div className="mb-2">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${categoryColors[t.category] ?? 'bg-gray-100 text-gray-800'}`}
        >
          {t.category}
        </span>
      </div>

      <h1 className="text-3xl font-bold mb-1">{t.term}</h1>
      {isKo && <p className="text-xl text-gray-600 mb-6">{t.termKo}</p>}

      <div className="prose max-w-none mb-8">
        <h2 className="text-lg font-semibold mb-2">
          {isKo ? '정의' : 'Definition'}
        </h2>
        <p className="text-gray-700 leading-relaxed mb-4">{isKo ? t.definitionKo : t.definition}</p>
        {isKo && (
          <>
            <h3 className="text-base font-semibold text-gray-500 mb-1">English</h3>
            <p className="text-gray-500 leading-relaxed">{t.definition}</p>
          </>
        )}
      </div>

      {t.relatedTickers && t.relatedTickers.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-2">
            {isKo ? '관련 종목' : 'Related Tickers'}
          </h3>
          <div className="flex gap-2 flex-wrap">
            {t.relatedTickers.map((ticker) => (
              <Link
                key={ticker}
                href={`/${params.locale}/company/${ticker}`}
                className="px-3 py-1 bg-gray-100 rounded-full text-sm font-medium hover:bg-gray-200"
              >
                {ticker}
              </Link>
            ))}
          </div>
        </div>
      )}

      {t.relatedTerms.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">
            {isKo ? '관련 용어' : 'Related Terms'}
          </h3>
          <div className="flex gap-2 flex-wrap">
            {t.relatedTerms.map((slug) => {
              const related = glossaryTerms.find((x) => x.slug === slug);
              if (!related) return null;
              return (
                <Link
                  key={slug}
                  href={`/${params.locale}/glossary/${slug}`}
                  className="px-3 py-1 border border-gray-200 rounded-full text-sm hover:border-blue-400 hover:text-blue-600"
                >
                  {isKo ? related.termKo : related.term}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

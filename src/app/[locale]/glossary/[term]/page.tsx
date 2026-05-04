import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { generateSeoMetadata } from '@/lib/seo';
import { glossaryTerms, getGlossaryTermBySlug } from '@/data/glossary';

export function generateStaticParams() {
  const params: { locale: string; term: string }[] = [];
  for (const locale of ["ko","en","ja","zh-CN","zh-TW","es","fr","de","pt","ru","ar","hi","id","th","tr","vi"]) {
    for (const gt of glossaryTerms) {
      params.push({ locale, term: gt.slug });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; term: string };
}): Promise<Metadata> {
  const term = getGlossaryTermBySlug(params.term);
  if (!term) return { title: 'Not Found' };
  const tl = await getTranslations({ locale: params.locale, namespace: 'glossary' });
  const isKo = params.locale === 'ko';
  const termName = isKo ? term.termKo : term.term;
  const definition = (isKo ? term.definitionKo : term.definition).substring(0, 160);
  return generateSeoMetadata({
    title: tl('termMetaTitle', { term: termName }),
    description: definition,
    path: `/glossary/${params.term}`,
    locale: params.locale,
    keywords: [termName, 'financial glossary', 'investing terms', term.category],
  });
}

export default async function GlossaryTermPage({
  params,
}: {
  params: { locale: string; term: string };
}) {
  const term = getGlossaryTermBySlug(params.term);
  if (!term) return notFound();
  const tl = await getTranslations({ locale: params.locale, namespace: 'glossary' });

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
          {tl('backButton')}
        </Link>
      </div>

      <div className="mb-2">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${categoryColors[term.category] ?? 'bg-gray-100 text-gray-800'}`}
        >
          {term.category}
        </span>
      </div>

      <h1 className="text-3xl font-bold mb-1">{term.term}</h1>
      {isKo && <p className="text-xl text-gray-600 mb-6">{term.termKo}</p>}

      <div className="prose max-w-none mb-8">
        <h2 className="text-lg font-semibold mb-2">
          {tl('definitionLabel')}
        </h2>
        <p className="text-gray-700 leading-relaxed mb-4">{isKo ? term.definitionKo : term.definition}</p>
        {isKo && (
          <>
            <h3 className="text-base font-semibold text-gray-500 mb-1">{tl('englishLabel')}</h3>
            <p className="text-gray-500 leading-relaxed">{term.definition}</p>
          </>
        )}
      </div>

      {term.relatedTickers && term.relatedTickers.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-2">
            {tl('relatedTickers')}
          </h3>
          <div className="flex gap-2 flex-wrap">
            {term.relatedTickers.map((ticker) => (
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

      {term.relatedTerms.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">
            {tl('relatedTerms')}
          </h3>
          <div className="flex gap-2 flex-wrap">
            {term.relatedTerms.map((slug) => {
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

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { glossaryTerms, glossaryCategories } from '@/data/glossary';

export function generateStaticParams() {
  return ["ko","en","ja","zh-CN","zh-TW","es","fr","de","pt","ru","ar","hi","id","th","tr","vi"].map((locale: string) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'glossary' });
  return {
    title: t('metaTitle'),
    description: t('metaDesc'),
  };
}

export default async function GlossaryIndexPage({
  params,
}: {
  params: { locale: string };
}) {
  const t = await getTranslations({ locale: params.locale, namespace: 'glossary' });
  const isKo = params.locale === 'ko';

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">
        {t('title')}
      </h1>
      <p className="text-gray-500 mb-8">
        {t('subtitle')}
      </p>

      {glossaryCategories
        .filter((cat) => cat.id !== 'all')
        .map((cat) => {
          const terms = glossaryTerms.filter((t) => t.category === cat.id);
          return (
            <div key={cat.id} className="mb-10">
              <h2 className="text-xl font-semibold mb-4 capitalize border-b pb-2">
                {isKo ? cat.labelKo : cat.label}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {terms.map((t) => (
                  <Link
                    key={t.slug}
                    href={`/${params.locale}/glossary/${t.slug}`}
                    className="block p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-sm"
                  >
                    <span className="font-medium">{isKo ? t.termKo : t.term}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}

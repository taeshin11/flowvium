/**
 * /[locale]/market-close — 날짜별 '한국 증시 마감' 기록 목록 (2026-11-11 성장 점검 A). 각 날짜 페이지 머리말 참고.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { generateSeoMetadata } from '@/lib/seo';
import { readClose, listCloseDates } from '@/lib/market-close-data';

export const revalidate = 3600;

const NS = 'marketClose';
const PATH = '/market-close';
const KO = 'ko';
const ymd = (date: string) => { const [y, m, d] = date.split('-').map(Number); return { y, m, d }; };

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: NS });
  const base = generateSeoMetadata({ title: t('archiveTitle'), description: t('archiveLead'), path: PATH, locale: params.locale });
  return {
    ...base,
    alternates: { canonical: `https://flowvium.net/${KO}${PATH}` },
    ...(params.locale === KO ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function MarketCloseArchive({ params }: { params: { locale: string } }) {
  const t = await getTranslations({ locale: params.locale, namespace: NS });
  const items = listCloseDates().map((d) => ({ date: d, rec: readClose(d) })).filter((x) => x.rec);
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10 break-keep">
      <h1 className="text-2xl sm:text-3xl font-bold text-cf-text-primary">{t('archiveTitle')}</h1>
      <p className="text-cf-text-secondary mt-2">{t('archiveLead')}</p>
      {params.locale !== KO && <p className="text-xs text-cf-text-secondary mt-2">{t('koOnly')}</p>}
      {items.length ? (
        <ul className="mt-6 space-y-3">
          {items.map(({ date, rec }) => (
            <li key={date} className="cf-card p-4">
              <Link href={`/${params.locale}${PATH}/${date}`} className="font-semibold text-cf-text-primary hover:underline">{t('title', ymd(date))}</Link>
              <p className="text-xs text-cf-text-secondary mt-1 tabular-nums">{rec!.facts.slice(0, 2).join(' · ')}</p>
              <p className="text-xs text-cf-text-secondary mt-1">{rec!.chapters.filter((c) => c.kind === 'story').map((c) => c.heading).join(' · ')}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-6 text-sm text-cf-text-secondary">{t('empty')}</p>}
    </div>
  );
}

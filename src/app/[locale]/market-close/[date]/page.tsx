/**
 * /[locale]/market-close/[date] — 그날 '한국 증시 마감' 기록 (2026-11-11 성장 점검 A, Claude·agy·ChatGPT 3/3).
 *
 * 왜: 보고서는 /report 한 주소에서 하루 다섯 번 바뀌어 검색에 쌓이는 것이 없었다. 날짜마다 주소를 하나씩 남긴다.
 * 무엇: 마감 지수(네이버 금융) + 관문(숫자 근거·당위 문장·장중 숫자·agy 대조)을 지난 문장 + 그 문장이 기댄 기사.
 *   여기서 새로 쓰는 문장은 없다(lib/market-close 머리말). 본문은 한국어뿐이라 다른 언어판은 색인하지 않고 한국어판을 대표로 둔다.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { generateSeoMetadata } from '@/lib/seo';
import { readClose, listCloseDates, closeCompanyLinks } from '@/lib/market-close-data';

export const revalidate = 3600;

const NS = 'marketClose';
const BASE_URL = 'https://flowvium.net';
const KO = 'ko';
// JSON-LD 고정값(화면에 안 보임)
const LD_CONTEXT = 'https://schema.org';
const LD_ARTICLE = 'NewsArticle';
const LD_ORG = 'Organization';
const PUBLISHER = 'FlowVium';
const pathOf = (date: string) => `/market-close/${date}`;
const koUrl = (date: string) => `${BASE_URL}/${KO}${pathOf(date)}`;
const ymd = (date: string) => { const [y, m, d] = date.split('-').map(Number); return { y, m, d }; };

export async function generateMetadata({ params }: { params: { locale: string; date: string } }): Promise<Metadata> {
  const rec = readClose(params.date);
  if (!rec) return {};
  const t = await getTranslations({ locale: params.locale, namespace: NS });
  const base = generateSeoMetadata({
    title: t('metaTitle', ymd(rec.date)),
    description: rec.facts.slice(0, 2).join(' · ') + ' — ' + rec.chapters.filter((c) => c.kind === 'story').map((c) => c.heading).join(', '),
    path: pathOf(rec.date),
    locale: params.locale,
  });
  // 본문이 한국어뿐 — 언어판끼리 같은 글이 되므로 한국어판 하나만 대표로, 나머지는 색인하지 않는다.
  return {
    ...base,
    alternates: { canonical: koUrl(rec.date) },
    ...(params.locale === KO ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function MarketClosePage({ params }: { params: { locale: string; date: string } }) {
  const rec = readClose(params.date);
  if (!rec) notFound();
  const t = await getTranslations({ locale: params.locale, namespace: NS });
  const loc = params.locale;
  const dates = listCloseDates();
  const i = dates.indexOf(rec.date);
  const newer = i > 0 ? dates[i - 1] : null;
  const older = i >= 0 && i < dates.length - 1 ? dates[i + 1] : null;
  const companies = closeCompanyLinks(rec);
  const jsonLd = {
    '@context': LD_CONTEXT,
    '@type': LD_ARTICLE,
    headline: t('title', ymd(rec.date)),
    datePublished: `${rec.date}T18:00:00+09:00`,
    inLanguage: KO,
    mainEntityOfPage: koUrl(rec.date),
    publisher: { '@type': LD_ORG, name: PUBLISHER },
    citation: rec.chapters.flatMap((c) => c.sources.map((s) => s.link)),
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10 break-keep">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <nav className="text-xs text-cf-text-secondary mb-3">
        <Link href={`/${loc}/market-close`} className="hover:underline">{t('archiveTitle')}</Link>
      </nav>
      <h1 className="text-2xl sm:text-3xl font-bold text-cf-text-primary">{t('title', ymd(rec.date))}</h1>
      {loc !== KO && <p className="text-xs text-cf-text-secondary mt-2">{t('koOnly')}</p>}

      <section className="cf-card p-5 sm:p-6 mt-6" aria-labelledby="h-idx">
        <h2 id="h-idx" className="text-base font-bold text-cf-text-primary mb-2">{t('indices')}</h2>
        <ul className="space-y-1 text-sm text-cf-text-primary tabular-nums">
          {rec.facts.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <p className="text-xs text-cf-text-secondary mt-3">{t('indicesSource')}</p>
      </section>

      {rec.chapters.map((c, ci) => (
        <section key={ci} className="cf-card p-5 sm:p-6 mt-4" aria-labelledby={`h-c${ci}`}>
          <h2 id={`h-c${ci}`} className="text-base font-bold text-cf-text-primary mb-2">{c.heading}</h2>
          <p className="text-sm leading-relaxed text-cf-text-primary">{c.sentences.join(' ')}</p>
          {c.sources.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-cf-text-secondary">
              {c.sources.map((s) => (
                <li key={s.link}>
                  {t('source')}: <a href={s.link} target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-cf-text-primary">{s.source} — {s.headline}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {companies.length > 0 && (
        <section className="cf-card p-5 sm:p-6 mt-4" aria-labelledby="h-co">
          <h2 id="h-co" className="text-base font-bold text-cf-text-primary mb-2">{t('related')}</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {companies.map((co) => (
              <li key={co.ticker}>
                <Link href={`/${loc}/company/${co.ticker}`} className="inline-block rounded border border-cf-border px-2 py-1 hover:bg-cf-bg">{co.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="flex flex-wrap justify-between gap-3 mt-6 text-sm">
        {older ? <Link href={`/${loc}${pathOf(older)}`} className="hover:underline">← {t('dayLabel', ymd(older))}</Link> : <span />}
        <Link href={`/${loc}/report`} className="hover:underline">{t('toReport')}</Link>
        {newer ? <Link href={`/${loc}${pathOf(newer)}`} className="hover:underline">{t('dayLabel', ymd(newer))} →</Link> : <span />}
      </nav>
      <p className="text-xs text-cf-text-secondary mt-6">{t('disclaimer')}</p>
    </div>
  );
}

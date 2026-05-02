import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import FearGreedMarketClient from './FearGreedMarketClient';

const MARKETS = ["us","korea","japan","china","europe","uk","india","brazil","taiwan","australia"];
const LOCALES = ["ko","en","ja","zh-CN","zh-TW","es","fr","de","pt","ru","ar","hi","id","th","tr","vi"];

const MARKET_LABELS: Record<string, string> = {"us":"US","korea":"Korea","japan":"Japan","china":"China","europe":"Europe","uk":"UK","india":"India","brazil":"Brazil","taiwan":"Taiwan","australia":"Australia"};

export function generateStaticParams() {
  const params: { locale: string; market: string }[] = [];
  for (const locale of LOCALES) {
    for (const market of MARKETS) {
      params.push({ locale, market });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; market: string };
}): Promise<Metadata> {
  const marketLabel = MARKET_LABELS[params.market] ?? params.market;
  const t = await getTranslations({ locale: params.locale, namespace: 'fearGreedMarket' });
  return {
    title: t('metaTitle', { market: marketLabel }),
    description: t('metaDesc', { market: marketLabel }),
  };
}

export default async function FearGreedMarketPage({
  params,
}: {
  params: { locale: string; market: string };
}) {
  const marketLabel = MARKET_LABELS[params.market] ?? params.market;
  const t = await getTranslations({ locale: params.locale, namespace: 'fearGreedMarket' });

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">
        {marketLabel} {t('title')}
      </h1>
      <p className="text-gray-500 text-sm mb-8">
        {t('description')}
      </p>

      <FearGreedMarketClient market={params.market} locale={params.locale} />
    </div>
  );
}

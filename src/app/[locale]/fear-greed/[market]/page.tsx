import type { Metadata } from 'next';
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
  const isKo = params.locale === 'ko';
  return {
    title: `${marketLabel} Fear & Greed Index | Flowvium`,
    description: isKo
      ? `${marketLabel} 시장의 공포·탐욕 지수 실시간 현황 및 구성 요소를 확인하세요.`
      : `Track the ${marketLabel} Fear & Greed Index in real time. See the current score, key driver, and 7-day trend.`,
  };
}

export default function FearGreedMarketPage({
  params,
}: {
  params: { locale: string; market: string };
}) {
  const marketLabel = MARKET_LABELS[params.market] ?? params.market;
  const isKo = params.locale === 'ko';

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">
        {marketLabel} {isKo ? '공포·탐욕 지수' : 'Fear & Greed Index'}
      </h1>
      <p className="text-gray-500 text-sm mb-8">
        {isKo
          ? '실시간 투자 심리 지표 — 0: 극단적 공포, 100: 극단적 탐욕'
          : 'Real-time investor sentiment — 0: Extreme Fear, 100: Extreme Greed'}
      </p>

      <FearGreedMarketClient market={params.market} locale={params.locale} />
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';

import { useEffect, useState } from 'react';

interface FearGreedEntry {
  id: string;
  label: string;
  flag?: string;
  score: number;
  trend: string;
  driver: string;
  prevScore?: number;
}

interface FearGreedData {
  byCountry?: FearGreedEntry[];
}

function getLevel(score: number) {
  if (score <= 24) return { label: 'Extreme Fear', labelKo: '극단적 공포', color: '#dc2626' };
  if (score <= 44) return { label: 'Fear', labelKo: '공포', color: '#ea580c' };
  if (score <= 55) return { label: 'Neutral', labelKo: '중립', color: '#ca8a04' };
  if (score <= 74) return { label: 'Greed', labelKo: '탐욕', color: '#16a34a' };
  return { label: 'Extreme Greed', labelKo: '극단적 탐욕', color: '#059669' };
}

export default function FearGreedMarketClient({
  market,
  locale,
}: {
  market: string;
  locale: string;
}) {
  const [data, setData] = useState<FearGreedEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations('fearGreedMarket');
  const isKo = locale === 'ko';

  useEffect(() => {
    fetch('/api/fear-greed', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json: FearGreedData) => {
        const entry = json.byCountry?.find((e) => e.id === market);
        if (entry) setData(entry);
        else setError('Market data not available');
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, [market]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-48">
        <div className="animate-pulse text-gray-500">{t('loading')}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-gray-500">
        {error ?? t('error')}
      </div>
    );
  }

  const level = getLevel(data.score);
  const rotation = (data.score / 100) * 180 - 90; // -90 to 90 degrees

  return (
    <div>
      {/* Score Gauge */}
      <div className="flex flex-col items-center py-8">
        <div className="relative w-48 h-24 overflow-hidden mb-4">
          <div className="absolute inset-0 rounded-t-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 opacity-20" />
          <div
            className="absolute bottom-0 left-1/2 w-1 h-20 rounded origin-bottom"
            style={{
              backgroundColor: level.color,
              transform: `translateX(-50%) rotate(${rotation}deg)`,
              transformOrigin: 'bottom center',
            }}
          />
          <div className="absolute bottom-0 left-1/2 w-3 h-3 rounded-full -translate-x-1/2 -translate-y-0.5 bg-gray-800" />
        </div>

        <div
          className="text-6xl font-bold mb-2"
          style={{ color: level.color }}
        >
          {data.score}
        </div>
        <div className="text-lg font-semibold" style={{ color: level.color }}>
          {isKo ? level.labelKo : level.label}
        </div>
        <div className="flex items-center gap-2 mt-2 text-gray-600">
          {data.flag && <span className="text-2xl">{data.flag}</span>}
          <span className="text-base">{data.label}</span>
        </div>
      </div>

      {/* Driver */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <h3 className="font-semibold mb-1">{t('keyDriver')}</h3>
        <p className="text-gray-700 text-sm leading-relaxed">{data.driver}</p>
      </div>

      {/* Trend */}
      {data.prevScore !== undefined && (
        <div className="flex items-center gap-4 p-4 border rounded-lg">
          <div className="flex-1">
            <div className="text-sm text-gray-500">{t('sevenDaysAgo')}</div>
            <div className="text-2xl font-bold">{data.prevScore}</div>
          </div>
          <div className="text-2xl">
            {data.trend === 'up' ? '↑' : data.trend === 'down' ? '↓' : '→'}
          </div>
          <div className="flex-1 text-right">
            <div className="text-sm text-gray-500">{t('current')}</div>
            <div className="text-2xl font-bold" style={{ color: level.color }}>
              {data.score}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

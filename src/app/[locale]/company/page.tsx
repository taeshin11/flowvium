import { generateSeoMetadata } from '@/lib/seo';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { allCompanies } from '@/data/companies';
import type { Metadata } from 'next';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 2026-05-31: /company/ index page 신설 (이전 404).
//   1,210 종목 풀에서 검색 / cap band 별 popular ticker 표시.

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'seo' });
  return generateSeoMetadata({
    title: t('exploreTitle'),
    description: t('exploreDescription'),
    path: '/company',
    locale: params.locale,
    keywords: ['stock', 'ticker', 'company', 'analysis'],
  });
}

function loadPool(): Array<{ ticker: string; name: string; sector: string; cap: string }> {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'data/candidate-tickers.json'), 'utf8');
    const data = JSON.parse(raw);
    const meta = data.meta ?? {};
    const list = (data.tickers as string[] ?? []).map(t => ({
      ticker: t,
      name: meta[t]?.name ?? t,
      sector: meta[t]?.sector ?? 'Unknown',
      cap: meta[t]?.cap ?? 'unknown',
    }));
    return list;
  } catch {
    return allCompanies.map(c => ({ ticker: c.ticker, name: c.name, sector: c.sector ?? 'Unknown', cap: 'curated' }));
  }
}

export default function CompanyIndexPage() {
  const pool = loadPool();
  const byCap: Record<string, typeof pool> = {};
  for (const c of pool) {
    const cap = c.cap === 'kr' ? 'KR (KOSPI/KOSDAQ)'
      : c.cap === 'titan' ? 'Titan ($1T+)'
      : c.cap === 'mega' ? 'Mega ($200B+)'
      : c.cap === 'large' ? 'Large ($10B+)'
      : c.cap === 'etf' ? 'ETF'
      : 'Other';
    (byCap[cap] = byCap[cap] ?? []).push(c);
  }
  const groupOrder = ['Titan ($1T+)', 'Mega ($200B+)', 'Large ($10B+)', 'KR (KOSPI/KOSDAQ)', 'ETF', 'Other'];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">기업 페이지</h1>
      <p className="text-sm text-gray-600 mb-6">
        총 <strong>{pool.length}</strong>개 종목 — ticker 클릭 시 재무/뉴스/추천/차트 페이지로 이동
      </p>
      {groupOrder.filter(g => byCap[g]?.length).map(group => (
        <section key={group} className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">{group} <span className="text-sm text-gray-500 font-normal">({byCap[group].length})</span></h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {byCap[group].slice(0, 60).map(c => (
              <Link key={c.ticker} href={`/company/${encodeURIComponent(c.ticker)}`} className="block rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 hover:border-indigo-300 transition">
                <div className="font-semibold text-gray-900 truncate">{c.ticker}</div>
                <div className="text-xs text-gray-500 truncate">{c.name}</div>
              </Link>
            ))}
          </div>
          {byCap[group].length > 60 && <p className="text-xs text-gray-400 mt-2">+{byCap[group].length - 60} 더 보기 (검색 사용)</p>}
        </section>
      ))}
    </main>
  );
}

import type { Account, Trade } from '@/lib/paper-trading';
import { getTranslations } from 'next-intl/server';
import { INITIAL_CASH } from '@/lib/paper-trading';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://flowvium.net';

async function fetchAccount(): Promise<Account | null> {
  try {
    const res = await fetch(BASE_URL + '/api/paper-trading?action=account', { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json() as Promise<Account>;
  } catch {
    return null;
  }
}

async function fetchTrades(limit = 20): Promise<Trade[]> {
  try {
    const res = await fetch(BASE_URL + '/api/paper-trading?action=trades&limit=' + limit, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json() as Promise<Trade[]>;
  } catch {
    return [];
  }
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtUSD(n: number) {
  return '$' + fmt(n);
}

function pnlClass(n: number) {
  if (n > 0) return 'text-green-500';
  if (n < 0) return 'text-red-500';
  return 'text-gray-400';
}

export default async function PaperTradingPage({ params }: { params: { locale: string } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'paperTrading' });
  const [account, trades] = await Promise.all([fetchAccount(), fetchTrades(20)]);

  const positionValue = account
    ? account.positions.reduce((s, p) => s + p.marketValue, 0)
    : 0;

  const cards: { label: string; value: string; pnlVal: number | null; sub: string | null }[] = [
    { label: t('totalAssets'), value: account ? fmtUSD(account.totalValue) : '—', pnlVal: null, sub: null },
    { label: t('cash'), value: account ? fmtUSD(account.cash) : '—', pnlVal: null, sub: account ? fmt((account.cash / account.totalValue) * 100, 1) + '%' : null },
    { label: t('positionValue'), value: account ? fmtUSD(positionValue) : '—', pnlVal: null, sub: account ? account.positions.length + ' ' + t('ticker') : null },
    { label: t('returnRate'), value: account ? (account.totalPnlPct >= 0 ? '+' : '') + fmt(account.totalPnlPct) + '%' : '—', pnlVal: account?.totalPnlPct ?? 0, sub: account ? (account.totalPnl >= 0 ? '+' : '') + fmtUSD(account.totalPnl) : null },
  ];

  return (
    <main className="min-h-screen bg-cf-bg text-cf-text-primary px-4 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-cf-text-secondary text-sm mt-1">{t('subtitle')} · {t('seed')} {fmtUSD(INITIAL_CASH)}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((card, i) => (
          <div key={i} className="bg-white dark:bg-white/[0.06] border border-cf-border rounded-xl p-4">
            <p className="text-xs text-cf-text-secondary mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.pnlVal !== null ? pnlClass(card.pnlVal) : ''}`}>{card.value}</p>
            {card.sub && <p className="text-xs text-cf-text-secondary mt-0.5">{card.sub}</p>}
          </div>
        ))}
      </div>

      {account && account.positions.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t('positions')}</h2>
          <div className="overflow-x-auto rounded-xl border border-cf-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.04] text-cf-text-secondary text-xs">
                  <th className="text-left px-4 py-3">{t('ticker')}</th>
                  <th className="text-right px-4 py-3">{t('quantity')}</th>
                  <th className="text-right px-4 py-3">{t('avgPrice')}</th>
                  <th className="text-right px-4 py-3">{t('currentPrice')}</th>
                  <th className="text-right px-4 py-3">{t('unrealizedPnl')}</th>
                  <th className="text-right px-4 py-3">{t('stopLoss')}</th>
                  <th className="text-right px-4 py-3">{t('target')}</th>
                  <th className="text-right px-4 py-3">{t('entryDate')}</th>
                </tr>
              </thead>
              <tbody>
                {account.positions.map((pos) => (
                  <tr key={pos.ticker} className="border-t border-cf-border hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3"><div className="font-semibold">{pos.ticker}</div><div className="text-xs text-cf-text-secondary truncate max-w-[120px]">{pos.name}</div></td>
                    <td className="px-4 py-3 text-right">{pos.shares}</td>
                    <td className="px-4 py-3 text-right">{fmtUSD(pos.avgCost)}</td>
                    <td className="px-4 py-3 text-right">{fmtUSD(pos.currentPrice)}</td>
                    <td className={`px-4 py-3 text-right ${pnlClass(pos.unrealizedPnl)}`}>
                      <div>{pos.unrealizedPnl >= 0 ? '+' : ''}{fmtUSD(pos.unrealizedPnl)}</div>
                      <div className="text-xs">{pos.unrealizedPct >= 0 ? '+' : ''}{fmt(pos.unrealizedPct)}%</div>
                    </td>
                    <td className="px-4 py-3 text-right text-cf-text-secondary">{pos.stopLoss ? fmtUSD(pos.stopLoss) : '—'}</td>
                    <td className="px-4 py-3 text-right text-cf-text-secondary">{pos.target ? fmtUSD(pos.target) : '—'}</td>
                    <td className="px-4 py-3 text-right text-xs text-cf-text-secondary">{pos.reportDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">{t('tradeHistory')}</h2>
        {trades.length === 0 ? (
          <div className="text-cf-text-secondary text-sm py-8 text-center border border-cf-border rounded-xl">
            {t('noTrades')}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-cf-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.04] text-cf-text-secondary text-xs">
                  <th className="text-left px-4 py-3">{t('date')}</th>
                  <th className="text-left px-4 py-3">{t('ticker')}</th>
                  <th className="text-left px-4 py-3">{t('type')}</th>
                  <th className="text-right px-4 py-3">{t('executionPrice')}</th>
                  <th className="text-right px-4 py-3">{t('quantity')}</th>
                  <th className="text-right px-4 py-3">{t('amount')}</th>
                  <th className="text-right px-4 py-3">{t('realizedPnl')}</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-t border-cf-border hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 text-xs text-cf-text-secondary whitespace-nowrap">{trade.timestamp.slice(0, 10)}</td>
                    <td className="px-4 py-3"><div className="font-semibold">{trade.ticker}</div><div className="text-xs text-cf-text-secondary truncate max-w-[100px]">{trade.name}</div></td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${trade.type === 'buy' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                        {trade.type === 'buy' ? t('buy') : t('sell')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{fmtUSD(trade.price)}</td>
                    <td className="px-4 py-3 text-right">{trade.shares}</td>
                    <td className="px-4 py-3 text-right">{fmtUSD(trade.amount)}</td>
                    <td className={`px-4 py-3 text-right ${trade.pnl !== null ? pnlClass(trade.pnl) : 'text-cf-text-secondary'}`}>
                      {trade.pnl !== null ? (trade.pnl >= 0 ? '+' : '') + fmtUSD(trade.pnl) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {account && (
        <p className="text-xs text-cf-text-secondary mt-6 text-right">
          {t('lastUpdated')}: {new Date(account.lastUpdated).toLocaleString('ko-KR')} · {t('processedReports')} {account.reportCount}{t('filingUnit')}
        </p>
      )}
    </main>
  );
}

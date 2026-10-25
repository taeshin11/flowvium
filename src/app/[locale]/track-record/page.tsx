/**
 * /[locale]/track-record — 지난 매수 추천 성적표 (2026-10-25 신설).
 *
 * 사장님 "이런 전향적 연구 안 하냐" → ChatGPT·agy·Claude 셋 다: 성적을 숨김없이, 시장을 나눠, 중앙값과 함께, 사지 못한 것·따라가는 중인 것은
 *   따로 세고, 고른 것만 보여 주지 말 것. 숫자는 scripts/scorecard.mjs 가 매일 data/scorecard.json 으로 만든다(규칙은 lib/judge-outcome·lib/scorecard 머리말).
 * 2026-05-30 보고서 맨 위 '트랙 레코드' 카드는 사장님 요청으로 뺐다 — 그래서 보고서 본문이 아니라 따로 둔 페이지다.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { generateSeoMetadata } from '@/lib/seo';

export const revalidate = 3600;

const NS = 'trackRecord';
const PATH = '/track-record';
const TZ = 'Asia/Seoul';
const LOCALE_TAG: Record<string, string> = { ko: 'ko-KR' };
const LOCALE_KO = 'ko';
const KEEP = 'break-keep';
const UP = 'text-emerald-700';
const DOWN = 'text-red-700';

type Recent = { date: string; ticker: string; name: string | null; result: string; pnlPct: number | null; vsIndex: number | null };
type Month = { month: string; n: number; profitShare: number | null; medianPct: number | null; vsIndexMedian: number | null };
type Market = {
  recommended: number; notEntered: number; tracking: number; finished: number;
  profitShare: number | null; medianPct: number | null; meanPct: number | null; vsIndexMedian: number | null;
  stopShare: number | null; targetShare: number | null; timeShare: number | null; worstPct: number | null; worst?: Pick;
  monthly: Month[]; recent: Recent[];
};
type Pick = { pct: number; ticker: string; name: string | null; date: string } | null;
type Scorecard = { generatedAt: string; horizonDays: number; markets: { us: Market; kr: Market }; gate?: { us?: { reduce: boolean; since?: string | null }; kr?: { reduce: boolean; since?: string | null } } };

function load(): Scorecard | null {
  try { return JSON.parse(readFileSync(join(process.cwd(), 'data/scorecard.json'), 'utf8')) as Scorecard; } catch { return null; }
}

const signed = (v: number | null, unit = '%') => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${unit}`);
const tone = (v: number | null) => (v == null || v === 0 ? 'text-cf-text-primary' : v > 0 ? UP : DOWN);
// 지수 대비는 색을 입히지 않는다 — 돈을 잃었는데 초록 '+10%p' 가 수익처럼 보인다(10/25 agy 눈검증)
const flat = 'text-cf-text-primary';
const nameOf = (ticker: string, name: string | null) => (name && name !== ticker ? name : ticker);

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: NS });
  return generateSeoMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: PATH, locale: params.locale });
}

export default async function TrackRecordPage({ params }: { params: { locale: string } }) {
  const t = await getTranslations({ locale: params.locale, namespace: NS });
  const sc = load();
  const time = sc ? new Date(sc.generatedAt).toLocaleString(LOCALE_TAG[params.locale] ?? params.locale, { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '';
  const pt = t('pointUnit');
  const resultLabel = (r: string) => (r === 'hit_target' ? t('resultTarget') : r === 'stop_loss' ? t('resultStop') : t('resultTime'));
  // 폰에서는 짧은 말(360px 눈검증 — 한국 표가 62px 넘쳤다)
  const resultShort = (r: string) => (r === 'hit_target' ? t('resultTargetShort') : r === 'stop_loss' ? t('resultStop') : t('resultTimeShort'));

  const MarketBlock = ({ m, s }: { m: 'us' | 'kr'; s: Market }) => (
    <section className="cf-card p-5 sm:p-6 mb-6" aria-labelledby={`h-${m}`}>
      <h2 id={`h-${m}`} className="text-lg font-bold text-cf-text-primary">{m === 'us' ? t('marketUs') : t('marketKr')}</h2>
      <p className="text-sm text-cf-text-secondary mt-1">
        {t('funnel', { finished: s.finished, recommended: s.recommended, notEntered: s.notEntered, tracking: s.tracking })}
      </p>
      {sc?.gate?.[m]?.reduce && (
        <p className="mt-3 text-sm rounded-lg bg-amber-50 text-amber-900 px-3 py-2">{t('reduced', { date: (sc.gate[m]?.since ?? sc.generatedAt.slice(0, 10)).slice(5).replace('-', '/') })}</p>
      )}
      {s.finished > 0 ? (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <dt className="text-xs text-cf-text-secondary">{t('profitShare')}</dt>
              <dd className="text-xl font-bold text-cf-text-primary tabular-nums">{s.profitShare ?? '–'}%</dd>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <dt className="text-xs text-cf-text-secondary">{t('median')}</dt>
              <dd className={`text-xl font-bold tabular-nums ${tone(s.medianPct)}`}>{signed(s.medianPct)}</dd>
              <dd className="text-xs text-cf-text-secondary tabular-nums">{t('mean')} {signed(s.meanPct)}</dd>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <dt className="text-xs text-cf-text-secondary">{m === 'us' ? t('vsIndexUs') : t('vsIndexKr')}</dt>
              <dd className={`text-xl font-bold tabular-nums ${flat}`}>{signed(s.vsIndexMedian, pt)}</dd>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <dt className="text-xs text-cf-text-secondary">{t('stopShare')}</dt>
              <dd className="text-xl font-bold text-cf-text-primary tabular-nums">{s.stopShare ?? '–'}%</dd>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <dt className="text-xs text-cf-text-secondary">{t('targetShare')}</dt>
              <dd className="text-xl font-bold text-cf-text-primary tabular-nums">{s.targetShare ?? '–'}%</dd>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <dt className="text-xs text-cf-text-secondary">{t('worst')}</dt>
              <dd className={`text-xl font-bold tabular-nums ${tone(s.worstPct)}`}>{signed(s.worstPct)}</dd>
              {s.worst && <dd className="text-xs text-cf-text-secondary line-clamp-2">{s.worst.date.slice(5).replace('-', '/')} · {nameOf(s.worst.ticker, s.worst.name)}</dd>}
            </div>
          </dl>

          <h3 className="text-sm font-bold text-cf-text-primary mt-6 mb-2">{t('monthlyTitle')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm tabular-nums">
              <thead><tr className="text-left text-xs text-cf-text-secondary border-b border-cf-border">
                <th className="py-1.5 pr-2 sm:pr-3 font-medium">{t('colMonth')}</th><th className="py-1.5 pr-2 sm:pr-3 font-medium text-right">{t('colCount')}</th>
                <th className="py-1.5 pr-2 sm:pr-3 font-medium text-right">{t('profitShare')}</th><th className="py-1.5 pr-2 sm:pr-3 font-medium text-right">{t('median')}</th>
                <th className="py-1.5 font-medium text-right sm:whitespace-nowrap">{m === 'us' ? t('vsIndexUs') : t('vsIndexKr')}</th>
              </tr></thead>
              <tbody>{s.monthly.map((x) => (
                <tr key={x.month} className="border-b border-cf-border/60">
                  <td className="py-1.5 pr-2 sm:pr-3 whitespace-nowrap">{x.month}</td><td className="py-1.5 pr-2 sm:pr-3 text-right">{x.n}</td>
                  <td className="py-1.5 pr-2 sm:pr-3 text-right">{x.profitShare ?? '–'}%</td>
                  <td className={`py-1.5 pr-2 sm:pr-3 text-right ${tone(x.medianPct)}`}>{signed(x.medianPct)}</td>
                  <td className={`py-1.5 text-right ${flat}`}>{signed(x.vsIndexMedian, pt)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>

          <h3 className="text-sm font-bold text-cf-text-primary mt-6 mb-2">{t('recentTitle', { n: s.recent.length })}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm tabular-nums">
              <thead><tr className="text-left text-xs text-cf-text-secondary border-b border-cf-border">
                <th className="py-1.5 pr-2 sm:pr-3 font-medium">{t('colDate')}</th><th className="py-1.5 pr-2 sm:pr-3 font-medium">{t('colStock')}</th>
                <th className="py-1.5 pr-2 sm:pr-3 font-medium">{t('colResult')}</th><th className="py-1.5 pr-2 sm:pr-3 font-medium text-right">{t('colReturn')}</th>
                <th className="py-1.5 font-medium text-right sm:whitespace-nowrap">{m === 'us' ? t('vsIndexUs') : t('vsIndexKr')}</th>
              </tr></thead>
              <tbody>{s.recent.map((x, i) => (
                <tr key={`${x.ticker}-${x.date}-${i}`} className="border-b border-cf-border/60">
                  <td className="py-1.5 pr-2 sm:pr-3 whitespace-nowrap">{x.date.slice(5)}</td>
                  {/* 미국 긴 회사명은 폰에서 표를 넘친다(390px 눈검증) — 폰에서는 티커, 넓은 화면에서는 이름. 한국은 이름(숫자 코드는 뜻이 없다) */}
                  <td className="py-1.5 pr-2 sm:pr-3">
                    {m === 'us' && x.name && x.name !== x.ticker
                      ? (<><span className="sm:hidden">{x.ticker}</span><span className="hidden sm:inline">{x.name}</span></>)
                      : <span className="block max-w-[5.5rem] sm:max-w-none truncate" title={nameOf(x.ticker, x.name)}>{nameOf(x.ticker, x.name)}</span>}
                  </td>
                  <td className="py-1.5 pr-2 sm:pr-3 whitespace-nowrap"><span className="sm:hidden">{resultShort(x.result)}</span><span className="hidden sm:inline">{resultLabel(x.result)}</span></td>
                  <td className={`py-1.5 pr-2 sm:pr-3 text-right ${tone(x.pnlPct)}`}>{signed(x.pnlPct)}</td>
                  <td className={`py-1.5 text-right ${flat}`}>{signed(x.vsIndex, pt)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="mt-4 text-sm text-cf-text-secondary">{t('noneYet')}</p>}
    </section>
  );

  return (
    <div className={`mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10 ${params.locale === LOCALE_KO ? KEEP : ''}`}>
      <h1 className="text-2xl sm:text-3xl font-bold text-cf-text-primary">{t('title')}</h1>
      <p className="text-cf-text-secondary mt-2">{t('lead')}</p>
      {sc ? (
        <>
          <p className="text-xs text-cf-text-secondary mt-1">{t('updated', { time })}</p>
          <p className="text-xs text-cf-text-secondary mt-1">{t('fixed')}</p>
          <div className="mt-6">
            <MarketBlock m="us" s={sc.markets.us} />
            <MarketBlock m="kr" s={sc.markets.kr} />
          </div>
          <section className="cf-card p-5 sm:p-6" aria-labelledby="h-how">
            <h2 id="h-how" className="text-base font-bold text-cf-text-primary mb-2">{t('howTitle')}</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm text-cf-text-secondary">
              <li>{t('how1', { days: sc.horizonDays })}</li><li>{t('how2')}</li><li>{t('howEntry')}</li><li>{t('how3')}</li>
              <li>{t('how4', { days: sc.horizonDays })}</li><li>{t('how5', { days: sc.horizonDays })}</li><li>{t('how6')}</li>
            </ul>
            <p className="text-xs text-cf-text-secondary mt-3">{t('note')}</p>
          </section>
        </>
      ) : <p className="mt-6 text-sm text-cf-text-secondary">{t('empty')}</p>}
    </div>
  );
}

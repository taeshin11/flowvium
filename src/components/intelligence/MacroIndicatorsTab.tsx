'use client';

import { useState, useEffect } from 'react';
import { Loader2, TrendingUp, Activity, GitMerge } from 'lucide-react';

// ── FedWatch ──────────────────────────────────────────────────────────────────
interface FomcMeeting {
  date: string; label: string;
  targetLow: number; targetHigh: number;
  probHike: number; probHold: number; probCut25: number; probCut50: number; probCut75: number;
  impliedRate: number; cumulativeCuts: number;
}
interface FedWatchData {
  currentTargetLow: number; currentTargetHigh: number; currentRateMid: number;
  meetings: FomcMeeting[];
  yearEndImpliedRate: number; totalImpliedCuts: number;
  updatedAt: string; source: string;
}

function FedWatchSection() {
  const [data, setData] = useState<FedWatchData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/fedwatch', { signal: controller.signal })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) return (
    <div className="cf-card p-4 flex items-center gap-2 text-cf-text-secondary">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-xs">FedWatch 로딩중...</span>
    </div>
  );
  if (!data) return null;

  const today = new Date();

  return (
    <div className="cf-card p-4">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🏛️</span>
            <h3 className="text-sm font-bold text-cf-text-primary">CME FedWatch — FOMC 금리 전망</h3>
          </div>
          <p className="text-xs text-cf-text-secondary">각 회의별 시장이 예상하는 금리 결정 확률</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-cf-text-secondary">현재 기준금리</span>
            <span className="text-base font-extrabold text-cf-text-primary tabular-nums">
              {data.currentTargetLow}–{data.currentTargetHigh}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-cf-text-secondary">연말 예상</span>
            <span className="text-sm font-bold text-blue-600 tabular-nums">{data.yearEndImpliedRate.toFixed(2)}%</span>
            <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-semibold">
              -{data.totalImpliedCuts}bp 인하
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {data.meetings.map((m) => {
          const isPast = new Date(m.date) < today;
          const isNext = !isPast && data.meetings.findIndex(x => new Date(x.date) >= today) === data.meetings.indexOf(m);
          const dominantCut = m.probCut25 + m.probCut50 + m.probCut75;

          return (
            <div key={m.date} className={`rounded-xl border p-3 ${isNext ? 'border-cf-primary/40 bg-cf-primary/5' : 'border-cf-border bg-white'} ${isPast ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <div className="flex items-center gap-2">
                  {isNext && <span className="text-[9px] font-bold bg-cf-primary text-white px-1.5 py-0.5 rounded-full">NEXT</span>}
                  <span className="text-xs font-bold text-cf-text-primary">{m.label}</span>
                  <span className="text-[10px] text-cf-text-secondary">{m.date}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-cf-text-secondary">예상금리</span>
                  <span className="text-xs font-bold tabular-nums text-cf-text-primary">{m.impliedRate.toFixed(2)}%</span>
                  {m.cumulativeCuts > 0 && (
                    <span className="text-[10px] text-blue-600 font-semibold">-{m.cumulativeCuts}bp</span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-16 flex-shrink-0">동결</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-400 rounded-full transition-all" style={{ width: `${m.probHold}%` }} />
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-10 text-right tabular-nums">{m.probHold.toFixed(1)}%</span>
                </div>
                {m.probCut25 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-blue-600 w-16 flex-shrink-0">-25bp</span>
                    <div className="flex-1 h-4 bg-blue-50 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${m.probCut25}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-blue-600 w-10 text-right tabular-nums">{m.probCut25.toFixed(1)}%</span>
                  </div>
                )}
                {m.probCut50 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-indigo-600 w-16 flex-shrink-0">-50bp</span>
                    <div className="flex-1 h-4 bg-indigo-50 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${m.probCut50}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-indigo-600 w-10 text-right tabular-nums">{m.probCut50.toFixed(1)}%</span>
                  </div>
                )}
                {m.probCut75 > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-purple-600 w-16 flex-shrink-0">-75bp+</span>
                    <div className="flex-1 h-4 bg-purple-50 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-400 rounded-full transition-all" style={{ width: `${m.probCut75}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-purple-600 w-10 text-right tabular-nums">{m.probCut75.toFixed(1)}%</span>
                  </div>
                )}
                {m.probHike > 0.5 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-red-600 w-16 flex-shrink-0">+25bp</span>
                    <div className="flex-1 h-4 bg-red-50 rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${m.probHike}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-red-600 w-10 text-right tabular-nums">{m.probHike.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  dominantCut > 60 ? 'bg-blue-100 text-blue-700' :
                  m.probHold > 60 ? 'bg-gray-100 text-gray-600' :
                  'bg-amber-50 text-amber-700'
                }`}>
                  {dominantCut > 60 ? `인하 우세 (${dominantCut.toFixed(0)}%)` :
                   m.probHold > 60 ? `동결 우세 (${m.probHold.toFixed(0)}%)` :
                   '혼재'}
                </span>
                {m.targetLow !== data.currentTargetLow && (
                  <span className="text-[10px] text-cf-text-secondary">
                    → {m.targetLow}–{m.targetHigh}% 예상
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-[10px] text-cf-text-secondary">
          💡 확률은 Fed Funds 선물 가격 기반 시장 컨센서스 (CME FedWatch 스타일)
        </p>
        <span className="text-[10px] text-gray-400">기준: {data.updatedAt}</span>
      </div>
    </div>
  );
}

// ── Macro Indicators Tab ──────────────────────────────────────────────────────
interface CascadeStep { asset: string; direction: 'up' | 'down' | 'mixed'; reason: string; magnitude: 'strong' | 'moderate' | 'weak'; }
interface MacroIndicator {
  id: string; name: string; nameKo: string; category: string;
  actual: number | null; forecast: number | null; previous: number | null; unit: string;
  releaseDate: string; nextRelease?: string;
  liveData?: boolean;
  surprise: 'beat' | 'miss' | 'inline' | 'pending';
  rateImpact: 'hawkish' | 'dovish' | 'neutral';
  rateImpactKo: string; cascade: CascadeStep[]; summary: string;
}

const SURPRISE_BADGE: Record<string, { label: string; cls: string }> = {
  beat:    { label: '예상 상회 ▲', cls: 'bg-red-50 text-red-700 border border-red-200' },
  miss:    { label: '예상 하회 ▼', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  inline:  { label: '예상 부합 →', cls: 'bg-gray-50 text-gray-600 border border-gray-200' },
  pending: { label: '발표 대기', cls: 'bg-amber-50 text-amber-600 border border-amber-200' },
};
const RATE_BADGE: Record<string, { label: string; cls: string }> = {
  hawkish: { label: '🦅 매파 (긴축)', cls: 'bg-red-100 text-red-700' },
  dovish:  { label: '🕊️ 비둘기파 (완화)', cls: 'bg-blue-100 text-blue-700' },
  neutral: { label: '⚖️ 중립', cls: 'bg-gray-100 text-gray-600' },
};
const CASCADE_ICONS: Record<string, string> = { up: '▲', down: '▼', mixed: '↕' };
const MAG_OPACITY: Record<string, string> = { strong: 'opacity-100', moderate: 'opacity-70', weak: 'opacity-40' };
const CAT_LABELS: Record<string, string> = { inflation: '물가', employment: '고용', growth: '경기', monetary: '통화정책', trade: '무역' };
const CAT_COLORS: Record<string, string> = { inflation: 'bg-orange-50 text-orange-700', employment: 'bg-green-50 text-green-700', growth: 'bg-blue-50 text-blue-700', monetary: 'bg-purple-50 text-purple-700', trade: 'bg-teal-50 text-teal-700' };

interface YieldPoint { label: string; value: number | null; }
interface YieldCurve { points: YieldPoint[]; inverted: boolean; spread10y2y: number | null; }

const LAYMAN: Record<string, { what: string; why: string; good: string; bad: string }> = {
  cpi:    { what: '마트·식당 등 우리가 매일 사는 물건들의 가격이 1년 전보다 얼마나 올랐는지 보여줍니다.', why: 'Fed(미국 중앙은행)가 금리를 올릴지 내릴지 결정하는 핵심 지표예요.', good: '예상보다 낮으면 → 물가가 안정 → 금리 인하 기대 → 주식 상승 가능성', bad: '예상보다 높으면 → 물가 과열 → 금리 인상 → 주식·채권 동반 하락 위험' },
  pce:    { what: 'CPI와 비슷하지만 Fed가 더 중요하게 보는 물가 지표예요. 사람들이 실제로 얼마나 쓰고 있는지 더 정확히 잡아냅니다.', why: 'Fed 의장이 공개적으로 "가장 선호하는 인플레 지표"라고 언급했어요.', good: '예상보다 낮으면 → 금리 인하 시기 앞당겨질 수 있음', bad: '예상보다 높으면 → 금리 인하 늦어짐 → 성장주 불리' },
  nfp:    { what: '지난 한 달 동안 미국에서 일자리가 몇 개 생겼는지 세는 지표예요. (농업 제외)', why: '일자리 = 경기의 온도계. 많이 늘면 경기 좋다는 신호. Fed도 이 숫자 보고 금리 결정해요.', good: '예상보다 낮으면 → 경기 둔화 → Fed 인하 압박 → 채권 상승', bad: '예상보다 높으면 → 경기 과열 → Fed 인하 어려워짐 → 성장주 단기 압박' },
  fomc:   { what: 'Fed(미국 중앙은행)가 기준금리를 올릴지·내릴지·유지할지 결정하는 회의예요. 1년에 8번 열려요.', why: '전 세계 모든 자산 가격에 직접 영향을 미치는 가장 중요한 이벤트예요.', good: '예상보다 비둘기(인하/동결) → 주식·암호화폐·금 일제히 상승', bad: '예상보다 매파(인상/강경) → 주식 급락, 달러 급등, EM 자금 이탈' },
  gdp:    { what: '미국 경제 전체가 한 분기에 얼마나 성장했는지 보여주는 숫자예요. 연율로 환산해서 발표돼요.', why: '경제의 건강상태 성적표. 2% 이상이면 건강, 마이너스 두 분기 연속이면 공식 침체예요.', good: '예상보다 높으면 → 기업 실적 기대↑ → 주식 긍정', bad: '예상보다 낮으면 → 침체 우려 → 안전자산(금·채권) 매수' },
  ism:    { what: '제조업체 구매 담당자들에게 "지금 경기 좋아요?"라고 물어본 설문 지표예요. 50 이상이면 성장, 이하면 수축이에요.', why: '실제 경기보다 약 2~3개월 앞서 움직이는 선행 지표로 유명해요.', good: '50 이상 + 예상 상회 → 제조업 회복 → 산업주·원자재 상승', bad: '50 이하 + 예상 하회 → 제조업 침체 → 경기민감주 하락' },
  retail: { what: '미국 소비자들이 지난 한 달 동안 쇼핑에 얼마나 썼는지 집계한 지표예요. 미국 GDP의 70%가 소비예요.', why: '소비가 줄면 기업 매출 → 실적 → 주가에 직접 영향을 미쳐요.', good: '예상보다 높으면 → 소비 강세 → 리테일·소비재 주식 상승', bad: '예상보다 낮으면 → 소비 둔화 → 경기침체 우려' },
  ppi:    { what: '기업이 물건을 만들 때 드는 원재료·부품 비용이 얼마나 올랐는지 보여줘요. CPI보다 1~2개월 앞서서 나와요.', why: 'PPI가 오르면 → 기업이 가격 올림 → 나중에 CPI도 오를 수 있어요. CPI 예측 지표로 활용해요.', good: '예상보다 낮으면 → 원가 부담 완화 → 기업 마진 개선 기대', bad: '예상보다 높으면 → 향후 CPI 상승 예고 → 긴축 우려' },
  unrate: { what: '일하고 싶은데 일자리를 못 찾은 사람이 전체 노동자의 몇 %인지 보여줘요.', why: 'Fed의 두 가지 임무 중 하나가 "완전 고용"이에요. 실업률이 너무 낮으면 임금 인플레 우려.', good: '높아지면 → 경기 둔화 → Fed 인하 압박', bad: '너무 낮으면 → 임금 상승 → 인플레 → 금리 인상 위험' },
};

function LaymanBox({ id }: { id: string }) {
  const info = LAYMAN[id];
  if (!info) return null;
  return (
    <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">💡</span>
        <div>
          <p className="text-xs font-bold text-blue-800 mb-0.5">이 지표가 뭔가요?</p>
          <p className="text-xs text-blue-700 leading-relaxed">{info.what}</p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">🎯</span>
        <div>
          <p className="text-xs font-bold text-blue-800 mb-0.5">왜 중요한가요?</p>
          <p className="text-xs text-blue-700 leading-relaxed">{info.why}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
        <div className="flex items-start gap-1.5 text-xs bg-green-50 border border-green-100 rounded-lg p-2">
          <span>✅</span>
          <span className="text-green-700 leading-relaxed">{info.good}</span>
        </div>
        <div className="flex items-start gap-1.5 text-xs bg-red-50 border border-red-100 rounded-lg p-2">
          <span>⚠️</span>
          <span className="text-red-700 leading-relaxed">{info.bad}</span>
        </div>
      </div>
    </div>
  );
}

export default function MacroIndicatorsTab() {
  const [indicators, setIndicators] = useState<MacroIndicator[]>([]);
  const [yieldCurve, setYieldCurve] = useState<YieldCurve | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLayman, setShowLayman] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/macro-indicators', { signal: controller.signal })
      .then(r => r.json())
      .then(d => { setIndicators(d.indicators ?? []); setYieldCurve(d.yieldCurve ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">경제지표 로딩중...</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="cf-card p-4 bg-gradient-to-r from-slate-50 to-blue-50 border-blue-100">
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">📊</div>
          <div>
            <h3 className="text-sm font-bold text-cf-text-primary mb-1">금리·시장을 움직이는 핵심 경제지표</h3>
            <p className="text-xs text-cf-text-secondary leading-relaxed">
              각 지표 발표가 주식·채권·달러·금에 어떤 연쇄 영향(cascade)을 미치는지 보여줍니다.
              <span className="font-semibold text-cf-primary ml-1">💡 버튼을 누르면 쉬운 설명을 볼 수 있어요.</span>
            </p>
          </div>
        </div>
      </div>

      {/* Yield Curve */}
      {yieldCurve && (
        <div className={`cf-card p-4 ${yieldCurve.inverted ? 'border-red-300 bg-red-50/30' : ''}`}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold text-cf-text-primary flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cf-primary" />
              미 국채 수익률 곡선 (Yield Curve)
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              {yieldCurve.spread10y2y !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${yieldCurve.inverted ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                  10Y-2Y: {yieldCurve.spread10y2y > 0 ? '+' : ''}{yieldCurve.spread10y2y}%p
                </span>
              )}
              {yieldCurve.inverted && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                  ⚠️ 역전 — 침체 선행지표
                </span>
              )}
            </div>
          </div>
          <div className="flex items-end gap-2 h-24">
            {yieldCurve.points.map((pt) => {
              const val = pt.value ?? 0;
              const maxVal = Math.max(...yieldCurve.points.map(p => p.value ?? 0), 1);
              const heightPct = (val / maxVal) * 100;
              return (
                <div key={pt.label} className="flex flex-col items-center flex-1 gap-1">
                  <span className="text-[10px] font-bold text-cf-text-primary tabular-nums">{val.toFixed(2)}%</span>
                  <div
                    className={`w-full rounded-t ${yieldCurve.inverted ? 'bg-red-400' : 'bg-blue-400'} transition-all`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className="text-[10px] text-cf-text-secondary">{pt.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FedWatch */}
      <FedWatchSection />

      {/* Indicators */}
      <div className="flex items-center gap-2 px-1">
        <Activity className="w-4 h-4 text-cf-primary" />
        <h3 className="text-sm font-bold text-cf-text-primary">주요 경제지표 발표 결과 & Cascade 분석</h3>
        <span className="text-xs text-cf-text-secondary">클릭 → cascade · 💡 클릭 → 쉬운 설명</span>
      </div>

      <div className="space-y-3">
        {indicators.map((ind) => {
          const sb = SURPRISE_BADGE[ind.surprise];
          const rb = RATE_BADGE[ind.rateImpact];
          const isOpen = expanded === ind.id;
          const isLayman = showLayman === ind.id;
          return (
            <div key={ind.id} className="cf-card overflow-hidden">
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CAT_COLORS[ind.category] ?? 'bg-gray-50 text-gray-600'}`}>
                        {CAT_LABELS[ind.category] ?? ind.category}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sb.cls}`}>{sb.label}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rb.cls}`}>{rb.label}</span>
                      {ind.liveData && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 flex items-center gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-cf-text-primary text-sm">{ind.nameKo}</div>
                    <div className="text-xs text-cf-text-secondary">{ind.name}</div>
                  </div>
                  <div className="flex items-end gap-3 flex-shrink-0 text-right">
                    {ind.actual !== null && (
                      <div>
                        <div className={`text-xl font-extrabold tabular-nums leading-tight ${ind.surprise === 'beat' ? 'text-red-600' : ind.surprise === 'miss' ? 'text-blue-600' : 'text-cf-text-primary'}`}>
                          {ind.actual.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-gray-400">{ind.unit} 실제</div>
                      </div>
                    )}
                    {ind.forecast !== null && (
                      <div>
                        <div className="text-sm font-bold text-gray-400 tabular-nums">{ind.forecast.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-400">예상</div>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-xs text-cf-text-secondary mt-2 leading-relaxed">{ind.summary}</p>

                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => setExpanded(isOpen ? null : ind.id)}
                    className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                      isOpen ? 'bg-cf-primary/10 border-cf-primary/30 text-cf-primary' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <GitMerge className="w-3 h-3" />
                    Cascade 영향 {isOpen ? '접기' : '보기'}
                  </button>
                  {LAYMAN[ind.id] && (
                    <button
                      onClick={() => setShowLayman(isLayman ? null : ind.id)}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                        isLayman ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100'
                      }`}
                    >
                      💡 쉬운 설명 {isLayman ? '접기' : '보기'}
                    </button>
                  )}
                  <div className="ml-auto flex flex-col items-end gap-0.5">
                    {ind.releaseDate && (
                      <span className="text-[10px] font-semibold text-cf-text-secondary">
                        📅 발표일: <span className="text-cf-text-primary">{ind.releaseDate}</span>
                      </span>
                    )}
                    {ind.nextRelease && (
                      <span className="text-[10px] text-gray-400">다음 발표: {ind.nextRelease}</span>
                    )}
                  </div>
                </div>

                {isLayman && <LaymanBox id={ind.id} />}
              </div>

              {isOpen && ind.cascade.length > 0 && (
                <div className="border-t border-cf-border bg-gray-50/50 px-4 py-3">
                  <div className="text-xs font-bold text-cf-text-secondary mb-2 flex items-center gap-1.5">
                    <GitMerge className="w-3 h-3" />
                    이 발표가 시장에 미치는 연쇄 영향
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {ind.cascade.map((step, i) => (
                      <div key={i} className={`flex items-center gap-2 text-xs p-2.5 rounded-xl bg-white border ${MAG_OPACITY[step.magnitude]} ${
                        step.direction === 'up' ? 'border-green-100' : step.direction === 'down' ? 'border-red-100' : 'border-gray-100'
                      }`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                          step.direction === 'up' ? 'bg-green-50 text-green-600' : step.direction === 'down' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'
                        }`}>
                          {CASCADE_ICONS[step.direction]}
                        </div>
                        <div>
                          <div className="font-bold text-cf-text-primary leading-tight">{step.asset}</div>
                          <div className="text-cf-text-secondary leading-tight mt-0.5">{step.reason}</div>
                        </div>
                        <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                          step.magnitude === 'strong' ? 'bg-red-50 text-red-500' : step.magnitude === 'moderate' ? 'bg-amber-50 text-amber-500' : 'bg-gray-50 text-gray-400'
                        }`}>
                          {step.magnitude === 'strong' ? '강' : step.magnitude === 'moderate' ? '중' : '약'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {isOpen && ind.cascade.length === 0 && (
                <div className="border-t border-cf-border bg-gray-50/50 px-4 py-3">
                  <p className="text-xs text-cf-text-secondary">
                    예상에 부합한 결과 — 시장이 이미 예상했던 내용이라 큰 변동이 없어요.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

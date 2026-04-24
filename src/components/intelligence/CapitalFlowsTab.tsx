'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import {
  Loader2, BarChart3, ArrowUpRight, ArrowDownRight, Globe,
  ArrowRight, GitMerge, Zap, RefreshCw,
} from 'lucide-react';

// ── Cascade rules ─────────────────────────────────────────────────────────────
const CASCADE_RULES: Record<string, { up: string[]; down: string[] }> = {
  '미국':   { up: ['기술주(QQQ)', 'S&P500(SPY)', '달러(UUP)'], down: ['EM주식', '채권(TLT)'] },
  '한국':   { up: ['반도체(SOXX)', 'HBM·AI메모리', 'KOSPI'], down: ['엔화(FXY)'] },
  '중국':   { up: ['원자재(DJP)', '구리', '철광석', 'EM ETF'], down: ['달러(UUP)', '미국 제조주'] },
  '인도':   { up: ['IT서비스주', 'EM채권', '인프라·시멘트'], down: [] },
  '대만':   { up: ['반도체(SOXX)', 'TSMC 공급망', 'AI가속기'], down: [] },
  '유럽':   { up: ['방산(ITA)', '유로화', '명품·소비주'], down: ['에너지주(XLE)'] },
  '일본':   { up: ['자동차·수출주', '닛케이'], down: ['엔화 캐리청산 리스크'] },
  '브라질': { up: ['철광석', '대두·농산물(DBA)', '원유'], down: [] },
  '금':     { up: ['은(SLV)', '귀금속 채굴주', '인플레 헤지'], down: ['달러(UUP)', '단기채(SHY)'] },
  '미 장기채': { up: ['부동산(VNQ)', '배당주', '유틸리티'], down: ['달러', '은행주(XLF)'] },
  '비트코인': { up: ['암호화폐 관련주', '위험선호', '기술주'], down: ['금', '채권'] },
  '원유':   { up: ['에너지주(XLE)', '산유국 통화', '인플레'], down: ['항공·해운주', '소비재'] },
  '미국 테크': { up: ['AI 인프라', 'Mag7', '데이터센터REIT'], down: ['전통금융', '에너지'] },
  '달러':   { up: ['단기채(SHY)', '미국채'], down: ['금', 'EM주식', '원자재'] },
  '에너지': { up: ['원유', '가스', '배당주'], down: ['항공·물류', '소비재'] },
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface AssetReturn { id: string; label: string; flag: string; group: string; ticker: string; ret1w: number; ret4w: number; ret13w: number; }
interface CountryReturn { id: string; label: string; flag: string; ticker: string; ret1w: number; ret4w: number; ret13w: number; }
interface FactorReturn { id: string; label: string; flag: string; ticker: string; desc: string; ret1w: number; ret4w: number; ret13w: number; }
interface SectorReturn { id: string; label: string; flag: string; ticker: string; ret1w: number; ret4w: number; ret13w: number; }
type RotEntry = { from:string; to:string; magnitude:number; weeksAgo?:number; startDate?:string; momentum?:string };
type CountryRotEntry = { from:string; fromFlag:string; to:string; toFlag:string; magnitude:number; momentum:'accelerating'|'holding'|'fading' };
interface CurvePoint { ticker: string; label: string; price: number; }
interface CommodityCurveData { id: 'oil'|'gold'; name: string; unit: string; curve: CurvePoint[]; structure: 'contango'|'backwardation'|'flat'; slope: number; updatedAt: string; }
interface FlowData {
  assets: AssetReturn[];
  flow: {
    topInflows: AssetReturn[]; topOutflows: AssetReturn[];
    groupAvg: {group:string;avg4w:number}[];
    rotations1w: RotEntry[]; rotations4w: RotEntry[]; rotations13w: RotEntry[];
  };
  goldVsDollar: {
    goldRet1w:number; dollarRet1w:number; signal1w:string;
    goldRet4w:number; dollarRet4w:number; signal4w:string;
    goldRet13w:number; dollarRet13w:number; signal13w:string;
  };
  countryFlow: {
    countries: CountryReturn[];
    rotations1w: CountryRotEntry[]; rotations4w: CountryRotEntry[]; rotations13w: CountryRotEntry[];
  };
  factorPerformance?: FactorReturn[];
  sectorPerformance?: SectorReturn[];
  dataSource?: string;
  updatedAt: string;
}

const GROUP_LABELS: Record<string, string> = { equity: '주식', bonds: '채권', alts: '대안자산', commodities: '원자재', currency: '통화' };
const GROUP_COLORS: Record<string, string> = { equity: 'bg-blue-500', bonds: 'bg-amber-500', alts: 'bg-yellow-400', commodities: 'bg-orange-500', currency: 'bg-purple-500' };
const GROUP_LIGHT: Record<string, string> = { equity: 'bg-blue-50 text-blue-700 border-blue-200', bonds: 'bg-amber-50 text-amber-700 border-amber-200', alts: 'bg-yellow-50 text-yellow-700 border-yellow-200', commodities: 'bg-orange-50 text-orange-700 border-orange-200', currency: 'bg-purple-50 text-purple-700 border-purple-200' };

function ReturnBar({ val, max }: { val: number; max: number }) {
  const pct = Math.min(Math.abs(val) / max * 100, 100);
  const positive = val >= 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden flex-shrink-0">
        <div
          className={`h-2 rounded-full ${positive ? 'bg-green-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%`, marginLeft: positive ? 0 : 'auto' }}
        />
      </div>
      <span className={`text-xs font-bold tabular-nums ${positive ? 'text-green-600' : 'text-red-500'}`}>
        {val > 0 ? '+' : ''}{val.toFixed(1)}%
      </span>
    </div>
  );
}

type Timeframe = '1w' | '4w' | '13w';
const TF_LABELS: Record<Timeframe, string> = { '1w': '1주', '4w': '4주', '13w': '3개월' };
const TF_RET_KEY: Record<Timeframe, 'ret1w' | 'ret4w' | 'ret13w'> = { '1w': 'ret1w', '4w': 'ret4w', '13w': 'ret13w' };

// ── Flow Intensity Panel ──────────────────────────────────────────────────────
function FlowIntensityPanel({ data }: { data: FlowData }) {
  const [activeView, setActiveView] = useState<'compare' | 'cascade'>('compare');

  const allItems = [
    ...data.assets.map(a => ({ id: a.id, label: a.label, flag: a.flag, type: 'asset' as const, ret1w: a.ret1w, ret4w: a.ret4w, ret13w: a.ret13w })),
    ...data.countryFlow.countries.map(c => ({ id: c.id, label: c.label, flag: c.flag, type: 'country' as const, ret1w: c.ret1w, ret4w: c.ret4w, ret13w: c.ret13w })),
  ];

  const top4 = (key: 'ret1w' | 'ret4w' | 'ret13w', dir: 'up' | 'down') =>
    [...allItems].sort((a, b) => dir === 'up' ? b[key] - a[key] : a[key] - b[key]).slice(0, 4);

  const divergent = allItems.filter(a => Math.sign(a.ret1w) !== Math.sign(a.ret13w) && Math.abs(a.ret1w) > 1.5 && Math.abs(a.ret13w) > 1.5);

  const topInflowItems = [...allItems].sort((a, b) => b.ret4w - a.ret4w).slice(0, 5);
  const cascadeChains = topInflowItems
    .filter(item => CASCADE_RULES[item.label])
    .map(item => {
      const rule = CASCADE_RULES[item.label]!;
      return { item, up: rule.up, down: rule.down };
    });

  const TF_COLS: Array<{ key: 'ret1w' | 'ret4w' | 'ret13w'; label: string; color: string }> = [
    { key: 'ret1w',  label: '1주',  color: 'bg-blue-400' },
    { key: 'ret4w',  label: '4주',  color: 'bg-cf-primary' },
    { key: 'ret13w', label: '13주', color: 'bg-purple-500' },
  ];

  return (
    <div className="cf-card overflow-hidden">
      <div className="p-4 border-b border-cf-border">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cf-primary" />
            <span className="text-sm font-bold text-cf-text-primary">수급 강도 & Cascade 영향</span>
          </div>
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
            <button onClick={() => setActiveView('compare')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${activeView === 'compare' ? 'bg-white text-cf-primary shadow-sm' : 'text-cf-text-secondary'}`}>
              1w·4w·13w 비교
            </button>
            <button onClick={() => setActiveView('cascade')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${activeView === 'cascade' ? 'bg-white text-cf-primary shadow-sm' : 'text-cf-text-secondary'}`}>
              Cascade 연쇄
            </button>
          </div>
        </div>
      </div>

      {activeView === 'compare' && (
        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs font-bold text-green-700 mb-2 flex items-center gap-1.5">
              <ArrowUpRight className="w-3.5 h-3.5" /> 수급 유입 상위 (기간별)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-cf-text-secondary">
                    <th className="text-left pb-1.5 font-medium">자산/국가</th>
                    {TF_COLS.map(c => <th key={c.key} className="text-right pb-1.5 font-medium w-14">{c.label}</th>)}
                    <th className="text-right pb-1.5 font-medium w-16">방향성</th>
                  </tr>
                </thead>
                <tbody>
                  {top4('ret4w', 'up').map(item => {
                    const trend = item.ret1w > item.ret4w ? '가속▲' : item.ret1w < 0 ? '반전⚡' : '유지→';
                    const trendColor = item.ret1w > item.ret4w ? 'text-green-600' : item.ret1w < 0 ? 'text-amber-600' : 'text-gray-400';
                    return (
                      <tr key={item.id} className="border-t border-cf-border/40">
                        <td className="py-1.5 flex items-center gap-1.5">
                          <span>{item.flag}</span>
                          <span className="font-medium text-cf-text-primary">{item.label}</span>
                        </td>
                        {TF_COLS.map(c => (
                          <td key={c.key} className={`text-right py-1.5 font-bold tabular-nums ${item[c.key] >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {item[c.key] > 0 ? '+' : ''}{item[c.key].toFixed(1)}%
                          </td>
                        ))}
                        <td className={`text-right py-1.5 text-[10px] font-bold ${trendColor}`}>{trend}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-red-600 mb-2 flex items-center gap-1.5">
              <ArrowDownRight className="w-3.5 h-3.5" /> 수급 유출 상위 (기간별)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-cf-text-secondary">
                    <th className="text-left pb-1.5 font-medium">자산/국가</th>
                    {TF_COLS.map(c => <th key={c.key} className="text-right pb-1.5 font-medium w-14">{c.label}</th>)}
                    <th className="text-right pb-1.5 font-medium w-16">방향성</th>
                  </tr>
                </thead>
                <tbody>
                  {top4('ret4w', 'down').map(item => {
                    const trend = item.ret1w < item.ret4w ? '가속▼' : item.ret1w > 0 ? '반전⚡' : '유지→';
                    const trendColor = item.ret1w < item.ret4w ? 'text-red-600' : item.ret1w > 0 ? 'text-amber-600' : 'text-gray-400';
                    return (
                      <tr key={item.id} className="border-t border-cf-border/40">
                        <td className="py-1.5 flex items-center gap-1.5">
                          <span>{item.flag}</span>
                          <span className="font-medium text-cf-text-primary">{item.label}</span>
                        </td>
                        {TF_COLS.map(c => (
                          <td key={c.key} className={`text-right py-1.5 font-bold tabular-nums ${item[c.key] >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {item[c.key] > 0 ? '+' : ''}{item[c.key].toFixed(1)}%
                          </td>
                        ))}
                        <td className={`text-right py-1.5 text-[10px] font-bold ${trendColor}`}>{trend}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {divergent.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <p className="text-[10px] font-bold text-amber-700 mb-2 flex items-center gap-1">
                ⚡ 추세 전환 감지 — 1주 vs 13주 방향 불일치
              </p>
              <div className="flex flex-wrap gap-1.5">
                {divergent.slice(0, 6).map(item => (
                  <div key={item.id} className="flex items-center gap-1.5 bg-white border border-amber-200 rounded-lg px-2 py-1">
                    <span className="text-sm leading-none">{item.flag}</span>
                    <span className="text-[10px] font-bold text-cf-text-primary">{item.label}</span>
                    <span className={`text-[10px] font-bold ${item.ret1w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      1w {item.ret1w > 0 ? '+' : ''}{item.ret1w.toFixed(1)}%
                    </span>
                    <span className="text-gray-300">vs</span>
                    <span className={`text-[10px] font-bold ${item.ret13w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      13w {item.ret13w > 0 ? '+' : ''}{item.ret13w.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeView === 'cascade' && (
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-cf-text-secondary">4주 기준 상위 유입 자산/국가의 연쇄 영향</p>
          {cascadeChains.length > 0 ? cascadeChains.map(({ item, up, down }) => (
            <div key={item.id} className="rounded-xl border border-cf-border overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border-b border-green-100">
                <span className="text-base leading-none">{item.flag}</span>
                <span className="text-xs font-bold text-green-700">{item.label}</span>
                <span className="text-xs font-bold text-green-600 ml-auto tabular-nums">
                  4w {item.ret4w > 0 ? '+' : ''}{item.ret4w.toFixed(1)}%
                </span>
                <span className={`text-[10px] tabular-nums ${item.ret1w >= 0 ? 'text-green-500' : 'text-orange-500'}`}>
                  1w {item.ret1w > 0 ? '+' : ''}{item.ret1w.toFixed(1)}%
                </span>
              </div>
              <div className="px-3 py-2 flex gap-4">
                {up.length > 0 && (
                  <div className="flex-1">
                    <p className="text-[9px] font-bold text-green-600 uppercase tracking-wide mb-1">수혜 ↑</p>
                    <div className="space-y-0.5">
                      {up.map(u => (
                        <div key={u} className="text-[11px] text-green-700 bg-green-50 rounded px-1.5 py-0.5">{u}</div>
                      ))}
                    </div>
                  </div>
                )}
                {down.length > 0 && (
                  <div className="flex-1">
                    <p className="text-[9px] font-bold text-red-500 uppercase tracking-wide mb-1">피해 ↓</p>
                    <div className="space-y-0.5">
                      {down.map(d => (
                        <div key={d} className="text-[11px] text-red-600 bg-red-50 rounded px-1.5 py-0.5">{d}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )) : (
            <p className="text-xs text-cf-text-secondary text-center py-4">Cascade 데이터 없음</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Flow Analysis Panel ───────────────────────────────────────────────────────
interface FlowCause {
  country: string; ret: string; direction: string;
  causes: string[]; risk: string;
}
interface RotationCause { from: string; to: string; reason: string; }
interface FlowAnalysis {
  summary: string; mainTheme: string;
  countries: FlowCause[]; rotations: RotationCause[];
  keyWatchpoints: string[];
}

function FlowAnalysisPanel({ tf }: { tf: Timeframe }) {
  const t = useTranslations('intelligence');
  const [analysis, setAnalysis] = useState<FlowAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [genTime, setGenTime] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(false);
    fetch(`/api/flow-analysis?tf=${tf}`)
      .then(r => r.json())
      .then(d => {
        setAnalysis(d.analysis ?? null);
        setGenTime(d.generatedAt ?? null);
        setLoaded(true);
        if (!d.analysis) setError(true);
      })
      .catch(() => { setError(true); setLoaded(true); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { setLoaded(false); setAnalysis(null); setError(false); }, [tf]);

  if (!loaded && !loading) {
    return (
      <div className="cf-card p-4 border-dashed border-cf-primary/30 bg-cf-primary/3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-cf-primary/10 flex items-center justify-center text-base flex-shrink-0">🤖</div>
            <div>
              <p className="text-sm font-bold text-cf-text-primary">AI 자금흐름 원인 분석</p>
              <p className="text-xs text-cf-text-secondary">EXAONE이 각 국가의 자금흐름 원인과 로테이션 이유를 분석합니다</p>
            </div>
          </div>
          <button
            onClick={load}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-cf-primary text-white rounded-xl text-xs font-bold hover:bg-cf-primary/90 transition-colors shadow-sm"
          >
            <Zap className="w-3.5 h-3.5" />
            원인 분석 시작
          </button>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="cf-card p-6 flex items-center justify-center gap-3 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin text-cf-primary" />
      <div>
        <p className="text-sm font-medium">EXAONE이 자금흐름 원인 분석 중...</p>
        <p className="text-xs text-cf-text-secondary/70 mt-0.5">국가별 ETF 수익률과 글로벌 이벤트 데이터를 분석하고 있어요</p>
      </div>
    </div>
  );

  if (error || !analysis) return (
    <div className="cf-card p-4 text-center">
      <p className="text-xs text-cf-text-secondary mb-2">분석을 불러오지 못했습니다. AI 서버 연결을 확인해주세요.</p>
      <button onClick={load} className="text-xs text-cf-primary hover:underline">다시 시도</button>
    </div>
  );

  return (
    <div className="cf-card overflow-hidden">
      <div className="p-4 pb-3 border-b border-cf-border bg-gradient-to-r from-cf-primary/5 to-transparent">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-cf-primary/10 flex items-center justify-center text-sm flex-shrink-0">🤖</div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-cf-text-primary">AI 자금흐름 원인 분석</span>
                <span className="text-[10px] bg-cf-primary/10 text-cf-primary px-2 py-0.5 rounded-full font-semibold">EXAONE</span>
              </div>
              {genTime && (
                <p className="text-[10px] text-cf-text-secondary mt-0.5">
                  {new Date(genTime).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 생성 · 4시간 캐시
                </p>
              )}
            </div>
          </div>
          <button onClick={load} className="flex-shrink-0 flex items-center gap-1 text-[11px] text-cf-text-secondary hover:text-cf-primary transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> {t('refresh')}
          </button>
        </div>
        {analysis.mainTheme && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200">
            <span className="text-amber-500">⚡</span>
            <span className="text-xs font-bold text-amber-700">현재 핵심 테마: {analysis.mainTheme}</span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
          <p className="text-xs font-bold text-blue-700 mb-1">📋 전체 요약</p>
          <p className="text-xs text-blue-700 leading-relaxed">{analysis.summary}</p>
        </div>

        {analysis.countries && analysis.countries.length > 0 && (
          <div>
            <p className="text-xs font-bold text-cf-text-primary mb-2 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-cf-primary" /> 국가별 원인 분석
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {analysis.countries.map((c, i) => (
                <div key={i} className={`p-3 rounded-xl border text-xs ${
                  c.direction === 'inflow' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`font-bold ${c.direction === 'inflow' ? 'text-green-700' : 'text-red-700'}`}>
                      {c.direction === 'inflow' ? '↑' : '↓'} {c.country}
                    </span>
                    <span className={`font-bold tabular-nums ${c.direction === 'inflow' ? 'text-green-600' : 'text-red-600'}`}>{c.ret}</span>
                  </div>
                  <ul className="space-y-0.5 mb-1.5">
                    {c.causes?.map((cause, j) => (
                      <li key={j} className={`flex items-start gap-1 ${c.direction === 'inflow' ? 'text-green-700' : 'text-red-700'}`}>
                        <span className="flex-shrink-0 mt-0.5">•</span>
                        <span className="leading-snug">{cause}</span>
                      </li>
                    ))}
                  </ul>
                  {c.risk && (
                    <div className="flex items-start gap-1 text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                      <span className="flex-shrink-0">⚠</span>
                      <span className="leading-snug">{c.risk}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis.rotations && analysis.rotations.length > 0 && (
          <div>
            <p className="text-xs font-bold text-cf-text-primary mb-2 flex items-center gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-cf-primary" /> 로테이션 원인
            </p>
            <div className="space-y-1.5">
              {analysis.rotations.map((r, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-xl bg-violet-50 border border-violet-100 text-xs">
                  <div className="flex items-center gap-1 flex-shrink-0 font-bold text-violet-700 min-w-[100px]">
                    <span>{r.from}</span>
                    <ArrowRight className="w-3 h-3" />
                    <span>{r.to}</span>
                  </div>
                  <span className="text-violet-700 leading-snug">{r.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis.keyWatchpoints && analysis.keyWatchpoints.length > 0 && (
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-xs font-bold text-slate-700 mb-2">👀 지금 주목해야 할 포인트</p>
            <ul className="space-y-1">
              {analysis.keyWatchpoints.map((pt, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                  <span className="font-bold text-slate-400 flex-shrink-0">{i + 1}.</span>
                  <span className="leading-snug">{pt}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CapitalFlowsTab ───────────────────────────────────────────────────────────
export default function CapitalFlowsTab() {
  const t = useTranslations('intelligence');
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tf, setTf] = useState<Timeframe>('4w');
  const [commCurves, setCommCurves] = useState<CommodityCurveData[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.allSettled([
      fetch('/api/capital-flows', { signal }).then(r => r.json()),
      fetch('/api/commodity-curve', { signal }).then(r => r.json()),
    ]).then(([flowRes, curveRes]) => {
      if (signal.aborted) return;
      if (flowRes.status === 'fulfilled') setData(flowRes.value);
      if (curveRes.status === 'fulfilled') setCommCurves(curveRes.value.curves ?? null);
    }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-cf-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">글로벌 자금흐름 분석 중...</span>
    </div>
  );
  if (!data) return <p className="text-center text-cf-text-secondary py-8 text-sm">데이터를 불러올 수 없습니다</p>;

  const retKey = TF_RET_KEY[tf];
  const maxAbs = Math.max(...data.assets.map((a) => Math.abs(a[retKey])), 1);
  const activeRotations = tf === '1w' ? data.flow.rotations1w : tf === '13w' ? data.flow.rotations13w : data.flow.rotations4w;

  return (
    <div className="space-y-6">
      {/* Timeframe toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-cf-text-secondary font-medium">기준:</span>
        <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
          {(['1w', '4w', '13w'] as Timeframe[]).map((t) => (
            <button key={t} onClick={() => setTf(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${tf === t ? 'bg-white text-cf-primary shadow-sm' : 'text-cf-text-secondary hover:text-cf-text-primary'}`}>
              {TF_LABELS[t]}
            </button>
          ))}
        </div>
        {data.dataSource && <span className="ml-auto text-[11px] text-cf-text-secondary">{data.dataSource}</span>}
      </div>

      {/* 주요 로테이션 */}
      {activeRotations.length > 0 && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-cf-primary" />
            자금 로테이션 ({TF_LABELS[tf]} 기준)
          </h3>
          <div className="space-y-3">
            {activeRotations.map((r, i) => {
              const momentumBadge = r.momentum === 'accelerating'
                ? { label: t('accelerating'), cls: 'bg-amber-100 text-amber-700' }
                : r.momentum === 'fading'
                ? { label: t('weakening'), cls: 'bg-gray-100 text-gray-500' }
                : { label: t('maintaining'), cls: 'bg-slate-100 text-slate-600' };
              return (
                <div key={i} className="p-3 rounded-lg bg-cf-bg border border-cf-border space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-full">{r.from}</span>
                    <ArrowRight className="w-4 h-4 text-cf-primary flex-shrink-0" />
                    <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full">{r.to}</span>
                    <span className="ml-auto text-sm font-extrabold text-cf-primary">+{r.magnitude}%p</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.startDate && (
                      <span className="text-[11px] text-cf-text-secondary flex items-center gap-1">
                        🕐 {r.weeksAgo === 1 ? '이번 주 시작' : `${r.weeksAgo}주 전 시작`} ({r.startDate})
                      </span>
                    )}
                    {r.momentum && (
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${momentumBadge.cls}`}>
                        {momentumBadge.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 국가별 시장 자금 흐름 */}
      {data.countryFlow && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4 text-cf-primary" />
            국가별 시장 자금 흐름 ({TF_LABELS[tf]} 기준)
          </h3>

          {(() => {
            const cr = tf === '1w' ? data.countryFlow.rotations1w : tf === '13w' ? data.countryFlow.rotations13w : data.countryFlow.rotations4w;
            return cr.length > 0 ? (
              <div className="space-y-2 mb-4">
                {cr.map((r, i) => {
                  const mb = r.momentum === 'accelerating'
                    ? { label: t('accelerating'), cls: 'bg-amber-100 text-amber-700' }
                    : r.momentum === 'fading'
                    ? { label: t('weakening'), cls: 'bg-gray-100 text-gray-500' }
                    : { label: t('maintaining'), cls: 'bg-slate-100 text-slate-600' };
                  return (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-cf-bg border border-cf-border">
                      <span className="text-base leading-none flex-shrink-0">{r.fromFlag}</span>
                      <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">{r.from}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-cf-primary flex-shrink-0" />
                      <span className="text-base leading-none flex-shrink-0">{r.toFlag}</span>
                      <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{r.to}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-1 ${mb.cls}`}>{mb.label}</span>
                      <span className="ml-auto text-sm font-extrabold text-cf-primary">+{r.magnitude}%p</span>
                    </div>
                  );
                })}
              </div>
            ) : null;
          })()}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[...data.countryFlow.countries]
              .sort((a, b) => b[retKey] - a[retKey])
              .map((c) => {
                const val = c[retKey];
                const positive = val >= 0;
                return (
                  <div key={c.id} className={`rounded-lg border p-2.5 ${positive ? 'border-green-200 bg-green-50/40' : 'border-red-200 bg-red-50/40'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-base leading-none">{c.flag}</span>
                      <span className="text-xs font-bold text-cf-text-primary">{c.label}</span>
                    </div>
                    <div className={`text-base font-extrabold tabular-nums ${positive ? 'text-green-600' : 'text-red-500'}`}>
                      {val > 0 ? '+' : ''}{val.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">{c.ticker}</div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 스마트베타 팩터 성과 */}
      {data.factorPerformance && data.factorPerformance.length > 0 && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <span>🧮</span> 스마트베타 팩터 성과 ({TF_LABELS[tf]} 기준)
          </h3>
          {(() => {
            const sorted = [...data.factorPerformance].sort((a, b) => b[retKey] - a[retKey]);
            const maxAbs2 = Math.max(...sorted.map(f => Math.abs(f[retKey])), 1);
            return (
              <div className="space-y-2">
                {sorted.map((f) => (
                  <div key={f.id} className="flex items-center gap-3">
                    <span className="text-base leading-none flex-shrink-0">{f.flag}</span>
                    <span className="text-xs font-bold text-cf-text-primary w-16 flex-shrink-0">{f.label}</span>
                    <span className="text-[10px] text-gray-400 font-mono w-10 flex-shrink-0">{f.ticker}</span>
                    <ReturnBar val={f[retKey]} max={maxAbs2} />
                  </div>
                ))}
                <p className="text-[10px] text-cf-text-secondary/60 pt-1">
                  MTUM · QUAL · VLUE · USMV · IVW · IVE — iShares/MSCI 팩터 ETF 기반
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* 미국 섹터 성과 */}
      {data.sectorPerformance && data.sectorPerformance.length > 0 && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <span>🏭</span> 미국 섹터 로테이션 ({TF_LABELS[tf]} 기준)
          </h3>
          {(() => {
            const sorted = [...data.sectorPerformance].sort((a, b) => b[retKey] - a[retKey]);
            const maxAbs2 = Math.max(...sorted.map(s => Math.abs(s[retKey])), 1);
            const best = sorted[0];
            const worst = sorted[sorted.length - 1];
            return (
              <>
                {(best && worst) && (
                  <div className="flex gap-2 mb-3">
                    <div className="flex-1 p-2 rounded-lg bg-green-50 border border-green-200 text-center">
                      <div className="text-base">{best.flag}</div>
                      <div className="text-xs font-bold text-green-700">{best.label}</div>
                      <div className="text-sm font-extrabold text-green-600">+{best[retKey].toFixed(1)}%</div>
                    </div>
                    <div className="flex items-center text-xs text-gray-400">→</div>
                    <div className="flex-1 p-2 rounded-lg bg-red-50 border border-red-200 text-center">
                      <div className="text-base">{worst.flag}</div>
                      <div className="text-xs font-bold text-red-700">{worst.label}</div>
                      <div className="text-sm font-extrabold text-red-500">{worst[retKey].toFixed(1)}%</div>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  {sorted.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className="text-sm leading-none flex-shrink-0">{s.flag}</span>
                      <span className="text-xs font-medium text-cf-text-primary w-16 flex-shrink-0 truncate">{s.label}</span>
                      <span className="text-[10px] text-gray-400 font-mono w-10 flex-shrink-0">{s.ticker}</span>
                      <ReturnBar val={s[retKey]} max={maxAbs2} />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-cf-text-secondary/60 pt-1">
                  SPDR Sector ETFs (XLK·XLF·XLE·XLV·XLI·XLB·XLY·XLP·XLU·XLRE·XLC)
                </p>
              </>
            );
          })()}
        </div>
      )}

      {/* 금 vs 달러 */}
      {(() => {
        const gvd = data.goldVsDollar;
        const goldRet = tf === '1w' ? gvd.goldRet1w : tf === '13w' ? gvd.goldRet13w : gvd.goldRet4w;
        const dollarRet = tf === '1w' ? gvd.dollarRet1w : tf === '13w' ? gvd.dollarRet13w : gvd.dollarRet4w;
        const signal = tf === '1w' ? gvd.signal1w : tf === '13w' ? gvd.signal13w : gvd.signal4w;
        return (
          <div className="cf-card p-4">
            <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
              <span>⚖️</span> 금 vs 달러 ({TF_LABELS[tf]} 기준)
            </h3>
            <div className="flex gap-4 mb-3">
              <div className="flex-1 text-center p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                <div className="text-2xl mb-1">🥇</div>
                <div className={`text-xl font-extrabold ${goldRet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {goldRet > 0 ? '+' : ''}{goldRet.toFixed(1)}%
                </div>
                <div className="text-[11px] text-gray-500">금 ({TF_LABELS[tf]})</div>
              </div>
              <div className="flex items-center text-gray-400 font-bold">vs</div>
              <div className="flex-1 text-center p-3 rounded-lg bg-blue-50 border border-blue-200">
                <div className="text-2xl mb-1">💵</div>
                <div className={`text-xl font-extrabold ${dollarRet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {dollarRet > 0 ? '+' : ''}{dollarRet.toFixed(1)}%
                </div>
                <div className="text-[11px] text-gray-500">달러 ({TF_LABELS[tf]})</div>
              </div>
            </div>
            <div className="text-center text-xs font-semibold text-cf-primary bg-cf-primary/5 rounded-lg py-2 px-3">
              📌 {signal}
            </div>
          </div>
        );
      })()}

      {/* 원자재 선물 커브 */}
      {commCurves && commCurves.length > 0 && (
        <div className="cf-card p-4">
          <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
            <span>🛢️</span> 원자재 선물 커브 — 컨탱고 / 백워데이션
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {commCurves.map((c) => {
              const structColor = c.structure === 'contango' ? 'text-blue-600 bg-blue-50 border-blue-200'
                : c.structure === 'backwardation' ? 'text-orange-600 bg-orange-50 border-orange-200'
                : 'text-gray-600 bg-gray-50 border-gray-200';
              const structLabel = c.structure === 'contango' ? '컨탱고 (정상상승)' : c.structure === 'backwardation' ? '백워데이션 (공급부족)' : '플랫';
              const maxP = Math.max(...c.curve.map(p => p.price));
              const minP = Math.min(...c.curve.map(p => p.price));
              const range = maxP - minP || 1;
              return (
                <div key={c.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cf-text-primary">{c.name}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${structColor}`}>
                      {structLabel} {c.slope > 0 ? '+' : ''}{c.slope.toFixed(1)}%
                    </span>
                  </div>
                  {c.curve.length > 0 && (
                    <div className="flex items-end gap-1 h-12">
                      {c.curve.map((pt) => {
                        const h = ((pt.price - minP) / range * 36 + 12);
                        const isFirst = pt === c.curve[0];
                        return (
                          <div key={pt.ticker} className="flex flex-col items-center flex-1 min-w-0">
                            <div
                              className={`w-full rounded-t-sm ${isFirst ? 'bg-cf-primary' : c.structure === 'contango' ? 'bg-blue-400' : 'bg-orange-400'}`}
                              style={{ height: `${h}px` }}
                              title={`${pt.label}: $${pt.price.toFixed(2)} ${c.unit}`}
                            />
                            <span className="text-[8px] text-cf-text-secondary mt-0.5 truncate w-full text-center leading-tight">{pt.label.replace(' 2', "'")}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="text-[10px] text-cf-text-secondary">
                    {c.id === 'oil'
                      ? (c.structure === 'backwardation' ? '⚠️ 공급 타이트 — 현물 프리미엄' : '📉 공급 여유 — 선도 프리미엄')
                      : (c.structure === 'contango' ? '📈 금 보유 비용 정상 반영' : '⚠️ 금 현물 수요 급증 신호')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 자산군별 성과 */}
      <div className="cf-card p-4">
        <h3 className="text-sm font-bold text-cf-text-primary mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cf-primary" />
          자산군별 {TF_LABELS[tf]} 수익률 (자금 유입 방향)
        </h3>
        {(() => {
          const groupPerf: Record<string, number[]> = {};
          for (const a of data.assets) {
            if (!groupPerf[a.group]) groupPerf[a.group] = [];
            groupPerf[a.group].push(a[retKey]);
          }
          const groupAvgTf = Object.entries(groupPerf)
            .map(([group, vals]) => ({ group, avg: parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)) }))
            .sort((a, b) => b.avg - a.avg);
          const maxG = Math.max(...groupAvgTf.map(g => Math.abs(g.avg)), 1);
          return (
            <div className="space-y-1">
              {groupAvgTf.map((g) => (
                <div key={g.group} className="flex items-center gap-3 py-2 border-b border-cf-border last:border-0">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${GROUP_LIGHT[g.group] ?? 'bg-gray-100 text-gray-600 border-gray-200'} w-20 text-center flex-shrink-0`}>
                    {GROUP_LABELS[g.group] ?? g.group}
                  </span>
                  <ReturnBar val={g.avg} max={maxG} />
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* 상위 유입/유출 개별 자산 */}
      {(() => {
        const sorted = [...data.assets].sort((a, b) => b[retKey] - a[retKey]);
        const topIn = sorted.slice(0, 5);
        const topOut = sorted.slice(-5).reverse();
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="cf-card p-4">
              <h3 className="text-sm font-bold text-green-700 mb-3 flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4" /> 자금 유입 TOP 5 ({TF_LABELS[tf]})
              </h3>
              <div className="space-y-2">
                {topIn.map((a, i) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-4 flex-shrink-0">{i + 1}</span>
                    <span className="text-base leading-none flex-shrink-0">{a.flag}</span>
                    <span className="text-xs font-medium text-cf-text-primary truncate flex-1">{a.label}</span>
                    <span className="text-xs font-bold text-green-600 flex-shrink-0">+{a[retKey].toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="cf-card p-4">
              <h3 className="text-sm font-bold text-red-600 mb-3 flex items-center gap-2">
                <ArrowDownRight className="w-4 h-4" /> 자금 이탈 TOP 5 ({TF_LABELS[tf]})
              </h3>
              <div className="space-y-2">
                {topOut.map((a, i) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-4 flex-shrink-0">{i + 1}</span>
                    <span className="text-base leading-none flex-shrink-0">{a.flag}</span>
                    <span className="text-xs font-medium text-cf-text-primary truncate flex-1">{a.label}</span>
                    <span className="text-xs font-bold text-red-500 flex-shrink-0">{a[retKey].toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 전체 테이블 */}
      <div className="cf-card p-4">
        <h3 className="text-sm font-bold text-cf-text-primary mb-3">전체 자산 수익률</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cf-border text-cf-text-secondary">
                <th className="text-left pb-2 font-medium">자산</th>
                <th className="text-right pb-2 font-medium">1주</th>
                <th className="text-right pb-2 font-medium">4주</th>
                <th className="text-right pb-2 font-medium">13주</th>
              </tr>
            </thead>
            <tbody>
              {[...data.assets].sort((a, b) => b.ret4w - a.ret4w).map((a) => (
                <tr key={a.id} className="border-b border-cf-border/50 last:border-0">
                  <td className="py-2 flex items-center gap-1.5">
                    <span>{a.flag}</span>
                    <span className="font-medium text-cf-text-primary">{a.label}</span>
                    <span className="text-gray-400 font-mono">{a.ticker}</span>
                  </td>
                  <td className={`py-2 text-right font-bold tabular-nums ${a.ret1w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {a.ret1w > 0 ? '+' : ''}{a.ret1w.toFixed(1)}%
                  </td>
                  <td className={`py-2 text-right font-bold tabular-nums ${a.ret4w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {a.ret4w > 0 ? '+' : ''}{a.ret4w.toFixed(1)}%
                  </td>
                  <td className={`py-2 text-right font-bold tabular-nums ${a.ret13w >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {a.ret13w > 0 ? '+' : ''}{a.ret13w.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 수급 강도 & Cascade */}
      <FlowIntensityPanel data={data} />

      {/* AI 자금흐름 원인 분석 */}
      <FlowAnalysisPanel tf={tf} />

      <p className="text-xs text-cf-text-secondary text-center">
        Yahoo Finance (15분 지연) · ETF 기반 자산군별 수익률 분석 · 4시간 캐시
        {data.updatedAt && ` · ${new Date(data.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 업데이트`}
      </p>
    </div>
  );
}

'use client';

import { useEffect, useState, useMemo } from 'react';
import { Link } from '@/i18n/routing';
import { Loader2, ArrowUpDown, ExternalLink, Filter, X, TrendingUp, TrendingDown, Plus, LogOut } from 'lucide-react';
import type { InstitutionalSignal } from '@/data/institutional-signals';
import type { ShortEntry } from '@/app/api/short-interest/route';

const SECTOR_LABELS: Record<string, string> = {
  semiconductors: '반도체',
  'ai-cloud': 'AI·클라우드',
  'ev-battery': 'EV·배터리',
  defense: '방산',
  'pharma-biotech': '바이오',
  commodities: '원자재',
  other: '기타',
};

const ACTION_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  accumulating: { label: '매집',   color: '#10b981', bg: '#10b98120', icon: <TrendingUp className="w-3 h-3" /> },
  new_position: { label: '신규',   color: '#3b82f6', bg: '#3b82f620', icon: <Plus className="w-3 h-3" /> },
  reducing:     { label: '비중 축소', color: '#f59e0b', bg: '#f59e0b20', icon: <TrendingDown className="w-3 h-3" /> },
  exit:         { label: '청산',   color: '#ef4444', bg: '#ef444420', icon: <LogOut className="w-3 h-3" /> },
};

interface ScreenerRow {
  ticker: string;
  companyName: string;
  sector: string;
  institution: string;
  action: string;
  estimatedValue: string;
  filingDate: string;
  newsGapScore: number;
  // from short interest
  shortFloatPct: number | null;
  shortRatio: number | null;
  squeezeScore: number;
}

const PRESETS = [
  {
    id: 'squeeze',
    label: '🔥 숏 스퀴즈 후보',
    desc: '기관 매집 + 공매도',
    // If short data is available, require squeezeScore >= 30; else fall back to accumulation-only
    filter: (r: ScreenerRow) => {
      const accumulating = r.action === 'accumulating' || r.action === 'new_position';
      if (!accumulating) return false;
      if (r.shortFloatPct != null) return r.squeezeScore >= 30;
      return true; // short 데이터 없으면 일단 매집 중인 종목 표시
    },
  },
  {
    id: 'inst',
    label: '🏦 기관 신규 편입',
    desc: '이번 분기 신규 편입',
    filter: (r: ScreenerRow) => r.action === 'new_position',
  },
  {
    id: 'accumulate',
    label: '📈 기관 매집 중',
    desc: '비중 확대 중인 종목',
    filter: (r: ScreenerRow) => r.action === 'accumulating' || r.action === 'new_position',
  },
  {
    id: 'reduce',
    label: '📉 기관 비중 축소',
    desc: '매도·청산 중인 종목',
    filter: (r: ScreenerRow) => r.action === 'reducing' || r.action === 'exit',
  },
  {
    id: 'gap',
    label: '📰 언더레이더',
    desc: '기관 매집 + 낮은 뉴스',
    filter: (r: ScreenerRow) => (r.action === 'accumulating' || r.action === 'new_position') && r.newsGapScore < 30,
  },
];

type SortKey = keyof ScreenerRow;

export default function ScreenerPage() {
  const [signals, setSignals] = useState<InstitutionalSignal[]>([]);
  const [shortData, setShortData] = useState<ShortEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [minShort, setMinShort] = useState<number>(0);
  const [maxShort, setMaxShort] = useState<number>(100);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('filingDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.allSettled([
      fetch('/api/signals', { signal }).then(r => r.json()),
      fetch('/api/short-interest', { signal }).then(r => r.json()),
    ]).then(([sigRes, shortRes]) => {
      if (signal.aborted) return;
      if (sigRes.status === 'fulfilled') setSignals(sigRes.value.signals ?? []);
      if (shortRes.status === 'fulfilled') setShortData(shortRes.value.entries ?? []);
      setLoading(false);
    }).catch(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const shortMap = useMemo(() =>
    new Map(shortData.map(s => [s.ticker, s])),
    [shortData]
  );

  // Deduplicate by ticker (keep most recent signal per ticker)
  const deduped: ScreenerRow[] = useMemo(() => {
    const byTicker = new Map<string, InstitutionalSignal>();
    for (const sig of signals) {
      const existing = byTicker.get(sig.ticker);
      if (!existing || sig.filingDate > existing.filingDate) {
        byTicker.set(sig.ticker, sig);
      }
    }
    return Array.from(byTicker.values()).map(sig => {
      const short = shortMap.get(sig.ticker);
      return {
        ticker: sig.ticker,
        companyName: sig.companyName,
        sector: sig.sector,
        institution: sig.institution,
        action: sig.action,
        estimatedValue: sig.estimatedValue,
        filingDate: sig.filingDate,
        newsGapScore: sig.newsGapScore,
        shortFloatPct: short?.shortFloatPct ?? null,
        shortRatio: short?.shortRatio ?? null,
        squeezeScore: short?.squeezeScore ?? 0,
      };
    });
  }, [signals, shortMap]);

  const sectors = useMemo(() => ['all', ...Array.from(new Set(deduped.map(r => r.sector)))], [deduped]);

  const filtered = useMemo(() => {
    let rows = deduped;
    if (activePreset) {
      const preset = PRESETS.find(p => p.id === activePreset);
      if (preset) rows = rows.filter(preset.filter);
    } else {
      if (sectorFilter !== 'all') rows = rows.filter(r => r.sector === sectorFilter);
      if (actionFilter !== 'all') rows = rows.filter(r => r.action === actionFilter);
      rows = rows.filter(r => (r.shortFloatPct ?? 0) >= minShort && (r.shortFloatPct ?? 100) <= maxShort);
    }
    return [...rows].sort((a, b) => {
      const va: unknown = a[sortKey];
      const vb: unknown = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [deduped, activePreset, sectorFilter, actionFilter, minShort, maxShort, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const clearFilters = () => {
    setSectorFilter('all');
    setActionFilter('all');
    setMinShort(0);
    setMaxShort(100);
    setActivePreset(null);
  };

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      className="px-3 py-2 text-left text-[10px] text-cf-text-secondary cursor-pointer hover:text-cf-text-primary select-none whitespace-nowrap"
      onClick={() => handleSort(k)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
        {sortKey === k && <span className="opacity-70">{sortDir === 'desc' ? '↓' : '↑'}</span>}
      </div>
    </th>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] gap-3 text-cf-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>데이터 로딩 중...</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-cf-text-primary flex items-center gap-2">
          <Filter className="w-6 h-6 text-cf-accent" />
          스크리너
        </h1>
        <p className="text-sm text-cf-text-secondary mt-1">
          기관 13F 매집 · 공매도 데이터 기반 종목 필터링
        </p>
      </div>

      {/* Quick guide */}
      <div className="cf-card p-4 mb-4 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-500/10">
        <p className="text-xs font-bold text-cf-text-primary mb-2">📖 어떻게 보는 건가요?</p>
        <ul className="text-[11px] text-cf-text-secondary space-y-1.5 leading-relaxed">
          <li>• <b className="text-cf-text-primary">프리셋 버튼</b>을 누르면 목적별로 종목이 필터링됩니다 — 복잡한 필터 설정 없이 한 번에 확인 가능</li>
          <li>• <b className="text-amber-400">🔥 숏 스퀴즈 후보</b> = 기관은 매집하는데 공매도 세력도 많은 종목 → 숏 세력이 손절하며 주가 급등 가능성</li>
          <li>• <b className="text-blue-400">🏦 기관 신규 편입</b> = 이번 분기에 대형 기관이 <em>새로</em> 담은 종목 → 기관이 왜 샀는지 리서치 대상</li>
          <li>• <b className="text-purple-400">📰 언더레이더</b> = 기관은 사는데 뉴스 커버리지 낮은 종목 → 시장에 소외된 기회</li>
          <li>• <b className="text-cf-text-primary">스퀴즈 점수</b>: 공매도 비율 + Days to Cover + 기관 매집을 종합한 0~100 점수 (70↑ 위험/주의)</li>
          <li>• 티커 클릭 → 해당 기업 상세 페이지 이동 (지분 변화, 섹터 연결, AI 분석)</li>
        </ul>
      </div>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => setActivePreset(activePreset === p.id ? null : p.id)}
            className={`text-xs px-3 py-2 rounded-xl border transition-all ${
              activePreset === p.id
                ? 'bg-cf-accent/20 border-cf-accent text-cf-accent'
                : 'border-white/10 text-cf-text-secondary hover:border-white/20'
            }`}
          >
            <span className="font-semibold">{p.label}</span>
            <span className="text-[10px] opacity-70 ml-1.5 hidden sm:inline">{p.desc}</span>
          </button>
        ))}
      </div>

      {/* Manual filters */}
      {!activePreset && (
        <div className="cf-card p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[10px] text-cf-text-secondary block mb-1">섹터</label>
            <select
              value={sectorFilter}
              onChange={e => setSectorFilter(e.target.value)}
              className="text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-cf-text-primary"
            >
              <option value="all">전체</option>
              {sectors.filter(s => s !== 'all').map(s => (
                <option key={s} value={s}>{SECTOR_LABELS[s] ?? s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-cf-text-secondary block mb-1">기관 액션</label>
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-cf-text-primary"
            >
              <option value="all">전체</option>
              <option value="accumulating">매집</option>
              <option value="new_position">신규 편입</option>
              <option value="reducing">비중 축소</option>
              <option value="exit">청산</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-cf-text-secondary block mb-1">Short Float % 최소</label>
            <input
              type="number"
              min={0} max={100}
              value={minShort}
              onChange={e => setMinShort(+e.target.value)}
              className="text-xs w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-cf-text-primary"
            />
          </div>
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-cf-text-secondary hover:bg-white/5 transition-colors"
          >
            <X className="w-3 h-3" /> 초기화
          </button>
        </div>
      )}

      {/* Result count */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-cf-text-secondary">{filtered.length}개 결과</span>
        {activePreset && (
          <button
            onClick={() => setActivePreset(null)}
            className="flex items-center gap-1 text-xs text-cf-text-secondary hover:text-cf-text-primary transition-colors"
          >
            <X className="w-3 h-3" /> 프리셋 해제
          </button>
        )}
      </div>

      {/* Table */}
      <div className="cf-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/5">
            <tr>
              <SortTh label="티커" k="ticker" />
              <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">기업</th>
              <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">섹터</th>
              <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">기관</th>
              <SortTh label="액션" k="action" />
              <th className="px-3 py-2 text-left text-[10px] text-cf-text-secondary">규모</th>
              <SortTh label="Short %" k="shortFloatPct" />
              <SortTh label="Days to Cover" k="shortRatio" />
              <SortTh label="스퀴즈" k="squeezeScore" />
              <SortTh label="뉴스갭" k="newsGapScore" />
              <SortTh label="파일링일" k="filingDate" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const actionCfg = ACTION_CONFIG[row.action];
              return (
                <tr key={`${row.ticker}-${row.institution}`} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/company/${row.ticker}` as Parameters<typeof Link>[0]['href']}
                      className="font-bold text-cf-accent hover:underline flex items-center gap-1"
                    >
                      {row.ticker}
                      <ExternalLink className="w-3 h-3 opacity-40" />
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary max-w-[130px] truncate">
                    {row.companyName}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-cf-text-secondary">
                      {SECTOR_LABELS[row.sector] ?? row.sector}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary max-w-[140px] truncate">
                    {row.institution}
                  </td>
                  <td className="px-3 py-2.5">
                    {actionCfg && (
                      <span
                        className="flex items-center gap-1 text-[10px] font-semibold w-fit px-1.5 py-0.5 rounded"
                        style={{ color: actionCfg.color, backgroundColor: actionCfg.bg }}
                      >
                        {actionCfg.icon}
                        {actionCfg.label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-cf-text-secondary">{row.estimatedValue}</td>
                  <td className="px-3 py-2.5 font-mono text-sm">
                    {row.shortFloatPct != null ? (
                      <span className={row.shortFloatPct > 20 ? 'text-red-400' : row.shortFloatPct > 10 ? 'text-amber-400' : 'text-cf-text-primary'}>
                        {row.shortFloatPct.toFixed(1)}%
                      </span>
                    ) : <span className="text-cf-text-secondary/40">-</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm">
                    {row.shortRatio != null ? (
                      <span className={row.shortRatio > 5 ? 'text-amber-400' : 'text-cf-text-primary'}>
                        {row.shortRatio.toFixed(1)}일
                      </span>
                    ) : <span className="text-cf-text-secondary/40">-</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold">{row.squeezeScore}</span>
                      <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${row.squeezeScore}%`,
                            backgroundColor: row.squeezeScore >= 70 ? '#ef4444' : row.squeezeScore >= 45 ? '#f59e0b' : '#6366f1',
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-mono">{row.newsGapScore}</span>
                      <div className="w-10 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-purple-400"
                          style={{ width: `${row.newsGapScore}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-cf-text-secondary font-mono whitespace-nowrap">
                    {row.filingDate}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-cf-text-secondary text-sm">
            조건에 맞는 종목이 없습니다
          </div>
        )}
      </div>

      <p className="text-[10px] text-cf-text-secondary/40 mt-3">
        출처: SEC EDGAR 13F · Yahoo Finance Short Interest · 캐시 4시간
      </p>
    </div>
  );
}

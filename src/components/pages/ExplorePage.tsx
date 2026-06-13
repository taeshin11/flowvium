'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslatedText } from '@/hooks/useTranslatedText';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import dynamic from 'next/dynamic';
import { allCompanies, type Company } from '@/data/companies';
import { sectors } from '@/data/sectors';
import { companyNamesI18n } from '@/data/company-names-i18n';
import {
  X,
  ExternalLink,
  ArrowRight,
  Building2,
  DollarSign,
  Package,
  Users,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const GraphLoadingFallback = (): React.ReactElement => {
  const t = useTranslations('explore');
  return <div className="flex items-center justify-center h-[500px]">{t('loadingGraph')}</div>;
};

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: GraphLoadingFallback,
});

const sectorColorMap: Record<string, string> = {
  semiconductors: '#6366f1',
  'ai-cloud': '#3b82f6',
  'ev-battery': '#22c55e',
  defense: '#ef4444',
  'pharma-biotech': '#a855f7',
  technology: '#14b8a6',
  automotive: '#f97316',
};

const relationshipColors: Record<string, string> = {
  supplier: '#4F8FBF',
  customer: '#5CB88A',
  partner: '#E8A945',
  competitor: '#D97171',
};

const marketCapSizes: Record<string, number> = {
  titan: 16,
  mega: 12,
  large: 10,
  mid: 8,
  small: 6,
};


function getRoleSize(role: string): number {
  if (role === 'leader') return 12;
  if (role === 'intermediary') return 10;
  if (role === 'mid-cap' || role === 'supplier') return 8;
  return 6;
}

interface SidePanelProps {
  company: Company;
  onClose: () => void;
  liveBand?: string;
}

function SidePanel({ company, onClose, liveBand }: SidePanelProps) {
  const t = useTranslations('explore');
  const mcLabel: Record<string, string> = { titan: t('mcTitan'), mega: t('mcMega'), large: t('mcLarge'), mid: t('mcMid'), small: t('mcSmall') };
  const translatedDescription = useTranslatedText(company.description);
  const pieData = company.revenue.segments.map((s) => ({
    name: s.name,
    value: s.percentage,
  }));
  const COLORS = ['#4F8FBF', '#6CB4A8', '#E8A945', '#D97171', '#5CB88A', '#7C5CFC'];

  const relatedCompanies = company.relationships
    .slice(0, 6)
    .map((r) => {
      const target = allCompanies.find(
        (c) => c.id === r.targetId || c.ticker === r.targetId
      );
      return { ...r, target };
    });

  return (
    <div className="fixed top-0 right-0 z-40 h-full w-96 max-w-[90vw] bg-white shadow-xl overflow-y-auto animate-slide-in-right">
      <div className="sticky top-0 bg-white z-10 border-b border-cf-border p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-heading font-bold text-cf-text-primary">
            {company.name}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono font-bold bg-cf-primary/10 text-cf-primary px-2 py-0.5 rounded">
              {company.ticker}
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: (sectorColorMap[company.sector] || '#888') + '20',
                color: sectorColorMap[company.sector] || '#888',
              }}
            >
              {company.sector}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <X className="w-5 h-5 text-cf-text-secondary" />
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Info badges */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 text-sm">
            <DollarSign className="w-4 h-4 text-cf-text-secondary" />
            <span className="text-cf-text-secondary">{t('sidePanel.cap')}:</span>
            <span className="font-medium">{mcLabel[liveBand ?? company.marketCap] ?? (liveBand ?? company.marketCap)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4 text-cf-text-secondary" />
            <span className="text-cf-text-secondary">{t('sidePanel.role')}:</span>
            <span className="font-medium capitalize">{company.role}</span>
          </div>
        </div>

        <p className="text-sm text-cf-text-secondary leading-relaxed line-clamp-4">
          {translatedDescription}
        </p>

        {/* Products */}
        <div>
          <h3 className="text-sm font-bold text-cf-text-primary mb-2 flex items-center gap-2">
            <Package className="w-4 h-4" /> {t('sidePanel.products')}
          </h3>
          <div className="space-y-1">
            {company.products.slice(0, 4).map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2"
              >
                <span className="text-cf-text-primary font-medium truncate mr-2">
                  {p.name}
                </span>
                <span className="text-cf-text-secondary flex-shrink-0">
                  {p.revenueShare}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue Pie */}
        <div>
          <h3 className="text-sm font-bold text-cf-text-primary mb-2">{t('sidePanel.revenueBreakdown')}</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={65}
                  dataKey="value"
                  paddingAngle={2}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => `${value}%`}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {pieData.map((item, i) => (
              <div key={item.name} className="flex items-center gap-1.5 text-xs">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="text-cf-text-secondary truncate">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Related Companies */}
        <div>
          <h3 className="text-sm font-bold text-cf-text-primary mb-2 flex items-center gap-2">
            <Users className="w-4 h-4" /> {t('sidePanel.relatedCompanies')}
          </h3>
          <div className="space-y-2">
            {relatedCompanies.map((rel, i) => (
              <Link
                key={i}
                href={`/company/${rel.target?.ticker || rel.targetId}`}
                className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors text-xs group"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: relationshipColors[rel.type] }}
                  />
                  <span className="font-medium text-cf-text-primary">
                    {rel.target?.name || rel.targetId}
                  </span>
                </div>
                <span
                  className="text-xs capitalize px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: relationshipColors[rel.type] + '20',
                    color: relationshipColors[rel.type],
                  }}
                >
                  {t(`relationships.${rel.type}`)}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2 pt-2">
          <Link
            href={`/company/${company.ticker}`}
            className="cf-btn-primary w-full justify-center gap-2"
          >
            {t('sidePanel.viewProfile')}
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href={`/cascade/${company.sector}`}
            className="cf-btn-secondary w-full justify-center gap-2"
          >
            {t('sidePanel.viewCascade')}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

interface ExplorePageProps {
  initialSector?: string;
}

export default function ExplorePage({ initialSector }: ExplorePageProps) {
  const t = useTranslations('explore');
  const mcLabel: Record<string, string> = { titan: t('mcTitan'), mega: t('mcMega'), large: t('mcLarge'), mid: t('mcMid'), small: t('mcSmall') };
  const [selectedSector, setSelectedSector] = useState<string>(initialSector || 'all');
  // 기본값: 'mega' (110개 ~ 시각화 적정) — 'all'(600+) 은 사용자 명시 선택 시만
  const [selectedCap, setSelectedCap] = useState<string>('mega');
  // isolated 노드 (relationship 0개) 자동 hide 토글
  const [hideIsolated, setHideIsolated] = useState<boolean>(true);
  // View mode: 'table' (Bloomberg-style dense) | 'graph' (force network). default = table
  const [viewMode, setViewMode] = useState<'table' | 'graph'>('table');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);
  const [containerWidth, setContainerWidth] = useState(800);
  // Live-fetched market-cap bands (overrides stale static `c.marketCap` enums)
  const [liveBands, setLiveBands] = useState<Record<string, string>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch live market-cap bands from Yahoo (cached 24h server-side).
  // Non-blocking: if the call fails the UI keeps static data as fallback.
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/market-caps', { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!controller.signal.aborted && data?.bands) setLiveBands(data.bands as Record<string, string>);
      })
      .catch(() => { /* static fallback */ });
    return () => controller.abort();
  }, []);

  // Resolve a company's effective cap band — live data if present, else static.
  const capFor = (c: Company): string => liveBands[c.ticker] ?? c.marketCap;

  useEffect(() => {
    setMounted(true);
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Configure forces — less aggressive on mobile
  useEffect(() => {
    if (graphRef.current) {
      const isMobile = containerWidth < 768;
      graphRef.current.d3Force('charge')?.strength(isMobile ? -2000 : -5500);
      graphRef.current.d3Force('link')?.distance(isMobile ? 400 : 900);
      graphRef.current.d3Force('center')?.strength(0.02);
      // Collision prevention — hard minimum separation via async d3-force import
      import('d3-force').then(({ forceCollide }) => {
        if (graphRef.current) {
          graphRef.current.d3Force('collide', forceCollide(isMobile ? 40 : 60).strength(0.95));
          graphRef.current.d3ReheatSimulation?.();
        }
      }).catch(() => { /* non-fatal */ });
      // Auto-fit after a short delay
      setTimeout(() => {
        if (graphRef.current) graphRef.current.zoomToFit(600, 40);
      }, 500);
      setTimeout(() => {
        if (graphRef.current) graphRef.current.zoomToFit(400, 40);
      }, 2000);
    }
  }, [mounted, selectedSector, selectedCap, searchQuery, containerWidth]);

  const filteredCompanies = useMemo(() => {
    let filtered = allCompanies;
    if (selectedSector !== 'all') {
      filtered = filtered.filter((c) => c.sector === selectedSector);
    }
    if (selectedCap !== 'all') {
      filtered = filtered.filter((c) => capFor(c) === selectedCap);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((c) => {
        if (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)) return true;
        const localizedNames = companyNamesI18n[c.ticker];
        if (localizedNames?.some((name) => name.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    return filtered;
  }, [selectedSector, selectedCap, searchQuery]);

  const graphData = useMemo(() => {
    const nodeIds = new Set(filteredCompanies.map((c) => c.id));
    const nodes = filteredCompanies.map((c) => ({
      id: c.id,
      name: c.name,
      ticker: c.ticker,
      sector: c.sector,
      val: marketCapSizes[capFor(c)] ?? getRoleSize(c.role),
      color: sectorColorMap[c.sector] || '#888',
    }));

    const links: { source: string; target: string; type: string; color: string }[] = [];
    const linkSet = new Set<string>();

    for (const c of filteredCompanies) {
      for (const rel of c.relationships) {
        const targetId = rel.targetId;
        if (nodeIds.has(targetId)) {
          const key = [c.id, targetId].sort().join('-') + rel.type;
          if (!linkSet.has(key)) {
            linkSet.add(key);
            links.push({
              source: c.id,
              target: targetId,
              type: rel.type,
              color: relationshipColors[rel.type],
            });
          }
        }
      }
    }

    // hideIsolated: 그래프에 link 가 0개인 노드는 시각화 가독성 저해 → 제거
    if (hideIsolated && links.length > 0) {
      const connected = new Set<string>();
      for (const l of links) { connected.add(l.source); connected.add(l.target); }
      return { nodes: nodes.filter(n => connected.has(n.id)), links };
    }
    return { nodes, links };
  }, [filteredCompanies, hideIsolated]);

  const handleNodeClick = useCallback(
    (node: Record<string, unknown>) => {
      const id = node.id as string | undefined;
      if (id) {
        const company = allCompanies.find((c) => c.id === id);
        if (company) setSelectedCompany(company);
      }
    },
    []
  );

  const handleZoomIn = () => {
    // Force graph zoom handled internally
  };

  return (
    <div className="relative">
      {/* Header */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8 pb-4">
        <h1 className="text-3xl font-heading font-bold text-cf-text-primary mb-2">
          {t('title')}
        </h1>
        <p className="text-cf-text-secondary mb-6">{t('subtitle')}</p>

        {/* Search */}
        <div className="relative mb-4 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cf-text-secondary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="cf-input pl-10"
          />
        </div>

        {/* Sector tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedSector('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedSector === 'all'
                ? 'bg-cf-primary text-white shadow-sm'
                : 'bg-white text-cf-text-secondary hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {t('sectors.all')}
          </button>
          {sectors.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSector(s.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                selectedSector === s.id
                  ? 'text-white shadow-sm'
                  : 'bg-white text-cf-text-secondary hover:bg-gray-50 border border-gray-200'
              }`}
              style={
                selectedSector === s.id ? { backgroundColor: s.color } : undefined
              }
            >
              {t(`sectors.${s.id}`)}
            </button>
          ))}
        </div>

        {/* Market Cap filter */}
        <div className="flex flex-wrap gap-2">
          {['all', 'titan', 'mega', 'large', 'mid', 'small'].map((cap) => (
            <button
              key={cap}
              onClick={() => setSelectedCap(cap)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                selectedCap === cap
                  ? 'bg-cf-text-primary text-white shadow-sm'
                  : 'bg-white text-cf-text-secondary hover:bg-gray-50 border border-gray-200'
              }`}
            >
              {cap === 'all' ? t('sectors.all') : mcLabel[cap] ?? cap}
            </button>
          ))}
        </div>
      </div>

      {/* Legend + 옵션 */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-2">
        <div className="flex flex-wrap items-center gap-4 text-xs text-cf-text-secondary">
          <span className="font-medium">{t('filters')}:</span>
          {Object.entries(relationshipColors).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1.5">
              <span className="w-5 h-1 rounded-full" style={{ backgroundColor: color }} />
              {t(`relationships.${type}`)}
            </span>
          ))}
          <div className="flex items-center gap-3 ml-auto">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideIsolated}
                onChange={(e) => setHideIsolated(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              <span>{t('hideIsolated')}</span>
            </label>
            <div className="flex border border-cf-border rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 text-xs font-mono ${viewMode === 'table' ? 'bg-cf-accent text-white' : 'bg-white hover:bg-gray-50'}`}
              >
                {t('viewTable')}
              </button>
              <button
                onClick={() => setViewMode('graph')}
                className={`px-2.5 py-1 text-xs font-mono ${viewMode === 'graph' ? 'bg-cf-accent text-white' : 'bg-white hover:bg-gray-50'}`}
              >
                {t('viewGraph')}
              </button>
            </div>
          </div>
        </div>
        {selectedCap === 'all' && (
          <div className="mt-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800">
            ⚠️ {t('allCapWarning')}
          </div>
        )}
      </div>

      {/* Table view — Bloomberg SPLC style (dense, monospace) */}
      {viewMode === 'table' && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="cf-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="bg-gray-50 border-b border-cf-border sticky top-0">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-cf-text-secondary">
                    <th className="px-3 py-2 font-semibold">{t('tblTicker')}</th>
                    <th className="px-3 py-2 font-semibold">{t('tblName')}</th>
                    <th className="px-3 py-2 font-semibold">{t('tblSector')}</th>
                    <th className="px-3 py-2 font-semibold text-right">{t('tblCap')}</th>
                    <th className="px-3 py-2 font-semibold text-center" title={t('ttSup')}>{t('tblSup')}</th>
                    <th className="px-3 py-2 font-semibold text-center" title={t('ttCus')}>{t('tblCus')}</th>
                    <th className="px-3 py-2 font-semibold text-center" title={t('ttPar')}>{t('tblPar')}</th>
                    <th className="px-3 py-2 font-semibold text-center" title={t('ttCom')}>{t('tblCom')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompanies.slice(0, 200).map((c) => {
                    const supplier = c.relationships.filter(r => r.type === 'supplier').length;
                    const customer = c.relationships.filter(r => r.type === 'customer').length;
                    const partner = c.relationships.filter(r => r.type === 'partner').length;
                    const competitor = c.relationships.filter(r => r.type === 'competitor').length;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedCompany(c)}
                        className="border-b border-cf-border/30 hover:bg-cf-accent/5 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-1.5">
                          <span
                            className="inline-block w-1 h-4 align-middle mr-2 rounded-sm"
                            style={{ backgroundColor: sectorColorMap[c.sector] || '#888' }}
                          />
                          <span className="font-bold text-cf-text-primary">{c.ticker}</span>
                        </td>
                        <td className="px-3 py-1.5 text-cf-text-primary max-w-[200px] truncate">{c.name}</td>
                        <td className="px-3 py-1.5 text-cf-text-secondary text-[11px]">{c.sector}</td>
                        <td className="px-3 py-1.5 text-right text-cf-text-secondary text-[11px]">{(mcLabel[capFor(c)] ?? capFor(c)).slice(0, 4)}</td>
                        <td className="px-3 py-1.5 text-center text-blue-600 tabular-nums">{supplier || '·'}</td>
                        <td className="px-3 py-1.5 text-center text-emerald-600 tabular-nums">{customer || '·'}</td>
                        <td className="px-3 py-1.5 text-center text-amber-600 tabular-nums">{partner || '·'}</td>
                        <td className="px-3 py-1.5 text-center text-red-600 tabular-nums">{competitor || '·'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredCompanies.length > 200 && (
              <div className="px-3 py-2 text-[11px] text-cf-text-secondary bg-gray-50 border-t border-cf-border">
                {t('topNlimit', { n: 200, total: filteredCompanies.length })}
              </div>
            )}
            {filteredCompanies.length === 0 && (
              <div className="p-8 text-center text-cf-text-secondary text-sm">{t('noCompaniesMatch')}</div>
            )}
          </div>
        </div>
      )}

      {/* Graph view (legacy network view, hidden by default) */}
      {viewMode === 'graph' && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div ref={containerRef} className="cf-card relative overflow-hidden" style={{ height: '600px' }}>
          {mounted && graphData.nodes.length > 0 ? (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              nodeLabel={(node: Record<string, unknown>) =>
                `${node.name as string} (${node.ticker as string})`
              }
              nodeColor={(node: Record<string, unknown>) => node.color as string}
              nodeVal={(node: Record<string, unknown>) => node.val as number}
              linkColor={(link: Record<string, unknown>) => link.color as string}
              linkWidth={3}
              linkDirectionalParticles={2}
              linkDirectionalParticleSpeed={0.004}
              linkDirectionalParticleWidth={3}
              d3AlphaDecay={0.05}
              d3VelocityDecay={0.4}
              warmupTicks={50}
              onNodeClick={handleNodeClick}
              onEngineStop={() => {
                if (graphRef.current) graphRef.current.zoomToFit(400, 40);
              }}
              nodeCanvasObject={(
                node: Record<string, unknown>,
                ctx: CanvasRenderingContext2D,
                globalScale: number
              ) => {
                const x = node.x as number;
                const y = node.y as number;
                const val = (node.val as number) ?? 6;
                const color = (node.color as string) || '#888';
                const label = (node.ticker as string) || '';
                const r = Math.sqrt(val) * 4;

                // Outer glow
                ctx.beginPath();
                ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
                ctx.fillStyle = color + '20';
                ctx.fill();

                // Main circle
                ctx.beginPath();
                ctx.arc(x, y, r, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();

                // Border
                ctx.strokeStyle = color + '80';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Label
                const fontSize = Math.max(12 / globalScale, 4);
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#fff';
                ctx.fillText(label, x, y);
              }}
              linkCanvasObject={(
                link: Record<string, unknown>,
                ctx: CanvasRenderingContext2D
              ) => {
                const source = link.source as Record<string, unknown>;
                const target = link.target as Record<string, unknown>;
                if (!source || !target) return;
                const sx = source.x as number;
                const sy = source.y as number;
                const tx = target.x as number;
                const ty = target.y as number;
                const color = (link.color as string) || '#ccc';

                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(tx, ty);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.globalAlpha = 0.7;
                ctx.stroke();
                ctx.globalAlpha = 1;
              }}
              backgroundColor="transparent"
              cooldownTicks={60}
              width={containerWidth}
              height={600}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-cf-text-secondary">
                {mounted ? t('noCompaniesMatch') : t('loadingGraph')}
              </p>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-2">
            <button
              onClick={handleZoomIn}
              className="w-8 h-8 rounded-lg bg-white shadow-md flex items-center justify-center hover:bg-gray-50"
              title="Zoom controls available via mouse wheel"
            >
              <ZoomIn className="w-4 h-4 text-cf-text-secondary" />
            </button>
            <button
              onClick={() => graphRef.current?.zoomToFit(400)}
              className="w-8 h-8 rounded-lg bg-white shadow-md flex items-center justify-center hover:bg-gray-50"
              title="Fit to view"
            >
              <ZoomOut className="w-4 h-4 text-cf-text-secondary" />
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Company list below graph for mobile */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <h2 className="text-lg font-heading font-bold text-cf-text-primary mb-4">
          {t('companiesCount', { count: filteredCompanies.length })}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredCompanies.map((c) => (
            <Link
              key={c.id}
              href={`/company/${c.ticker}`}
              className="cf-card p-4 group hover:shadow-lg transition-all flex items-center gap-3"
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
                style={{ backgroundColor: sectorColorMap[c.sector] || '#888' }}
              >
                {c.ticker.slice(0, 3)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-cf-text-primary truncate group-hover:text-cf-primary transition-colors">
                  {c.name}
                </p>
                <p className="text-xs text-cf-text-secondary">
                  {c.ticker} &middot; {mcLabel[capFor(c)] ?? capFor(c)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Side panel */}
      {selectedCompany && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
            onClick={() => setSelectedCompany(null)}
          />
          <SidePanel
            company={selectedCompany}
            onClose={() => setSelectedCompany(null)}
            liveBand={liveBands[selectedCompany.ticker]}
          />
        </>
      )}
    </div>
  );
}

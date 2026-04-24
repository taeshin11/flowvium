'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, AlertCircle, Info, RefreshCw, Trash2, Lock, Server, CheckCircle2, XCircle, Activity, PlayCircle } from 'lucide-react';

interface LogEntry {
  t: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  event: string;
  message?: string;
  status?: number;
  durationMs?: number;
  data?: Record<string, unknown>;
  error?: string;
}

interface BySource {
  total: number;
  errors: number;
  warns: number;
  lastSeen: string;
}

interface HealthPayload {
  deploy: {
    commit: string;
    branch: string | null;
    deploymentId: string | null;
    region: string | null;
    env: string;
    nodeVersion: string;
  };
  redis: {
    configured: boolean;
    trackedCaches: Record<string, { exists: boolean; size?: number; error?: string }>;
    populatedCount: number;
    missingCount: number;
  };
  paidApis: Record<string, boolean>;
  logs: { bufferCount: number; errorCount: number; warnCount: number };
  checkedAt: string;
  checkDurationMs: number;
}

interface MetricItem {
  key: string;
  label: string;
  group: string;
  // 'skipped' = intentionally optional/unreachable (예: 로컬 vLLM 터널, 미설정 유료 Gemini 키).
  // overallStatus 영향 없음. 회색으로 렌더.
  status: 'ok' | 'degraded' | 'error' | 'skipped';
  value?: number | string | null;
  source?: string;
  details?: Record<string, unknown>;
  lastError?: string;
  skipReason?: string;
}

interface MetricsSnapshot {
  checkedAt: string;
  durationMs: number;
  overallStatus: 'healthy' | 'degraded' | 'error';
  summary: { ok: number; degraded: number; error: number; skipped?: number; total: number };
  items: MetricItem[];
}

const LEVEL_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  error: { bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-400', icon: <AlertCircle className="w-3.5 h-3.5" /> },
  warn:  { bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-400', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  info:  { bg: 'bg-blue-500/10 border-blue-500/30', text: 'text-blue-400', icon: <Info className="w-3.5 h-3.5" /> },
  debug: { bg: 'bg-white/5 border-white/10', text: 'text-cf-text-secondary', icon: <Info className="w-3.5 h-3.5" /> },
};

function fmtTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mn}:${ss}`;
}

export default function AdminLogsPage() {
  // Secret is kept only in localStorage — never committed or sent anywhere but the admin API
  const [secret, setSecret] = useState<string>('');
  const [secretInput, setSecretInput] = useState<string>('');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [bySource, setBySource] = useState<Record<string, BySource>>({});
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [metricsGroupFilter, setMetricsGroupFilter] = useState<string>('');
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('flowvium_admin_secret') : null;
    if (saved) setSecret(saved);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!secret) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (levelFilter) params.set('level', levelFilter);
      if (sourceFilter) params.set('source', sourceFilter);
      const headers = { 'x-admin-secret': secret };
      const [logRes, healthRes, metricsRes] = await Promise.all([
        fetch(`/api/admin/logs?${params.toString()}`, { headers, signal }),
        fetch(`/api/admin/health`, { headers, signal }),
        fetch(`/api/admin/metrics-health`, { headers, signal }),
      ]);
      if (signal?.aborted) return;
      if (logRes.status === 401) { setError('Unauthorized — check CRON_SECRET'); setEntries([]); return; }
      if (!logRes.ok) { setError(`HTTP ${logRes.status}`); return; }
      const data = await logRes.json();
      setEntries(data.entries ?? []);
      setBySource(data.bySource ?? {});
      if (healthRes.ok) setHealth(await healthRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
      else if (metricsRes.status === 404) setMetrics(null);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [secret, levelFilter, sourceFilter]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const saveSecret = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem('flowvium_admin_secret', secretInput);
    setSecret(secretInput);
  };

  const clearBuffer = async () => {
    if (!secret || !confirm('Clear all log entries?')) return;
    await fetch('/api/admin/logs', { method: 'DELETE', headers: { 'x-admin-secret': secret } });
    load();
  };

  const runVerifyNow = async () => {
    if (!secret) return;
    setVerifying(true);
    try {
      // 즉시 한 번 실행 (크론 주기 기다리지 않고) — 다음 30분 크론이 다시 갱신
      const res = await fetch('/api/cron/verify-metrics', {
        headers: { 'x-admin-secret': secret },
      });
      if (res.ok) setMetrics(await res.json());
      else setError(`Verify failed: HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verify failed');
    } finally {
      setVerifying(false);
    }
  };

  // ── Gate by secret ──────────────────────────────────────────────────────
  if (!secret) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-md">
        <div className="cf-card p-6">
          <div className="flex items-center gap-2 mb-4 text-cf-text-primary">
            <Lock className="w-5 h-5" /><h1 className="text-lg font-bold">Admin Logs</h1>
          </div>
          <p className="text-xs text-cf-text-secondary mb-4 leading-relaxed">
            Enter the CRON_SECRET environment variable to access. The value is kept in localStorage and only sent to <code>/api/admin/logs</code>.
          </p>
          <input
            type="password"
            value={secretInput}
            onChange={e => setSecretInput(e.target.value)}
            placeholder="CRON_SECRET"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-cf-text-primary mb-3"
            onKeyDown={e => e.key === 'Enter' && saveSecret()}
          />
          <button
            onClick={saveSecret}
            disabled={!secretInput}
            className="w-full bg-cf-accent/20 hover:bg-cf-accent/30 border border-cf-accent text-cf-accent text-sm font-semibold py-2 rounded-lg disabled:opacity-40"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  const sources = Object.entries(bySource).sort((a, b) => b[1].errors - a[1].errors || b[1].total - a[1].total);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cf-text-primary flex items-center gap-2">
            <AlertCircle className="w-6 h-6 text-red-400" />
            Admin · Logs
          </h1>
          <p className="text-sm text-cf-text-secondary mt-1">
            Recent warn/error events from Redis buffer · sorted newest first
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={clearBuffer}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="cf-card p-3 mb-4 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Health — deploy + caches + paid APIs */}
      {health && (
        <div className="cf-card p-4 mb-4 bg-gradient-to-br from-emerald-500/5 to-transparent border border-emerald-500/20">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-cf-text-primary flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" /> Deploy & Health
            </p>
            <span className="text-[10px] text-cf-text-secondary">probed {health.checkDurationMs}ms</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px] mb-3">
            <div>
              <p className="text-cf-text-secondary">Commit</p>
              <p className="font-mono text-cf-text-primary text-xs">{health.deploy.commit}</p>
              {health.deploy.branch && <p className="text-cf-text-secondary/60 font-mono">{health.deploy.branch}</p>}
            </div>
            <div>
              <p className="text-cf-text-secondary">Env · Region</p>
              <p className="font-mono text-cf-text-primary text-xs">{health.deploy.env}</p>
              <p className="text-cf-text-secondary/60 font-mono">{health.deploy.region ?? 'local'}</p>
            </div>
            <div>
              <p className="text-cf-text-secondary">Caches populated</p>
              <p className={`font-mono text-xs ${health.redis.missingCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {health.redis.populatedCount} / {health.redis.populatedCount + health.redis.missingCount}
              </p>
              {health.redis.missingCount > 0 && <p className="text-cf-text-secondary/60">{health.redis.missingCount} missing</p>}
            </div>
            <div>
              <p className="text-cf-text-secondary">Log buffer</p>
              <p className="font-mono text-xs text-cf-text-primary">{health.logs.bufferCount}</p>
              {(health.logs.errorCount > 0 || health.logs.warnCount > 0) && (
                <p className="text-[10px]">
                  {health.logs.errorCount > 0 && <span className="text-red-400">✕{health.logs.errorCount}</span>}
                  {health.logs.errorCount > 0 && health.logs.warnCount > 0 && ' '}
                  {health.logs.warnCount > 0 && <span className="text-amber-400">⚠{health.logs.warnCount}</span>}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {Object.entries(health.paidApis).map(([api, ok]) => (
              <span key={api} className={`text-[10px] px-2 py-0.5 rounded-md border flex items-center gap-1 ${ok ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' : 'bg-white/5 border-white/10 text-cf-text-secondary'}`}>
                {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {api}
              </span>
            ))}
          </div>
          <details className="text-[10px]">
            <summary className="cursor-pointer text-cf-text-secondary hover:text-cf-text-primary">Cache key detail ({Object.keys(health.redis.trackedCaches).length})</summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {Object.entries(health.redis.trackedCaches).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2 font-mono">
                  <span className={v.exists ? 'text-cf-text-primary' : 'text-cf-text-secondary/50'}>{k}</span>
                  <span className={v.exists ? 'text-emerald-400' : 'text-red-400'}>
                    {v.exists ? `${Math.round((v.size ?? 0) / 1024)}KB` : 'empty'}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Metrics Status — 주기적 verify-metrics 크론이 기록한 개별 수치 헬스 */}
      <div className="cf-card p-4 mb-4 bg-gradient-to-br from-blue-500/5 to-transparent border border-blue-500/20">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-xs font-bold text-cf-text-primary flex items-center gap-2">
            <Activity className={`w-4 h-4 ${metrics?.overallStatus === 'error' ? 'text-red-400' : metrics?.overallStatus === 'degraded' ? 'text-amber-400' : 'text-emerald-400'}`} />
            Metrics Status {metrics && <span className="text-[10px] text-cf-text-secondary">· {fmtTime(metrics.checkedAt)} · {metrics.durationMs}ms</span>}
          </p>
          <button
            onClick={runVerifyNow}
            disabled={verifying}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-40"
            title="크론 30분 기다리지 않고 즉시 재검증"
          >
            <PlayCircle className={`w-3 h-3 ${verifying ? 'animate-spin' : ''}`} />
            {verifying ? 'Verifying…' : 'Verify now'}
          </button>
        </div>
        {!metrics ? (
          <p className="text-[11px] text-cf-text-secondary">크론 스냅샷 없음 · "Verify now"로 즉시 실행 가능 (30분마다 자동 실행 예정)</p>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-2 mb-3 text-[10px]">
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-2">
                <p className="text-cf-text-secondary">정상</p>
                <p className="font-mono text-base text-emerald-400">{metrics.summary.ok}</p>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-md p-2">
                <p className="text-cf-text-secondary">Degraded</p>
                <p className="font-mono text-base text-amber-400">{metrics.summary.degraded}</p>
              </div>
              <div className="bg-red-500/5 border border-red-500/20 rounded-md p-2">
                <p className="text-cf-text-secondary">Error</p>
                <p className="font-mono text-base text-red-400">{metrics.summary.error}</p>
              </div>
              <div className="bg-white/5 border border-white/15 rounded-md p-2" title="의도적으로 비활성: optional cascade stage / 미설정 유료 키">
                <p className="text-cf-text-secondary">Skipped</p>
                <p className="font-mono text-base text-cf-text-secondary">{metrics.summary.skipped ?? 0}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-md p-2">
                <p className="text-cf-text-secondary">전체</p>
                <p className="font-mono text-base text-cf-text-primary">{metrics.summary.total}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button
                onClick={() => setMetricsGroupFilter('')}
                className={`text-[10px] px-2 py-0.5 rounded-md border ${metricsGroupFilter === '' ? 'bg-blue-500/20 border-blue-500/40 text-blue-300' : 'bg-white/5 border-white/10 text-cf-text-secondary'}`}
              >
                all
              </button>
              {Array.from(new Set(metrics.items.map(i => i.group))).map(g => {
                const groupItems = metrics.items.filter(i => i.group === g);
                const nErr = groupItems.filter(i => i.status === 'error').length;
                const nDeg = groupItems.filter(i => i.status === 'degraded').length;
                const nSkip = groupItems.filter(i => i.status === 'skipped').length;
                return (
                  <button
                    key={g}
                    onClick={() => setMetricsGroupFilter(g)}
                    className={`text-[10px] px-2 py-0.5 rounded-md border font-mono ${metricsGroupFilter === g ? 'bg-blue-500/20 border-blue-500/40 text-blue-300' : nErr > 0 ? 'bg-red-500/5 border-red-500/20 text-red-400' : nDeg > 0 ? 'bg-amber-500/5 border-amber-500/20 text-amber-400' : 'bg-white/5 border-white/10 text-cf-text-secondary'}`}
                  >
                    {g} · {groupItems.length}
                    {nErr > 0 && <span className="ml-1 text-red-400">✕{nErr}</span>}
                    {nDeg > 0 && <span className="ml-1 text-amber-400">⚠{nDeg}</span>}
                    {nSkip > 0 && <span className="ml-1 text-cf-text-secondary">◌{nSkip}</span>}
                  </button>
                );
              })}
            </div>
            <details className="text-[10px]" open={metrics.summary.error > 0 || metrics.summary.degraded > 0}>
              <summary className="cursor-pointer text-cf-text-secondary hover:text-cf-text-primary">
                개별 지표 ({metrics.items.filter(i => !metricsGroupFilter || i.group === metricsGroupFilter).length}개 표시)
              </summary>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 max-h-96 overflow-y-auto">
                {metrics.items
                  .filter(i => !metricsGroupFilter || i.group === metricsGroupFilter)
                  .sort((a, b) => {
                    const order = { error: 0, degraded: 1, ok: 2, skipped: 3 } as const;
                    return order[a.status] - order[b.status];
                  })
                  .map(item => (
                    <div
                      key={item.key}
                      className={`flex items-center justify-between gap-2 px-2 py-1 rounded border ${
                        item.status === 'error' ? 'bg-red-500/5 border-red-500/20' :
                        item.status === 'degraded' ? 'bg-amber-500/5 border-amber-500/20' :
                        item.status === 'skipped' ? 'bg-white/5 border-white/15 opacity-60' :
                        'bg-emerald-500/5 border-emerald-500/10'
                      }`}
                      title={item.skipReason ?? item.lastError ?? (item.details ? JSON.stringify(item.details) : '')}
                    >
                      <span className="truncate text-cf-text-primary">{item.label}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {item.value != null && (
                          <span className="font-mono text-cf-text-secondary">{typeof item.value === 'number' ? Math.round(item.value) : String(item.value).slice(0, 20)}</span>
                        )}
                        {item.source && (
                          <span className="text-[9px] text-cf-text-secondary/70 font-mono">{item.source}</span>
                        )}
                        <span className={
                          item.status === 'error' ? 'text-red-400' :
                          item.status === 'degraded' ? 'text-amber-400' :
                          item.status === 'skipped' ? 'text-cf-text-secondary' :
                          'text-emerald-400'
                        }>
                          {item.status === 'error' ? '✕' : item.status === 'degraded' ? '⚠' : item.status === 'skipped' ? '◌' : '✓'}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </details>
          </>
        )}
      </div>

      {/* Source summary */}
      {sources.length > 0 && (
        <div className="cf-card p-3 mb-4">
          <p className="text-[11px] text-cf-text-secondary mb-2 font-bold">By source (click to filter)</p>
          <div className="flex flex-wrap gap-1.5">
            {sources.map(([src, s]) => (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                className={`text-[10px] px-2 py-1 rounded-md border ${s.errors > 0 ? 'bg-red-500/5 border-red-500/20 text-red-400' : s.warns > 0 ? 'bg-amber-500/5 border-amber-500/20 text-amber-400' : 'bg-white/5 border-white/10 text-cf-text-secondary'} hover:bg-white/10`}
              >
                <span className="font-mono">{src}</span>
                <span className="ml-1.5 opacity-70">· {s.total}</span>
                {s.errors > 0 && <span className="ml-1 text-red-400">✕{s.errors}</span>}
                {s.warns > 0 && <span className="ml-1 text-amber-400">⚠{s.warns}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs text-cf-text-primary">
          <option value="">All levels</option>
          <option value="error">Errors only</option>
          <option value="warn">Warnings only</option>
          <option value="info">Info only</option>
        </select>
        <input
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          placeholder="Filter by source (e.g. yahoo)"
          className="flex-1 max-w-xs bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs text-cf-text-primary placeholder:text-cf-text-secondary/50"
        />
        {(levelFilter || sourceFilter) && (
          <button onClick={() => { setLevelFilter(''); setSourceFilter(''); }}
            className="text-xs text-cf-text-secondary hover:text-cf-text-primary">
            Clear filters
          </button>
        )}
        <span className="text-xs text-cf-text-secondary self-center ml-auto">{entries.length} entries</span>
      </div>

      {/* Entries */}
      <div className="space-y-1.5">
        {entries.map((e, i) => {
          const s = LEVEL_STYLES[e.level] ?? LEVEL_STYLES.info;
          return (
            <div key={i} className={`cf-card px-3 py-2 border ${s.bg} font-mono text-[11px]`}>
              <div className="flex items-start gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 font-bold ${s.text} w-14 shrink-0`}>
                  {s.icon}{e.level.toUpperCase()}
                </span>
                <span className="text-cf-text-secondary shrink-0">{fmtTime(e.t)}</span>
                <span className="text-cf-accent font-semibold">{e.source}</span>
                <span className="text-cf-text-primary">{e.event}</span>
                {e.status != null && <span className="text-cf-text-secondary">status={e.status}</span>}
                {e.durationMs != null && <span className="text-cf-text-secondary">{e.durationMs}ms</span>}
                {e.message && <span className="text-cf-text-secondary">· {e.message}</span>}
              </div>
              {e.error && (
                <pre className="mt-1 text-red-300/80 text-[10px] whitespace-pre-wrap break-all">{e.error}</pre>
              )}
              {e.data && Object.keys(e.data).length > 0 && (
                <pre className="mt-1 text-cf-text-secondary/80 text-[10px] whitespace-pre-wrap break-all">{JSON.stringify(e.data, null, 0)}</pre>
              )}
            </div>
          );
        })}
        {!loading && entries.length === 0 && (
          <div className="cf-card p-8 text-center text-sm text-cf-text-secondary">
            No log entries. If you just deployed, try hitting <code>/api/insider-trades?refresh=1</code> first.
          </div>
        )}
      </div>

      <p className="text-[10px] text-cf-text-secondary/40 mt-4">
        Redis buffer holds up to 500 most-recent warn+error entries. Full stream is in Vercel dashboard logs.
      </p>
    </div>
  );
}

/**
 * src/lib/logger.ts
 *
 * Structured logger used across all server code. Purposes:
 *   1. Emit single-line JSON to stdout so Vercel's log dashboard shows a
 *      searchable/filterable stream (Vercel captures console.log/error).
 *   2. Push warn/error entries to a capped Redis list so the in-app
 *      /admin/errors page can surface recent failures without requiring
 *      Vercel dashboard access.
 *   3. Auto-time external fetches via `logger.time()` so slow calls get
 *      flagged with duration.
 *
 * Design choices:
 *   - Source tags are dotted strings (e.g. `yahoo.crumb`, `edgar.form4`,
 *     `api.insider-trades`) to group by subsystem.
 *   - `event` is a short slug so logs are grep-friendly (`fetch_failed`,
 *     `parse_ok`, `cache_hit`, `rate_limited`).
 *   - Errors are NEVER swallowed silently — every caller that used to
 *     `catch {}` should now call `logger.error(source, event, err)` before
 *     returning the fallback.
 */

import { Redis } from '@upstash/redis';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  t: string;                 // ISO timestamp
  level: LogLevel;
  source: string;            // dotted subsystem tag
  event: string;             // slug ("fetch_failed", etc.)
  message?: string;
  status?: number;           // HTTP status if applicable
  durationMs?: number;
  data?: Record<string, unknown>;
  error?: string;            // error message (stack truncated)
}

const REDIS_KEY = 'flowvium:log:recent';
const REDIS_MAX = 500;

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Serialise errors (any kind) to a clean message string. */
function toErrorMessage(err: unknown): string {
  if (err == null) return '';
  if (err instanceof Error) {
    const name = err.name || 'Error';
    const msg = err.message || '';
    // Keep stack top frame if available (helps pinpoint source file)
    const stack = err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : '';
    return `${name}: ${msg}${stack ? ' @ ' + stack : ''}`.slice(0, 800);
  }
  if (typeof err === 'string') return err.slice(0, 800);
  try { return JSON.stringify(err).slice(0, 800); } catch { return String(err).slice(0, 800); }
}

/** Emit the entry: always to console, and to Redis for warn/error. */
async function emit(entry: LogEntry): Promise<void> {
  // Console: one line JSON (Vercel captures this)
  const line = JSON.stringify(entry);
  if (entry.level === 'error') console.error(line);
  else if (entry.level === 'warn') console.warn(line);
  else console.log(line);

  // Redis: only persist warn/error (avoid filling up with info noise)
  if (entry.level === 'warn' || entry.level === 'error') {
    const r = redis();
    if (!r) return;
    try {
      await r.lpush(REDIS_KEY, JSON.stringify(entry));
      await r.ltrim(REDIS_KEY, 0, REDIS_MAX - 1);
    } catch {
      // Intentionally silent — can't log an error about the error logger
      // failing. The console line above still went through.
    }
  }
}

function makeEntry(level: LogLevel, source: string, event: string, data?: unknown): LogEntry {
  const entry: LogEntry = {
    t: new Date().toISOString(),
    level,
    source,
    event,
  };
  if (data == null) return entry;
  if (data instanceof Error) {
    entry.error = toErrorMessage(data);
    return entry;
  }
  if (typeof data === 'string') {
    entry.message = data;
    return entry;
  }
  if (typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    if (rec.error != null) {
      entry.error = toErrorMessage(rec.error);
    }
    if (typeof rec.message === 'string') entry.message = rec.message;
    if (typeof rec.status === 'number') entry.status = rec.status;
    if (typeof rec.durationMs === 'number') entry.durationMs = rec.durationMs;
    // Stash remaining fields into data
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (['error', 'message', 'status', 'durationMs'].includes(k)) continue;
      rest[k] = v;
    }
    if (Object.keys(rest).length > 0) entry.data = rest;
    return entry;
  }
  entry.data = { value: data };
  return entry;
}

export const logger = {
  debug(source: string, event: string, data?: unknown) {
    emit(makeEntry('debug', source, event, data));
  },
  info(source: string, event: string, data?: unknown) {
    emit(makeEntry('info', source, event, data));
  },
  warn(source: string, event: string, data?: unknown) {
    emit(makeEntry('warn', source, event, data));
  },
  error(source: string, event: string, data?: unknown) {
    emit(makeEntry('error', source, event, data));
  },

  /**
   * Wrap an async operation with automatic timing + success/failure logging.
   * Logs `event_start` at debug, and `event` at info/error with durationMs.
   */
  async time<T>(source: string, event: string, fn: () => Promise<T>, extra?: Record<string, unknown>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;
      emit(makeEntry('info', source, event, { ...(extra ?? {}), durationMs, ok: true }));
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      emit(makeEntry('error', source, event, { ...(extra ?? {}), durationMs, ok: false, error: err }));
      throw err;
    }
  },

  /** Same as time() but never re-throws — returns fallback on error.
   *  Use when the existing behaviour was `catch { return fallback; }`. */
  async timeSafe<T>(source: string, event: string, fn: () => Promise<T>, fallback: T, extra?: Record<string, unknown>): Promise<T> {
    try { return await this.time(source, event, fn, extra); }
    catch { return fallback; }
  },
};

// ── Write-operation wrappers ──────────────────────────────────────────────────
// These exist so every storage/IO/API call gets uniform start/end/error logs
// without each caller having to repeat the pattern. Use them instead of raw
// redis.set / redis.lpush / fetch whenever the outcome matters for debugging.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisLike = any;  // Upstash Redis has a complex SetCommandOptions union we don't need to reproduce

/** Redis SET with structured logging. Returns true on success. */
export async function loggedRedisSet(
  redis: RedisLike | null,
  source: string,
  key: string,
  value: unknown,
  opts?: { ex?: number },
): Promise<boolean> {
  if (!redis) {
    logger.debug(source, 'cache_write_skipped', { key, reason: 'no_redis' });
    return false;
  }
  const start = Date.now();
  try {
    await redis.set(key, value, opts);
    const size = (() => { try { return JSON.stringify(value).length; } catch { return -1; } })();
    logger.info(source, 'cache_write', { key, ttl: opts?.ex, size, durationMs: Date.now() - start });
    return true;
  } catch (err) {
    logger.error(source, 'cache_write_failed', { key, ttl: opts?.ex, error: err, durationMs: Date.now() - start });
    return false;
  }
}

/** Redis LPUSH + LTRIM (queue-style) with structured logging. */
export async function loggedRedisLpushTrim(
  redis: RedisLike | null,
  source: string,
  key: string,
  value: unknown,
  capAt: number,
): Promise<boolean> {
  if (!redis) return false;
  const start = Date.now();
  try {
    await redis.lpush(key, JSON.stringify(value));
    await redis.ltrim(key, 0, capAt - 1);
    logger.debug(source, 'list_push', { key, cap: capAt, durationMs: Date.now() - start });
    return true;
  } catch (err) {
    logger.error(source, 'list_push_failed', { key, error: err, durationMs: Date.now() - start });
    return false;
  }
}

/** Redis SET NX (distributed lock) with structured logging.
 *  Use this instead of bare redis.set(..., { nx, ex }) so lock acquisitions are observable. */
export async function loggedRedisSetNx(
  redis: RedisLike | null,
  source: string,
  key: string,
  value: string,
  ex: number,
): Promise<boolean> {
  if (!redis) return false;
  const start = Date.now();
  try {
    const acquired = await redis.set(key, value, { nx: true, ex }); // allow: lock primitive
    logger.debug(source, acquired ? 'lock_acquired' : 'lock_contended', { key, ex, durationMs: Date.now() - start });
    return !!acquired;
  } catch (err) {
    logger.error(source, 'lock_failed', { key, error: err, durationMs: Date.now() - start });
    return false;
  }
}

/** Redis DEL with structured logging. */
export async function loggedRedisDel(
  redis: RedisLike | null,
  source: string,
  keys: string[],
): Promise<boolean> {
  if (!redis || keys.length === 0) return false;
  const start = Date.now();
  try {
    await redis.del(...keys);
    logger.info(source, 'cache_delete', { keys, durationMs: Date.now() - start });
    return true;
  } catch (err) {
    logger.error(source, 'cache_delete_failed', { keys, error: err, durationMs: Date.now() - start });
    return false;
  }
}

/**
 * fetch() wrapper that always logs the HTTP outcome.
 *   success (2xx) → info
 *   4xx/5xx       → warn with status
 *   thrown        → error
 * Returns the Response on reachability (even if non-2xx) or null on exception.
 */
export async function loggedFetch(
  source: string,
  event: string,
  url: string,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response | null> {
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const dur = Date.now() - start;
    if (res.ok) logger.info(source, event, { url: safeUrl(url), status: res.status, durationMs: dur });
    else        logger.warn(source, event + '_http_error', { url: safeUrl(url), status: res.status, durationMs: dur });
    return res;
  } catch (err) {
    logger.error(source, event + '_failed', { url: safeUrl(url), error: err, durationMs: Date.now() - start });
    return null;
  }
}

/** Strip API keys / auth tokens from URL before logging. */
function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ['apiKey', 'api_key', 'token', 'crumb', 'x-api-key']) {
      if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED');
    }
    // Truncate long query strings
    const full = u.toString();
    return full.length > 200 ? full.slice(0, 200) + '…' : full;
  } catch {
    return url.length > 200 ? url.slice(0, 200) + '…' : url;
  }
}

// ── Boot-time deploy marker ───────────────────────────────────────────────────
// Fires once per lambda cold-start so /admin/logs shows deployment lineage
// (useful for "which commit is actually live right now" debugging).
let booted = false;
export function logBoot() {
  if (booted) return;
  booted = true;
  logger.info('boot', 'cold_start', {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? 'local',
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'n/a',
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? 'n/a',
    region: process.env.VERCEL_REGION ?? 'n/a',
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    nodeVersion: process.version,
  });
}
// Fire on module load
logBoot();

// ── Admin viewer helpers ──────────────────────────────────────────────────────

/** Fetch recent log entries (newest first). Returns [] if Redis is absent. */
export async function getRecentLogs(limit = 200, levelFilter?: LogLevel): Promise<LogEntry[]> {
  const r = redis();
  if (!r) return [];
  try {
    const raw = await r.lrange(REDIS_KEY, 0, limit - 1);
    const entries = raw
      .map((v: unknown) => {
        if (typeof v === 'string') {
          try { return JSON.parse(v) as LogEntry; } catch { return null; }
        }
        // Upstash sometimes pre-deserialises JSON
        return v as LogEntry;
      })
      .filter((e): e is LogEntry => !!e);
    return levelFilter ? entries.filter(e => e.level === levelFilter) : entries;
  } catch {
    return [];
  }
}

/** Clear the error buffer (admin action). */
export async function clearLogs(): Promise<void> {
  const r = redis();
  if (!r) return;
  try { await r.del(REDIS_KEY); } catch { /* non-fatal */ }
}

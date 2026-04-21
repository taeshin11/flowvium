/**
 * Shared module-level in-memory cache for API routes.
 *
 * Purpose: Persists across requests while a serverless function instance
 * stays warm (typically several minutes). Used as a fallback when Upstash
 * Redis env vars (UPSTASH_REDIS_REST_URL/TOKEN) are unset, so endpoints
 * still get sub-request caching instead of re-fetching upstream every call.
 *
 * Scope: per function-instance, per route (keyed). Not shared between
 * different Lambda invocations / cold starts. For durable cross-request
 * cache, configure Upstash.
 *
 * Usage:
 *   const cache = createMemoryCache<MyPayload>('my-route', 10 * 60_000);
 *   const cached = cache.get(key);
 *   if (cached) return cached;
 *   const fresh = await fetchData();
 *   cache.set(key, fresh);
 */
import { logger } from '@/lib/logger';

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface MemoryCache<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): void;
  size(): number;
}

export function createMemoryCache<T>(namespace: string, ttlMs: number): MemoryCache<T> {
  const store = new Map<string, MemoryCacheEntry<T>>();

  // Cap size to prevent unbounded growth on pathological instances.
  const MAX_ENTRIES = 50;

  return {
    get(key: string): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      logger.info(`cache.${namespace}`, 'memory_hit', { key, ageMs: Date.now() - (entry.expiresAt - ttlMs) });
      return entry.value;
    },
    set(key: string, value: T): void {
      if (store.size >= MAX_ENTRIES) {
        // Evict oldest (FIFO — simple, no LRU tracking overhead)
        const firstKey = store.keys().next().value;
        if (firstKey) store.delete(firstKey);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    has(key: string): boolean {
      const entry = store.get(key);
      return !!entry && entry.expiresAt > Date.now();
    },
    delete(key: string): void {
      store.delete(key);
    },
    size(): number {
      return store.size;
    },
  };
}

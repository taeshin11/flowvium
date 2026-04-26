import { Redis } from '@upstash/redis';

let _instance: Redis | null | undefined;

export function createRedis(): Redis | null {
  if (_instance !== undefined) return _instance;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  _instance = url && token ? new Redis({ url, token }) : null;
  return _instance;
}

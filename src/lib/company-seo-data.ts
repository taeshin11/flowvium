// company-seo-data.ts — 종목 풀·DART 이름표를 서버에서 한 번 읽는다(계산은 company-seo.mjs). 2026-11-07.
// 못 읽으면 빈 값 — 제목은 큐레이션 이름·티커로, 사이트맵은 큐레이션만으로 간다(종전과 같은 상태).
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { allCompanies } from '@/data/companies';

type Pool = { tickers?: string[]; meta?: Record<string, { name?: string }> };
let cache: { pool: Pool; dart: Record<string, { corpName?: string }>; curated: { ticker: string; name: string }[] } | null = null;

export function companySeoData() {
  if (cache) return cache;
  const read = (p: string) => { try { return JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8')); } catch { return null; } };
  cache = {
    pool: read('data/candidate-tickers.json') ?? {},
    dart: read('data/dart-corp-codes.json')?.map ?? {},
    curated: allCompanies.map((c) => ({ ticker: c.ticker, name: c.name })),
  };
  return cache;
}

/**
 * /api/institutional-refresh
 *
 * SEC EDGAR Submissions API에서 상위 5개 기관의 최신 13F-HR 제출 정보를 조회하여
 * Redis에 저장한다. update-all 크론에서 5월 15일 이후 호출 (Q1 2026 13F 공개 후).
 *
 * Redis key: flowvium:institutional:13f:latest:v1
 * TTL: 7일
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedFetch, loggedRedisSet } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_KEY = 'flowvium:institutional:13f:latest:v1';
const CACHE_TTL = 7 * 86400; // 7일

interface InstitutionConfig {
  name: string;
  cik: string;
}

const INSTITUTIONS: InstitutionConfig[] = [
  { name: 'Berkshire Hathaway', cik: '0001067983' },
  { name: 'Vanguard',           cik: '0000102909' },
  { name: 'BlackRock',          cik: '0001364742' },
  { name: 'State Street',       cik: '0000093751' },
  { name: 'Invesco',            cik: '0000049196' },
];

interface FilingResult {
  name: string;
  cik: string;
  accessionNumber: string | null;
  filingDate: string | null;
  primaryDocument: string | null;
  error?: string;
}

async function fetchLatest13F(inst: InstitutionConfig): Promise<FilingResult> {
  const url = `https://data.sec.gov/submissions/CIK${inst.cik}.json`;
  try {
    const res = await loggedFetch('institutional-refresh', 'edgar_fetch', url, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'FlowVium/1.0 (taeshinkim11@gmail.com)',
        'Accept-Encoding': 'gzip, deflate',
        'Accept': 'application/json',
      },
    }, 15000);

    if (!res) {
      return { ...inst, accessionNumber: null, filingDate: null, primaryDocument: null, error: 'fetch_null' };
    }
    if (!res.ok) {
      logger.warn('institutional-refresh', 'edgar_http_error', { cik: inst.cik, status: res.status });
      return { ...inst, accessionNumber: null, filingDate: null, primaryDocument: null, error: `HTTP ${res.status}` };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const recent = data?.filings?.recent;
    if (!recent) {
      return { ...inst, accessionNumber: null, filingDate: null, primaryDocument: null, error: 'no_filings' };
    }

    const forms: string[] = recent.form ?? [];
    const accessions: string[] = recent.accessionNumber ?? [];
    const dates: string[] = recent.filingDate ?? [];
    const docs: string[] = recent.primaryDocument ?? [];

    const idx = forms.findIndex((f: string) => f === '13F-HR');
    if (idx === -1) {
      return { ...inst, accessionNumber: null, filingDate: null, primaryDocument: null, error: 'no_13f_hr' };
    }

    return {
      name: inst.name,
      cik: inst.cik,
      accessionNumber: accessions[idx] ?? null,
      filingDate: dates[idx] ?? null,
      primaryDocument: docs[idx] ?? null,
    };
  } catch (err) {
    logger.error('institutional-refresh', 'fetch_error', { cik: inst.cik, error: err instanceof Error ? err.message : String(err) });
    return { ...inst, accessionNumber: null, filingDate: null, primaryDocument: null, error: 'fetch_failed' };
  }
}

export async function GET() {
  const redis = createRedis();
  const updatedAt = new Date().toISOString();

  const results = await Promise.all(INSTITUTIONS.map(fetchLatest13F));

  const payload = {
    updatedAt,
    institutions: results,
  };

  if (redis) {
    await loggedRedisSet(redis, 'api.institutional-refresh', CACHE_KEY, payload, { ex: CACHE_TTL });
    logger.info('institutional-refresh', 'saved_to_redis', { count: results.length, updatedAt });
  } else {
    logger.warn('institutional-refresh', 'no_redis', { updatedAt });
  }

  const successCount = results.filter(r => r.accessionNumber != null).length;

  return NextResponse.json({ ok: true, count: successCount, updatedAt });
}

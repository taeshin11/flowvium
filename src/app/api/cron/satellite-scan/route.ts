/**
 * /api/cron/satellite-scan  —  Sentinel-1 SAR 레이더 기반 공장 활동 분석
 *
 * Vision AI 추측 대신 레이더 후방산란(backscatter) 수치로 객관적 측정:
 *   - 구름 관통 (날씨 무관)
 *   - VV/VH 밴드 Statistics API → JSON 통계 직접 수신
 *   - 베이스라인 대비 dB 변화량 → 활동 점수 (추측 없음)
 *   - 건설: VH 채널 +2dB 이상 증가
 *   - 차량/구조물: VV 채널 증가
 *
 * Redis 키:
 *   flowvium:satellite:v1:{YYYY-MM-DD}         — 결과 배열 (48h TTL)
 *   flowvium:satellite:img:{id}                — SAR PNG base64 (7일 TTL)
 *   flowvium:satellite:sar-baseline:{id}       — 롤링 베이스라인 (90일 TTL)
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { FACTORY_LOCATIONS, type FactoryLocation } from '@/data/factory-locations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ── 인증 ─────────────────────────────────────────────────────────────────────
function checkAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get('x-admin-secret') === secret) return true;
  if (req.headers.get('user-agent')?.includes('vercel-cron')) return true;
  return false;
}

// ── Copernicus OAuth ──────────────────────────────────────────────────────────
const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getCopernicusToken(): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60000) return _tokenCache.token;
  const email = process.env.COPERNICUS_EMAIL?.trim();
  const password = process.env.COPERNICUS_PASSWORD?.trim();
  if (!email || !password) throw new Error('COPERNICUS_EMAIL/PASSWORD not set');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'cdse-public', username: email, password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Copernicus auth ${res.status}: ${(await res.text()).slice(0, 80)}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 30) * 1000 };
  return _tokenCache.token;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function getBbox(factory: FactoryLocation) {
  const m = factory.radiusKm / 111.32;
  return [factory.lng - m, factory.lat - m, factory.lng + m, factory.lat + m];
}

function toDb(linear: number) {
  return 10 * Math.log10(Math.max(linear, 1e-7));
}

// ── SAR evalscripts ───────────────────────────────────────────────────────────

// 표시용: false-color composite (Red=VV, Green=VH, Blue=VV/VH)
// 도심/공장 → 주황, 건설/식생 → 초록, 수면 → 파랑
const SAR_DISPLAY_EVALSCRIPT = `//VERSION=3
function setup(){return{input:[{bands:["VV","VH","dataMask"],units:"LINEAR_POWER"}],output:{bands:4}}}
function evaluatePixel(s){
  const vv=Math.sqrt(s.VV+1e-7);const vh=Math.sqrt(s.VH+1e-7);
  const ratio=Math.min(1,vv/Math.max(vh,0.001)/2.5);
  return[Math.min(1,vv*2.2),Math.min(1,vh*4),ratio,s.dataMask]
}`;

// 통계용: ORBIT mosaicking + median (복수 패스 합성 → speckle 감소)
const SAR_STATS_EVALSCRIPT = `//VERSION=3
function setup(){return{input:[{bands:["VV","VH","dataMask"],units:"LINEAR_POWER"}],mosaicking:"ORBIT",output:[{id:"VV",bands:1,sampleType:"FLOAT32"},{id:"VH",bands:1,sampleType:"FLOAT32"},{id:"dataMask",bands:1}]}}
function median(arr){if(arr.length===0)return 0;arr.sort(function(a,b){return a-b});return arr[Math.floor(arr.length/2)];}
function evaluatePixel(samples){var vv=[],vh=[];for(var i=0;i<samples.length;i++){if(samples[i].dataMask){vv.push(samples[i].VV);vh.push(samples[i].VH);}}var ok=vv.length>0?1:0;return{VV:[median(vv)],VH:[median(vh)],dataMask:[ok]};}`;

// ── SAR 표시 이미지 fetch ─────────────────────────────────────────────────────
async function fetchSARImage(factory: FactoryLocation, token: string): Promise<string | null> {
  const bbox = getBbox(factory);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10); // 최근 12일 내 최신
  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-1-grd', dataFilter: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        acquisitionMode: 'IW',
        polarization: 'DV',
        resolution: 'HIGH',
        mosaickingOrder: 'mostRecent',
      }}],
    },
    output: { width: 512, height: 512, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript: SAR_DISPLAY_EVALSCRIPT,
  };
  const res = await fetch(PROCESS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'image/png' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    logger.warn('cron.satellite-scan', 'sar_image_failed', { factory: factory.id, status: res.status, text: (await res.text()).slice(0, 80) });
    return null;
  }
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

// ── SAR 통계 fetch (핵심: Vision AI 대체) ────────────────────────────────────
interface SARStats {
  vv_mean: number;  // linear power
  vh_mean: number;
  vv_stdev: number;
  vh_stdev: number;
  sample_count: number;
}

async function fetchSARStats(factory: FactoryLocation, from: string, to: string, token: string): Promise<SARStats | null> {
  const bbox = getBbox(factory);
  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-1-grd', dataFilter: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        acquisitionMode: 'IW',
        polarization: 'DV',
        resolution: 'HIGH',
      }}],
    },
    aggregation: {
      timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
      aggregationInterval: { of: 'P12D' },
      evalscript: SAR_STATS_EVALSCRIPT,
      resx: 0.00018, resy: 0.00018, // 20m in WGS84 degrees (20 / 111320)
    },
    calculations: { default: {} },
  };
  const res = await fetch(STATS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    logger.warn('cron.satellite-scan', 'sar_stats_failed', { factory: factory.id, status: res.status, error: errText.slice(0, 100) });
    return null;
  }
  type StatsResp = {
    status?: string;
    data?: Array<{
      outputs?: {
        VV?: { bands?: { B0?: { stats?: { mean?: number; stDev?: number; sampleCount?: number } } } };
        VH?: { bands?: { B0?: { stats?: { mean?: number; stDev?: number; sampleCount?: number } } } };
      };
    }>;
  };
  const data = await res.json() as StatsResp;
  const vvS = data.data?.[0]?.outputs?.VV?.bands?.B0?.stats;
  const vhS = data.data?.[0]?.outputs?.VH?.bands?.B0?.stats;
  if (!vvS?.mean || !vhS?.mean || vvS.sampleCount === 0) {
    logger.warn('cron.satellite-scan', 'sar_stats_empty', { factory: factory.id, status: data.status, vvMean: vvS?.mean, sampleCount: vvS?.sampleCount });
    return null;
  }
  return {
    vv_mean: vvS.mean,
    vh_mean: vhS.mean,
    vv_stdev: vvS.stDev ?? 0,
    vh_stdev: vhS.stDev ?? 0,
    sample_count: vvS.sampleCount ?? 0,
  };
}

// ── 베이스라인 (롤링 평균) ────────────────────────────────────────────────────
interface SARBaseline {
  vv_mean: number;
  vh_mean: number;
  obs_count: number;
  dates: string[];
}

async function loadBaseline(factoryId: string, redis: NonNullable<ReturnType<typeof createRedis>>): Promise<SARBaseline | null> {
  try {
    const raw = await redis.get<string>(`flowvium:satellite:sar-baseline:${factoryId}`);
    return raw ? JSON.parse(raw) as SARBaseline : null;
  } catch { return null; }
}

async function updateBaseline(
  factoryId: string, current: SARStats, baseline: SARBaseline | null,
  redis: NonNullable<ReturnType<typeof createRedis>>, today: string,
): Promise<SARBaseline> {
  const prev = baseline ?? { vv_mean: 0, vh_mean: 0, obs_count: 0, dates: [] };
  const n = Number(prev.obs_count ?? 0);
  const prevDates = Array.isArray(prev.dates) ? prev.dates : [];
  const updated: SARBaseline = {
    vv_mean: n > 0 ? (Number(prev.vv_mean) * n + current.vv_mean) / (n + 1) : current.vv_mean,
    vh_mean: n > 0 ? (Number(prev.vh_mean) * n + current.vh_mean) / (n + 1) : current.vh_mean,
    obs_count: n + 1,
    dates: [...prevDates.slice(-14), today],
  };
  try {
    await redis.set(`flowvium:satellite:sar-baseline:${factoryId}`, JSON.stringify(updated), { ex: 7776000 });
  } catch (e) {
    logger.error('cron.satellite-scan', 'baseline_save_failed', { factory: factoryId, error: String(e) });
  }
  return updated;
}

// ── 시설 타입별 SAR 가중치 ────────────────────────────────────────────────────
const SAR_WEIGHTS: Record<string, { vv: number; vh: number; constrVhDb: number }> = {
  port:      { vv: 11, vh: 4, constrVhDb: 2.5 },
  LNG:       { vv: 8,  vh: 5, constrVhDb: 2.4 },
  fab:       { vv: 8,  vh: 6, constrVhDb: 2.0 },
  aerospace: { vv: 7,  vh: 5, constrVhDb: 2.3 },
  auto:      { vv: 8,  vh: 4, constrVhDb: 2.3 },
  steel:     { vv: 10, vh: 4, constrVhDb: 2.5 },
  solar:     { vv: 6,  vh: 5, constrVhDb: 2.2 },
  default:   { vv: 8,  vh: 6, constrVhDb: 2.0 },
};

function getFacilityType(factory: FactoryLocation): string {
  const t = factory.tags;
  if (t.includes('port'))      return 'port';
  if (t.includes('LNG'))       return 'LNG';
  if (t.includes('aerospace')) return 'aerospace';
  if (t.includes('auto'))      return 'auto';
  if (t.includes('steel'))     return 'steel';
  if (t.includes('solar'))     return 'solar';
  return 'fab';
}

// ── 점수 계산 (추측 없음, 순수 수치) ─────────────────────────────────────────
interface SARAnalysis {
  activityScore: number | null;
  vv_db: number;
  vh_db: number;
  vv_delta_db: number | null;
  vh_delta_db: number | null;
  vehicleDensity: 'low' | 'medium' | 'high';
  cloudCoverage: 'clear';        // SAR은 항상 clear
  loadingActivity: 'inactive' | 'normal' | 'busy';
  constructionVisible: boolean;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
}

function scoreFactory(current: SARStats, baseline: SARBaseline | null, factory: FactoryLocation): SARAnalysis {
  const w = SAR_WEIGHTS[getFacilityType(factory)] ?? SAR_WEIGHTS.default;
  const vv_db = Math.round(toDb(current.vv_mean) * 10) / 10;
  const vh_db = Math.round(toDb(current.vh_mean) * 10) / 10;
  let score: number;
  let vv_delta_db: number | null = null;
  let vh_delta_db: number | null = null;
  let constructionVisible = false;
  let confidence: 'low' | 'medium' | 'high' = 'low';

  const obsCount = baseline?.obs_count ?? 0;

  if (baseline && obsCount >= 2) {
    vv_delta_db = Math.round((vv_db - toDb(baseline.vv_mean)) * 100) / 100;
    vh_delta_db = Math.round((vh_db - toDb(baseline.vh_mean)) * 100) / 100;
    score = Math.max(5, Math.min(97, 50 + Math.round(vv_delta_db * w.vv + vh_delta_db * w.vh)));
    constructionVisible = vh_delta_db > w.constrVhDb;
    confidence = obsCount >= 5 ? 'high' : 'medium';
  } else {
    // ── 절대값 분류 (첫 스캔, 베이스라인 없음) ──
    // 산업단지 VV 일반 범위: -13 ~ -3 dB
    if (vv_db > -6) score = 78;
    else if (vv_db > -9) score = 62;
    else if (vv_db > -13) score = 46;
    else score = 28;
    // VH/VV 비율: 식생/건설 → VH 높음, 도시/포장 → VV 높음
    constructionVisible = (vh_db - vv_db) > -10;  // cross-ratio 역치
    confidence = 'low';
  }

  const vehicleDensity: 'low' | 'medium' | 'high' =
    score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  const loadingActivity: 'inactive' | 'normal' | 'busy' =
    score >= 75 ? 'busy' : score >= 40 ? 'normal' : 'inactive';

  // 요약 문장 (수치 기반, 추측 없음)
  const summaryParts: string[] = [];
  if (vv_delta_db !== null && baseline && obsCount >= 2) {
    const sign = vv_delta_db >= 0 ? '+' : '';
    summaryParts.push(`레이더(VV) ${sign}${vv_delta_db}dB vs ${obsCount}회 평균`);
    if (constructionVisible && vh_delta_db != null) summaryParts.push(`VH +${vh_delta_db}dB — 건설/중장비 역치 초과`);
    else if (Math.abs(vv_delta_db) < 0.8) summaryParts.push('유의미한 변화 없음 — 정상 가동');
    else if (vv_delta_db > 0) summaryParts.push('레이더 반사 증가 — 차량·구조물 증가');
    else summaryParts.push('레이더 반사 감소 — 활동 저하');
  } else {
    summaryParts.push(`VV ${vv_db}dB · VH ${vh_db}dB (베이스라인 축적 중 ${obsCount}/5회)`);
    if (score >= 70) summaryParts.push('고강도 산업 반사 감지');
    else if (score >= 45) summaryParts.push('정상 산업단지 수준');
    else summaryParts.push('저강도 — 야간·휴일 또는 커버리지 제한');
  }

  return {
    activityScore: score,
    vv_db, vh_db, vv_delta_db, vh_delta_db,
    vehicleDensity, cloudCoverage: 'clear', loadingActivity,
    constructionVisible, confidence,
    summary: summaryParts.join('. '),
  };
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = process.env.COPERNICUS_EMAIL?.trim();
  const password = process.env.COPERNICUS_PASSWORD?.trim();
  if (!email || !password) {
    logger.warn('cron.satellite-scan', 'missing_credentials', {});
    return NextResponse.json({ error: 'COPERNICUS_EMAIL/PASSWORD not configured' }, { status: 503 });
  }

  const redis = createRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not configured' }, { status: 503 });

  const today = new Date().toISOString().slice(0, 10);
  const statsFrom = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
  const start = Date.now();

  logger.info('cron.satellite-scan', 'start', { mode: 'SAR', factories: FACTORY_LOCATIONS.length, date: today });

  let token: string;
  try {
    token = await getCopernicusToken();
  } catch (err) {
    logger.error('cron.satellite-scan', 'auth_failed', { error: String(err) });
    return NextResponse.json({ error: 'Copernicus auth failed', detail: String(err) }, { status: 502 });
  }

  const results: Record<string, unknown>[] = [];
  let success = 0, failed = 0;

  // 3개씩 배치 처리
  const BATCH = 3;
  for (let i = 0; i < FACTORY_LOCATIONS.length; i += BATCH) {
    const batch = FACTORY_LOCATIONS.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async (factory) => {
      try {
        // 1) SAR 통계 (핵심, 동기)
        const stats = await fetchSARStats(factory, statsFrom, today, token);
        if (!stats) {
          logger.warn('cron.satellite-scan', 'no_sar_stats', { factory: factory.id });
          results.push({ id: factory.id, ticker: factory.ticker, name: factory.name, country: factory.country, tags: factory.tags, significance: factory.significance, activityScore: null, error: 'no_sar_data', scannedAt: new Date().toISOString(), imageDate: today, cloudCoverage: 'clear', source: 'SAR' });
          failed++;
          return;
        }
        if (stats.sample_count < 500) {
          logger.warn('cron.satellite-scan', 'sar_samples_low', { factory: factory.id, samples: stats.sample_count });
          results.push({ id: factory.id, ticker: factory.ticker, name: factory.name, country: factory.country, tags: factory.tags, significance: factory.significance, activityScore: null, error: 'insufficient_sar_samples', scannedAt: new Date().toISOString(), imageDate: today, cloudCoverage: 'clear', source: 'SAR' });
          failed++;
          return;
        }
        logger.info('cron.satellite-scan', 'sar_stats_ok', { factory: factory.id, vv_db: Math.round(toDb(stats.vv_mean)*10)/10, vh_db: Math.round(toDb(stats.vh_mean)*10)/10, samples: stats.sample_count });

        // 2) 베이스라인 로드 + 점수 계산
        const baseline = await loadBaseline(factory.id, redis);
        const analysis = scoreFactory(stats, baseline, factory);

        logger.info('cron.satellite-scan', 'scored', { factory: factory.id, score: analysis.activityScore, vv_delta: analysis.vv_delta_db, vh_delta: analysis.vh_delta_db, construction: analysis.constructionVisible, confidence: analysis.confidence });

        // 3) 베이스라인 업데이트
        await updateBaseline(factory.id, stats, baseline, redis, today);

        // 4) SAR 이미지 (병렬, 실패해도 계속)
        const imageBase64 = await fetchSARImage(factory, token);
        if (imageBase64) {
          const imgKey = `flowvium:satellite:img:${factory.id}`;
          const sizeKB = Math.round(imageBase64.length / 1024);
          try {
            await redis.set(imgKey, imageBase64, { ex: 604800 });
            logger.info('cron.satellite-scan', 'img_saved', { factory: factory.id, sizeKB });
          } catch (e) {
            logger.error('cron.satellite-scan', 'img_save_failed', { factory: factory.id, sizeKB, error: String(e) });
          }
        }

        const result = {
          id: factory.id, ticker: factory.ticker, name: factory.name,
          country: factory.country, tags: factory.tags, significance: factory.significance,
          ...analysis,
          scannedAt: new Date().toISOString(), imageDate: today,
          source: 'SAR',
          sar_raw: { vv_db: analysis.vv_db, vh_db: analysis.vh_db, samples: stats.sample_count },
        };
        results.push(result);

        // 5) 히스토리 (30일 점수 시계열)
        if (analysis.activityScore != null) {
          const histKey = `flowvium:satellite:history:${factory.id}`;
          try {
            const rawHist = await redis.get<string>(histKey);
            const prev = rawHist ? JSON.parse(typeof rawHist === 'string' ? rawHist : JSON.stringify(rawHist)) : { v: 1, points: [] };
            const newPoint = { d: today, s: analysis.activityScore, vv: analysis.vv_db, vh: analysis.vh_db, c: analysis.confidence[0] };
            const points = [...((prev.points ?? []) as typeof newPoint[]).filter((p) => p.d !== today), newPoint].slice(-30);
            await redis.set(histKey, JSON.stringify({ v: 1, points }), { ex: 7776000 });
          } catch (e) {
            logger.error('cron.satellite-scan', 'history_save_failed', { factory: factory.id, error: String(e) });
          }
        }

        success++;
      } catch (err) {
        logger.error('cron.satellite-scan', 'factory_error', { factory: factory.id, error: String(err), stack: err instanceof Error ? err.stack?.slice(0, 300) : undefined });
        results.push({ id: factory.id, ticker: factory.ticker, name: factory.name, country: factory.country, tags: factory.tags, significance: factory.significance, activityScore: null, error: String(err).slice(0, 120), scannedAt: new Date().toISOString(), imageDate: today, source: 'SAR' });
        failed++;
      }
    }));
    if (i + BATCH < FACTORY_LOCATIONS.length) await new Promise(r => setTimeout(r, 1500));
  }

  if (success > 0) {
    const scanKey = `flowvium:satellite:v1:${today}`;
    try {
      await redis.set(scanKey, JSON.stringify({ results, updatedAt: new Date().toISOString(), mode: 'SAR' }), { ex: 172800 });
      logger.info('cron.satellite-scan', 'saved', { key: scanKey, success, failed, ms: Date.now() - start });
    } catch (e) {
      logger.error('cron.satellite-scan', 'result_save_failed', { error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, date: today, mode: 'SAR', success, failed, ms: Date.now() - start });
}

/**
 * /api/cron/satellite-scan
 *
 * Sentinel-2 위성사진으로 12개 반도체·EV 공장 활동 지수 자동 스캔.
 * vercel.json에서 매일 07:40 KST (22:40 UTC) 실행.
 *
 * 필요 환경변수 (Vercel 배포):
 *   COPERNICUS_EMAIL    — dataspace.copernicus.eu 계정
 *   COPERNICUS_PASSWORD — 계정 비밀번호
 *   OPENROUTER_API_KEY  — Claude Vision (선택)
 *   GEMINI_API_KEY      — Gemini Vision 폴백 (선택)
 *
 * Redis 키:
 *   flowvium:satellite:v1:{YYYY-MM-DD} — 공장 배열 (48h TTL)
 *   flowvium:satellite:img:{id}         — 이미지 base64 (7일 TTL)
 *   flowvium:satellite:history:{id}     — 활동 히스토리 (90일 TTL)
 *   flowvium:satellite:last-image:{id}  — 중복 방지 (90일 TTL)
 */
import { NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { FACTORY_LOCATIONS, type FactoryLocation } from '@/data/factory-locations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Pro 플랜: 최대 5분 (12개 공장 병렬 처리)

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
const STAC_URL = 'https://stac.dataspace.copernicus.eu/v1/search';

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getCopernicusToken(): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60000) {
    return _tokenCache.token;
  }
  const email = process.env.COPERNICUS_EMAIL?.trim();
  const password = process.env.COPERNICUS_PASSWORD?.trim();
  if (!email || !password) throw new Error('COPERNICUS_EMAIL/PASSWORD not set');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'cdse-public', username: email, password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Copernicus auth ${res.status}: ${(await res.text()).slice(0, 100)}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 30) * 1000 };
  return _tokenCache.token;
}

// ── 이미지 fetch ──────────────────────────────────────────────────────────────
const EVALSCRIPT = `//VERSION=3
function setup(){return{input:[{bands:["B04","B03","B02","dataMask"]}],output:{bands:4}}}
function evaluatePixel(s){return[3.5*s.B04,3.5*s.B03,3.5*s.B02,s.dataMask]}`;

async function fetchImage(factory: FactoryLocation, token: string): Promise<string | null> {
  const m = factory.radiusKm / 111.32;
  const bbox = [factory.lng - m, factory.lat - m, factory.lng + m, factory.lat + m];
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        maxCloudCoverage: 30, mosaickingOrder: 'leastCC',
      }}],
    },
    output: { width: 512, height: 512, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript: EVALSCRIPT,
  };

  const res = await fetch(PROCESS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'image/png' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// ── STAC 중복 체크 ────────────────────────────────────────────────────────────
async function getLatestStacId(factory: FactoryLocation): Promise<string | null> {
  try {
    const m = factory.radiusKm / 111.32;
    const bbox = [factory.lng - m, factory.lat - m, factory.lng + m, factory.lat + m];
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(STAC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'], bbox,
        datetime: `${from}/${new Date().toISOString().slice(0, 10)}`,
        query: { 'eo:cloud_cover': { lte: 50 } },
        sortby: [{ field: 'properties.datetime', direction: 'desc' }],
        limit: 1,
        fields: { include: ['id'] },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { features?: Array<{ id: string }> };
    return data.features?.[0]?.id ?? null;
  } catch { return null; }
}

// ── Vision 분석 ───────────────────────────────────────────────────────────────
interface VisionResult {
  activityScore: number | null;
  vehicleDensity: 'low' | 'medium' | 'high' | null;
  cloudCoverage: 'clear' | 'partial' | 'heavy' | null;
  loadingActivity: 'inactive' | 'normal' | 'busy' | null;
  constructionVisible: boolean | null;
  confidence: 'low' | 'medium' | 'high' | null;
  summary: string | null;
}

async function analyzeImage(factory: FactoryLocation, imageBase64: string): Promise<VisionResult> {
  const prompt = `Sentinel-2 satellite image (10m/pixel) of ${factory.name}. Area: ~${(factory.radiusKm*2).toFixed(1)}km x ${(factory.radiusKm*2).toFixed(1)}km.
Analyze factory activity: parking lot fill ratio, loading dock brightness, construction, cloud coverage.
Respond ONLY in JSON: {"activityScore":<0-100>,"vehicleDensity":"low"|"medium"|"high","cloudCoverage":"clear"|"partial"|"heavy","loadingActivity":"inactive"|"normal"|"busy","constructionVisible":true|false,"confidence":"low"|"medium"|"high","summary":"<1 sentence in Korean>"}`;

  // 1) OpenRouter (Claude Vision)
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openrouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4-5',
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ]}],
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content ?? '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]) as VisionResult;
      }
    } catch { /* fall through */ }
  }

  // 2) Gemini Vision
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/png', data: imageBase64 } },
          ]}],
          generationConfig: { maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) {
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]) as VisionResult;
      }
    } catch { /* fall through */ }
  }

  return { activityScore: null, vehicleDensity: null, cloudCoverage: null, loadingActivity: null, constructionVisible: null, confidence: null, summary: null };
}

// ── 히스토리 + 베이스라인 ─────────────────────────────────────────────────────
interface HistoryEntry { activityScore: number; confidence: string; imageDate: string; }

async function loadHistory(factoryId: string, redis: NonNullable<ReturnType<typeof createRedis>>): Promise<HistoryEntry[]> {
  try {
    const key = `flowvium:satellite:history:${factoryId}`;
    const raw = await redis.lrange<string>(key, 0, 9);
    return raw.map(s => { try { return JSON.parse(s) as HistoryEntry; } catch { return null; } }).filter(Boolean) as HistoryEntry[];
  } catch { return []; }
}

function computeBaseline(score: number | null, history: HistoryEntry[]) {
  const usable = history.filter(h => h.activityScore != null && h.confidence !== 'low').slice(0, 6);
  if (score == null || usable.length < 3) return { baselineScore: null, deltaFromBaseline: null, zScore: null, trend: 'insufficient_history' };
  const scores = usable.map(h => h.activityScore);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length) || 1;
  const delta = score - mean;
  return {
    baselineScore: Math.round(mean),
    deltaFromBaseline: Math.round(delta),
    zScore: Math.round(delta / sd * 100) / 100,
    trend: Math.abs(delta) >= 15 ? (delta > 0 ? 'up' : 'down') : 'flat',
  };
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
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
  const start = Date.now();

  logger.info('cron.satellite-scan', 'start', { factories: FACTORY_LOCATIONS.length, date: today });

  let token: string;
  try {
    token = await getCopernicusToken();
  } catch (err) {
    logger.error('cron.satellite-scan', 'auth_failed', { error: String(err) });
    return NextResponse.json({ error: 'Copernicus auth failed', detail: String(err) }, { status: 502 });
  }

  const results: Record<string, unknown>[] = [];
  let success = 0, skipped = 0, failed = 0;

  // 3개씩 배치 처리 (Copernicus rate limit 보호)
  const BATCH = 3;
  for (let i = 0; i < FACTORY_LOCATIONS.length; i += BATCH) {
    const batch = FACTORY_LOCATIONS.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async (factory) => {
      const label = `[${factory.ticker}] ${factory.name}`;
      try {
        // STAC 중복 체크
        const stacId = await getLatestStacId(factory);
        if (stacId) {
          const lastKey = `flowvium:satellite:last-image:${factory.id}`;
          const prev = await redis.get<string>(lastKey);
          if (prev === stacId) {
            logger.info('cron.satellite-scan', 'skip_same_image', { factory: factory.id, stacId });
            skipped++;
            return;
          }
          await redis.set(lastKey, stacId, { ex: 7776000 });
        }

        const imageBase64 = await fetchImage(factory, token);
        if (!imageBase64) {
          logger.warn('cron.satellite-scan', 'no_image', { factory: factory.id });
          results.push({ ...factory, activityScore: null, error: 'no_image', scannedAt: new Date().toISOString(), imageDate: today });
          failed++;
          return;
        }

        // 이미지 Redis 저장 (7일 TTL)
        const imgKey = `flowvium:satellite:img:${factory.id}`;
        await redis.set(imgKey, imageBase64, { ex: 604800 }).catch(() => {});

        const analysis = await analyzeImage(factory, imageBase64);
        logger.info('cron.satellite-scan', 'analysis_done', { factory: factory.id, score: analysis.activityScore, confidence: analysis.confidence });

        const history = await loadHistory(factory.id, redis);
        const baseline = computeBaseline(analysis.activityScore, history);

        const result = { id: factory.id, ticker: factory.ticker, name: factory.name, country: factory.country, tags: factory.tags, significance: factory.significance, ...analysis, ...baseline, scannedAt: new Date().toISOString(), imageDate: today };
        results.push(result);

        // 히스토리 업데이트
        if (analysis.activityScore != null) {
          const histKey = `flowvium:satellite:history:${factory.id}`;
          await redis.lpush(histKey, JSON.stringify({ activityScore: analysis.activityScore, confidence: analysis.confidence, imageDate: today, scannedAt: result.scannedAt }));
          await redis.ltrim(histKey, 0, 9);
          await redis.expire(histKey, 7776000);
        }

        success++;
      } catch (err) {
        logger.error('cron.satellite-scan', 'factory_error', { factory: factory.id, error: String(err) });
        results.push({ ...factory, activityScore: null, error: String(err).slice(0, 100), scannedAt: new Date().toISOString(), imageDate: today });
        failed++;
      }
    }));

    // 배치 간 1.5초 대기
    if (i + BATCH < FACTORY_LOCATIONS.length) await new Promise(r => setTimeout(r, 1500));
  }

  // 결과 Redis 저장
  if (success > 0) {
    const scanKey = `flowvium:satellite:v1:${today}`;
    await redis.set(scanKey, JSON.stringify({ results, updatedAt: new Date().toISOString() }), { ex: 172800 });
    logger.info('cron.satellite-scan', 'saved', { key: scanKey, success, skipped, failed, ms: Date.now() - start });
  }

  return NextResponse.json({
    ok: true,
    date: today,
    success,
    skipped,
    failed,
    ms: Date.now() - start,
  });
}

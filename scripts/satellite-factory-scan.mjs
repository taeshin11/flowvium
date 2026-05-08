/**
 * satellite-factory-scan.mjs
 *
 * Sentinel-2 위성사진으로 주요 반도체/EV 공장의 활동 지수 스캔.
 *
 * 데이터: Copernicus Data Space Ecosystem (ESA, 완전 무료)
 * 해상도: 10m (주차장·하역장 수준 감지)
 * 주기: 5일마다 새 이미지 (구름 없을 때 자동 선택)
 * 분석: Claude Vision (활동 지수 0-100 + 현장 상황 요약)
 *
 * 필요 환경변수:
 *   COPERNICUS_EMAIL    — dataspace.copernicus.eu 계정 이메일
 *   COPERNICUS_PASSWORD — 계정 비밀번호
 *   ANTHROPIC_API_KEY   — Claude Vision 분석용
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — 결과 저장
 *
 * 실행:
 *   node scripts/satellite-factory-scan.mjs
 *   node scripts/satellite-factory-scan.mjs --factory=tsmc-tainan-n3
 *   node scripts/satellite-factory-scan.mjs --dry-run   (이미지 다운로드 없이 API 테스트)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Load .env.local
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\[rn]/g, '').trim();
  }
}

const COPERNICUS_TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const SENTINEL_PROCESS_URL =
  'https://sh.dataspace.copernicus.eu/api/v1/process';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const REDIS_KEY_PREFIX = 'flowvium:satellite:v1';
const HISTORY_KEY = (id) => `flowvium:satellite:history:${id}`;
const LAST_IMAGE_KEY = (id) => `flowvium:satellite:last-image:${id}`;
const STAC_SEARCH_URL = 'https://stac.dataspace.copernicus.eu/v1/search';
const HISTORY_MAX = 10; // 최대 10개 관측치 보관 (~50일)

// ── Factory 목록 (factory-locations.ts 와 동기) ───────────────────────────────
const FACTORIES = [
  { id: 'tsmc-tainan-n3',   ticker: 'TSM',       name: 'TSMC Fab 18 / Tainan (N3/N2)',             country: 'TW', lat: 22.9271, lng: 120.3038, radiusKm: 2.0, tags: ['NVDA','AAPL','AMD','foundry'],         significance: 'critical' },
  { id: 'tsmc-taichung',    ticker: 'TSM',       name: 'TSMC Fab 15 / Taichung (N5/N7)',           country: 'TW', lat: 24.1964, lng: 120.6464, radiusKm: 1.5, tags: ['NVDA','AMD','AAPL','foundry'],         significance: 'critical' },
  { id: 'samsung-pyeongtaek', ticker: '005930.KS', name: 'Samsung Pyeongtaek P3/P4 (HBM/DRAM)',   country: 'KR', lat: 37.0034, lng: 127.0786, radiusKm: 2.5, tags: ['HBM','DRAM','NVDA','memory'],         significance: 'critical' },
  { id: 'skhynix-icheon',   ticker: '000660.KS', name: 'SK Hynix Icheon M14/M16 (HBM3E)',         country: 'KR', lat: 37.2776, lng: 127.4512, radiusKm: 2.0, tags: ['HBM','DRAM','NVDA','memory'],         significance: 'critical' },
  { id: 'micron-boise',     ticker: 'MU',        name: 'Micron Fab 10X / Boise ID',               country: 'US', lat: 43.6022, lng: -116.1936, radiusKm: 1.5, tags: ['DRAM','NAND','memory'],              significance: 'major' },
  { id: 'intel-chandler',   ticker: 'INTC',      name: 'Intel Fab 42 / Chandler AZ (18A)',        country: 'US', lat: 33.3045, lng: -111.8316, radiusKm: 1.5, tags: ['foundry','logic'],                   significance: 'major' },
  { id: 'asml-veldhoven',   ticker: 'ASML',      name: 'ASML HQ / Veldhoven (EUV 제조)',           country: 'NL', lat: 51.3965, lng: 5.4195,   radiusKm: 1.0, tags: ['EUV','lithography','supply-chain'],   significance: 'critical' },
  { id: 'foxconn-zhengzhou',ticker: 'AAPL',      name: 'Foxconn iPhone City / Zhengzhou',         country: 'CN', lat: 34.7046, lng: 113.7394, radiusKm: 3.0, tags: ['assembly','AAPL','iPhone'],           significance: 'critical' },
  { id: 'catl-ningde',      ticker: 'CATL',      name: 'CATL 본사 공장 / Ningde',                  country: 'CN', lat: 26.6616, lng: 119.5163, radiusKm: 2.0, tags: ['battery','EV','TSLA'],               significance: 'major' },
  { id: 'tesla-shanghai',   ticker: 'TSLA',      name: 'Tesla Gigafactory Shanghai',              country: 'CN', lat: 30.9265, lng: 121.8571, radiusKm: 2.0, tags: ['EV','TSLA','assembly'],              significance: 'major' },
  { id: 'tesla-nevada',     ticker: 'TSLA',      name: 'Tesla Gigafactory Nevada',               country: 'US', lat: 39.5363, lng: -118.9769, radiusKm: 2.0, tags: ['battery','EV','TSLA'],              significance: 'moderate' },
  { id: 'samsung-austin',   ticker: 'TSM',       name: 'Samsung Austin Semiconductor (S3/S5)',   country: 'US', lat: 30.3820, lng: -97.7749, radiusKm: 1.5, tags: ['foundry','logic'],                   significance: 'moderate' },
];

// ── Copernicus Auth ────────────────────────────────────────────────────────────
let _tokenCache = null;
async function getCopernicusToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60000) {
    return _tokenCache.token;
  }
  const email = process.env.COPERNICUS_EMAIL;
  const password = process.env.COPERNICUS_PASSWORD;
  if (!email || !password) {
    throw new Error(
      '환경변수 누락: COPERNICUS_EMAIL + COPERNICUS_PASSWORD\n' +
      '  → https://dataspace.copernicus.eu 에서 무료 가입 후 .env.local에 추가하세요.'
    );
  }
  const res = await fetch(COPERNICUS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'cdse-public',
      username: email,
      password,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Copernicus auth failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
  console.log('  ✅ Copernicus 인증 완료 (토큰 만료:', new Date(Date.now() + data.expires_in * 1000).toISOString(), ')');
  return _tokenCache.token;
}

// ── Sentinel-2 이미지 가져오기 ────────────────────────────────────────────────
const EVALSCRIPT_TRUE_COLOR = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04","B03","B02","dataMask"] }],
    output: { bands: 4 }
  };
}
function evaluatePixel(s) {
  // 3.5x brightness boost for clearer industrial area visibility
  return [3.5*s.B04, 3.5*s.B03, 3.5*s.B02, s.dataMask];
}`;

async function fetchSentinelImage(factory, token, dryRun = false) {
  const margin = factory.radiusKm / 111.32; // km → degrees (approx)
  const bbox = [
    factory.lng - margin,
    factory.lat - margin,
    factory.lng + margin,
    factory.lat + margin,
  ];

  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const payload = {
    input: {
      bounds: {
        bbox,
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
      },
      data: [{
        type: 'sentinel-2-l2a',
        dataFilter: {
          timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
          maxCloudCoverage: 30,
          mosaickingOrder: 'leastCC', // 구름 가장 적은 이미지 우선
        },
      }],
    },
    output: {
      width: 512,
      height: 512,
      responses: [{ identifier: 'default', format: { type: 'image/png' } }],
    },
    evalscript: EVALSCRIPT_TRUE_COLOR,
  };

  if (dryRun) {
    console.log(`  [DRY-RUN] bbox=${bbox.map(v=>v.toFixed(4)).join(',')} from=${from} to=${to}`);
    return null;
  }

  const res = await fetch(SENTINEL_PROCESS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'image/png',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.warn(`  ⚠️  Sentinel API ${res.status} for ${factory.id}: ${txt.slice(0, 150)}`);
    return null;
  }

  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  console.log(`  🛰️  이미지 수신 (${(buffer.byteLength / 1024).toFixed(0)} KB)`);
  return base64;
}

// ── Vision 분석 (OpenRouter Claude → Anthropic → Gemini 순서) ─────────────────
async function analyzeWithClaude(factory, imageBase64) {
  const prompt = `This is a Sentinel-2 satellite true-color image (10m/pixel) of ${factory.name} (${factory.ticker}).
The image covers a ~${(factory.radiusKm * 2).toFixed(1)}km x ${(factory.radiusKm * 2).toFixed(1)}km area.
At 10m resolution, individual trucks are ~1 pixel wide, but parking/loading areas (50m+) are visible as bright clusters.

Analyze factory activity level for supply chain intelligence:
- Parking lot fill ratio (empty=low, clustered vehicles=high)
- Loading dock/truck bay area brightness (active loading = brighter spots at building edges)
- Any visible construction or expansion activity
- Seasonal vegetation vs industrial surface ratio
- Cloud/shadow coverage affecting analysis quality

Respond ONLY in JSON (no markdown):
{"activityScore":<0-100>,"vehicleDensity":"low"|"medium"|"high","cloudCoverage":"clear"|"partial"|"heavy","loadingActivity":"inactive"|"normal"|"busy","constructionVisible":true|false,"confidence":"low"|"medium"|"high","summary":"<1 sentence in Korean>"}`;

  // 1) OpenRouter (Claude Sonnet vision)
  if (OPENROUTER_KEY) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://flowvium.vercel.app',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
      signal: AbortSignal.timeout(40000),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      const match = text.match(/\{[\s\S]+\}/);
      if (match) return JSON.parse(match[0]);
    } else {
      console.warn(`  ⚠️ OpenRouter ${res.status} — Gemini로 폴백`);
    }
  }

  // 2) Anthropic direct
  if (ANTHROPIC_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 400,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
          { type: 'text', text: prompt },
        ]}],
      }),
      signal: AbortSignal.timeout(40000),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.content?.find(b => b.type === 'text')?.text ?? '';
      const match = text.match(/\{[\s\S]+\}/);
      if (match) return JSON.parse(match[0]);
    }
  }

  // 3) Gemini vision
  if (GEMINI_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: 'image/png', data: imageBase64 } },
            { text: prompt },
          ]}],
          generationConfig: { maxOutputTokens: 400, temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(40000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const match = text.match(/\{[\s\S]+\}/);
      if (match) return JSON.parse(match[0]);
    } else {
      const txt = await res.text();
      throw new Error(`Gemini API ${res.status}: ${txt.slice(0, 200)}`);
    }
  }

  throw new Error('사용 가능한 Vision API 없음 (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY 중 하나 필요)');
}


// ── STAC 최신 이미지 체크 (중복 분석 방지) ────────────────────────────────────
async function findLatestStacItem(factory) {
  try {
    const margin = factory.radiusKm / 111.32;
    const bbox = [
      factory.lng - margin, factory.lat - margin,
      factory.lng + margin, factory.lat + margin,
    ];
    const from = new Date(Date.now() - 14 * 86400000).toISOString();
    const to = new Date().toISOString();

    const res = await fetch(STAC_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox,
        datetime: `${from}/${to}`,
        query: { 'eo:cloud_cover': { lte: 50 } },
        sortby: [{ field: 'properties.datetime', direction: 'desc' }],
        limit: 1,
        fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover'] },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.features?.[0];
    if (!item) return null;
    return {
      id: item.id,
      datetime: item.properties.datetime,
      cloudPct: item.properties['eo:cloud_cover'],
    };
  } catch { return null; }
}

async function isNewImage(factory) {
  if (!REDIS_URL || !REDIS_TOKEN) return true; // Redis 없으면 항상 스캔
  const stacItem = await findLatestStacItem(factory);
  if (!stacItem) return true; // STAC 실패 시 스캔 진행

  const key = LAST_IMAGE_KEY(factory.id);
  const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (res.ok) {
    const data = await res.json();
    const prev = data.result ? JSON.parse(data.result) : null;
    if (prev?.stacItemId === stacItem.id) {
      console.log(`  ⏭️  동일 이미지 (${stacItem.id.slice(-8)}) — 스킵`);
      return false;
    }
  }

  // 새 이미지 → last-image 키 갱신 (90일 TTL)
  await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify({ stacItemId: stacItem.id, imageDate: stacItem.datetime.slice(0, 10) })),
  });
  await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/7776000`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  console.log(`  🆕 새 이미지 감지: ${stacItem.datetime.slice(0, 10)} (cloud ${stacItem.cloudPct?.toFixed(0)}%)`);
  return true;
}

// ── 히스토리 로드 + baseline 계산 ─────────────────────────────────────────────
async function loadHistory(factoryId) {
  if (!REDIS_URL || !REDIS_TOKEN) return [];
  try {
    const key = HISTORY_KEY(factoryId);
    const res = await fetch(`${REDIS_URL}/lrange/${encodeURIComponent(key)}/0/${HISTORY_MAX - 1}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result ?? []).map(item => {
      try { return JSON.parse(item); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

async function appendHistory(factoryId, entry) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  const key = HISTORY_KEY(factoryId);
  const val = JSON.stringify(entry);
  await fetch(`${REDIS_URL}/lpush/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(val),
  });
  await fetch(`${REDIS_URL}/ltrim/${encodeURIComponent(key)}/0/${HISTORY_MAX - 1}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/7776000`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
}

function computeBaseline(currentScore, history) {
  const usable = history
    .filter(h => h.activityScore != null && h.confidence !== 'low')
    .slice(0, 6); // 4~5주치 관측

  if (currentScore == null || usable.length < 3) {
    return { baselineScore: null, deltaFromBaseline: null, trend: 'insufficient_history' };
  }

  const scores = usable.map(h => h.activityScore);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length;
  const sd = Math.sqrt(variance) || 1;
  const delta = currentScore - mean;
  const zScore = delta / sd;

  let trend = 'flat';
  if (Math.abs(delta) >= 15) trend = delta > 0 ? 'up' : 'down';

  return {
    baselineScore: Math.round(mean),
    deltaFromBaseline: Math.round(delta),
    zScore: Math.round(zScore * 100) / 100,
    trend,
  };
}

// ── Redis 저장 ────────────────────────────────────────────────────────────────
async function saveToRedis(results) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.log('  ℹ️  Redis 미설정 — 결과를 로컬 파일로만 저장');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const key = `${REDIS_KEY_PREFIX}:${today}`;
  const payload = JSON.stringify({ results, updatedAt: new Date().toISOString() });
  await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // TTL 48h
  await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/172800`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  console.log(`  💾 Redis 저장: ${key}`);
}

// ── 로컬 파일 저장 (debug) ────────────────────────────────────────────────────
function saveLocal(results) {
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(ROOT, 'research_history', `${today}_satellite-scan.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`  📁 로컬 저장: ${outPath}`);
}

// ── 결과 출력 ─────────────────────────────────────────────────────────────────
function printResult(factory, analysis, imageDate) {
  const score = analysis.activityScore ?? 50;
  const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
  const color = score >= 70 ? '🔴' : score >= 50 ? '🟡' : '🟢';
  console.log(`\n  ${color} [${factory.ticker}] ${factory.name}`);
  console.log(`     활동지수: ${bar} ${score}/100 (${analysis.vehicleDensity ?? '?'} vehicles)`);
  console.log(`     하역활동: ${analysis.loadingActivity ?? '?'} | 구름: ${analysis.cloudCoverage ?? '?'} | 신뢰도: ${analysis.confidence ?? '?'}`);
  console.log(`     신규공사: ${analysis.constructionVisible ? '🔨 YES' : 'NO'} | 이미지: ${imageDate}`);
  console.log(`     요약: ${analysis.summary ?? '-'}`);
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const factoryFilter = args.find(a => a.startsWith('--factory='))?.split('=')[1];

  const targets = factoryFilter
    ? FACTORIES.filter(f => f.id === factoryFilter)
    : FACTORIES;

  if (targets.length === 0) {
    console.error(`❌ factory '${factoryFilter}' 없음`);
    process.exit(1);
  }

  console.log(`\n🛰️  FlowVium 위성 공장 스캔 시작`);
  console.log(`   대상: ${targets.length}개 공장 | 날짜: ${new Date().toISOString().slice(0, 10)}`);
  console.log(`   모드: ${dryRun ? 'DRY-RUN (이미지 다운로드 없음)' : 'LIVE'}\n`);

  if (!dryRun && (!process.env.COPERNICUS_EMAIL || !process.env.COPERNICUS_PASSWORD)) {
    console.error('❌ COPERNICUS_EMAIL / COPERNICUS_PASSWORD 미설정');
    console.error('   → https://dataspace.copernicus.eu 에서 무료 가입 후 .env.local에 추가하세요:');
    console.error('   COPERNICUS_EMAIL=your@email.com');
    console.error('   COPERNICUS_PASSWORD=yourpassword');
    process.exit(1);
  }

  let token = null;
  if (!dryRun) {
    token = await getCopernicusToken();
  }

  const results = [];
  let success = 0, failed = 0;

  for (const factory of targets) {
    console.log(`\n📍 ${factory.name} (${factory.id})`);
    try {
      // STAC 중복 체크 (새 이미지 없으면 스킵)
      if (!dryRun && targets.length > 1) {
        const newImg = await isNewImage(factory);
        if (!newImg) { failed++; continue; }
      }

      const imageBase64 = await fetchSentinelImage(factory, token, dryRun);
      if (!imageBase64) {
        results.push({ ...factory, activityScore: null, error: 'no_image', scannedAt: new Date().toISOString() });
        failed++;
        continue;
      }

      // 이미지 Redis 저장 (7일 TTL, 나중에 UI 표시용)
      if (REDIS_URL && REDIS_TOKEN) {
        const imgKey = `flowvium:satellite:img:${factory.id}`;
        const sizeKB = Math.round(imageBase64.length / 1024);
        try {
          const setRes = await fetch(`${REDIS_URL}/set/${encodeURIComponent(imgKey)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(imageBase64),
          });
          if (setRes.ok) {
            await fetch(`${REDIS_URL}/expire/${encodeURIComponent(imgKey)}/604800`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
            });
            console.log(`  📸 이미지 저장: ${sizeKB}KB base64 → Redis OK`);
          } else {
            const errText = await setRes.text().catch(() => '');
            console.error(`  ❌ 이미지 Redis 저장 실패 HTTP ${setRes.status}: ${errText.slice(0, 100)}`);
          }
        } catch (e) {
          console.error(`  ❌ 이미지 Redis 저장 예외: ${e.message ?? e}`);
        }
      } else {
        console.warn(`  ⚠️  REDIS_URL/TOKEN 미설정 — 이미지 저장 스킵 (UPSTASH_REDIS_REST_URL 확인)`);
      }

      console.log('  🤖 Claude Vision 분석 중...');
      const analysis = await analyzeWithClaude(factory, imageBase64);
      const today = new Date().toISOString().slice(0, 10);
      printResult(factory, analysis, today);

      // 히스토리 로드 + baseline 계산
      const history = await loadHistory(factory.id);
      const baseline = computeBaseline(analysis.activityScore, history);
      if (baseline.deltaFromBaseline != null) {
        const sign = baseline.deltaFromBaseline >= 0 ? '+' : '';
        console.log(`     베이스라인: ${baseline.baselineScore}/100 (Δ${sign}${baseline.deltaFromBaseline}, trend=${baseline.trend})`);
      } else {
        console.log(`     베이스라인: 히스토리 부족 (현재 ${history.length}개 관측치)`);
      }

      const result = {
        id: factory.id,
        ticker: factory.ticker,
        name: factory.name,
        country: factory.country,
        tags: factory.tags,
        significance: factory.significance,
        ...analysis,
        ...baseline,
        scannedAt: new Date().toISOString(),
        imageDate: today,
      };
      results.push(result);

      // 히스토리에 추가
      await appendHistory(factory.id, {
        activityScore: analysis.activityScore,
        confidence: analysis.confidence,
        imageDate: today,
        scannedAt: result.scannedAt,
      });
      success++;

      // Rate limit: Sentinel Hub 처리 유닛 절약 + Claude API 과부하 방지
      if (targets.length > 1) await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ 실패: ${err.message}`);
      results.push({ ...factory, activityScore: null, error: err.message.slice(0, 100), scannedAt: new Date().toISOString() });
      failed++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ 완료: 성공 ${success} | 실패 ${failed}`);

  if (!dryRun && success > 0) {
    await saveToRedis(results);
    saveLocal(results);
  }

  // 활동 지수 요약 (높은 순)
  const ranked = results
    .filter(r => r.activityScore != null)
    .sort((a, b) => b.activityScore - a.activityScore);

  if (ranked.length > 0) {
    console.log('\n📊 활동 지수 순위:');
    ranked.forEach((r, i) => {
      const bar = '█'.repeat(Math.round(r.activityScore / 10));
      const flag = r.activityScore >= 70 ? ' ⚠️ 높음' : r.activityScore <= 30 ? ' 💤 조용' : '';
      console.log(`  ${String(i+1).padStart(2)}. [${r.activityScore.toString().padStart(3)}] ${bar.padEnd(10)} ${r.name}${flag}`);
    });
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

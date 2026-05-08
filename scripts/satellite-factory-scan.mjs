/**
 * satellite-factory-scan.mjs  —  Sentinel-1 SAR 레이더 기반 공장 활동 스캔
 *
 * Vision AI 추측 제거. 레이더 후방산란(backscatter) 수치로 객관적 측정:
 *   - Sentinel-1 SAR: 구름 관통 (날씨·시간 무관)
 *   - Statistics API → VV/VH linear power 통계값 직접 수신
 *   - 베이스라인(롤링 평균) 대비 dB 변화량 → 활동 점수 (추측 없음)
 *   - 건설 감지: VH +2dB 이상 = 중장비/토공 역치
 *   - 차량/구조물 감지: VV 증가 = 금속 반사체 증가
 *
 * 필요 환경변수:
 *   COPERNICUS_EMAIL / COPERNICUS_PASSWORD — dataspace.copernicus.eu 계정
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — 결과 저장
 *
 * 실행:
 *   node scripts/satellite-factory-scan.mjs
 *   node scripts/satellite-factory-scan.mjs --factory=samsung-pyeongtaek
 *   node scripts/satellite-factory-scan.mjs --dry-run
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
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').trim();
  }
}

const TOKEN_URL   = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const STATS_URL   = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ── Factory 목록 ─────────────────────────────────────────────────────────────
const FACTORIES = [
  { id: 'tsmc-tainan-n3',    ticker: 'TSM',       name: 'TSMC Fab 18 / Tainan (N3/N2)',           country: 'TW', lat: 22.9271, lng: 120.3038, radiusKm: 2.0, tags: ['NVDA','AAPL','AMD','foundry'],       significance: 'critical' },
  { id: 'tsmc-taichung',     ticker: 'TSM',       name: 'TSMC Fab 15 / Taichung (N5/N7)',         country: 'TW', lat: 24.1964, lng: 120.6464, radiusKm: 1.5, tags: ['NVDA','AMD','AAPL','foundry'],       significance: 'critical' },
  { id: 'samsung-pyeongtaek',ticker: '005930.KS', name: 'Samsung Pyeongtaek P3/P4 (HBM/DRAM)',   country: 'KR', lat: 37.0034, lng: 127.0786, radiusKm: 2.5, tags: ['HBM','DRAM','NVDA','memory'],       significance: 'critical' },
  { id: 'skhynix-icheon',    ticker: '000660.KS', name: 'SK Hynix Icheon M14/M16 (HBM3E)',       country: 'KR', lat: 37.2776, lng: 127.4512, radiusKm: 2.0, tags: ['HBM','DRAM','NVDA','memory'],       significance: 'critical' },
  { id: 'micron-boise',      ticker: 'MU',        name: 'Micron Fab 10X / Boise ID',             country: 'US', lat: 43.6022, lng: -116.1936, radiusKm: 1.5, tags: ['DRAM','NAND','memory'],            significance: 'major' },
  { id: 'intel-chandler',    ticker: 'INTC',      name: 'Intel Fab 42 / Chandler AZ (18A)',      country: 'US', lat: 33.3045, lng: -111.8316, radiusKm: 1.5, tags: ['foundry','logic'],                 significance: 'major' },
  { id: 'asml-veldhoven',    ticker: 'ASML',      name: 'ASML HQ / Veldhoven (EUV 제조)',         country: 'NL', lat: 51.3965, lng: 5.4195,   radiusKm: 1.0, tags: ['EUV','lithography'],               significance: 'critical' },
  { id: 'foxconn-zhengzhou', ticker: 'AAPL',      name: 'Foxconn iPhone City / Zhengzhou',       country: 'CN', lat: 34.7046, lng: 113.7394, radiusKm: 3.0, tags: ['assembly','AAPL','iPhone'],         significance: 'critical' },
  { id: 'catl-ningde',       ticker: 'CATL',      name: 'CATL 본사 공장 / Ningde',               country: 'CN', lat: 26.6616, lng: 119.5163, radiusKm: 2.0, tags: ['battery','EV','TSLA'],             significance: 'major' },
  { id: 'tesla-shanghai',    ticker: 'TSLA',      name: 'Tesla Gigafactory Shanghai',            country: 'CN', lat: 30.9265, lng: 121.8571, radiusKm: 2.0, tags: ['EV','TSLA','assembly'],            significance: 'major' },
  { id: 'tesla-nevada',      ticker: 'TSLA',      name: 'Tesla Gigafactory Nevada',             country: 'US', lat: 39.5363, lng: -118.9769, radiusKm: 2.0, tags: ['battery','EV','TSLA'],            significance: 'moderate' },
  { id: 'samsung-austin',    ticker: 'TSM',       name: 'Samsung Austin Semiconductor (S3/S5)', country: 'US', lat: 30.3820,  lng: -97.7749,   radiusKm: 1.5, tags: ['foundry','logic'],               significance: 'moderate' },
  // ── Ports / Logistics
  { id: 'yangshan-port',     ticker: 'SHCOMP',    name: 'Yangshan Deep-Water Port / Shanghai',  country: 'CN', lat: 30.6294,  lng: 122.0578,   radiusKm: 3.5, tags: ['port','logistics','shipping'],   significance: 'critical' },
  { id: 'rotterdam-port',    ticker: 'AH.AS',     name: 'Port of Rotterdam Maasvlakte',         country: 'NL', lat: 51.9490,  lng: 4.0232,     radiusKm: 3.0, tags: ['port','logistics','shipping'],   significance: 'critical' },
  { id: 'longbeach-port',    ticker: 'UPS',       name: 'Port of Long Beach',                   country: 'US', lat: 33.7542,  lng: -118.2165,  radiusKm: 3.0, tags: ['port','logistics','shipping'],   significance: 'major' },
  // ── Aerospace
  { id: 'boeing-renton',     ticker: 'BA',        name: 'Boeing Renton Factory (737 MAX)',       country: 'US', lat: 47.5004,  lng: -122.2075,  radiusKm: 2.0, tags: ['aerospace','BA'],               significance: 'major' },
  { id: 'airbus-toulouse',   ticker: 'AIR.PA',    name: 'Airbus Final Assembly Line / Toulouse', country: 'FR', lat: 43.6240,  lng: 1.3630,     radiusKm: 2.5, tags: ['aerospace','AIR'],              significance: 'major' },
  // ── Auto
  { id: 'hyundai-ulsan',     ticker: '005380.KS', name: 'Hyundai Motor Ulsan Plant',            country: 'KR', lat: 35.5384,  lng: 129.3114,   radiusKm: 3.0, tags: ['auto','EV','HEV'],              significance: 'major' },
  { id: 'toyota-tsutsumi',   ticker: '7203.T',    name: 'Toyota Tsutsumi Plant / Aichi',        country: 'JP', lat: 35.0260,  lng: 137.1590,   radiusKm: 2.0, tags: ['auto','HEV'],                   significance: 'major' },
  // ── Solar
  { id: 'longi-xian',        ticker: '601012.SS', name: "LONGi Solar / Xi'an Base",             country: 'CN', lat: 34.3416,  lng: 108.9398,   radiusKm: 2.0, tags: ['solar','renewable'],            significance: 'major' },
  { id: 'jinko-shangrao',    ticker: 'JKS',       name: 'JinkoSolar Shangrao Base',             country: 'CN', lat: 28.4518,  lng: 117.9429,   radiusKm: 2.0, tags: ['solar','renewable'],            significance: 'moderate' },
  // ── Steel / Materials
  { id: 'posco-pohang',      ticker: '005490.KS', name: 'POSCO Pohang Works',                   country: 'KR', lat: 36.0320,  lng: 129.3826,   radiusKm: 3.0, tags: ['steel','materials'],            significance: 'major' },
  { id: 'baosteel-baoshan',  ticker: '600019.SS', name: 'Baowu Baosteel Baoshan Works',         country: 'CN', lat: 31.4055,  lng: 121.4896,   radiusKm: 3.0, tags: ['steel','materials'],            significance: 'major' },
  // ── Energy / LNG
  { id: 'sabine-pass-lng',   ticker: 'LNG',       name: 'Sabine Pass LNG Terminal / Louisiana', country: 'US', lat: 29.7541,  lng: -93.8741,   radiusKm: 2.5, tags: ['LNG','energy'],                 significance: 'major' },
];

// ── Copernicus 인증 ───────────────────────────────────────────────────────────
let _tokenCache = null;
async function getCopernicusToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60000) return _tokenCache.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'cdse-public', username: process.env.COPERNICUS_EMAIL, password: process.env.COPERNICUS_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Copernicus auth ${res.status}: ${(await res.text()).slice(0, 80)}`);
  const data = await res.json();
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 30) * 1000 };
  console.log(`  ✅ Copernicus 인증 완료`);
  return _tokenCache.token;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function getBbox(factory) {
  const m = factory.radiusKm / 111.32;
  return [factory.lng - m, factory.lat - m, factory.lng + m, factory.lat + m];
}
function toDb(linear) {
  return 10 * Math.log10(Math.max(linear, 1e-7));
}

// ── Evalscripts ───────────────────────────────────────────────────────────────

// SAR 표시용 false-color: Red=VV, Green=VH, Blue=VV/VH
const SAR_DISPLAY_EVALSCRIPT = `//VERSION=3
function setup(){return{input:[{bands:["VV","VH","dataMask"],units:"LINEAR_POWER"}],output:{bands:4}}}
function evaluatePixel(s){
  const vv=Math.sqrt(s.VV+1e-7);const vh=Math.sqrt(s.VH+1e-7);
  const ratio=Math.min(1,vv/Math.max(vh,0.001)/2.5);
  return[Math.min(1,vv*2.2),Math.min(1,vh*4),ratio,s.dataMask]
}`;

// SAR 통계용: ORBIT mosaicking + median (복수 패스 합성 → speckle 감소)
const SAR_STATS_EVALSCRIPT = `//VERSION=3
function setup(){return{input:[{bands:["VV","VH","dataMask"],units:"LINEAR_POWER"}],mosaicking:"ORBIT",output:[{id:"VV",bands:1,sampleType:"FLOAT32"},{id:"VH",bands:1,sampleType:"FLOAT32"},{id:"dataMask",bands:1}]}}
function median(arr){if(arr.length===0)return 0;arr.sort(function(a,b){return a-b});return arr[Math.floor(arr.length/2)];}
function evaluatePixel(samples){var vv=[],vh=[];for(var i=0;i<samples.length;i++){if(samples[i].dataMask){vv.push(samples[i].VV);vh.push(samples[i].VH);}}var ok=vv.length>0?1:0;return{VV:[median(vv)],VH:[median(vh)],dataMask:[ok]};}`;

// ── SAR Statistics API (핵심 — Vision AI 대체) ────────────────────────────────
async function fetchSARStats(factory, from, to, token) {
  const bbox = getBbox(factory);
  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-1-grd', dataFilter: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        acquisitionMode: 'IW', polarization: 'DV', resolution: 'HIGH',
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
    const err = await res.text().catch(() => '');
    console.warn(`  ⚠️  SAR 통계 API ${res.status}: ${err.slice(0, 100)}`);
    return null;
  }
  const data = await res.json();
  const vvS = data.data?.[0]?.outputs?.VV?.bands?.B0?.stats;
  const vhS = data.data?.[0]?.outputs?.VH?.bands?.B0?.stats;
  if (!vvS?.mean || !vhS?.mean || vvS.sampleCount === 0) {
    console.warn(`  ⚠️  SAR 통계 빈 응답 (커버리지 없음) status=${data.status} vvMean=${vvS?.mean} samples=${vvS?.sampleCount}`);
    return null;
  }
  return { vv_mean: vvS.mean, vh_mean: vhS.mean, vv_stdev: vvS.stDev ?? 0, vh_stdev: vhS.stDev ?? 0, sample_count: vvS.sampleCount ?? 0 };
}

// ── SAR 표시 이미지 fetch ─────────────────────────────────────────────────────
async function fetchSARImage(factory, token, dryRun) {
  const bbox = getBbox(factory);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
  if (dryRun) {
    console.log(`  [DRY-RUN] SAR bbox=${bbox.map(v=>v.toFixed(4)).join(',')} from=${from}`);
    return null;
  }
  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-1-grd', dataFilter: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        acquisitionMode: 'IW', polarization: 'DV', resolution: 'HIGH', mosaickingOrder: 'mostRecent',
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
    console.warn(`  ⚠️  SAR 이미지 ${res.status}: ${(await res.text().catch(()=>'')).slice(0,80)}`);
    return null;
  }
  const buf = await res.arrayBuffer();
  console.log(`  🛰️  SAR 이미지 수신 (${(buf.byteLength/1024).toFixed(0)} KB)`);
  return Buffer.from(buf).toString('base64');
}

// ── 베이스라인 (Redis 롤링 평균) ──────────────────────────────────────────────
async function loadBaseline(factoryId) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(`flowvium:satellite:sar-baseline:${factoryId}`)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function saveBaseline(factoryId, baseline) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(`flowvium:satellite:sar-baseline:${factoryId}`)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(baseline)),
      signal: AbortSignal.timeout(8000),
    });
    await fetch(`${REDIS_URL}/expire/${encodeURIComponent(`flowvium:satellite:sar-baseline:${factoryId}`)}/7776000`, {
      method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
  } catch (e) { console.warn(`  ⚠️  베이스라인 저장 실패: ${e.message}`); }
}

function updateBaseline(current, baseline, today) {
  const prev = baseline ?? { vv_mean: 0, vh_mean: 0, obs_count: 0, dates: [] };
  const n = Number(prev.obs_count ?? 0);
  const prevDates = Array.isArray(prev.dates) ? prev.dates : [];
  return {
    vv_mean: n > 0 ? (Number(prev.vv_mean) * n + current.vv_mean) / (n + 1) : current.vv_mean,
    vh_mean: n > 0 ? (Number(prev.vh_mean) * n + current.vh_mean) / (n + 1) : current.vh_mean,
    obs_count: n + 1,
    dates: [...prevDates.slice(-14), today],
  };
}

// ── 시설 타입별 SAR 가중치 ────────────────────────────────────────────────────
const SAR_WEIGHTS = {
  port:      { vv: 11, vh: 4, constrVhDb: 2.5 }, // 크레인/컨테이너: VV 강함
  LNG:       { vv: 8,  vh: 5, constrVhDb: 2.4 }, // 탱크+선박: VV+VH 혼합
  fab:       { vv: 8,  vh: 6, constrVhDb: 2.0 }, // 반도체 fab: 현행 기준
  aerospace: { vv: 7,  vh: 5, constrVhDb: 2.3 }, // 격납고/계류장: VV 우세
  auto:      { vv: 8,  vh: 4, constrVhDb: 2.3 }, // 완성차 야드: VV
  steel:     { vv: 10, vh: 4, constrVhDb: 2.5 }, // 금속 산란체: VV 강함
  solar:     { vv: 6,  vh: 5, constrVhDb: 2.2 }, // 패널 지붕: 혼합
  default:   { vv: 8,  vh: 6, constrVhDb: 2.0 },
};

function getFacilityType(factory) {
  const t = factory.tags;
  if (t.includes('port'))      return 'port';
  if (t.includes('LNG'))       return 'LNG';
  if (t.includes('aerospace')) return 'aerospace';
  if (t.includes('auto'))      return 'auto';
  if (t.includes('steel'))     return 'steel';
  if (t.includes('solar'))     return 'solar';
  return 'fab';
}

// ── 점수 계산 (순수 수치, 추측 없음) ─────────────────────────────────────────
function scoreFactory(current, baseline, factory) {
  const w = SAR_WEIGHTS[getFacilityType(factory)] ?? SAR_WEIGHTS.default;
  const vv_db = Math.round(toDb(current.vv_mean) * 10) / 10;
  const vh_db = Math.round(toDb(current.vh_mean) * 10) / 10;
  const obsCount = baseline?.obs_count ?? 0;
  let score, vv_delta_db = null, vh_delta_db = null, constructionVisible = false;
  let confidence;

  if (baseline && obsCount >= 2) {
    vv_delta_db = Math.round((vv_db - toDb(baseline.vv_mean)) * 100) / 100;
    vh_delta_db = Math.round((vh_db - toDb(baseline.vh_mean)) * 100) / 100;
    score = Math.max(5, Math.min(97, 50 + Math.round(vv_delta_db * w.vv + vh_delta_db * w.vh)));
    constructionVisible = vh_delta_db > w.constrVhDb;
    confidence = obsCount >= 5 ? 'high' : 'medium';
  } else {
    // 절대값 기반 (첫 스캔)
    if (vv_db > -6) score = 78;
    else if (vv_db > -9) score = 62;
    else if (vv_db > -13) score = 46;
    else score = 28;
    constructionVisible = (vh_db - vv_db) > -10;
    confidence = 'low';
  }

  const vehicleDensity = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  const loadingActivity = score >= 75 ? 'busy' : score >= 40 ? 'normal' : 'inactive';
  const summaryParts = [];
  if (vv_delta_db !== null && obsCount >= 2) {
    summaryParts.push(`레이더(VV) ${vv_delta_db >= 0 ? '+' : ''}${vv_delta_db}dB vs ${obsCount}회 평균`);
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
    activityScore: score, vv_db, vh_db, vv_delta_db, vh_delta_db,
    vehicleDensity, cloudCoverage: 'clear', loadingActivity,
    constructionVisible, confidence, summary: summaryParts.join('. '),
  };
}

// ── 히스토리 (30일 점수 시계열) ───────────────────────────────────────────────
async function loadHistory(factoryId) {
  if (!REDIS_URL || !REDIS_TOKEN) return { v: 1, points: [] };
  try {
    const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(`flowvium:satellite:history:${factoryId}`)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { v: 1, points: [] };
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : { v: 1, points: [] };
  } catch { return { v: 1, points: [] }; }
}

async function saveHistory(factoryId, point) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    const prev = await loadHistory(factoryId);
    const points = [...(prev.points ?? []).filter(p => p.d !== point.d), point].slice(-30);
    await redisSet(`flowvium:satellite:history:${factoryId}`, JSON.stringify({ v: 1, points }), 7776000);
  } catch (e) { console.warn(`  ⚠️  히스토리 저장 실패: ${e?.message}`); }
}

// ── Redis 저장 ─────────────────────────────────────────────────────────────────
async function redisSet(key, value, exSec) {
  if (!REDIS_URL || !REDIS_TOKEN) { console.warn(`  ⚠️  Redis 미설정 — ${key} 저장 스킵`); return false; }
  try {
    const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`  ❌ Redis set ${key} HTTP ${res.status}: ${(await res.text()).slice(0,80)}`); return false; }
    if (exSec) {
      await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${exSec}`, {
        method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      });
    }
    return true;
  } catch (e) { console.error(`  ❌ Redis set ${key} 예외: ${e.message}`); return false; }
}

// ── 출력 ─────────────────────────────────────────────────────────────────────
function printResult(factory, analysis, today, obsCount) {
  const score = analysis.activityScore ?? 0;
  const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
  const color = score >= 70 ? '🔴' : score >= 50 ? '🟡' : '🟢';
  const deltaStr = analysis.vv_delta_db != null ? ` Δ${analysis.vv_delta_db >= 0 ? '+' : ''}${analysis.vv_delta_db}dB` : ' (기준선 축적중)';
  console.log(`\n  ${color} [${factory.ticker}] ${factory.name}`);
  console.log(`     활동지수: ${bar} ${score}/100`);
  console.log(`     VV: ${analysis.vv_db}dB · VH: ${analysis.vh_db}dB${deltaStr}`);
  console.log(`     건설: ${analysis.constructionVisible ? '🔨 YES' : 'NO'} | 신뢰도: ${analysis.confidence} (관측 ${obsCount}회)`);
  console.log(`     요약: ${analysis.summary}`);
}

function saveLocal(results, today) {
  const outPath = path.join(ROOT, 'research_history', `${today}_satellite-scan.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`  📁 로컬 저장: ${outPath}`);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const factoryFilter = args.find(a => a.startsWith('--factory='))?.split('=')[1]
    ?? (args.find(a => !a.startsWith('-')) ?? null);

  const targets = factoryFilter
    ? FACTORIES.filter(f => f.id === factoryFilter || f.ticker === factoryFilter.toUpperCase())
    : FACTORIES;

  if (targets.length === 0) {
    console.error(`❌ factory '${factoryFilter}' 없음. 사용 가능: ${FACTORIES.map(f=>f.id).join(', ')}`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n🛰️  FlowVium 위성 공장 스캔 (Sentinel-1 SAR)`);
  console.log(`   대상: ${targets.length}개 공장 | 날짜: ${today}`);
  console.log(`   모드: ${dryRun ? 'DRY-RUN' : 'LIVE'} | 방식: 레이더 수치 (추측 없음)\n`);

  if (!dryRun && (!process.env.COPERNICUS_EMAIL || !process.env.COPERNICUS_PASSWORD)) {
    console.error('❌ COPERNICUS_EMAIL / COPERNICUS_PASSWORD 미설정');
    process.exit(1);
  }
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.warn('⚠️  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 미설정 — Redis 저장 스킵\n');
  }

  let token = null;
  if (!dryRun) {
    try { token = await getCopernicusToken(); }
    catch (e) { console.error(`❌ 인증 실패: ${e.message}`); process.exit(1); }
  }

  const statsFrom = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
  const results = [];
  let success = 0, failed = 0;

  for (const factory of targets) {
    console.log(`\n📍 ${factory.name} (${factory.id})`);
    try {
      // 1) SAR 통계 (핵심)
      const stats = await fetchSARStats(factory, statsFrom, today, token ?? 'dry');
      if (!stats && !dryRun) {
        console.warn(`  ⚠️  SAR 데이터 없음 (커버리지 부족 또는 API 오류)`);
        results.push({ ...factory, activityScore: null, error: 'no_sar_data', scannedAt: new Date().toISOString(), imageDate: today, source: 'SAR' });
        failed++;
        continue;
      }

      // 1b) samples 필터 — 픽셀 수 부족 시 신뢰 불가
      if (stats && stats.sample_count < 500 && !dryRun) {
        console.warn(`  ⚠️  SAR samples 부족: ${stats.sample_count}/500 → 스킵`);
        results.push({ ...factory, activityScore: null, error: 'insufficient_sar_samples', scannedAt: new Date().toISOString(), imageDate: today, source: 'SAR' });
        failed++;
        continue;
      }

      // 2) 베이스라인 + 점수
      const baseline = dryRun ? null : await loadBaseline(factory.id);
      const analysis = stats ? scoreFactory(stats, baseline, factory) : { activityScore: null, vv_db: null, vh_db: null, vv_delta_db: null, vh_delta_db: null, vehicleDensity: null, cloudCoverage: 'clear', loadingActivity: null, constructionVisible: false, confidence: 'low', summary: 'DRY-RUN' };
      printResult(factory, analysis, today, baseline?.obs_count ?? 0);

      // 3) 베이스라인 업데이트
      if (stats && !dryRun) {
        const updatedBaseline = updateBaseline(stats, baseline, today);
        await saveBaseline(factory.id, updatedBaseline);
        console.log(`     베이스라인: ${updatedBaseline.obs_count}회 축적 (vv_mean=${toDb(updatedBaseline.vv_mean).toFixed(1)}dB)`);
      }

      // 4) SAR 이미지
      const imageBase64 = await fetchSARImage(factory, token ?? 'dry', dryRun);
      if (imageBase64) {
        const sizeKB = Math.round(imageBase64.length / 1024);
        const ok = await redisSet(`flowvium:satellite:img:${factory.id}`, imageBase64, 604800);
        console.log(`  📸 SAR 이미지 저장: ${sizeKB}KB → Redis ${ok ? 'OK' : 'FAIL'}`);
      }

      const result = {
        id: factory.id, ticker: factory.ticker, name: factory.name,
        country: factory.country, tags: factory.tags, significance: factory.significance,
        ...analysis, scannedAt: new Date().toISOString(), imageDate: today,
        source: 'SAR',
        sar_raw: stats ? { vv_db: analysis.vv_db, vh_db: analysis.vh_db, samples: stats.sample_count } : null,
      };
      results.push(result);
      // 5) 히스토리 저장
      if (analysis.activityScore != null && !dryRun) {
        await saveHistory(factory.id, { d: today, s: analysis.activityScore, vv: analysis.vv_db, vh: analysis.vh_db, c: analysis.confidence?.[0] ?? 'l' });
      }
      success++;
    } catch (e) {
      const errMsg = String(e?.message ?? e);
      console.error(`  ❌ 오류: ${errMsg}`);
      results.push({ ...factory, activityScore: null, error: errMsg.slice(0, 120), scannedAt: new Date().toISOString(), imageDate: today, source: 'SAR' });
      failed++;
    }
  }

  // Redis 결과 저장
  if (success > 0 && !dryRun) {
    const scanKey = `flowvium:satellite:v1:${today}`;
    const ok = await redisSet(scanKey, JSON.stringify({ results, updatedAt: new Date().toISOString(), mode: 'SAR' }), 172800);
    console.log(`\n────────────────────────────────────────────────────────────`);
    console.log(`✅ 완료: 성공 ${success} | 실패 ${failed}`);
    console.log(`  💾 Redis 저장: ${scanKey} → ${ok ? 'OK' : 'FAIL'}`);
    saveLocal(results, today);
  } else if (dryRun) {
    console.log(`\n✅ DRY-RUN 완료 (Redis 저장 안 함)`);
  }

  // 점수 순위
  const scored = results.filter(r => r.activityScore != null).sort((a, b) => b.activityScore - a.activityScore);
  if (scored.length > 0) {
    console.log(`\n📊 SAR 활동 지수 순위:`);
    scored.forEach((r, i) => {
      const bar = '█'.repeat(Math.round(r.activityScore / 10));
      const delta = r.vv_delta_db != null ? ` (Δ${r.vv_delta_db >= 0 ? '+' : ''}${r.vv_delta_db}dB)` : '';
      console.log(`   ${i+1}. [${String(r.activityScore).padStart(3)}] ${bar.padEnd(10)} ${r.name}${delta}`);
    });
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });

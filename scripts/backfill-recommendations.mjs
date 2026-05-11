#!/usr/bin/env node
/**
 * backfill-recommendations.mjs
 *
 * reports/ 폴더의 모든 보고서를 portfolio-retrospective PRED_KEY 로 적재.
 * 기존 추천이 평가 큐에 들어가도록 일회성 백필.
 *
 * 사용:
 *   node scripts/backfill-recommendations.mjs              # dry run (요약만)
 *   node scripts/backfill-recommendations.mjs --apply      # Redis 실제 쓰기
 *
 * 적재 후 daily cron (/api/cron/portfolio-retrospective) 가 14일 경과 항목 평가.
 * 결과는 /api/portfolio-accuracy 로 조회.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPORTS_DIR = resolve(ROOT, 'reports');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}
const env = loadEnv();
const UPSTASH_URL = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
const UPSTASH_TOKEN = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;

const PRED_KEY = 'flowvium:retro:predictions:v2';

function parsePrice(s) {
  if (!s) return null;
  const m = String(s).replace(/[$₩€,\s]/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function parseZone(s) {
  if (!s) return [null, null];
  const m = String(s).match(/([₩$€]?[\d,]+\.?\d*)\s*[-~]\s*([₩$€]?[\d,]+\.?\d*)/);
  if (!m) {
    const single = parsePrice(s);
    return [single, single];
  }
  return [parsePrice(m[1]), parsePrice(m[2])];
}

function inferSession(generatedAt) {
  const d = new Date(generatedAt);
  const kstHour = (d.getUTCHours() + 9) % 24;
  if (kstHour >= 7 && kstHour < 16) return 'morning';
  if (kstHour >= 16 && kstHour < 22) return 'afternoon';
  return 'evening';
}

function reportToPredictions(report, filename) {
  if (!Array.isArray(report.portfolio)) return [];
  const generatedAt = report.generatedAt ?? new Date().toISOString();
  const kstDate = new Date(new Date(generatedAt).getTime() + 9*3600000).toISOString().slice(0, 10);
  const session = report.session ?? inferSession(generatedAt);
  const reportId = `${kstDate}:${session}`;
  // evaluate after 14 days from generation
  const evalDate = new Date(new Date(generatedAt).getTime() + 14 * 86400000).toISOString();

  return report.portfolio
    .filter(p => p.ticker && p.action !== 'hold')
    .map(p => {
      const [lo, hi] = parseZone(p.entryZone);
      return {
        id: `${kstDate}:${session}:${p.ticker}`,
        reportId,
        ticker: p.ticker, name: p.name ?? p.ticker,
        generatedAt, evaluateAfter: evalDate,
        entryZoneLow: lo, entryZoneHigh: hi,
        target: parsePrice(p.target),
        stopLoss: parsePrice(p.stopLoss),
        priceAtGen: p.currentPrice ?? null,
        rationale: (p.rationale ?? '').slice(0, 120),
        entryRationale: p.entryRationale,
        targetRationale: p.targetRationale,
        action: p.action ?? 'watch',
        reportStance: report.stance,
        reportRiskEvents: Array.isArray(report.riskEvents)
          ? report.riskEvents.slice(0, 5).map(e => `${e.date}:${e.event}`)
          : undefined,
        sectorWeights: Array.isArray(report.sectorAllocation)
          ? Object.fromEntries(report.sectorAllocation.map(s => [s.sector, s.pct]))
          : undefined,
        _backfilledFrom: filename,
      };
    });
}

const files = readdirSync(REPORTS_DIR)
  .filter(f => f.match(/^report-\d{4}-\d{2}-\d{2}-(morning|afternoon|evening)-(ko|en)\.json$/))
  .sort();

console.log(`\n=== backfill-recommendations (${files.length}개 보고서) ${APPLY ? '— APPLY' : '— DRY RUN'} ===\n`);

const allPreds = [];
const tickerSet = new Set();
for (const file of files) {
  const path = resolve(REPORTS_DIR, file);
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const preds = reportToPredictions(report, file);
    for (const p of preds) {
      tickerSet.add(p.ticker);
    }
    allPreds.push(...preds);
    console.log(`📄 ${file}: ${preds.length} 추천 (${report.portfolio?.length ?? 0} portfolio entries)`);
  } catch (e) {
    console.warn(`  ⚠️  ${file}: parse error ${e.message?.slice(0, 80)}`);
  }
}

// dedup by id (같은 (date, session, ticker) 는 한 번만)
const idMap = new Map();
for (const p of allPreds) idMap.set(p.id, p);
const deduped = Array.from(idMap.values()).slice(0, 500); // 상한 500

console.log(`\n=== 합계: ${allPreds.length} 항목 → dedup ${deduped.length} (${tickerSet.size} 고유 ticker) ===\n`);

if (!APPLY) {
  console.log('💡 실제 적재: --apply 플래그');
  process.exit(0);
}

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error('❌ UPSTASH_REDIS_REST_URL / TOKEN 미설정 — .env.local 확인');
  process.exit(1);
}

// Redis SET PRED_KEY = deduped (merge with existing)
async function loadExisting() {
  const res = await fetch(`${UPSTASH_URL}/get/${PRED_KEY}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const val = data?.result;
  if (typeof val !== 'string') return [];
  try { return JSON.parse(val); } catch { return []; }
}
async function writeAll(arr) {
  // 90일 TTL
  const url = `${UPSTASH_URL}/set/${PRED_KEY}?EX=${90*86400}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'text/plain' },
    body: JSON.stringify(arr),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}

(async () => {
  const existing = await loadExisting();
  console.log(`기존 Redis 항목: ${existing.length}`);
  const existingIds = new Set(existing.map(e => e?.id).filter(Boolean));
  const newOnly = deduped.filter(p => !existingIds.has(p.id));
  const merged = [...newOnly, ...existing].slice(0, 500);
  await writeAll(merged);
  console.log(`✅ Redis 저장 — ${newOnly.length} 신규 + ${existing.length} 기존 = ${merged.length} 총`);
  console.log(`다음 단계: GET /api/cron/portfolio-retrospective 호출 → 14일 경과분 평가`);
})();

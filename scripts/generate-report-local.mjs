/**
 * generate-report-local.mjs
 *
 * 로컬 PC에서 AI 리포트 생성 후 Upstash Redis에 직접 업로드.
 * 사용법:
 *   # Ollama로 로컬 생성
 *   node scripts/generate-report-local.mjs --model ollama/qwen2.5:14b
 *
 *   # 또는 CRON_SECRET으로 Vercel 서버에 직접 force 요청
 *   node scripts/generate-report-local.mjs --via-vercel
 *
 * 필요: .env.local에 UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// .env.local 파싱
function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { console.error('.env.local not found'); process.exit(1); }
  return env;
}

const env = loadEnv();
const args = process.argv.slice(2);
const viaVercel = args.includes('--via-vercel');
const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1] ?? 'ollama/qwen3:14b';
const SITE = env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '') || 'https://flowvium.net';

// ── Option A: Vercel force 요청 ──────────────────────────────────────────────
async function generateViaVercel() {
  const secret = env.CRON_SECRET;
  if (!secret) { console.error('CRON_SECRET not set'); process.exit(1); }

  console.log('Vercel force 요청 중... (최대 90초)');
  const res = await fetch(`${SITE}/api/investment-strategy?force=1`, {
    headers: { 'Authorization': `Bearer ${secret}`, 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(95000),
  });
  if (!res.ok) { console.error('HTTP', res.status); process.exit(1); }
  const data = await res.json();
  console.log('source:', data.source);
  console.log('schemaVersion:', data.schemaVersion);
  console.log('Has 7-section:', !!data.marketNarrative);
  console.log('Portfolio:', data.portfolio?.map(p => p.ticker).join(', '));
  return data;
}

// ── Option B: Ollama 로컬 생성 ───────────────────────────────────────────────
async function callOllama(prompt, model = 'qwen2.5:14b') {
  const baseModel = model.replace('ollama/', '');
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: baseModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: 0.5, num_predict: 2000 },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const d = await res.json();
  return d.message?.content ?? '';
}

// Upstash Redis에 직접 저장
async function redisSet(key, value, exSeconds) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { console.error('Upstash env not set'); process.exit(1); }

  const body = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', String(exSeconds)]
    : ['SET', key, JSON.stringify(value)];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  return d.result === 'OK';
}

function getSession() {
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour >= 7 && kstHour < 16) return 'morning';
  if (kstHour >= 16 && kstHour < 22) return 'afternoon';
  return 'evening';
}

async function generateViaOllama() {
  console.log(`Ollama(${modelArg}) 로컬 생성 중...`);

  // 컨텍스트 데이터 가져오기 (Vercel API에서)
  console.log('컨텍스트 데이터 수집...');
  const [fgRes, capitalRes] = await Promise.allSettled([
    fetch(`${SITE}/api/fear-greed`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
    fetch(`${SITE}/api/capital-flows`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
  ]);

  const fg = fgRes.status === 'fulfilled' ? fgRes.value : {};
  const capital = capitalRes.status === 'fulfilled' ? capitalRes.value : {};

  const usScore = fg.byCountry?.find(c => c.id === 'us')?.score ?? '?';
  const topFlows = capital.flow?.topInflows?.slice(0, 3).map(a => `${a.label}+${a.ret4w?.toFixed(1)}%`).join(', ') ?? '';

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are a portfolio manager. Date: ${today}.
Context: US Fear&Greed=${usScore}/100. Top inflows: ${topFlows}.

[FACTS — MANDATORY]
- Jerome Powell is FORMER Fed Chair (term ended 2026-02). Do NOT call him current chair.
- Approved tickers: NVDA,AAPL,MSFT,GOOGL,META,AMZN,TSLA,AMD,AVGO,JPM,GS,V,MA,XLK,XLE,XLF,XLV,GLD,TLT,SPY,QQQ,EWY,EWT,EWJ,USO
[END FACTS]

Generate a JSON investment strategy with these exact fields:
{
  "stance": "bullish|neutral|bearish",
  "thesis": "≤50 chars",
  "portfolio": [
    {"ticker":"NVDA","name":"NVIDIA","sector":"Technology","market":"us",
     "rationale":"data-driven ≤100 chars","allocation":15,
     "entryZone":"$205-212","entryRationale":"50일선 지지","stopLoss":"$190",
     "target":"$240","targetRationale":"52주 고점 저항","confidence":"high","action":"buy"}
  ],
  "sectorAllocation": [{"sector":"Technology","pct":25,"stance":"overweight","reason":"AI momentum"}],
  "riskEvents": [{"date":"${today}","event":"FOMC","impact":"high","watchFor":"rate guidance"}],
  "macroAnalysis": "≤150 chars",
  "technicalAnalysis": "≤120 chars",
  "fundamentalAnalysis": "≤120 chars",
  "riskLevel": "medium",
  "marketNarrative": {"why":"≤100 chars","watch":"≤80 chars","story":"≤100 chars","sessionNote":"morning"},
  "shortSqueeze": [{"ticker":"SMCI","score":45,"timing":"48h","risk":"earnings vol"}],
  "insiderSignals": [{"ticker":"GOOGL","filings":5,"significance":"Berkshire accumulation","pattern":"연속매집"}],
  "regionStances": {"us":{"stance":"bullish","thesis":"AI capex","keyData":"SPY+0.5% 1w"},"korea":{"stance":"bullish","thesis":"HBM demand","keyData":"EWY+1.2% 1w"}},
  "stopLossRationale": [{"ticker":"NVDA","rationale":"50일선 이탈 시 추세전환"}],
  "hedgingSuggestion": "VIX 저변동성 구간 — TLT 5% 인플레 헤지",
  "portfolioRiskNote": "전반적 리스크 보통"
}
6-8 portfolio items, allocation sum=100, pure JSON only, Korean rationale preferred.`;

  let text = '';
  try {
    text = await callOllama(prompt, modelArg);
    console.log('Ollama 응답 수신 (chars:', text.length, ')');
  } catch (e) {
    console.error('Ollama 실패:', e.message);
    console.error('Ollama가 실행 중인지 확인: ollama serve');
    process.exit(1);
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) { console.error('JSON 파싱 실패'); console.log(text.slice(0, 500)); process.exit(1); }

  let report;
  try { report = JSON.parse(match[0]); } catch (e) { console.error('JSON parse error:', e.message); process.exit(1); }

  const now = new Date().toISOString();
  const session = getSession();
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const key = `flowvium:investment-strategy:v8:${kstDate}:${session}`;
  const staleKey = 'flowvium:investment-strategy:stale:v8';

  const finalReport = {
    ...report,
    generatedAt: now,
    dataAsOf: now,
    source: `local-${modelArg}`,
    schemaVersion: 8,
    buildId: 'local',
  };

  // 히스토리 배열 업데이트 (UI 탭에 표시)
  const HIST_KEY = 'flowvium:investment-strategy:history:arr:v1';
  const SESSION_KO = { morning: '오전 (미국장 마감 후)', afternoon: '오후 (아시아장 마감 후)', evening: '저녁 (미국장 개장 전)' };
  const histMeta = {
    key, generatedAt: now, session,
    kstDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '),
    stance: report.stance ?? 'neutral',
    thesis: (report.thesis ?? '').slice(0, 80),
    riskLevel: report.riskLevel ?? 'medium',
    source: finalReport.source,
    sessionLabel: SESSION_KO[session] ?? session,
  };
  async function updateHistory() {
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    const getRes = await fetch(`${url}/get/${encodeURIComponent(HIST_KEY)}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const getD = await getRes.json();
    let existing = [];
    if (getD.result) {
      try { existing = JSON.parse(typeof getD.result === 'string' ? getD.result : JSON.stringify(getD.result)); } catch {}
    }
    if (!Array.isArray(existing)) existing = [];
    const updated = [histMeta, ...existing.filter(e => e.generatedAt !== now)].slice(0, 30);
    await redisSet(HIST_KEY, updated, 90 * 86400);
  }

  console.log('Redis 저장 중...');
  const [ok1, ok2] = await Promise.all([
    redisSet(key, finalReport, 86400),
    redisSet(staleKey, finalReport, 7 * 86400),
  ]);
  await updateHistory();

  console.log(`session key (${key}): ${ok1 ? '✅' : '❌'}`);
  console.log(`stale key: ${ok2 ? '✅' : '❌'}`);
  console.log('source:', finalReport.source);
  console.log('Portfolio:', report.portfolio?.map(p => p.ticker).join(', '));
  console.log('Has 7-section:', !!report.marketNarrative);
  console.log('');
  console.log('✅ 완료! flowvium.net/ko/report 에서 확인하세요.');
}

// ── Main ─────────────────────────────────────────────────────────────────────
if (viaVercel) {
  generateViaVercel().catch(console.error);
} else {
  generateViaOllama().catch(console.error);
}

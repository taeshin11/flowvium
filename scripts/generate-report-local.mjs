/**
 * generate-report-local.mjs — 로컬 AI 보고서 생성 + 업로드 도구
 *
 * 사용법:
 *   # Step 1: 로컬 Ollama로 생성 → reports/ 에 JSON 저장 (Redis 업로드 안 함)
 *   node scripts/generate-report-local.mjs
 *   node scripts/generate-report-local.mjs --model=qwen3:14b
 *
 *   # Step 2: 저장된 파일 검토 후 업로드
 *   node scripts/generate-report-local.mjs --upload=reports/report-2026-05-05-afternoon.json
 *   node scripts/generate-report-local.mjs --upload=latest   ← 가장 최근 파일
 *
 *   # 한 번에 생성 + 즉시 업로드 (품질게이트 통과 시만)
 *   node scripts/generate-report-local.mjs --auto-upload
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const REPORTS_DIR = resolve(ROOT, 'reports');

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
const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1] ?? 'qwen3:14b';
const uploadArg = args.find(a => a.startsWith('--upload='))?.split('=')[1];
const autoUpload = args.includes('--auto-upload');
const localeArg = args.find(a => a.startsWith('--locale='))?.split('=')[1] ?? 'ko';
const SITE = env.NEXT_PUBLIC_SITE_URL?.replace(/\s+/g, '') || 'https://flowvium.net';

// ── 품질 게이트 (strategy-quality.ts 로직 동일) ────────────────────────────────
const GARBAGE_MIN_LEN = { thesis: 25, macroAnalysis: 30, technicalAnalysis: 15, fundamentalAnalysis: 15 };
// CJK 한자는 글자당 밀도가 높으므로 최솟값을 60%로 축소
const CJK_LOCALES = new Set(['ja', 'zh-CN', 'zh-TW', 'zh']);
function garbageMinLen(base) {
  return CJK_LOCALES.has(localeArg) ? Math.ceil(base * 0.6) : base;
}

function isGarbage(text, minLen = 15) {
  if (!text || text.trim().length === 0) return false;
  const t = text.trim();
  if (t.length < minLen) return true;
  if (/^[^\n+]+(\+[^\n+]+){2,}$/.test(t)) return true;
  if (t.length < 80 && /^[^\n+]{3,}\+[^\n+]{3,}$/.test(t) && !/\d+%|\d+\.\d+|\$\d/.test(t)) return true;
  if (/^[^\n/|→]+([/|→][^\n/|→]+){2,}$/.test(t) && t.length < 80) return true;
  const tokens = t.split(/[\s,+|/·→]+/).filter(w => w.length > 1);
  if (tokens.length >= 4) {
    const freq = new Map();
    for (const tok of tokens) freq.set(tok.toLowerCase(), (freq.get(tok.toLowerCase()) ?? 0) + 1);
    const maxFreq = Math.max(...Array.from(freq.values()));
    if (maxFreq / tokens.length > 0.55) return true;
  }
  return false;
}

function qualityCheck(report) {
  const issues = [];
  if (isGarbage(report.thesis, garbageMinLen(GARBAGE_MIN_LEN.thesis)))
    issues.push(`thesis GARBAGE: "${report.thesis}"`);
  if (isGarbage(report.macroAnalysis, garbageMinLen(GARBAGE_MIN_LEN.macroAnalysis)))
    issues.push(`macroAnalysis GARBAGE: "${report.macroAnalysis?.slice(0, 60)}"`);
  if (isGarbage(report.technicalAnalysis, garbageMinLen(GARBAGE_MIN_LEN.technicalAnalysis)))
    issues.push(`technicalAnalysis GARBAGE: "${report.technicalAnalysis?.slice(0, 60)}"`);
  if (!report.portfolio?.length) issues.push('portfolio EMPTY');
  if (!report.marketNarrative) issues.push('marketNarrative MISSING');
  if (!report.regionStances || Object.keys(report.regionStances).length === 0) issues.push('regionStances MISSING');
  if (!report.shortSqueeze?.length) issues.push('shortSqueeze MISSING');

  // 품질 점수 (0-100)
  let score = 0;
  if ((report.thesis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.thesis))              score += 15;
  if ((report.macroAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.macroAnalysis)) score += 15;
  if ((report.technicalAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.technicalAnalysis)) score += 10;
  if ((report.fundamentalAnalysis?.length ?? 0) >= garbageMinLen(GARBAGE_MIN_LEN.fundamentalAnalysis)) score += 10;
  if ((report.portfolio?.length ?? 0) >= 2)             score += 15;
  if ((report.riskEvents?.length ?? 0) >= 1)            score += 5;
  if (Object.keys(report.regionStances ?? {}).length >= 2) score += 5;
  if ((report.shortSqueeze?.length ?? 0) >= 1)          score += 5;
  if ((report.insiderSignals?.length ?? 0) >= 1)        score += 3;
  if ((report.stopLossRationale?.length ?? 0) >= 1)     score += 5;
  if (report.marketNarrative?.why || report.marketNarrative?.story) score += 5;
  if ((report.companyChanges?.length ?? 0) >= 1)        score += 7;

  return { ok: issues.length === 0, issues, score };
}

// ── Redis 업로드 ────────────────────────────────────────────────────────────────
async function redisPost(body) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { console.error('Upstash env not set'); process.exit(1); }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  return d.result === 'OK';
}

async function redisSet(key, value, exSeconds) {
  const cmd = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', String(exSeconds)]
    : ['SET', key, JSON.stringify(value)];
  return redisPost(cmd);
}

function getSession() {
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour >= 7 && kstHour < 16) return 'morning';
  if (kstHour >= 16 && kstHour < 22) return 'afternoon';
  return 'evening';
}

// ── Step 2: 파일 → Redis 업로드 ────────────────────────────────────────────────
async function uploadFromFile(filePath) {
  let resolved = filePath;
  if (filePath === 'latest') {
    if (!existsSync(REPORTS_DIR)) { console.error('reports/ 디렉토리 없음. 먼저 생성하세요.'); process.exit(1); }
    const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).sort();
    if (!files.length) { console.error('reports/ 에 파일 없음'); process.exit(1); }
    resolved = resolve(REPORTS_DIR, files[files.length - 1]);
    console.log(`최신 파일: ${basename(resolved)}`);
  } else {
    resolved = resolve(process.cwd(), filePath);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (e) { console.error('파일 읽기 실패:', e.message); process.exit(1); }

  console.log('\n=== 품질 게이트 검사 ===');
  const { ok, issues, score } = qualityCheck(report);
  console.log(`품질 점수: ${score}/100`);
  if (issues.length) {
    console.log('⚠️  문제 발견:');
    for (const i of issues) console.log('   ', i);
  } else {
    console.log('✅ 품질 검사 통과');
  }

  if (!ok) {
    console.error('\n❌ 품질 게이트 실패 — 업로드 중단됨.');
    console.error('   보고서를 직접 수정한 후 다시 시도하거나 --force-upload 옵션 사용.');
    process.exit(1);
  }

  const locale = report.locale ?? localeArg;
  const session = report.session ?? getSession();
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const sessionKey = `flowvium:investment-strategy:v8:${kstDate}:${session}:${locale}`;
  const staleKeyStr = `flowvium:investment-strategy:stale:v8:${locale}`;

  console.log(`\n=== Redis 업로드 ===`);
  console.log(`session key: ${sessionKey}`);
  console.log(`stale   key: ${staleKeyStr}`);

  const [ok1, ok2] = await Promise.all([
    redisSet(sessionKey, report, 86400),
    redisSet(staleKeyStr, report, 7 * 86400),
  ]);

  // 히스토리 배열 업데이트
  const HIST_KEY = 'flowvium:investment-strategy:history:arr:v1';
  const histMeta = {
    key: sessionKey,
    generatedAt: report.generatedAt,
    session,
    kstDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '),
    stance: report.stance ?? 'neutral',
    thesis: (report.thesis ?? '').slice(0, 80),
    riskLevel: report.riskLevel ?? 'medium',
    source: report.source,
    locale,
  };
  try {
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    const getRes = await fetch(`${url}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', HIST_KEY]),
    });
    const getD = await getRes.json();
    let existing = [];
    try { existing = JSON.parse(typeof getD.result === 'string' ? getD.result : JSON.stringify(getD.result ?? '[]')); } catch {}
    if (!Array.isArray(existing)) existing = [];
    const updated = [histMeta, ...existing.filter(e => e.generatedAt !== report.generatedAt)].slice(0, 30);
    await redisSet(HIST_KEY, updated, 90 * 86400);
    console.log('히스토리 업데이트 완료');
  } catch (e) { console.log('히스토리 업데이트 실패 (non-fatal):', e.message); }

  console.log(`\nsession key: ${ok1 ? '✅' : '❌'}`);
  console.log(`stale   key: ${ok2 ? '✅' : '❌'}`);
  console.log(`source: ${report.source}`);
  console.log(`quality score: ${score}/100`);
  console.log(`\n✅ 업로드 완료! ${SITE}/${locale}/report 에서 확인`);
}

// ── Step 1: Ollama 생성 ─────────────────────────────────────────────────────────
async function callOllama(prompt, model) {
  const isQwen3 = model.startsWith('qwen3');
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    options: { temperature: 0.6, num_predict: 4096 },
    ...(isQwen3 ? { think: false } : {}),
  };
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const d = await res.json();
  return d.message?.content ?? '';
}

async function generateViaOllama() {
  console.log(`=== 로컬 Ollama 보고서 생성 (${modelArg}) ===`);
  console.log(`locale: ${localeArg}, auto-upload: ${autoUpload}`);

  // 컨텍스트 데이터 수집
  console.log('\n[1/4] 컨텍스트 데이터 수집...');
  const [fgRes, capitalRes, macroRes] = await Promise.allSettled([
    fetch(`${SITE}/api/fear-greed`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
    fetch(`${SITE}/api/capital-flows`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
    fetch(`${SITE}/api/macro-indicators`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
  ]);

  const fg = fgRes.status === 'fulfilled' ? fgRes.value : {};
  const capital = capitalRes.status === 'fulfilled' ? capitalRes.value : {};
  const macro = macroRes.status === 'fulfilled' ? macroRes.value : {};

  const usScore = fg.byCountry?.find(c => c.id === 'us')?.score ?? '?';
  const krScore = fg.byCountry?.find(c => c.id === 'kr')?.score ?? '?';
  const topFlows = capital.flow?.topInflows?.slice(0, 3).map(a => `${a.label}+${a.ret4w?.toFixed(1)}%`).join(', ') ?? '';
  const vix = macro?.indicators?.find?.(i => i.id === 'vix')?.value ?? '?';

  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const session = getSession();
  const SESSION_KO = { morning: '오전 (미국장 마감 후)', afternoon: '오후 (아시아장)', evening: '저녁 (미국장 개장 전)' };

  const LOCALE_LANG = {
    ko: 'Korean', en: 'English', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
    es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian',
    ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', th: 'Thai', tr: 'Turkish', vi: 'Vietnamese',
  };
  const targetLang = LOCALE_LANG[localeArg] ?? 'Korean';
  const sessionLabel = localeArg === 'ko' ? (SESSION_KO[session] ?? session) : session;

  console.log(`  US F&G: ${usScore}, KR F&G: ${krScore}, VIX: ${vix}, Top flows: ${topFlows}`);

  const prompt = `You are a senior portfolio manager. Date: ${today} KST. Session: ${sessionLabel}.
Live data: US Fear&Greed=${usScore}/100, KR Fear&Greed=${krScore}/100, VIX=${vix}, Top inflows: ${topFlows}.

[FACTS — MANDATORY]
- Do NOT use Jerome Powell as current Fed Chair (term ended 2026-02)
- Approved tickers: S&P500 (SPY/VOO), Nasdaq (QQQ), major ETFs, crypto (BTC-USD/ETH-USD), Korean stocks (.KS suffix)
- BLOCKED: OTC/pink sheets, 3x leveraged ETFs as primary hold, bare index names (KOSPI/SPX/NDX/VIX as buy)
[END FACTS]

[INVESTMENT FRAMEWORK — use ≥1 per entry]
- Buffett: ROE>15%+FCF yield>2×bonds+moat → margin of safety entry
- Lynch: PEG<1 (P/E÷growth) → undervalued vs growth
- Greenblatt: EBIT/EV>10%+ROIC>25% → Magic Formula
- Druckenmiller: earnings momentum+liquidity expansion → concentrated position
RULE: entryRationale MUST include ≥1 fundamental signal.
BAD: "50일선 지지" GOOD: "100일선+FCF수익률8%→안전마진" or "린치PEG0.8→성장대비저평가"
[END FRAMEWORK]

Generate a valid JSON investment strategy. ALL text fields in ${targetLang}. Return ONLY the JSON with no explanation.

{
  "stance": "bullish|neutral|bearish",
  "thesis": "25-80 chars ${targetLang} summary of current market thesis",
  "portfolio": [
    {
      "ticker": "NVDA", "name": "NVIDIA", "sector": "Technology", "market": "us",
      "rationale": "${targetLang} rationale ≤100 chars",
      "allocation": 15,
      "entryZone": "$205-212",
      "entryRationale": "must include ≥1 fundamental signal (e.g. 100-day MA + FCF yield 8% → margin of safety)",
      "stopLoss": "$190",
      "target": "$260",
      "targetBull": "$295",
      "targetRationale": "P/E 38x → $260 base | 52w high breakout Fib 1.618 → $295 bull",
      "confidence": "high",
      "action": "buy"
    }
  ],
  "sectorAllocation": [{"sector": "Technology", "pct": 25, "stance": "overweight", "reason": "AI momentum"}],
  "riskEvents": [{"date": "${today}", "event": "FOMC", "impact": "high", "watchFor": "rate guidance"}],
  "macroAnalysis": "30-150 chars ${targetLang} macro analysis (NOT a list with + signs)",
  "technicalAnalysis": "15-120 chars ${targetLang} technical analysis",
  "fundamentalAnalysis": "15-120 chars ${targetLang} fundamental analysis",
  "riskLevel": "low|medium|high",
  "marketNarrative": {
    "why": "30-100 chars why this stance",
    "watch": "20-80 chars what to watch",
    "story": "30-100 chars market story",
    "sessionNote": "${session}"
  },
  "shortSqueeze": [{"ticker": "SMCI", "score": 45, "timing": "48h", "risk": "earnings vol"}],
  "insiderSignals": [{"ticker": "GOOGL", "filings": 5, "significance": "Berkshire accumulation", "pattern": "consecutive buying"}],
  "regionStances": {
    "us": {"stance": "bullish", "thesis": "AI capex cycle", "keyData": "SPY+0.5% 1w"},
    "korea": {"stance": "neutral", "thesis": "HBM demand recovery", "keyData": "EWY+1.2% 1w"}
  },
  "stopLossRationale": [{"ticker": "NVDA", "rationale": "trend reversal if 50-day MA breaks"}],
  "hedgingSuggestion": "hedging suggestion (${targetLang}, specific)",
  "portfolioRiskNote": "overall portfolio risk summary (${targetLang})"
}

Rules:
- 6-8 portfolio items, allocation sum MUST equal 100
- Pure JSON only — no markdown, no explanation, no code blocks
- ALL text fields MUST be in ${targetLang} — do NOT use Korean if locale is not ko
- thesis must be 25+ chars and a SENTENCE, not a list (no + separators)
- macroAnalysis must be 30+ chars and a SENTENCE (no + separators like "AI+crypto+FOMC")`;

  console.log('\n[2/4] Ollama AI 생성 중...');
  let rawText = '';
  try {
    rawText = await callOllama(prompt, modelArg);
    console.log(`  응답 수신 (${rawText.length}자)`);
  } catch (e) {
    console.error('Ollama 실패:', e.message);
    console.error('Ollama 실행 확인: ollama serve && ollama list');
    process.exit(1);
  }

  // JSON 파싱
  console.log('\n[3/4] JSON 파싱...');
  const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const codeBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlock ? codeBlock[1] : cleaned;
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('JSON 파싱 실패 — 원시 출력:');
    console.log(cleaned.slice(0, 800));
    process.exit(1);
  }

  let report;
  try {
    const fixedJson = match[0]
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,])\s*\n\s*([}\]])/g, '$1$2');
    report = JSON.parse(fixedJson);
  } catch (e) {
    console.error('JSON parse error:', e.message);
    console.log(match[0].slice(0, 600));
    process.exit(1);
  }

  // 후처리
  if (Array.isArray(report.portfolio)) {
    report.portfolio = report.portfolio
      .map(p => ({ ...p, ticker: /^\d{6}$/.test(p.ticker || '') ? `${p.ticker}.KS` : (p.ticker || '') }))
      .filter(p => {
        const k = (p.ticker || '').toUpperCase();
        const INDEX = new Set(['KS','KR','JP','CN','EU','US','UK','KOSPI','NIKKEI','KOSDAQ',
          '^KS11','^N225','^GSPC','KOSPI200','KOSPI100','KOSDAQ150','KRX300','SPX','NDX','RUT','VIX']);
        return k && !INDEX.has(k);
      });
    const total = report.portfolio.reduce((s, p) => s + (p.allocation ?? 0), 0);
    if (total > 0 && Math.abs(total - 100) > 2) {
      report.portfolio = report.portfolio.map(p => ({ ...p, allocation: Math.round((p.allocation ?? 0) / total * 100) }));
      const diff = 100 - report.portfolio.reduce((s, p) => s + p.allocation, 0);
      if (diff !== 0 && report.portfolio.length) report.portfolio[0].allocation += diff;
    }
  }

  const now = new Date().toISOString();
  const finalReport = {
    ...report,
    generatedAt: now,
    dataAsOf: now,
    source: `local-${modelArg}`,
    locale: localeArg,
    session,
    schemaVersion: 8,
    buildId: 'local',
  };

  // 품질 검사
  console.log('\n[4/4] 품질 게이트 검사...');
  const { ok, issues, score } = qualityCheck(finalReport);
  console.log(`  품질 점수: ${score}/100`);
  if (issues.length) {
    console.log('  ⚠️  문제:');
    for (const i of issues) console.log(`    - ${i}`);
  } else {
    console.log('  ✅ 품질 검사 통과');
  }

  // reports/ 디렉토리에 저장
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const filename = `report-${kstDate}-${session}-${localeArg}.json`;
  const filepath = resolve(REPORTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(finalReport, null, 2), 'utf8');

  console.log(`\n=== 저장 완료 ===`);
  console.log(`파일: reports/${filename}`);
  console.log(`source: ${finalReport.source}`);
  console.log(`stance: ${finalReport.stance}`);
  console.log(`thesis: ${finalReport.thesis}`);
  console.log(`portfolio: ${finalReport.portfolio?.map(p => `${p.ticker}(${p.allocation}%)`).join(' ')}`);

  if (!ok) {
    console.log('\n❌ 품질 불합격 — 자동 업로드 건너뜀.');
    console.log(`   파일을 검토 후: node scripts/generate-report-local.mjs --upload=reports/${filename}`);
    return;
  }

  if (autoUpload) {
    console.log('\n--auto-upload 설정됨, 품질 통과 → 업로드 진행...');
    await uploadFromFile(filepath);
  } else {
    console.log('\n✅ 생성 완료. 내용 확인 후 업로드:');
    console.log(`   node scripts/generate-report-local.mjs --upload=reports/${filename}`);
    console.log(`   또는 최신 파일: node scripts/generate-report-local.mjs --upload=latest`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
if (uploadArg) {
  uploadFromFile(uploadArg).catch(console.error);
} else {
  generateViaOllama().catch(console.error);
}

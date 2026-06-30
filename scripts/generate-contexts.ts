/**
 * Flowvium — Company Context Generator
 * =====================================
 * Generates macroImpact + rdPipeline for all companies using:
 *   - vLLM (local, primary) — zero API cost
 *   - Gemini API (fallback if vLLM not running)
 *
 * Usage:
 *   # With local vLLM (WSL2 + GPU):
 *   npx tsx scripts/generate-contexts.ts
 *
 *   # vLLM on custom port:
 *   VLLM_URL=http://127.0.0.1:8000 npx tsx scripts/generate-contexts.ts
 *
 *   # Gemini only (no local vLLM):
 *   FORCE_GEMINI=1 GEMINI_API_KEY=xxx npx tsx scripts/generate-contexts.ts
 *
 *   # Single ticker test:
 *   TICKER=NVDA npx tsx scripts/generate-contexts.ts
 *
 *   # Skip already-generated tickers:
 *   SKIP_EXISTING=1 npx tsx scripts/generate-contexts.ts
 *
 * Output: src/data/generated/company-contexts.json
 * Then: git add src/data/generated/company-contexts.json && git push → Vercel auto-deploys
 *
 * WSL2 vLLM setup (run in WSL2):
 *   pip install vllm
 *   python -m vllm.entrypoints.openai.api_server \
 *     --model Qwen/Qwen2.5-7B-Instruct \
 *     --port 8000 --dtype auto --max-model-len 4096
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { allCompanies } from '../src/data/companies';

// ── Config ────────────────────────────────────────────────────────────────────

const VLLM_URL = process.env.VLLM_URL ?? 'http://127.0.0.1:8000';
const VLLM_MODEL = process.env.VLLM_MODEL ?? 'Qwen/Qwen2.5-7B-Instruct';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const FORCE_GEMINI = process.env.FORCE_GEMINI === '1';
const SKIP_EXISTING = process.env.SKIP_EXISTING === '1';
const ONLY_TICKER = process.env.TICKER ?? '';
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '3', 10); // parallel requests
const OUTPUT_PATH = join(__dirname, '../src/data/generated/company-contexts.json');
const TODAY = new Date().toISOString().split('T')[0];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GeneratedContext {
  ticker: string;
  generatedAt: string;
  model: string;
  macroImpact: {
    summary: string;
    tailwinds: string[];
    headwinds: string[];
  };
  rdPipeline: Array<{
    name: string;
    stage: 'research' | 'development' | 'validation' | 'commercial';
    description: string;
    targetDate?: string;
    budget?: string;
  }>;
}

type ContextMap = Record<string, GeneratedContext>;

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPrompt(company: {
  name: string;
  ticker: string;
  sector: string;
  subSector: string;
  description: string;
  products: { name: string }[];
}): string {
  return `You are a senior equity research analyst. Today is ${TODAY}.

Analyze this company and return ONLY a valid JSON object (no markdown, no explanation):

Company: ${company.name} (${company.ticker})
Sector: ${company.sector} / ${company.subSector}
Business: ${company.description}
Products: ${company.products.slice(0, 3).map(p => p.name).join(', ')}

Return JSON in exactly this format:
{
  "macroImpact": {
    "summary": "2-3 sentences on current macro/market environment and how it specifically affects ${company.ticker}",
    "tailwinds": [
      "Specific positive macro factor 1 with data point",
      "Specific positive macro factor 2 with data point",
      "Specific positive macro factor 3 with data point"
    ],
    "headwinds": [
      "Specific risk/headwind 1 with data point",
      "Specific risk/headwind 2 with data point",
      "Specific risk/headwind 3 with data point"
    ]
  },
  "rdPipeline": [
    {
      "name": "Product or initiative name",
      "stage": "research",
      "description": "1-2 sentence description of what this is and why it matters",
      "targetDate": "2025"
    }
  ]
}

Rules:
- macroImpact.tailwinds: exactly 3-5 items
- macroImpact.headwinds: exactly 3-5 items
- rdPipeline: 2-5 items (stage must be one of: research, development, validation, commercial)
- Be specific to ${company.ticker}, not generic sector commentary
- Use real data points (%, $B, dates) where known
- JSON only, no other text`;
}

// ── LLM Clients ──────────────────────────────────────────────────────────────

async function callVllm(prompt: string): Promise<string> {
  const res = await fetch(`${VLLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`vLLM ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content.trim();
}

async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
  return data.candidates[0].content.parts[0].text.trim();
}

async function isVllmRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${VLLM_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── JSON Extractor ────────────────────────────────────────────────────────────

function extractJson(raw: string): GeneratedContext['macroImpact'] & { rdPipeline: GeneratedContext['rdPipeline'] } | null {
  try {
    // Strip markdown code blocks if present
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    // Find first { and last }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;

    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed.macroImpact || !parsed.rdPipeline) return null;

    // Validate macroImpact shape
    const mi = parsed.macroImpact;
    if (!mi.summary || !Array.isArray(mi.tailwinds) || !Array.isArray(mi.headwinds)) return null;

    // Validate rdPipeline items
    const rdp = (parsed.rdPipeline as unknown[]).filter(
      (item): item is GeneratedContext['rdPipeline'][number] =>
        typeof item === 'object' &&
        item !== null &&
        'name' in item &&
        'stage' in item &&
        'description' in item &&
        ['research', 'development', 'validation', 'commercial'].includes((item as { stage: string }).stage)
    );

    return { ...mi, rdPipeline: rdp };
  } catch {
    return null;
  }
}

// ── Core Generator ────────────────────────────────────────────────────────────

async function generateForCompany(
  company: (typeof allCompanies)[number],
  useVllm: boolean,
  modelName: string
): Promise<GeneratedContext | null> {
  const prompt = buildPrompt(company);
  let raw: string;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      raw = useVllm ? await callVllm(prompt) : await callGemini(prompt);
      const parsed = extractJson(raw);
      if (parsed) {
        return {
          ticker: company.ticker,
          generatedAt: TODAY,
          model: modelName,
          macroImpact: {
            summary: parsed.summary,
            tailwinds: parsed.tailwinds,
            headwinds: parsed.headwinds,
          },
          rdPipeline: parsed.rdPipeline,
        };
      }
      console.warn(`  [${company.ticker}] attempt ${attempt}: bad JSON, retrying...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 3) console.error(`  [${company.ticker}] failed after 3 attempts: ${msg}`);
      else await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  return null;
}

// ── Batch Runner ──────────────────────────────────────────────────────────────

async function runBatch(
  companies: (typeof allCompanies),
  existing: ContextMap,
  useVllm: boolean,
  modelName: string
): Promise<ContextMap> {
  const results: ContextMap = { ...existing };
  let done = 0;
  let skipped = 0;
  let failed = 0;

  const toProcess = companies.filter(c => {
    if (SKIP_EXISTING && existing[c.ticker]) {
      skipped++;
      return false;
    }
    return true;
  });

  console.log(`\nProcessing ${toProcess.length} companies (${skipped} skipped, model: ${modelName})\n`);

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const chunk = toProcess.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(c => generateForCompany(c, useVllm, modelName))
    );

    for (let j = 0; j < chunk.length; j++) {
      const company = chunk[j];
      const result = chunkResults[j];
      done++;
      const pct = Math.round((done / toProcess.length) * 100);

      if (result) {
        results[company.ticker] = result;
        console.log(`  [${pct}%] ✓ ${company.ticker} — ${company.name}`);
      } else {
        failed++;
        console.log(`  [${pct}%] ✗ ${company.ticker} — ${company.name} (failed)`);
      }
    }

    // Save progress after each chunk (resume-safe)
    writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf8');

    // Small delay between chunks to avoid rate limits
    if (i + CONCURRENCY < toProcess.length) {
      await new Promise(r => setTimeout(r, useVllm ? 500 : 1500));
    }
  }

  console.log(`\nDone: ${done - failed} succeeded, ${failed} failed, ${skipped} skipped`);
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Flowvium Context Generator');
  console.log('==========================');
  console.log(`Date: ${TODAY}`);
  console.log(`Output: ${OUTPUT_PATH}`);

  // Load existing results
  const existing: ContextMap = existsSync(OUTPUT_PATH)
    ? JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'))
    : {};
  console.log(`Existing: ${Object.keys(existing).length} companies already generated`);

  // Select companies to process
  let companies = allCompanies;
  if (ONLY_TICKER) {
    companies = allCompanies.filter(c => c.ticker.toUpperCase() === ONLY_TICKER.toUpperCase());
    if (companies.length === 0) {
      console.error(`Ticker ${ONLY_TICKER} not found`);
      process.exit(1);
    }
    console.log(`Single ticker mode: ${ONLY_TICKER}`);
  }

  // Decide which LLM to use
  let useVllm = false;
  let modelName = 'gemini-2.0-flash';

  if (!FORCE_GEMINI) {
    console.log(`\nChecking vLLM at ${VLLM_URL}...`);
    useVllm = await isVllmRunning();
    if (useVllm) {
      modelName = VLLM_MODEL;
      console.log(`vLLM ✓ — using local model: ${VLLM_MODEL}`);
    } else {
      console.log(`vLLM not running — falling back to Gemini API`);
      if (!GEMINI_API_KEY) {
        console.error('Neither vLLM nor GEMINI_API_KEY available. Aborting.');
        process.exit(1);
      }
    }
  } else {
    console.log('FORCE_GEMINI=1 — using Gemini API');
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not set. Aborting.');
      process.exit(1);
    }
  }

  // Run
  const results = await runBatch(companies, existing, useVllm, modelName);

  // Final save
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nSaved ${Object.keys(results).length} companies to ${OUTPUT_PATH}`);
  console.log('\nNext steps:');
  console.log('  git add src/data/generated/company-contexts.json');
  console.log('  git commit -m "chore: update company contexts"');
  console.log('  git push  # Vercel auto-deploys');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

/**
 * supply-chain-extract.ts — 동적 grounded 공급망 추출 (2026-06-04 신설).
 *
 * 배경: company.relationships(US)/kr-supply-chain(KR)는 수기 큐레이션 정적 데이터라 커버리지 한계.
 *   사용자 요청으로 SEC 10-K / DART 사업보고서에서 공급사·고객사·경쟁사를 *라이브 추출*.
 *
 * 환각 0 안전장치 (필수):
 *  1) LLM 은 filing 원문 발췌(excerpt)만 보고 추출 — 외부 지식 사용 금지 프롬프트.
 *  2) 인용 검증: 추출된 회사명이 excerpt 에 literal(정규화 substring)로 존재해야만 채택. 없으면 drop.
 *  3) ticker 는 LLM 이 아니라 SEC company_tickers.json(권위 맵)으로 해소 — ticker 환각 불가.
 *  4) 각 관계에 quote(원문 인용) 동반 → UI 가 출처 표시 가능.
 */
import { logger } from '@/lib/logger';

const SEC_HEADERS = { 'User-Agent': 'Flowvium (taeshinkim11@gmail.com)' };
// 2026-06-15 Ollama→vLLM: 로컬 vLLM OpenAI-compat 엔드포인트(기본 localhost:8000/v1).
const VLLM_BASE = (process.env.VLLM_URL || 'http://localhost:8000/v1').replace(/\s+/g, '').replace(/\\n/g, '').replace(/\/+$/, '');
const OLLAMA_URL = `${VLLM_BASE}/chat/completions`;
const OLLAMA_MODEL = process.env.OLLAMA_TRANSLATE_MODEL || 'flowvium-local';

export type ScRelType = 'supplier' | 'customer' | 'competitor' | 'partner';
export interface ScRelationship {
  name: string;
  ticker?: string;
  type: ScRelType;
  quote: string;
}
export interface ScResult {
  ticker: string;
  relationships: ScRelationship[];
  source: 'sec-10k' | 'dart' | 'none';
  filingUrl?: string;
  filingDate?: string;
  note?: string;
}

// ── SEC ticker 맵 (ticker→cik, name→ticker 역인덱스) — 모듈 캐시 ──────────────
let cikByTicker: Map<string, string> | null = null;
let nameIndex: Array<{ norm: string; ticker: string }> | null = null;

function normalizeName(s: string): string {
  return s.toLowerCase()
    .replace(/,?\s+(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings|group|technologies|technology|systems|sa|ag|nv|llc)\.?\b/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function loadSecTickers(): Promise<void> {
  if (cikByTicker && nameIndex) return;
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
  const data = await res.json() as Record<string, { cik_str: number; ticker: string; title: string }>;
  const cmap = new Map<string, string>();
  const nidx: Array<{ norm: string; ticker: string }> = [];
  for (const k in data) {
    const e = data[k];
    if (!e?.ticker) continue;
    cmap.set(e.ticker.toUpperCase(), String(e.cik_str).padStart(10, '0'));
    nidx.push({ norm: normalizeName(e.title), ticker: e.ticker.toUpperCase() });
  }
  cikByTicker = cmap;
  nameIndex = nidx.sort((a, b) => b.norm.length - a.norm.length); // 긴 이름 우선(정확)
}

/** 추출된 회사명 → SEC 권위 맵으로 ticker 해소 (LLM ticker 환각 차단). 못 찾으면 undefined. */
function resolveTicker(name: string): string | undefined {
  if (!nameIndex) return undefined;
  const n = normalizeName(name);
  if (!n || n.length < 2) return undefined;
  // 정확 매치 우선
  const exact = nameIndex.find(x => x.norm === n);
  if (exact) return exact.ticker;
  // 핵심 토큰 포함 (양방향) — 단 너무 짧은 토큰은 오매치 방지
  if (n.length >= 4) {
    const part = nameIndex.find(x => x.norm === n || x.norm.startsWith(n + ' ') || n.startsWith(x.norm + ' '));
    if (part) return part.ticker;
  }
  return undefined;
}

async function getCik(ticker: string): Promise<string | null> {
  await loadSecTickers();
  return cikByTicker?.get(ticker.toUpperCase()) ?? null;
}

/** 최신 10-K 본문(HTML 제거 텍스트) + 메타. */
async function fetch10KText(cik: string): Promise<{ text: string; url: string; date: string } | null> {
  const sub = await (await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: SEC_HEADERS, signal: AbortSignal.timeout(12000) })).json() as {
    filings?: { recent?: { form?: string[]; accessionNumber?: string[]; primaryDocument?: string[]; filingDate?: string[] } };
  };
  const f = sub?.filings?.recent;
  if (!f?.form) return null;
  let idx = -1;
  for (let i = 0; i < f.form.length; i++) { if (f.form[i] === '10-K') { idx = i; break; } }
  if (idx < 0) return null;
  const acc = (f.accessionNumber![idx]).replace(/-/g, '');
  const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${f.primaryDocument![idx]}`;
  const html = await (await fetch(url, { headers: SEC_HEADERS, signal: AbortSignal.timeout(15000) })).text();
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8217;|&#8216;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&#8211;|&#8212;/g, '-')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return { text, url, date: f.filingDate![idx] };
}

/** competition/customer/supplier 단서 주변 window 를 모아 LLM 발췌(≤7000자) 구성. */
function buildExcerpt(text: string): string {
  const patterns = [
    /our (?:current )?competitors include/i, /principal competitors/i, /we compete (?:with|against|primarily)/i,
    /significant customers?/i, /largest customers?/i, /customers? (?:include|accounted for)/i, /major customers?/i,
    /(?:we (?:rely|depend) on|sole[- ]source|single source|key suppliers?|principal suppliers?|are manufactured by|outsource)/i,
  ];
  const windows: Array<[number, number]> = [];
  for (const p of patterns) {
    let from = 0;
    for (let guard = 0; guard < 3; guard++) {
      const i = text.slice(from).search(p);
      if (i < 0) break;
      const abs = from + i;
      windows.push([Math.max(0, abs - 150), Math.min(text.length, abs + 900)]);
      from = abs + 900;
    }
  }
  if (!windows.length) return '';
  // 병합 + 캡
  windows.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1] + 50) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w] as [number, number]);
  }
  let out = '';
  for (const [a, b] of merged) {
    if (out.length >= 7000) break;
    out += text.slice(a, b).trim() + '\n---\n';
  }
  return out.slice(0, 7000);
}

async function ollamaExtract(excerpt: string, companyName: string): Promise<Array<{ name: string; type: string; quote: string }>> {
  // /no_think: qwen3 thinking 모델이 <think> 로 max_tokens 를 소진해 빈 출력 내던 문제 해결.
  const prompt = `/no_think
You are extracting business relationships from an SEC 10-K excerpt for ${companyName}.
ONLY use companies EXPLICITLY NAMED in the text below. Do NOT use outside knowledge. Do NOT infer.
Classify each named company as one of: competitor, customer, supplier, partner.
For each, copy the EXACT short quote (≤20 words) from the text that names it.
Ignore ${companyName} itself, generic terms ("customers", "OEMs"), and government/agencies.
Return ONLY a JSON array, no prose: [{"name":"...","type":"competitor","quote":"..."}]

TEXT:
${excerpt}`;
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 2500, chat_template_kwargs: { enable_thinking: false } }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return [];
    const d = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    let txt = (d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]) as Array<{ name?: string; type?: string; quote?: string }>;
    return arr.filter(x => x?.name && x?.type).map(x => ({ name: String(x.name).trim(), type: String(x.type).toLowerCase().trim(), quote: String(x.quote ?? '').trim() }));
  } catch {
    return [];
  }
}

/** US 종목 — SEC 10-K 에서 공급망 라이브 추출 (인용 검증 + ticker 권위 해소). */
export async function extractSupplyChainUS(ticker: string): Promise<ScResult> {
  const t0 = Date.now();
  try {
    const cik = await getCik(ticker);
    if (!cik) return { ticker, relationships: [], source: 'none', note: 'CIK not found' };
    const doc = await fetch10KText(cik);
    if (!doc) return { ticker, relationships: [], source: 'none', note: 'no 10-K' };
    const excerpt = buildExcerpt(doc.text);
    if (!excerpt) return { ticker, relationships: [], source: 'sec-10k', filingUrl: doc.url, filingDate: doc.date, note: 'no relationship section' };
    const raw = await ollamaExtract(excerpt, ticker.toUpperCase());
    const excerptLower = excerpt.toLowerCase();
    const validTypes = new Set<ScRelType>(['supplier', 'customer', 'competitor', 'partner']);
    const seen = new Set<string>();
    const relationships: ScRelationship[] = [];
    for (const r of raw) {
      const type = r.type as ScRelType;
      if (!validTypes.has(type)) continue;
      // 인용 검증 — 추출명이 excerpt 에 literal 존재해야 채택 (환각 차단).
      const nameLower = r.name.toLowerCase();
      const coreName = normalizeName(r.name);
      const present = excerptLower.includes(nameLower) || (coreName.length >= 3 && excerptLower.includes(coreName));
      if (!present) continue;
      if (r.name.toUpperCase() === ticker.toUpperCase()) continue;
      const dedupKey = `${coreName}|${type}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      relationships.push({ name: r.name, ticker: resolveTicker(r.name), type, quote: r.quote.slice(0, 160) });
    }
    logger.info('supply-chain.extract', 'us_ok', { ticker, found: relationships.length, raw: raw.length, durationMs: Date.now() - t0 });
    return { ticker, relationships, source: 'sec-10k', filingUrl: doc.url, filingDate: doc.date };
  } catch (err) {
    logger.error('supply-chain.extract', 'us_failed', { ticker, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
    return { ticker, relationships: [], source: 'none', note: 'error' };
  }
}

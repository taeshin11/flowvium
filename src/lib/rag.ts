/**
 * rag.ts — 심판엔진 AITS+RAG 의 semantic 검색 (2026-06-18 신설)
 *
 * 버핏 서한/투자 고전 전문을 청크→임베딩한 로컬 벡터 코퍼스(data/rag/corpus.ndjson)에서
 * 질문과 의미적으로 가까운 구절을 top-k 로 꺼내 LLM 프롬프트에 grounding 한다.
 *
 * - 임베딩: WSL 로컬 임베딩 서비스(EMBED_URL, 기본 127.0.0.1:8100) — bge-m3(다국어, KR+EN).
 *   GPU 는 vLLM(30B) 가 점유 → 임베딩은 CPU. 질문 1건이라 수백 ms 로 수용가능.
 * - 벡터스토어: 코퍼스가 수천 청크 규모 → 별도 벡터DB 없이 모듈 메모리 + 코사인.
 * - graceful degrade: 코퍼스 없음/임베딩 서비스 down 이면 [] 반환 → AITS+RAG 가 AITS 로 강등(로그).
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from '@/lib/logger';

const CORPUS_PATH = resolve(process.cwd(), 'data/rag/corpus.ndjson');
const EMBED_URL = process.env.EMBED_URL ?? 'http://127.0.0.1:8100/embed';

export interface RagChunk { id: string; source: string; year?: number | string; text: string; embedding: number[]; }
export interface RagHit { source: string; year?: number | string; text: string; score: number; }

let _corpus: RagChunk[] | null = null;
let _loadTried = false;

function loadCorpus(): RagChunk[] {
  if (_corpus) return _corpus;
  if (_loadTried) return [];
  _loadTried = true;
  try {
    if (!existsSync(CORPUS_PATH)) { logger.warn('rag', 'corpus_missing', { path: CORPUS_PATH }); return []; }
    const lines = readFileSync(CORPUS_PATH, 'utf8').split('\n').filter(Boolean);
    const out: RagChunk[] = [];
    for (const ln of lines) {
      try {
        const o = JSON.parse(ln) as RagChunk;
        if (o && Array.isArray(o.embedding) && o.embedding.length && typeof o.text === 'string') out.push(o);
      } catch { /* skip bad line */ }
    }
    _corpus = out;
    logger.info('rag', 'corpus_loaded', { chunks: out.length, dim: out[0]?.embedding.length ?? 0 });
    return out;
  } catch (e) {
    logger.error('rag', 'corpus_load_failed', { error: e instanceof Error ? e.message : 'unknown' });
    return [];
  }
}

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const r = await fetch(EMBED_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: [text] }), signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = await r.json() as { embeddings?: number[][] };
    const v = d?.embeddings?.[0];
    return Array.isArray(v) && v.length ? v : null;
  } catch { return null; }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 소스 라벨 → 구루 그룹 (다양성 캡 용). 버크셔 서한 5430청크가 검색을 독점하지 않도록
//   "버핏(서한+위키쿼트)"을 한 그룹으로 묶어 다른 구루(소로스·린치·코스톨라니·막스·투자지혜)에 자리 양보.
function guruGroup(source: string): string {
  const s = source.toLowerCase();
  if (s.includes('버크셔') || s.includes('buffett')) return 'buffett';
  if (s.includes('soros') || s.includes('소로스')) return 'soros';
  if (s.includes('lynch') || s.includes('린치')) return 'lynch';
  if (s.includes('kostolany') || s.includes('코스톨라니')) return 'kostolany';
  if (s.includes('marks') || s.includes('막스')) return 'marks';
  return source; // 투자 지혜 / 심판 doctrine 등은 개별 유지
}

/** 질문과 의미적으로 가까운 코퍼스 구절 top-k (구루 다양성 캡). 코퍼스 없음/임베딩 실패 시 []. */
export async function ragRetrieve(query: string, k = 4): Promise<RagHit[]> {
  const corpus = loadCorpus();
  if (!corpus.length) return [];
  const qv = await embedQuery(query);
  if (!qv) { logger.warn('rag', 'embed_unavailable', {}); return []; }
  const scored = corpus.map(c => ({ source: c.source, year: c.year, text: c.text, score: cosine(qv, c.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  const eligible = scored.filter(h => h.score >= 0.35);
  // 구루 그룹당 최대 2개 → 버핏 독점 방지, 다른 구루 노출. 부족하면 cap 무시하고 채움.
  const CAP = 2;
  const counts: Record<string, number> = {};
  const picked: RagHit[] = [];
  for (const h of eligible) {
    const g = guruGroup(h.source);
    if ((counts[g] ?? 0) >= CAP) continue;
    counts[g] = (counts[g] ?? 0) + 1;
    picked.push(h);
    if (picked.length >= k) break;
  }
  if (picked.length < k) for (const h of eligible) { if (!picked.includes(h)) { picked.push(h); if (picked.length >= k) break; } }
  return picked;
}

export function ragCorpusSize(): number {
  return loadCorpus().length;
}

/**
 * rag.ts — 심판엔진 AISVI+RAG 의 semantic 검색 (2026-06-18 신설)
 *
 * 버핏 서한/투자 고전 전문을 청크→임베딩한 로컬 벡터 코퍼스(data/rag/corpus.ndjson)에서
 * 질문과 의미적으로 가까운 구절을 top-k 로 꺼내 LLM 프롬프트에 grounding 한다.
 *
 * - 임베딩: WSL 로컬 임베딩 서비스(EMBED_URL, 기본 127.0.0.1:8100) — bge-m3(다국어, KR+EN).
 *   GPU 는 vLLM(30B) 가 점유 → 임베딩은 CPU. 질문 1건이라 수백 ms 로 수용가능.
 * - 벡터스토어: 코퍼스가 수천 청크 규모 → 별도 벡터DB 없이 모듈 메모리 + 코사인.
 * - graceful degrade: 코퍼스 없음/임베딩 서비스 down 이면 [] 반환 → AISVI+RAG 가 AISVI 로 강등(로그).
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from '@/lib/logger';

const CORPUS_PATH = resolve(process.cwd(), 'data/rag/corpus.ndjson');
const EMBED_URL = process.env.EMBED_URL ?? 'http://127.0.0.1:8100/embed';

export interface RagChunk { id: string; source: string; year?: number | string; text: string; embedding: number[]; _norm?: number; _boost?: number; }
export interface RagHit { source: string; year?: number | string; text: string; score: number; }

let _corpus: RagChunk[] | null = null;
let _loadTried = false;
// 2026-07-06 (Claude 직접검증 → re-rank): 큐레이션 원칙 청크 boost 판정용. 로드 시 1회 precompute.
const CURATION_TAG = /\b(guru|discipline|fundamental|technical|macro)\b|매수엔진|매도엔진/;

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
        if (o && Array.isArray(o.embedding) && o.embedding.length && typeof o.text === 'string') {
          // 2026-07-06 최적화: 질의-불변 값(L2 norm·re-rank boost)을 로드 시 1회 precompute →
          //   매 질의 5,731청크 재계산 제거(norm sqrt + boost 정규식). embedding 은 Float32Array 로(메모리·dot 속도).
          o.embedding = Float32Array.from(o.embedding) as unknown as number[];
          let nn = 0; for (let i = 0; i < o.embedding.length; i++) nn += o.embedding[i] * o.embedding[i];
          o._norm = Math.sqrt(nn) || 1;
          o._boost = (/[가-힣]/.test(o.text) ? 0.06 : 0) + (CURATION_TAG.test(o.text) ? 0.04 : 0);
          out.push(o);
        }
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
  // 2026-07-06 (Claude 직접 검증): raw 버크셔 주주서한이 *영어 문장조각*으로 청킹돼 bge-m3 교차언어 유사도로
  //   한국어 질의에도 top 랭크를 차지하나 실사용 가치 0(중간 조각). 큐레이션 원칙 라인이 gold 인데 밀림 →
  //   effScore re-rank(한글 +0.06, 큐레이션 태그 +0.04, 로드 시 _boost precompute). gold 를 노이즈 위로.
  // 최적화: 질의벡터 norm 1회 계산 + 청크 _norm/_boost precompute 사용(매 질의 5,731 재계산 제거).
  let qn = 0; for (let i = 0; i < qv.length; i++) qn += qv[i] * qv[i];
  const qnorm = Math.sqrt(qn) || 1;
  const scored = corpus.map(c => {
    const emb = c.embedding; const n = Math.min(qv.length, emb.length);
    let dot = 0; for (let i = 0; i < n; i++) dot += qv[i] * emb[i];
    const base = dot / (qnorm * (c._norm ?? 1));
    return { source: c.source, year: c.year, text: c.text, score: base, effScore: base + (c._boost ?? 0) };
  });
  scored.sort((a, b) => b.effScore - a.effScore);
  const eligible = scored.filter(h => h.effScore >= 0.35);
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

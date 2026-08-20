/**
 * translation-memory.ts — 확정 번역 조회 (웹 읽기 전용 경로).
 *   scripts/lib/translation-memory.mjs 가 쓰기(시딩)를 담당한다. 둘을 함께 고칠 것.
 *
 * 왜(2026-08-20 실측): 웹 레인은 Qwen3.5-4B(:8001)다. 보고서(27B)와 GPU 를 나눠 쓰려고 분리한
 *   구조이고 그 이유는 유효하지만, 4B 의 금융 번역이 틀린다:
 *     industrial conglomerate → "산업 컨glomerate"(깨짐) · Short squeeze candidate → "단축 압력 후보"(오역)
 *   앞은 게이트가 걸러 원문이 노출되고, 뒤는 한국어라서 게이트를 통과해 틀린 채 나간다.
 *   반복 용어를 27B 품질로 미리 확정해 두면 웹 경로는 GPU 를 아예 안 건드린다.
 *   Redis 캐시(30일 TTL)와 역할이 다르다 — 저건 만료되는 응답 캐시, 이건 만료 없는 용어 사전이다.
 */
import Database from 'better-sqlite3';
import { join } from 'path';

const norm = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

let db: Database.Database | null = null;
let tried = false;

function handle(): Database.Database | null {
  if (tried) return db;
  tried = true;
  try {
    db = new Database(join(process.cwd(), 'data/flowvium.db'), { readonly: true, fileMustExist: true });
  } catch {
    db = null;   // 사전이 아직 없으면 조용히 비활성 — 번역 경로 자체를 막지는 않는다
  }
  return db;
}

/** 확정 번역 또는 null. 없음을 빈 문자열로 돌려주지 않는다 — 호출부가 '번역됨'으로 오인한다. */
export function lookupMemory(text: string, locale: string): string | null {
  const h = handle();
  if (!h) return null;
  try {
    const r = h.prepare('SELECT translated FROM translation_memory WHERE key=? AND locale=?')
               .get(norm(text), locale) as { translated?: string } | undefined;
    return r?.translated ?? null;
  } catch { return null; }
}

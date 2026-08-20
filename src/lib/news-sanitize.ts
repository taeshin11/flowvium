/**
 * news-sanitize.ts — 뉴스 제목/요약 정제. scripts/lib/news-sanitize.mjs 와 동일 로직.
 *
 * ① 엔티티 디코딩. news-cascade/route.ts:453 이 RSS <title> 을 정규식으로 뽑고 .trim() 만 해서
 *    "&quot;삼성전자…&quot;-KB", "speed bump &#x2014; but" 이 화면까지 갔다(2026-08-20 눈검증).
 *    미관 문제만이 아니다 — "S&amp;P 500 hits record" 가 FINANCIAL_SIGNAL(:433)의 `s&p` 에
 *    매칭되지 않아 금융 기사가 필터에서 버려졌다(실측: 원문 false → 디코딩 후 true).
 *    엔티티 표는 손으로 만들지 않는다(CLAUDE.md 하드코딩 화이트리스트 금지) — entities 패키지 사용.
 * ② 요약이 제목과 같으면 비운다. :617 keywordFallbackCascade 가 summary: title 을 돌려주므로
 *    AI 요약이 garbage 판정(:772)되면 화면에 같은 문장이 두 번 뜬다.
 */
import { decodeHTML } from 'entities';

export function decodeEntities(s: string | null | undefined): string {
  if (s == null) return '';
  const str = String(s);
  if (!str.includes('&')) return str;
  let out = decodeHTML(str);
  if (out.includes('&')) { const again = decodeHTML(out); if (again !== out) out = again; }
  return out;
}

const norm = (s: string | null | undefined) => decodeEntities(s).replace(/\s+/g, ' ').trim().toLowerCase();

export function dedupeSummary(title: string, summary: string | null | undefined): string | null {
  if (summary == null || String(summary).trim() === '') return null;
  return norm(title) === norm(summary) ? null : summary;
}

export function sanitizeArticle({ title, summary }: { title: string; summary?: string | null }) {
  const t = decodeEntities(title).replace(/\s+/g, ' ').trim();
  const rawS = decodeEntities(summary).replace(/\s+/g, ' ').trim();
  return { title: t, summary: dedupeSummary(t, rawS) };
}

// market-close-data.ts — data/market-close/<날짜>.json 을 서버에서 읽는다(규칙은 market-close.mjs). 2026-11-11.
// 기록은 make-market-brief(krclose)가 관문을 지난 대본으로 매일 쓴다. 못 읽으면 없음 — 지어내지 않는다.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { closeDates, companyLinks } from '@/lib/market-close.mjs';
import { companyName, sitemapTickers } from '@/lib/company-seo.mjs';
import { companySeoData } from '@/lib/company-seo-data';

export type CloseSource = { source: string; headline: string; link: string };
export type CloseChapter = { kind: 'market' | 'story'; heading: string; sentences: string[]; sources: CloseSource[] };
export type CloseRecord = { date: string; title: string; facts: string[]; chapters: CloseChapter[] };

const DIR = () => join(process.cwd(), 'data/market-close');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function listCloseDates(): string[] {
  try { return closeDates(readdirSync(DIR())); } catch { return []; }
}

export function readClose(date: string): CloseRecord | null {
  if (!DATE_RE.test(date)) return null;   // 주소의 날짜로 파일을 연다 — 형식이 아니면 열지 않는다
  try { return JSON.parse(readFileSync(join(DIR(), `${date}.json`), 'utf8')) as CloseRecord; } catch { return null; }
}

// 본문에 나온 한국 종목 → 종목 페이지. 사이트맵과 같은 집합(내용 있는 페이지)만 잇는다.
export function closeCompanyLinks(rec: CloseRecord): { ticker: string; name: string }[] {
  const data = companySeoData();
  const names: [string, string][] = [];
  for (const t of sitemapTickers(data)) {
    if (!/\.K[SQ]$/.test(t)) continue;
    const n = companyName(t, 'ko', data);
    if (n && /[가-힣]/.test(n)) names.push([t, n]);
  }
  const texts = rec.chapters.flatMap((c) => [c.heading, ...c.sentences]);
  return companyLinks(texts, names, { headings: rec.chapters.map((c) => c.heading) });
}

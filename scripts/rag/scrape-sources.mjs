#!/usr/bin/env node
/**
 * scrape-sources.mjs — 합법 공개 1차 자료 스크랩 → data/rag/sources/*.txt (2026-06-18)
 *
 * 저작권 보호 "서적 전문"은 스크랩하지 않는다. 합법 소스만:
 *   1) Wikiquote (CC BY-SA) — 버핏·린치·소로스·코스톨라니·하워드막스의 출처표기 어록
 *   2) Oaktree 메모 (하워드 막스가 무료 공개한 전문) — best-effort
 * 결과는 ingest-corpus.py 의 load_dir("sources") 가 코퍼스로 흡수.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const OUT_DIR = resolve(process.cwd(), 'data/rag/sources');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const UA = 'Mozilla/5.0 (FlowVium RAG ingester; legal public-domain/CC scrape)';

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// 위키 마크업 → 평문
function cleanWiki(s) {
  return s
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Wikiquote 페이지 → 본인 어록만 추출 ("Quotes about" 이전까지의 top-level 불릿)
async function scrapeWikiquote(lang, page, label) {
  try {
    const url = `https://${lang}.wikiquote.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;
    const d = await getJson(url);
    let wt = d?.parse?.wikitext;
    if (typeof wt !== 'string') { console.log(`  ✗ ${label}: no wikitext`); return 0; }
    // "Quotes about / About / External links" 이후 절단 (타인의 말 제외)
    const cut = wt.search(/==+\s*(Quotes about|About|External links|See also|References|Weblinks|Über)\b/i);
    if (cut > 0) wt = wt.slice(0, cut);
    const quotes = [];
    for (const raw of wt.split('\n')) {
      if (!/^\*\s/.test(raw)) continue;        // top-level 불릿만 (어록)
      if (/^\*\*/.test(raw)) continue;          // 출처 주석 제외
      const q = cleanWiki(raw.replace(/^\*\s*/, ''));
      if (q.length >= 25 && !/^(p\.|chapter|ibid|as quoted)/i.test(q)) quotes.push(q);
    }
    if (!quotes.length) { console.log(`  ✗ ${label}: 0 quotes`); return 0; }
    const out = resolve(OUT_DIR, `${label}.txt`);
    writeFileSync(out, quotes.join('\n\n') + '\n', 'utf8');
    console.log(`  ✓ ${label}: ${quotes.length} quotes → ${out}`);
    return quotes.length;
  } catch (e) { console.log(`  ✗ ${label}: ${e.message}`); return 0; }
}

async function main() {
  console.log('[scrape] Wikiquote (CC BY-SA):');
  let total = 0;
  total += await scrapeWikiquote('en', 'Warren_Buffett', 'warren-buffett-wikiquote');
  total += await scrapeWikiquote('en', 'Peter_Lynch', 'peter-lynch-wikiquote');
  total += await scrapeWikiquote('en', 'George_Soros', 'george-soros-wikiquote');
  total += await scrapeWikiquote('en', 'Howard_Marks_(investor)', 'howard-marks-wikiquote');
  total += await scrapeWikiquote('en', 'André_Kostolany', 'kostolany-wikiquote-en');
  total += await scrapeWikiquote('de', 'André_Kostolany', 'kostolany-wikiquote-de');
  console.log(`[scrape] 완료 — 총 ${total} quotes. (book 전문은 저작권으로 제외; 보유 사본은 data/rag/books/)`);
}

main().catch(e => { console.error('[FATAL]', e?.stack ?? e); process.exit(1); });

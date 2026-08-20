#!/usr/bin/env node
/**
 * data-entities.test.mjs — 데이터 파일에 HTML 엔티티가 남아 있지 않은지 검증.
 *
 * 배경(2026-08-20 눈검증): 리포트 화면에 "삼성E&amp;A" 가 그대로 노출됐다.
 *   뉴스가 아니라 기업명이었고, data/candidate-tickers.json 에 11개 고유 항목이 있었다
 *   (M&amp;T Bank, PG&amp;E Corporation, KKR &amp; Co., 세이브존I&amp;C …).
 *   외부 소스(HTML/RSS)에서 이름을 수집할 때 디코딩하지 않아 파일에 그대로 저장됐고,
 *   화면까지 그대로 갔다. 뉴스 파이프라인과 같은 결함이 다른 수집 지점에도 있었다.
 *
 * 이 테스트는 '어느 파일에 몇 건'을 박지 않는다 — data/ 의 JSON 을 훑어 엔티티를 찾는다.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// 2026-08-20: data/*.json 만 보면 놓친다. 실제로 src/data/companies-kr.ts 와 universe-search.ts 에
//   "삼성E&amp;A" 가 있었는데 첫 판 테스트가 못 잡았다(JSON 만 훑었다).
//   빌드 산출물로 들어가 화면까지 가는 경로는 확장자와 무관하다.
const SCAN_DIRS = [resolve(ROOT, 'data'), resolve(ROOT, 'src/data')];
const SCAN_EXT = /\.(json|ts|tsx|mjs)$/;
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// 엔티티처럼 보이는 패턴. 숫자/명명 모두. 정상 텍스트의 '&' 단독은 잡지 않는다.
const ENT = /&(?:[a-zA-Z][a-zA-Z0-9]{1,10}|#[0-9]{1,6}|#x[0-9a-fA-F]{1,6});/;
const offenders = [];
let scanned = 0;
for (const dir of SCAN_DIRS) {
  let files; try { files = readdirSync(dir); } catch { continue; }
  for (const f of files) {
    if (!SCAN_EXT.test(f) || f.includes('.bak') || f.includes('.test.')) continue;
    let raw;
    try { raw = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    if (raw.length > 40 * 1024 * 1024) continue;
    scanned++;
    const hits = [...new Set((raw.match(new RegExp(`"[^"]*${ENT.source}[^"]*"`, 'g')) || []))];
    if (hits.length) offenders.push({ f: `${dir.split('/').slice(-2).join('/')}/${f}`, n: hits.length, sample: hits.slice(0, 3) });
  }
}
offenders.length === 0
  ? ok(`데이터 소스에 HTML 엔티티 없음 (${scanned}개 파일 검사)`)
  : bad(`엔티티 잔존:\n` + offenders.map(o => `        ${o.f} — ${o.n}건 · 예: ${o.sample.map(s=>s.slice(0,40)).join(', ')}`).join('\n'));

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * scripts/build-company-names.mjs — companies-batch*.ts 의 실제 회사명을 ticker→name JSON 으로 추출.
 *
 * 배경(2026-06-03 CPRT→"Cypress Semiconductor" 환각 사건): generate-report-local.mjs 가 portfolio
 * name 검증을 ~60개 하드코딩 `US_NAMES_HARNESS` 로만 했음. CPRT(Copart) 가 거기 없어 LLM 환각이
 * 그대로 통과. 권위 소스(allCompanies, companies-batch*.ts ~515 실제 프로필)를 안 썼기 때문.
 *
 * 이 스크립트가 batch 파일에서 {name, ticker} 쌍을 전부 추출해 data/company-names.json 생성 →
 * generate-report-local.mjs(name override) + verify-report.mjs(name↔ticker probe) 가 공유.
 *
 * 필드 순서 무관(name→ticker / ticker→name 양쪽) + 객체 경계 기반 파싱.
 * 사용: node scripts/build-company-names.mjs   (data/company-names.json 갱신)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const out = {};
let scanned = 0;

for (let i = 1; i <= 10; i++) {
  const f = `src/data/companies-batch${i}.ts`;
  if (!existsSync(f)) continue;
  const src = readFileSync(f, 'utf8');
  // 객체 단위 분할: `{ ... }` 안에서 name 과 ticker 를 같이 잡음 (순서 무관).
  // 각 ticker 출현 위치 기준 ±600자 윈도우에서 가장 가까운 name 매칭.
  const tickerRe = /ticker:\s*["']([A-Z0-9.\-]+)["']/g;
  let m;
  while ((m = tickerRe.exec(src)) !== null) {
    const ticker = m[1];
    const pos = m.index;
    const win = src.slice(Math.max(0, pos - 600), pos + 600);
    // 같은 객체 내 name (가장 가까운 것). name 필드는 회사명, sector/industry 와 구분.
    const nameMatches = [...win.matchAll(/\bname:\s*["']([^"']+)["']/g)];
    if (nameMatches.length === 0) continue;
    // ticker 위치(윈도우 내 상대 좌표)에 가장 가까운 name 선택
    const relTicker = Math.min(pos, 600);
    let best = null, bestDist = Infinity;
    for (const nm of nameMatches) {
      const d = Math.abs(nm.index - relTicker);
      if (d < bestDist) { bestDist = d; best = nm[1]; }
    }
    if (best && !out[ticker]) { out[ticker] = best; scanned++; }
  }
}

writeFileSync('data/company-names.json', JSON.stringify(out, null, 0) + '\n');
console.log(`[build-company-names] ${Object.keys(out).length} tickers → data/company-names.json`);
console.log(`  CPRT=${out.CPRT ?? '(missing)'} | NVDA=${out.NVDA ?? '?'} | AAPL=${out.AAPL ?? '?'}`);

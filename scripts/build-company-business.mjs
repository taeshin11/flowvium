#!/usr/bin/env node
/**
 * scripts/build-company-business.mjs — companies-batch*.ts 의 products(주력 매출상품) + description
 *   을 ticker→{products, desc} JSON 으로 추출. 보고서/회사페이지가 "무슨 사업으로 매출 내는지" 표시용.
 *
 * 배경(2026-06-07 사용자 지적): 보고서 종목(APH 등)에 재무수치만 있고 주력 제품/사업개요가 없어
 *   "뭐로 매출 내는 기업인지 모르겠다". companies-batch 에 products[](name+revenueShare) + description
 *   큐레이션 데이터가 있는데 보고서가 안 씀. LLM 생성(환각위험)보다 이 큐레이션 소스가 정확.
 *
 * 사용: node scripts/build-company-business.mjs   (data/company-business.json 갱신)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const out = {};
let n = 0;

const files = [];
for (let i = 1; i <= 10; i++) { const f = `src/data/companies-batch${i}.ts`; if (existsSync(f)) files.push(f); }
if (existsSync('src/data/companies.ts')) files.push('src/data/companies.ts');

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // ticker 출현마다 그 직후 ~3000자 윈도우에서 products[] + description 추출
  const tickerRe = /ticker:\s*["']([A-Z0-9.\-]+)["']/g;
  let m;
  while ((m = tickerRe.exec(src)) !== null) {
    const ticker = m[1];
    if (out[ticker]) continue;
    const win = src.slice(m.index, m.index + 3500);
    // products: [ ... ] (관계 relationships 의 products 와 구분 — 첫 products 블록만)
    const prodBlock = win.match(/products:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const prods = [...prodBlock.matchAll(/name:\s*["']([^"']+)["'][\s\S]{0,260}?revenueShare:\s*(\d+)/g)]
      .map(x => ({ name: x[1], share: +x[2] }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 4);
    // description (회사 사업 개요 1-2문장) — 4-space 들여쓰기 = 회사레벨(products[].description 는
    //   더 깊은 들여쓰기라 제외). 회사 description 은 products/relationships 블록 뒤에 위치.
    const desc = win.match(/\n {4}description:\s*["']([^"']{20,400})["']/)?.[1] ?? '';
    if (!prods.length && !desc) continue;
    const productsStr = prods.map(p => `${p.name} ${p.share}%`).join(' · ');
    out[ticker] = { products: productsStr, desc: desc.trim() };
    n++;
  }
}

// 큐레이션 — companies-batch 미수록 주요 대형주(보고서 편입되나 사업프로필 없는 사각지대).
//   share% 불확실하면 제품명만(가짜 % 금지 — 환각 방지). 발견 시 추가.
const CURATED = {
  APH: { products: '커넥터·인터커넥트 · 센서 · 안테나/케이블', desc: 'Amphenol — 전기/전자 커넥터, 인터커넥트 시스템, 센서, 안테나, 케이블 제조. IT/데이터센터·모바일·자동차·산업·방산·브로드밴드 시장 공급.' },
};
for (const [t, v] of Object.entries(CURATED)) { if (!out[t]) { out[t] = v; n++; } }

writeFileSync('data/company-business.json', JSON.stringify(out, null, 0) + '\n');
console.log(`[build-company-business] ${n} tickers → data/company-business.json`);
console.log(`  예: UNH=${JSON.stringify(out.UNH?.products)} | NVDA=${JSON.stringify(out.NVDA?.products)}`);

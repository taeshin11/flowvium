#!/usr/bin/env node
/**
 * scripts/fix-supply-chain-count.mjs
 *
 * 사용자 지적: "종목수 늘었는데 아직도 616개라고 표시된곳이 많아"
 *
 * 16 messages/*.json 의 exploreSupplyChainsDesc 의 "616" hardcoded 숫자를
 * `{count}` placeholder 로 변경. 빌드 시 HomePage 에서 allCompanies.length 주입.
 *
 * 16 언어 → 같은 의미 한 줄 update.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('messages');
const files = readdirSync(dir).filter(f => f.endsWith('.json'));

let updated = 0;
for (const f of files) {
  const path = resolve(dir, f);
  let text = readFileSync(path, 'utf8');
  const before = text;
  // 616 (또는 다른 숫자) 를 {count} placeholder 로 — exploreSupplyChainsDesc 라인만 정확히 치환
  text = text.replace(/("exploreSupplyChainsDesc"\s*:\s*")([^"]*?)\d{3,4}([^"]*?")/, (m, p1, pre, post) => `${p1}${pre}{count}${post}`);
  if (text !== before) {
    writeFileSync(path, text, 'utf8');
    updated++;
    const newLine = text.match(/"exploreSupplyChainsDesc"\s*:\s*"[^"]+"/);
    console.log(`✅ ${f}: ${newLine?.[0]}`);
  } else {
    console.log(`⏭️  ${f}: skip (no match)`);
  }
}
console.log(`\n${updated}/${files.length} 파일 업데이트`);

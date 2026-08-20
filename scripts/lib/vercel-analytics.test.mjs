#!/usr/bin/env node
/**
 * vercel-analytics.test.mjs — 자가호스팅에서 Vercel 애널리틱스를 로드하지 않는지 검증.
 *
 * 배경(2026-08-20 실측): 브라우저 콘솔에 404 두 건.
 *   /_vercel/speed-insights/script.js — net::ERR_ABORTED
 *   /_vercel/insights/script.js       — net::ERR_ABORTED
 *   2026-06-02 Vercel→자가호스팅 이전 후에도 layout.tsx 가 <Analytics/> <SpeedInsights/> 를
 *   무조건 렌더해 매 페이지뷰마다 존재하지 않는 스크립트를 요청한다. 기능은 안 죽지만
 *   모든 방문자의 콘솔에 에러가 찍히고 요청이 낭비된다.
 *   조건은 환경으로 판단해야 한다 — 코드에서 지우면 Vercel 로 되돌릴 때 다시 넣어야 한다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'src/app/layout.tsx'), 'utf8');
// 무조건 렌더면 실패. 환경 조건이 붙어 있어야 한다.
// 조건부 블록 안에 있는지로 판정한다(들여쓰기가 아니라 구조).
const gated = /\{\s*isVercel\s*&&\s*\([\s\S]{0,400}?<Analytics\s*\/>[\s\S]{0,400}?<SpeedInsights\s*\/>/.test(src);
gated ? ok('Analytics/SpeedInsights 가 조건부 블록 안')
      : bad('무조건 렌더 — 자가호스팅에서 404');
/process\.env\.VERCEL/.test(src) ? ok('환경(VERCEL)으로 분기 — 되돌릴 수 있음')
                                 : bad('환경 분기 없음 (코드에서 지우면 복귀가 어려움)');
// ③ 자가호스팅인데 .env.local 이 VERCEL=1 이면 분기가 무력해진다
const env = (() => { try { return readFileSync(resolve(ROOT, '.env.local'), 'utf8'); } catch { return ''; } })();
const claimsVercel = /^VERCEL=["']?1["']?\s*$/m.test(env);
claimsVercel ? bad('.env.local 이 VERCEL=1 — 자가호스팅인데 Vercel 이라고 주장해 분기가 무력')
             : ok('.env.local 이 VERCEL 을 주장하지 않음');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * prefer-small-model.test.mjs — preferSmallModel 이 실제로 작은 모델로 보낸다.
 *
 * 배경(2026-08-22 실측): /api/company-news 가 KR 종목마다 정확히 30.1초 걸렸다(US 는 0.4~0.7초).
 *   audit-coverage 의 프로브 상한이 20초라 company-news 가 3/12 로 떨어져 push 게이트를 막고 있었다.
 *   ("느리다" 가 아니라 *정확히* 30초라 고정 상한을 의심했고, 맞았다.)
 *
 *   로그: {"source":"company-news","event":"local_only_fallback","durationMs":30002}
 *   ai-providers.ts:77  signal: AbortSignal.timeout(opts.timeoutMs ?? 30000)
 *
 *   그런데 웹 레인(:8001, 4B)에 같은 요약을 직접 시키면 2.5초에 답한다.
 *   추적하니 ai-providers.ts:36 에 preferSmallModel 옵션이 *선언만* 되어 있고
 *   라우팅에 쓰이지 않았다 — 호출부는 작은 모델을 원했는데 요청은 27B(:8000)로 갔다.
 *   27B 는 보고서 전용이고 --prompt-concurrency 1 이라 200토큰 요약도 30초를 넘긴다.
 *
 *   선언만 있고 동작하지 않는 옵션은 호출부를 속인다 — 오늘 하루 반복해 만난 부류다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'src/lib/ai-providers.ts'), 'utf8');

// 옵션이 선언만 되고 안 쓰이면 호출부가 속는다
const uses = (src.match(/preferSmallModel/g) ?? []).length;
uses > 1 ? ok(`preferSmallModel 이 ${uses}곳에서 쓰인다 (선언 + 사용)`)
         : bad(`preferSmallModel 이 ${uses}곳 — 선언만 있고 라우팅에 안 쓰인다`);

// 작은 모델을 원하면 웹 레인(LOCAL_LLM_URL)으로 가야 한다
/LOCAL_LLM_URL/.test(src)
  ? ok('웹 레인(LOCAL_LLM_URL)을 참조한다')
  : bad('웹 레인을 모른다 — preferSmallModel 이 갈 곳이 없다');

// 호출부가 실제로 이 옵션을 쓰고 있는지 (쓰는 곳이 없으면 이 테스트가 무의미)
const callers = [];
for (const f of ['src/app/api/company-news/route.ts', 'src/app/api/news-cascade/route.ts']) {
  try { if (/preferSmallModel:\s*true/.test(readFileSync(resolve(ROOT, f), 'utf8'))) callers.push(f); } catch {}
}
callers.length ? ok(`호출부 ${callers.length}곳이 이 옵션을 쓴다: ${callers.map(c => c.split('/').pop()).join(', ')}`)
               : bad('이 옵션을 쓰는 호출부가 없다 — 테스트 전제가 낡았다');

console.log(fail === 0 ? '\n✅ prefer-small-model 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

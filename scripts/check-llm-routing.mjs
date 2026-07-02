#!/usr/bin/env node
/**
 * scripts/check-llm-routing.mjs — LLM 라우팅 stale-가정 회귀가드 (2026-07-02 신설)
 *
 * 발생 경위: 클라우드 LLM 키 전면 revoke(2026-06-15) 후에도 "EXAONE 취약" 시절의 skipVllm:true 가
 *   flow-analysis·signal-retrospective 에 남아 *유일한 LLM(vLLM)을 건너뛰는* 영구 fallback 이 됐다
 *   (2026-07-02 발견 — 환경이 바뀌어도 과거 가정을 재감사하는 체계가 없던 클래스).
 *   같은 클래스: finance 모델 실측 ~10 tok/s 인데 고정 타임아웃(25s/55s)이 출력토큰 요구량보다 짧아
 *   장문 경로가 항상 timeout → fallback 되던 결함.
 *
 * 검사:
 *  [1] skipVllm:true 표면은 allowlist(자체 로컬 폴백 보유가 검증된 번역 경로)만 허용.
 *      신규/미분류 skipVllm = ❌ (키 revoke 환경에선 "LLM 전무"와 동치).
 *  [2] callAI/streamVllm 호출에서 maxTokens 와 timeoutMs 가 *같은 호출*에 리터럴로 있으면
 *      timeoutMs < 30s + 100ms/tok(실측 10 tok/s) 검출 → ❌. (llmTimeoutMs() 같은 파생식은 통과.)
 *
 * exit 1 = ❌ 존재. verify-all 에서 실행.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';

const ROOT = process.cwd().replace(/\\/g, '/');
let errN = 0, warnN = 0, okN = 0;
const err = (m) => { errN++; console.error(`❌ ${m}`); };
const warn = (m) => { warnN++; console.warn(`⚠️  ${m}`); };
const ok = (m) => { okN++; console.log(`✅ ${m}`); };

// skipVllm allowlist — *자체 로컬(Ollama/localChat) 폴백이 코드에 실재*함을 확인하고 등록한 표면만.
//   신규 등록 시 반드시 그 파일의 폴백 경로를 눈으로 확인할 것 (등록 사유 주석 필수).
const SKIPVLLM_ALLOW = {
  'src/app/api/translate/route.ts': '공유 번역 — callAI 빈결과 시 로컬 Ollama 폴백(라우트 내)',
  'src/app/api/news-cascade/route.ts': '뉴스 번역 — localChatNoBleed 1차, callAI 는 2차(빈결과 허용)',
  'src/lib/blog-translate.ts': '블로그 번역 — 로컬 우선 체인의 클라우드 leg(빈결과 시 로컬 폴백)',
  'src/lib/translate-headlines.ts': '헤드라인 번역 — 로컬 우선 체인의 클라우드 leg',
  'src/lib/daily-brief.ts': '데일리브리프 — 로컬 Ollama 1차, callAI 는 폴백 leg(라이브 src=ollama 실측)',
  'src/lib/ai-providers.ts': '정의부(옵션 선언) — 호출 표면 아님',
};

function walk(dir, out = []) {
  let entries; try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = `${dir}/${e}`;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!/node_modules|\.next|\.git/.test(e)) walk(p, out); }
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
  }
  return out;
}
const files = walk(`${ROOT}/src`).concat(walk(`${ROOT}/scripts`)).map((p) => p.replace(`${ROOT}/`, ''))
  .filter((f) => !f.endsWith('check-llm-routing.mjs'));  // 자기 자신(패턴 문자열 보유) 제외

console.log('## [1] skipVllm:true 표면 (allowlist 외 = 유일 LLM 건너뛰기)\n');
let sv = 0;
for (const f of files) {
  let src = ''; try { src = readFileSync(`${ROOT}/${f}`, 'utf8'); } catch { continue; }
  if (!/skipVllm\s*:\s*true/.test(src)) continue;
  sv++;
  if (SKIPVLLM_ALLOW[f]) ok(`${f} — allowlist (${SKIPVLLM_ALLOW[f]})`);
  else err(`${f} — skipVllm:true 미분류. 클라우드 키 revoke 환경에서 LLM 전무와 동치 — 제거하거나 로컬 폴백 확인 후 SKIPVLLM_ALLOW 등록`);
}
if (!sv) ok('skipVllm:true 표면 없음');

console.log('\n## [2] 고정 타임아웃 < 토큰 요구량 (실측 ~10 tok/s: 필요 ≈ 30s + 100ms/tok)\n');
let tShort = 0, tChecked = 0, tSkipped = 0;
for (const f of files) {
  let src = ''; try { src = readFileSync(`${ROOT}/${f}`, 'utf8'); } catch { continue; }
  // 같은 옵션객체 안에 maxTokens 리터럴 + timeoutMs 리터럴이 공존하는 호출만 판정(llmTimeoutMs() 파생식은 자동 통과).
  for (const m of src.matchAll(/maxTokens:\s*(\d+)[^}]{0,220}?timeoutMs:\s*(\d+)|timeoutMs:\s*(\d+)[^}]{0,220}?maxTokens:\s*(\d+)/gs)) {
    const maxTok = Number(m[1] ?? m[4]), tmo = Number(m[2] ?? m[3]);
    if (!maxTok || !tmo) continue;
    // skipVllm:true 동반 호출 = vLLM 미도달(클라우드 키 revoke 로 즉시 빈결과) — 타임아웃 무의미, 판정 제외.
    const around = src.slice(Math.max(0, m.index - 250), m.index + m[0].length + 250);
    if (/skipVllm\s*:\s*true/.test(around)) { tSkipped++; continue; }
    tChecked++;
    const need = 30_000 + maxTok * 100;
    if (tmo < Math.min(300_000, need)) {
      tShort++;
      err(`${f} — maxTokens ${maxTok} 인데 timeoutMs ${tmo / 1000}s < 필요 ~${Math.round(Math.min(300, need / 1000))}s (10 tok/s 실측). llmTimeoutMs 패턴 적용`);
    }
  }
}
if (tSkipped) console.log(`   (skipVllm 동반 ${tSkipped}건 판정 제외 — vLLM 미도달 경로)`);
if (!tShort) ok(`고정 타임아웃 부족 0건 (리터럴 쌍 ${tChecked}건 검사)`);

console.log(`\n종합: ok ${okN} / warn ${warnN} / err ${errN}`);
if (errN) { console.error('\n❌ FAIL — LLM 라우팅 stale 가정 검출'); process.exit(1); }
console.log('✅ PASS');

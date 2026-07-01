#!/usr/bin/env node
/**
 * scripts/check-hanja-coverage.mjs — 한자 zero-tolerance 커버리지 게이트 (2026-07-01, 노드 spinai1/2/6 G12 차용).
 *
 * "코드에 가드 있음 ≠ 그 표면에 적용됨" — LLM 완성 호출 표면을 *정적 열거*해 각 user-facing 한국어 산문
 * 표면이 한자가드를 경유하는지 강제 검증. point-wise scrub 맹점을 체계적으로 봉쇄.
 *
 * 판정:
 *   - GUARDED : 파일에 한자가드 참조(sanitizeText/sanitizeReport/sanitizeAnswer/hasChineseBleed/localChatNoBleed/한자)
 *   - EXEMPT  : user-facing 한국어 산문 아님(인프라/probe/launcher/dev/영어출력/JSON추출/serves-guarded) — 사유 문서화
 *   - TRACKED : KO 산문 표면이나 아직 가드 미경유 — 알려진 갭(WARN, 비차단). 향후 localChatNoBleed 경유 or 소스억제.
 *   - ★UNCLASSIFIED(신규) : 위 어디에도 없는 LLM 표면 = 회귀 → FAIL(exit 1). 새 스트림 표면이 가드 없이 추가되면 즉시 차단.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';

const ROOT = process.cwd().replace(/\\/g, '/');
const LLM_RE = /callVLLM|callOllama|streamVllm|callAI|localChat|generateViaOllama|:8000\/v1|11434/;
const GUARD_RE = /sanitizeText|sanitizeReport|sanitizeAnswer|hasChineseBleed|localChatNoBleed|한자|2E80|\\uF900/;
// 포터블 열거 — execSync grep 은 Windows cmd.exe 에 없어 실패 → 순수 node fs 워크.
function walk(dir, out = []) {
  let entries; try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === '.git' || e === 'dist') continue;
    const p = `${dir}/${e}`;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|cjs|bat|sh)$/.test(e)) out.push(p);
  }
  return out;
}

// EXEMPT — user-facing 한국어 산문 아님(사유 명시). spinai2 "services EXEMPT 문서화" 규율.
const EXEMPT = {
  'src/lib/ai-providers.ts': 'LLM 래퍼 인프라(callVLLM 등 정의) — 소비처가 표면',
  'src/lib/llm-local.ts': '한자 bleed 가드 라이브러리 자체(hasChineseBleed 단일출처)',
  'scripts/check-stall.mjs': 'model-id health probe(/v1/models) — 산문 생성 아님',
  'scripts/pm2-watchdog.mjs': 'health probe — 산문 생성 아님',
  'scripts/run-report.bat': '런처(가드된 generate-report 호출)',
  'scripts/sft/check-lora-vllm.sh': 'SFT/학습 dev 도구 — 비사용자대면',
  'scripts/build-segments-dynamic.mjs': '내부 세그먼트 데이터 빌드(JSON) — 사용자 산문 아님',
  'src/app/api/ai/route.ts': '영어 시스템프롬프트/영어 출력(You are Flowvium AI…)',
  'src/app/api/investment-strategy/route.ts': '저장된 리포트 serve(생성시 sanitizeReport 6블록 적용됨)',
  'src/lib/supply-chain-extract.ts': '영어 프롬프트 + JSON 구조추출(공급망 관계)',
  'src/app/api/cron/signal-retrospective/route.ts': '영어 프롬프트 + JSON 회고 데이터',
  'src/lib/strategy-quality.ts': '전략 품질 스코어링(수치) — 산문 아님',
  'src/app/api/cron/daily-brief/route.ts': 'lib/daily-brief(가드됨) 위임',
  'src/app/api/daily-brief/route.ts': 'lib/daily-brief(가드됨) 위임',
  'src/app/api/flow-analysis/route.ts': '영어 프롬프트/영어 JSON 출력(Analyze… Respond in JSON only)',
};
// TRACKED — KO 산문 표면이나 가드 미경유(알려진 갭, WARN). 향후 localChatNoBleed 경유 or 소스억제로 fix.
const TRACKED = {
  'src/lib/blog-translate.ts': 'KO 블로그 번역 → localChatNoBleed 경유 필요',
  'src/lib/translate-headlines.ts': 'KO 헤드라인 번역 → localChatNoBleed 경유 필요',
  'src/app/api/company-news/route.ts': 'KO 뉴스 번역 → localChatNoBleed 경유 필요',
  'src/app/api/cron/log-cascade-events/route.ts': 'KO cascade 로그 → 검토 필요',
  'src/app/api/supply-chain-signals/route.ts': 'KO 8-K 백그라운드 요약(qwen3) → 소스억제/sanitize 필요',
};

const files = [...walk(`${ROOT}/scripts`), ...walk(`${ROOT}/src`)]
  .filter((p) => !p.endsWith('check-hanja-coverage.mjs'))  // 게이트 자기 파일(LLM_RE 정의를 자기매칭) 제외
  .filter((p) => { try { return LLM_RE.test(readFileSync(p, 'utf8')); } catch { return false; } })
  .map((p) => p.replace(`${ROOT}/`, '')).sort();

let guarded = 0, exempt = 0, tracked = 0; const unclassified = [];
console.log('한자 커버리지 게이트 — LLM 출력표면 정적 열거\n');
for (const f of files) {
  let src = ''; try { src = readFileSync(`${ROOT}/${f}`, 'utf8'); } catch {}
  const hasGuard = GUARD_RE.test(src);
  if (hasGuard) { guarded++; console.log(`  ✅ GUARDED   ${f}`); }
  else if (EXEMPT[f]) { exempt++; console.log(`  ⚪ EXEMPT    ${f}  — ${EXEMPT[f]}`); }
  else if (TRACKED[f]) { tracked++; console.log(`  ⚠️  TRACKED   ${f}  — ${TRACKED[f]}`); }
  else { unclassified.push(f); console.log(`  ❌ UNCLASSIFIED ${f}  — 신규 LLM 표면? 가드 경유 or EXEMPT/TRACKED 분류 필요`); }
}
// 요약 라벨은 ❌/FAIL 토큰 미포함(verify-all errCount 오탐 방지) — ❌ 는 실제 미분류 발생 라인·에러블록에서만.
console.log(`\n종합: GUARDED ${guarded} / EXEMPT ${exempt} / TRACKED(갭) ${tracked} / 미분류(신규) ${unclassified.length}`);
if (tracked) console.log(`⚠️  TRACKED ${tracked}건 = KO 산문 미가드 갭(가시화, 비차단) — 향후 localChatNoBleed/소스억제로 fix`);
if (unclassified.length) {
  console.error(`\n❌ FAIL: 미분류 LLM 표면 ${unclassified.length}건 — 새 표면이 가드 없이 추가됨(회귀). 가드 경유시키거나 EXEMPT/TRACKED 에 사유와 함께 등록하라:`);
  unclassified.forEach((f) => console.error(`   - ${f}`));
  process.exit(1);
}
console.log('✅ 한자 커버리지 OK (미분류 신규표면 0 — 회귀봉쇄)');

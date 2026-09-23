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
// 2026-09-23: chat\/completions 와 resolveLlm 을 추가했다. 종전 목록은 **리터럴 URL** 에 기대서,
//   `resolveLlm('report')` 로 베이스를 받아 `${base}/chat/completions` 로 부르는 호출부를 못 봤다
//   (실측: build-segments-dynamic.mjs 가 EXEMPT 에 등록돼 있는데 목록에는 한 번도 안 잡혔다 —
//    면제된 게 아니라 **안 보이던** 것이다. 면제는 보여야 면제다).
const LLM_RE = /callVLLM|callOllama|streamVllm|callAI|localChat|generateViaOllama|:8000\/v1|11434|chat\/completions|resolveLlm/;
const GUARD_RE = /sanitizeText|sanitizeReport|sanitizeAnswer|hasChineseBleed|localChatNoBleed|한자|2E80|\\uF900/;
/**
 * 주석만 걷어 낸다. 판정용이지 되쓰기용이 아니다.
 *
 * 줄 끝 `//` 주석은 **일부러 남긴다.** 코드 줄의 `'http://127.0.0.1:8000/v1'` 을
 *   `//` 로 자르면 LLM_RE 의 `:8000\/v1` 이 사라져 **진짜 표면을 놓친다.**
 *   게이트는 틀릴 때 과탐 쪽으로 틀려야 한다.
 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // 블록 주석 (머리말 포함)
    .replace(/^[ \t]*\/\/.*$/gm, '');         // 줄 전체가 주석인 것만
}

// 포터블 열거 — execSync grep 은 Windows cmd.exe 에 없어 실패 → 순수 node fs 워크.
function walk(dir, out = []) {
  let entries; try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    // 2026-08-20: 점으로 시작하는 디렉토리를 통째로 건너뛴다. 재작성 전 백업(scripts/.bak-*/)이
    //   스캔에 잡혀 "미분류 LLM 표면" 오탐을 냈다. 이름을 하나씩 박으면 다음 백업에서 또 샌다.
    if (e.startsWith('.') || e === 'node_modules' || e === 'dist') continue;
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
  // 2026-09-02 신설, 2026-09-09 등록. /v1/models 200 만 보고 "정상" 이라 찍던 게이트가
  //   3일 정지를 놓쳐서, 생성 경로까지 실제로 찔러 보도록 만든 프로브다.
  //   max_tokens: 1 로 'ping' 을 보내 choices 가 오는지만 본다 — 그 응답은 버린다.
  //   사용자에게 산문이 나가는 표면이 아니라 가드를 태울 대상이 아니다.
  // 2026-08-21 신설. LLM 을 호출하지도 산문을 만들지도 않는다 — 요청 동시성만 제한한다.
  //   주석에 서버 URL(:8000)과 mlx 플래그를 적어 둔 탓에 LLM_RE 에 매칭됐을 뿐이다.
  // 2026-08-20: LLM 호출이 0건인 설정 해석기. LLM_RE 의 ':8000/v1'(기본 URL 문자열)에 매칭됐을 뿐
  //   출력 표면이 아니다 — URL/모델명만 돌려준다.
  'scripts/lib/llm-config.mjs': '설정 해석기(LLM 호출 0건, 기본 URL 문자열만 보유 — 출력 표면 아님)',
  'scripts/run-report.sh': '런처(가드된 generate-report 호출) — 맥 launchd 가 실제로 부르는 진입점. .bat 은 윈도우 유물.',
  'scripts/sft/check-lora-vllm.sh': 'SFT/학습 dev 도구 — 비사용자대면',
  'scripts/build-segments-dynamic.mjs': '내부 세그먼트 데이터 빌드(JSON) — 사용자 산문 아님',
  'src/app/api/ai/route.ts': '영어 시스템프롬프트/영어 출력(You are Flowvium AI…)',
  'src/app/api/investment-strategy/route.ts': '저장된 리포트 serve(생성시 sanitizeReport 6블록 적용됨)',
  'scripts/lib/llm-health.mjs': '생성 경로 health probe(ping, max_tokens 1) — 응답 폐기, 산문 아님',
  'src/lib/supply-chain-extract.ts': '영어 프롬프트 + JSON 구조추출(공급망 관계)',
  'src/app/api/cron/signal-retrospective/route.ts': '영어 프롬프트 + JSON 회고 데이터',
  'src/lib/strategy-quality.ts': '전략 품질 스코어링(수치) — 산문 아님',
  'src/app/api/cron/daily-brief/route.ts': 'lib/daily-brief(가드됨) 위임',
  'src/app/api/daily-brief/route.ts': 'lib/daily-brief(가드됨) 위임',
  'src/app/api/flow-analysis/route.ts': '영어 프롬프트/영어 JSON 출력(Analyze… Respond in JSON only)',
  // ── 2026-09-23: LLM_RE 에 chat\/completions·resolveLlm 을 넣자 드러난 표면들.
  //    여태 리터럴 URL 만 보느라 안 보이던 것들이다. 각각 실제로 열어 보고 적었다.
  'scripts/cron-runner.mjs': "resolveLlm('report').model 로 **모델명만** 가져간다(gpu-watchdog 언로드 대상) — LLM 호출 0건",
  'scripts/llm-health-check.mjs': '기동/생성 프로브 — 응답 폐기, 판정만 출력',
  'src/app/api/cron/verify-metrics/route.ts': 'GROQ quota 프로브 — x-ratelimit 헤더만 읽고 본문 폐기',
  'scripts/sft/distill-gen.mjs': '학습데이터(SFT) 생성 — 수동 실행, 사용자 표면 아님',
  'scripts/sft/gen-buffett-sft.mjs': '학습데이터(SFT) 생성 — 수동 실행, 사용자 표면 아님',
  'scripts/generate-contexts.ts': '수동 dev 툴(npx tsx) — 산출물 src/data/generated/company-contexts.json 이 2026-06-15 이후 4바이트 빈 파일. 파이프라인에 없음',
};
// TRACKED — KO 산문 표면이나 가드 미경유(알려진 갭, WARN). 향후 localChatNoBleed 경유 or 소스억제로 fix.
const TRACKED = {
  // 2026-09-23 신규 가시화 + 실측. 종전엔 게이트에 잡히지도 않았다(변수 URL).
  //    화면에 박혀 나가는 한국어다 — DB 실측(최근 hooks 있는 36편):
  //      hooks_json 4/36 편에 한자(靑·與·李), bodies_json 0/36, headline 10/36(美·韓·靑·北…).
  //    headline 쪽은 언론이 쓰는 약자라 소스에서 온 것이고, hooks 는 LLM 이 그걸 따라 쓴 것이다.
  //    지울지 둘지는 정책 판단이라 임의로 안 바꾼다 — 우선 **보이게** 한다(WARN, 비차단).
  'scripts/video/make-shorts.mjs': '쇼츠 훅/대본(KO, 화면 표시) — 가드 미경유. 실측 hooks 4/36편에 한자(靑與李)',
  'scripts/video/make-issue-video.mjs': '이슈영상 대본(KO, 화면 표시) — 가드 미경유',
  'src/lib/blog-translate.ts': 'KO 블로그 번역 → localChatNoBleed 경유 필요',
  'src/lib/translate-headlines.ts': 'KO 헤드라인 번역 → localChatNoBleed 경유 필요',
  'src/app/api/company-news/route.ts': 'KO 뉴스 번역 → localChatNoBleed 경유 필요',
  'src/app/api/cron/log-cascade-events/route.ts': 'KO cascade 로그 → 검토 필요',
  'src/app/api/supply-chain-signals/route.ts': 'KO 8-K 백그라운드 요약(qwen3) → 소스억제/sanitize 필요',
};

const files = [...walk(`${ROOT}/scripts`), ...walk(`${ROOT}/src`)]
  .filter((p) => !p.endsWith('check-hanja-coverage.mjs'))  // 게이트 자기 파일(LLM_RE 정의를 자기매칭) 제외
  // 2026-08-21: 테스트 파일은 사용자에게 아무것도 내보내지 않는다 — 출력표면이 아니다.
  //   LLM 을 흉내내거나 소스를 문자열로 검사하느라 LLM_RE 에 걸릴 뿐이다.
  //   이름을 하나씩 EXEMPT 에 박으면 다음 테스트에서 또 샌다(위 24행이 같은 교훈).
  .filter((p) => !/\.test\.mjs$/.test(p))
  // 2026-09-23: 종전엔 파일 원문에 LLM_RE 를 걸었다. 그러면 **주석에서 호출부를 언급하기만 해도**
  //   LLM 출력표면으로 잡힌다(실측: model-provenance.mjs 가 'callVLLMOnce 안에서만 채워진다' 라고
  //   설명한 것만으로 UNCLASSIFIED FAIL). 이 저장소는 주석에 호출부를 적어 두는 규율이 있어서
  //   설명을 쓸수록 오탐이 늘어난다 — 이름을 하나씩 EXEMPT 에 박는 것은 위 24·76행이 이미 버린 방법이다.
  //   그래서 주석을 걷어 낸 본문으로 판정한다. 진짜 호출부는 주석이 아니라 코드다.
  .filter((p) => { try { return LLM_RE.test(stripComments(readFileSync(p, 'utf8'))); } catch { return false; } })
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
// 2026-09-23: 더 이상 잡히지 않는 면제 항목을 신고한다.
//   죽은 EXEMPT 는 그냥 지저분한 게 아니라 **함정**이다 — 그 파일에 나중에 진짜 LLM 호출이
//   들어가면 이 항목이 조용히 면제해 준다. 면제는 사유가 살아 있을 때만 유효하다.
//   (주석 판정으로 바꾸면서 llm-gate/llm-health 두 항목이 실제로 죽었고, 그래서 지웠다.)
const listed = new Set(files);
const dead = [...Object.keys(EXEMPT), ...Object.keys(TRACKED)].filter((f) => !listed.has(f));
if (dead.length) {
  console.log(`\n⚠️  죽은 분류 ${dead.length}건 — 이제 LLM 표면으로 잡히지 않는다. 사유가 유효한지 보고 지워라:`);
  for (const f of dead) console.log(`     ${f}`);
}
console.log(`\n종합: GUARDED ${guarded} / EXEMPT ${exempt} / TRACKED(갭) ${tracked} / 미분류(신규) ${unclassified.length}`);
if (tracked) console.log(`⚠️  TRACKED ${tracked}건 = KO 산문 미가드 갭(가시화, 비차단) — 향후 localChatNoBleed/소스억제로 fix`);
if (unclassified.length) {
  console.error(`\n❌ FAIL: 미분류 LLM 표면 ${unclassified.length}건 — 새 표면이 가드 없이 추가됨(회귀). 가드 경유시키거나 EXEMPT/TRACKED 에 사유와 함께 등록하라:`);
  unclassified.forEach((f) => console.error(`   - ${f}`));
  process.exit(1);
}
console.log('✅ 한자 커버리지 OK (미분류 신규표면 0 — 회귀봉쇄)');

#!/usr/bin/env node
/**
 * local-first-translate.test.mjs — 번역 경로가 로컬 LLM 을 먼저 쓰는가.
 *
 * 배경(2026-08-22 눈검증): /ko/blog 캡쳐에서 글 제목·요약이 전부 영문이었다.
 *   배선은 멀쩡했다 — blog/page.tsx 가 translateBlogSummary 를 부르고 BlogClient 가
 *   그 결과를 그린다. 문제는 그 아래였다:
 *
 *     src/lib/blog-translate.ts:62  callAI(..., { skipVllm: true })   ← 로컬을 건너뛴다
 *     src/lib/blog-translate.ts:94  if (msg.includes('429')||'quota') return text;  ← 조용히 원문
 *
 *   바로 위 주석은 "통합 AI 체인 (vLLM → GROQ → Gemini)" 이라고 *주장* 한다.
 *   코드가 vLLM 을 빼고 있다 — 주석이 코드보다 낙관적이었다.
 *   실측: ko 블로그 캐시 0/8 적중, 로그 0건. 캐시는 `translated !== text` 일 때만 쓰므로
 *   실패하면 아무 흔적도 안 남고 매 방문마다 조용히 실패한다.
 *
 *   CLAUDE.md 가 "회사페이지 미번역 사건" 뒤 만든 규칙이 정확히 이것이다 —
 *   "LLM 번역 경로는 로컬 우선, cloud 는 fallback. 소비처가 여러 곳이면 **전부** 적용."
 *   실측 5개 소비처 중 3개는 지켰고 2개(blog-translate · translate-headlines)가 빠져 있었다.
 *
 * 판정 규칙(유도): `skipVllm: true` 는 '이 호출에서는 로컬을 쓰지 말라' 는 뜻이므로
 *   **폴백 표식**이다. 그걸 쓰면서 파일 어디에도 로컬 시도가 없으면 곧장 클라우드로 가는 것이다.
 *   소비처 목록을 손으로 적지 않는다 — 새 소비처가 생기면 이 규칙이 자동으로 적용된다.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const files = [];
const walk = (dir, d = 0) => {
  if (d > 6) return;
  let ents = []; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, d + 1);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
};
walk(resolve(ROOT, 'src'));
files.length > 100 ? ok(`src 스캔 ${files.length}개 파일`) : bad(`스캔 결과 ${files.length}개 — 앵커가 낡았다`);

const LOCAL = /localChat|localChatNoBleed|translateViaOllama|LOCAL_LLM_URL|127\.0\.0\.1:800/;
const offenders = [];
for (const p of files) {
  let src = ''; try { src = readFileSync(p, 'utf8'); } catch { continue; }
  if (!/skipVllm:\s*true/.test(src)) continue;
  if (LOCAL.test(src)) continue;
  offenders.push(p.replace(ROOT + '/', ''));
}
offenders.length
  ? bad(`로컬 시도 없이 곧장 클라우드로 가는 번역 경로 ${offenders.length}건: ${offenders.join(', ')}`)
  : ok('skipVllm 을 쓰는 모든 경로가 로컬 시도를 갖는다');

// 조용한 삼킴 — 실패가 흔적을 남기지 않으면 아무도 모른다(로그 0건이 그 결과였다).
const bt = (() => { try { return readFileSync(resolve(ROOT, 'src/lib/blog-translate.ts'), 'utf8'); } catch { return ''; } })();
/(429|quota)[^\n]*\n?[^\n]*return text;/.test(bt) && !/quota_exhausted|logger\.warn[^\n]*(429|quota)/.test(bt)
  ? bad('429/quota 를 로그 없이 삼키고 원문을 돌려준다 — 실패가 보이지 않는다')
  : ok('쿼터 소진을 로그로 남긴다');

// 평문 필드(제목·메타설명)에 마크다운을 넣으면 안 된다.
//   2026-08-22 내가 만든 회귀: 본문 섹션과 같은 프롬프트("Preserve all markdown")를 제목에도 써서
//   /ko/blog 화면에 `## ` 접두가 22줄 보였다. 게다가 호출 지점이 두 곳인데 한 곳만 고쳐
//   목록 페이지는 계속 깨진 채였다 — 같은 파일 안에서도 '한 곳만 고침' 이 났다.
{
  const bt2 = readFileSync(resolve(ROOT, 'src/lib/blog-translate.ts'), 'utf8');
  const calls = [...bt2.matchAll(/translateSection\(redis, locale, slug, 900[01], \w+, langName([^)]*)\)/g)];
  const missing = calls.filter((m) => !/true/.test(m[1]));
  calls.length >= 4 && missing.length === 0
    ? ok(`제목·메타설명 호출 ${calls.length}곳 전부 평문 모드`)
    : bad(`평문 모드가 아닌 제목/메타 호출 ${missing.length}건 (총 ${calls.length}) — 화면에 '## ' 가 남는다`);
  /plain && translated/.test(bt2)
    ? ok('평문 필드 계약(마크다운·개행 불가)을 코드가 강제한다')
    : bad('모델이 지시를 어겨도 그대로 캐시된다 — 180일 TTL 이라 오래 남는다');
}

console.log(fail === 0 ? '\n✅ local-first-translate 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

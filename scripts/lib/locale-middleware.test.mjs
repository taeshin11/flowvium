#!/usr/bin/env node
/**
 * locale-middleware.test.mjs — 점(.)이 든 동적 세그먼트도 로케일 미들웨어를 타야 한다.
 *
 * 배경(2026-08-22 눈검증): /ko/company/005930.KS 페이지 감사에서 english_leak 21건.
 *   내용은 전역 내비 라벨(AI Report · Heatmap · Screener · Search companies...).
 *   SSR 출력 대조로 원인이 확정됐다:
 *       /ko/company/AAPL       → 한글 ✓      /ja/company/AAPL      → 일본어 ✓
 *       /ko/company/005930.KS  → 영문 ✗      /ja/company/005930.KS → 영문 ✗
 *   = 한국 티커(005930.KS · 196170.KQ)에는 점이 있고, middleware matcher 의
 *     `.*\.*.*` 부정 전방탐색이 '점 = 정적 파일' 로 보고 요청을 통째로 건너뛴다.
 *     그러면 요청 로케일이 안 잡히고, [locale]/layout.tsx 의 getMessages() 가
 *     (locale 인자 없이 호출되므로) 기본 로케일로 폴백한다 → 16개 로케일 전부 영문.
 *
 *   next-intl 문서도 같은 함정을 경고한다: "matcher 는 점 같은 예기치 않은 문자를 포함한
 *   동적 세그먼트까지 앱의 모든 라우트를 맞춰야 한다". '점 제외' 는 흔한 편법일 뿐이다.
 *   정식은 *알려진 정적 확장자* 를 끝에서 제외하는 것이다.
 *
 * 한국 종목은 이 서비스의 절반이다 — 그 페이지가 전부 영문이었다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const mw = readFileSync(resolve(ROOT, 'src/middleware.ts'), 'utf8');
const m = mw.match(/matcher:\s*\[([^\]]+)\]/s);
if (!m) { bad('matcher 를 못 찾음 — 테스트 앵커가 낡았다'); }
else {
  const pattern = m[1].replace(/['"`\s]/g, '');
  // '어떤 위치든 점이 있으면 제외' 형태를 금지한다
  /\.\*\\\\?\.\.\*/.test(pattern)
    ? bad(`matcher 가 '점 포함 경로' 를 통째로 제외한다 — KR 티커(005930.KS)가 로케일을 못 받는다: ${pattern.slice(0, 60)}`)
    : ok('matcher 가 점 포함 경로를 통째로 제외하지 않는다');

  // 정적 자산은 확장자로 제외돼야 한다(제외 자체는 필요하다 — 안 하면 favicon 등이 리라이트된다)
  /\\\\?\.\(\?:?[a-z0-9|]+\)?\$|\\\\?\.[a-z0-9]+\$/i.test(pattern)
    ? ok('정적 자산을 확장자(끝)로 제외한다')
    : bad('정적 자산 제외 규칙이 없다 — favicon/robots 등이 미들웨어를 타면 오작동한다');

  // 실제 경로로 판정 시뮬레이션
  try {
    // TS 소스의 문자열 리터럴을 런타임 정규식으로 되돌린다.
    //   소스의 '\\.' 는 실제 정규식에서 '\.' 다. 이걸 안 풀면 '역슬래시+임의문자' 로 읽혀
    //   시뮬레이션이 통째로 거짓이 된다(처음에 그렇게 틀렸다 — /favicon.ico 가 통과로 나왔다).
    const runtime = pattern.replace(/\\\\/g, '\\');
    const rx = new RegExp('^' + runtime + '$');
    const cases = [
      ['/ko/company/005930.KS', true,  'KR 티커(점 포함) — 반드시 타야 한다'],
      ['/ko/company/196170.KQ', true,  'KOSDAQ 티커'],
      ['/ko/company/AAPL',      true,  'US 티커'],
      ['/ko/report',            true,  '일반 페이지'],
      ['/favicon.ico',          false, '정적 자산'],
      ['/robots.txt',           false, '정적 자산'],
      ['/api/health',           false, 'API'],
      ['/_next/static/x.js',    false, 'Next 내부'],
    ];
    let bads = 0;
    for (const [p, want, why] of cases) {
      const got = rx.test(p);
      if (got !== want) { bad(`matcher: ${p} → ${got}, 기대 ${want} (${why})`); bads++; }
    }
    if (!bads) ok(`경로 판정 ${cases.length}종 정확 (KR 티커 포함)`);
  } catch (e) { bad(`matcher 정규식 평가 실패: ${e.message}`); }
}

console.log(fail === 0 ? '\n✅ locale-middleware 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * ticker.test.mjs — 티커 형식 판정 (아카이브 저장 가드).
 *
 * 배경(2026-08-21 DB 감사): 아카이브 테이블에 티커가 아닌 값이 저장돼 있었다.
 *   short_squeeze_archive.ticker = '[TICKER]'  2행  ← 프롬프트 템플릿 문자열이 그대로
 *     (2026-06-02/03 · score 0 · "단기 매매 신호 없음" — LLM 이 줄 게 없는데 템플릿을 채웠다)
 *   insider_archive.ticker      = 'N/A'        1행
 *   저장 경로(db.mjs)는 `s.ticker ?? ''` 로 무검증이었다.
 *
 *   같은 정규식이 generate-report-local 두 곳(:3816, :8012)에 복제돼 있었다.
 *   복제된 규칙은 한쪽만 고쳐져 어긋난다 — 한 곳으로 모으고 저장 경로도 그걸 쓴다.
 */
import { isTicker, TICKER_RX } from './ticker.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const eq = (g, w, m) => (g === w ? ok(m) : (console.log(`  FAIL  ${m}  got ${JSON.stringify(g)}`), fail++));

// ① 실측 오염값 — 이게 저장돼 있었다
eq(isTicker('[TICKER]'), false, "'[TICKER]' 거부 (프롬프트 템플릿)");
eq(isTicker('N/A'), false, "'N/A' 거부");
eq(isTicker('[ACTUAL_TICKER]'), false, "'[ACTUAL_TICKER]' 거부");
// ② 정상 티커 — 거부하면 데이터를 잃는다
for (const t of ['AAPL', 'BRK.B', 'MSFT', '005930.KS', '083650.KQ', 'V', 'RDS-A', 'GOOGL'])
  eq(isTicker(t), true, `정상 티커 허용: ${t}`);
// ③ 소문자는 허용하되 판정은 대문자 기준
eq(isTicker('aapl'), true, '소문자 입력 허용(정규화 후 판정)');
// ④ 경계
eq(isTicker(''), false, '빈 문자열 거부');
eq(isTicker(null), false, 'null 거부');
eq(isTicker('  '), false, '공백만 거부');
eq(isTicker('TOOLONGTICKER12'), false, '과도한 길이 거부');
eq(isTicker('회사명'), false, '한글 거부');
eq(isTicker('Advanced Micro Devices'), false, '회사명(공백 포함) 거부');
// ⑤ 정규식 자체가 export 되어 재사용 가능
TICKER_RX instanceof RegExp ? ok('TICKER_RX export') : bad('TICKER_RX 없음');

// ⑥ 저장 경로가 가드를 쓴다
{
  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const { stripCommentsPreservingLines } = await import('./context-keys.mjs');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const db = stripCommentsPreservingLines(readFileSync(resolve(ROOT, 'scripts/lib/db.mjs'), 'utf8'));
  /isTicker\(/.test(db) ? ok('db.mjs 아카이브 저장이 isTicker 를 쓴다') : bad('저장 가드 미배선');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

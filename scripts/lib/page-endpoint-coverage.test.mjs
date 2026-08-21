#!/usr/bin/env node
/**
 * page-endpoint-coverage.test.mjs — 페이지 감사가 실제로 호출한 API 를 커버리지 근거로 쓴다.
 *
 * 배경(2026-08-21): audit-coverage [12] 가 매 사이클 경고한다 —
 *   "코드 참조하나 어떤 검증도 미커버 (3): /api/judge-chat, /api/client-log, /api/member"
 *   그런데 실측하면 /ko/judge 가 GET /api/member 와 GET /api/judge-chat?action=list 를 호출하고,
 *   audit-pages.mjs:207 도 /api/member 를 POST 한다. 이미 덮여 있는데 audit-coverage 가 모른다.
 *
 *   도구의 제안("TRACKED_ENDPOINTS 에 추가")은 틀렸다. 그 목록의 목적은
 *   "보고서 생성 시점 LLM 컨텍스트 재현"이라 세션 엔드포인트를 넣으면 재현 아카이브가 오염된다.
 *
 *   손 목록(COVERED_BY_...)을 하나 더 만드는 것도 답이 아니다 — 이 세션에서 손 목록이
 *   실제와 갈리는 걸 네 번 봤다(ctxNullCheck 14/25 · sectorLabels 7종 · callees 나열 · 티커 정규식 복제).
 *   페이지 감사가 브라우저에서 *실제로 관측한 호출*을 기록해 그걸 근거로 삼는다.
 */
import { endpointsFromPageAudit } from './page-endpoint-coverage.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const has = (s, v, m) => (s.has(v) ? ok(m) : (console.log(`  FAIL  ${m} — set=${[...s].join(',')}`), fail++));

// audit-pages 가 남기는 형태 (pages[].apiCalls)
const AUDIT = {
  ts: '2026-08-21T00:00:00Z',
  pages: [
    { path: '/ko/judge', apiCalls: ['GET /api/member', 'GET /api/judge-chat?action=list'] },
    { path: '/ko', apiCalls: ['GET /api/latest-updates?locale=ko', 'GET /api/fear-greed'] },
    { path: '/ko/report', apiCalls: [] },
  ],
};

// ① 쿼리스트링·메서드를 떼고 경로만 남긴다
{
  const s = endpointsFromPageAudit(AUDIT);
  has(s, '/api/member', 'member 커버 인식');
  has(s, '/api/judge-chat', 'judge-chat 커버 인식 (쿼리 제거)');
  has(s, '/api/latest-updates', 'latest-updates 커버 인식');
  has(s, '/api/fear-greed', 'fear-greed 커버 인식');
  s.size === 4 ? ok('중복 없이 4종') : bad(`개수 ${s.size}`);
}
// ② per-ticker 경로는 base 로 정규화 — /api/company-kr/005930 → /api/company-kr
{
  const s = endpointsFromPageAudit({ pages: [{ path: '/x', apiCalls: ['GET /api/company-kr/005930', 'GET /api/company-financials/AAPL'] }] });
  has(s, '/api/company-kr', 'per-ticker 를 base 로 정규화');
  has(s, '/api/company-financials', 'per-ticker 정규화 2');
}
// ③ 절대 URL 도 받는다 (playwright 는 전체 URL 을 준다)
{
  const s = endpointsFromPageAudit({ pages: [{ path: '/x', apiCalls: ['GET http://127.0.0.1:3000/api/signals?tab=1'] }] });
  has(s, '/api/signals', '절대 URL 처리');
}
// ④ 입력 방어 — 없으면 빈 집합이지 예외가 아니다
{
  for (const [inp, label] of [[null, 'null'], [{}, '빈 객체'], [{ pages: [] }, '빈 pages'], [{ pages: [{ path: '/x' }] }, 'apiCalls 없음']]) {
    const s = endpointsFromPageAudit(inp);
    s instanceof Set && s.size === 0 ? ok(`${label} → 빈 집합`) : bad(`${label} 처리 이상`);
  }
}
// ⑤ /api 가 아닌 요청은 무시
{
  const s = endpointsFromPageAudit({ pages: [{ path: '/x', apiCalls: ['GET /_next/static/x.js', 'GET /api/ok'] }] });
  s.size === 1 && s.has('/api/ok') ? ok('비-API 요청 무시') : bad(`비-API 포함: ${[...s].join(',')}`);
}

// ⑥ 두 소비자가 실제로 배선됐는지
{
  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const { stripCommentsPreservingLines } = await import('./context-keys.mjs');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const pages = stripCommentsPreservingLines(readFileSync(resolve(ROOT, 'scripts/visual/audit-pages.mjs'), 'utf8'));
  /apiCalls/.test(pages) ? ok('audit-pages 가 apiCalls 를 기록한다') : bad('audit-pages 미기록');
  const cov = stripCommentsPreservingLines(readFileSync(resolve(ROOT, 'scripts/audit-coverage.mjs'), 'utf8'));
  /endpointsFromPageAudit\(/.test(cov) ? ok('audit-coverage 가 파생 커버리지를 쓴다') : bad('audit-coverage 미배선');
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

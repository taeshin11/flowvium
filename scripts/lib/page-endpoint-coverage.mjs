/**
 * page-endpoint-coverage.mjs — 페이지 감사가 *실제로 관측한* API 호출을 커버리지 근거로 변환.
 *
 * 왜 파생인가(2026-08-21): audit-coverage [12] 가 매 사이클
 *   "코드 참조하나 어떤 검증도 미커버 (3): /api/judge-chat, /api/client-log, /api/member"
 * 라고 경고했다. 실측하면 /ko/judge 가 GET /api/member 와 GET /api/judge-chat?action=list 를
 * 호출하고 audit-pages.mjs 도 /api/member 를 POST 한다 — 이미 덮여 있는데 그걸 몰랐을 뿐이다.
 *
 * 도구의 제안("TRACKED_ENDPOINTS 에 추가")은 따르지 않는다. 그 목록의 목적은
 * "보고서 생성 시점 LLM 컨텍스트 재현"이라 세션 엔드포인트를 넣으면 재현 아카이브가 오염된다.
 *
 * COVERED_BY_* 손 목록을 하나 더 만드는 것도 답이 아니다. 이 세션에서 손 목록이 실제와
 * 갈리는 걸 네 번 봤다(ctxNullCheck 14/25 · screener sectorLabels 7종 · eslint callees 나열 ·
 * 티커 정규식 복제). 브라우저가 관측한 사실을 그대로 근거로 쓴다.
 */

/** 'GET http://host/api/company-kr/005930?x=1' → '/api/company-kr' */
function toBaseEndpoint(entry) {
  let s = String(entry ?? '').trim();
  if (!s) return null;
  const sp = s.indexOf(' ');
  if (sp > 0 && /^[A-Z]+$/.test(s.slice(0, sp))) s = s.slice(sp + 1);   // 메서드 제거
  s = s.replace(/^https?:\/\/[^/]+/, '');                                // 절대 URL → 경로
  s = s.split('?')[0].split('#')[0];
  if (!s.startsWith('/api/')) return null;
  // per-ticker 경로는 base 로 — /api/company-kr/005930 은 /api/company-kr 커버로 본다
  //   (audit-coverage 의 capCovers 도 같은 prefix 규칙을 쓴다)
  const seg = s.split('/').filter(Boolean);      // ['api','company-kr','005930']
  return seg.length >= 2 ? `/api/${seg[1]}` : null;
}

/**
 * @param {{pages?: Array<{apiCalls?: string[]}>}|null|undefined} audit  logs/page-audit.json
 * @returns {Set<string>} 관측된 base endpoint 집합
 */
export function endpointsFromPageAudit(audit) {
  const out = new Set();
  const pages = audit && typeof audit === 'object' ? audit.pages : null;
  if (!Array.isArray(pages)) return out;
  for (const p of pages) {
    const calls = Array.isArray(p?.apiCalls) ? p.apiCalls : [];
    for (const c of calls) {
      const e = toBaseEndpoint(c);
      if (e) out.add(e);
    }
  }
  return out;
}

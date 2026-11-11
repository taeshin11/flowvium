// blog-site-links.mjs — 블로그 글 끝 '사이트에서 더 보기' 링크. 근거는 blog-site-links.test.mjs 머리말. (2026-11-11)
// 그날(이전) 한국 증시 마감 기록 1개 + 글에 나온 한국 종목 중 페이지가 있는 것. 경로만 돌려주고 꼬리표(utm)는 부르는 쪽이 단다.

/**
 * @param {{ postDate: string, closeDates: string[], picks: { ticker?: string }[], nameOf: (t: string) => string | null }} a
 * @returns {{ label: string, path: string }[]}
 */
export function blogSiteLinks({ postDate, closeDates, picks, nameOf }) {
  const out = [];
  const close = [...closeDates].filter((d) => d <= postDate).sort().pop();
  if (close) {
    const [, m, d] = close.split('-').map(Number);
    out.push({ label: `${m}월 ${d}일 한국 증시 마감 정리`, path: `/ko/market-close/${close}` });
  }
  for (const p of picks) {
    const t = String(p?.ticker ?? '').toUpperCase();
    if (!/\.K[SQ]$/.test(t)) continue;
    const name = nameOf(t);
    if (name) out.push({ label: `${name} 종목 페이지`, path: `/ko/company/${t}` });
  }
  return out;
}

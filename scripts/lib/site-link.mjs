/** site-link.mjs — 출처 꼬리표(utm)를 단 flowvium.net 링크. 근거는 site-link.test.mjs 머리말. (2026-10-02) */
export function trackedUrl({ source, medium = null, campaign = null, path = '/ko/report', site = process.env.PUBLIC_SITE_URL || 'https://flowvium.net' }) {
  const u = new URL(path, site);
  u.searchParams.set('utm_source', source);
  if (medium) u.searchParams.set('utm_medium', medium);
  if (campaign) u.searchParams.set('utm_campaign', campaign);
  return u.href;
}

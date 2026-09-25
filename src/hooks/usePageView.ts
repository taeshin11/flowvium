'use client';
/**
 * usePageView — 페이지를 볼 때마다 /api/pv 로 한 번 알린다(자가호스팅 방문자 측정, 2026-09-25).
 * 쿠키·로컬저장 없음. 자동화 브라우저(navigator.webdriver — 우리 모니터·스크린샷)는 보내지 않는다.
 * 첫 조회만 document.referrer 를 쓴다. 사이트 안 이동(클라이언트 라우팅)은 document.referrer 가 첫 값 그대로라
 *   '(직접)' 으로 잘못 세었다(실측) — 두 번째부터는 우리 사이트에서 온 것으로 보낸다.
 * 화면에 보이는 글자가 없는 측정 코드라 컴포넌트 폴더가 아니라 여기 둔다(layout 은 PageViewBeacon 만 올린다).
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const ENDPOINT = '/api/pv';
let firstView = true;

export function usePageView(): void {
  const pathname = usePathname();
  useEffect(() => {
    try {
      if (!pathname || navigator.webdriver) return;
      const utm = new URLSearchParams(location.search).get('utm_source') ?? undefined;
      const r = firstView ? (document.referrer || '') : location.origin;
      firstView = false;
      const body = JSON.stringify({ p: pathname, r, u: utm });
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      else fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
    } catch { /* 측정 때문에 페이지가 깨지면 안 된다 */ }
  }, [pathname]);
}

/** layout 에 올리는 자리. 그리는 것은 없다. */
export function PageViewBeacon(): null {
  usePageView();
  return null;
}

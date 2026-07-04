'use client';
/**
 * ClientErrorReporter — 브라우저 에러를 /api/client-log 로 보고 (2026-07-04)
 * window error + unhandledrejection 캡처. 세션당 10건·동일 메시지 60s 디바운스(스팸/루프 방어).
 * sendBeacon(페이지 이탈 중에도 전송) 우선, 폴백 fetch keepalive.
 */
import { useEffect } from 'react';

const sent = new Map<string, number>();
let count = 0;

function report(type: string, message: string, stack?: string) {
  try {
    if (!message || count >= 10) return;
    const key = message.slice(0, 80);
    const now = Date.now();
    if ((sent.get(key) ?? 0) > now - 60000) return;
    sent.set(key, now);
    count++;
    const body = JSON.stringify({ type, message: message.slice(0, 300), stack: (stack ?? '').slice(0, 500), url: location.pathname + location.search });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/client-log', new Blob([body], { type: 'application/json' }));
    else fetch('/api/client-log', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch { /* 리포터 자신은 절대 throw 금지 */ }
}

export default function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => report('error', e.message || 'unknown error', e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report('unhandledrejection', (r?.message ?? String(r) ?? 'unhandled rejection').slice(0, 300), r?.stack);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  return null;
}

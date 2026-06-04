'use client';

import { useEffect } from 'react';

/**
 * Locale 페이지 트리 에러 바운더리.
 * 자가호스팅 재배포 시 청크 해시가 교체되면, 열려있던 클라이언트가 사라진 청크를
 * 로드하다 ChunkLoadError → "Application error: a client-side exception" 노출 (2026-06-04 사건).
 * → 청크 에러는 세션당 1회 자동 새로고침으로 복구(무한루프 방지 guard). 그 외 에러는 재시도 UI.
 */
const CHUNK_RE = /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|importScripts/i;

export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isChunk = error?.name === 'ChunkLoadError' || CHUNK_RE.test(error?.message ?? '');

  useEffect(() => {
    if (!isChunk) return;
    try {
      const last = Number(sessionStorage.getItem('chunkReloadAt') || '0');
      // 최근 12초 내 이미 새로고침했으면 루프 방지 — UI 표시로 폴백.
      if (Date.now() - last > 12000) {
        sessionStorage.setItem('chunkReloadAt', String(Date.now()));
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  }, [isChunk]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-cf-text-muted text-sm">
        {isChunk
          ? '새 버전이 배포되었습니다. 페이지를 새로고침하는 중…'
          : '일시적인 오류가 발생했습니다.'}
      </p>
      <button
        onClick={() => (isChunk ? window.location.reload() : reset())}
        className="px-4 py-2 rounded-lg bg-cf-accent/10 text-cf-accent text-sm font-medium hover:bg-cf-accent/20 transition-colors"
      >
        새로고침
      </button>
    </div>
  );
}

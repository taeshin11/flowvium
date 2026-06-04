'use client';

import { useEffect } from 'react';

/**
 * 루트 레이아웃 레벨 에러 바운더리 (자체 html/body 필수).
 * locale/error.tsx 가 못 잡는 root-layout 단계 크래시까지 커버.
 * 청크 로드 에러(재배포 후 해시 교체)는 세션당 1회 자동 새로고침으로 복구.
 */
const CHUNK_RE = /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const isChunk = error?.name === 'ChunkLoadError' || CHUNK_RE.test(error?.message ?? '');

  useEffect(() => {
    if (!isChunk) return;
    try {
      const last = Number(sessionStorage.getItem('chunkReloadAt') || '0');
      if (Date.now() - last > 12000) {
        sessionStorage.setItem('chunkReloadAt', String(Date.now()));
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  }, [isChunk]);

  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', textAlign: 'center', padding: '24px' }}>
        <p style={{ color: '#6b7280', fontSize: '14px' }}>
          {isChunk ? '새 버전이 배포되었습니다. 새로고침하는 중…' : '일시적인 오류가 발생했습니다.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#eef2ff', color: '#4f46e5', fontSize: '14px', cursor: 'pointer' }}
        >
          새로고침
        </button>
      </body>
    </html>
  );
}

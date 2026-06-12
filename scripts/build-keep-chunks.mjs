#!/usr/bin/env node
/**
 * scripts/build-keep-chunks.mjs — 셀프호스팅 무중단 배포용 빌드 래퍼 (2026-06-13).
 *
 * 사건: 잦은 재배포로 .next/static 청크 해시가 교체될 때마다 열려있던 클라이언트가
 *   ChunkLoadError → "새 버전이 배포되었습니다" 새로고침 루프 (사용자 /explore 실측 —
 *   캐시된 HTML 이 옛 청크를 참조하면 reload 해도 재발).
 * 해결: 빌드 전 .next/static 을 백업하고, 빌드 후 새 빌드에 없는 파일만 복사해 되살림.
 *   청크는 컨텐츠 해시 파일명이라 충돌 없음 — 직전 1세대 보존으로 열린 세션이 자연 만료될
 *   시간을 벌어줌.
 * 사용: node scripts/build-keep-chunks.mjs   (next build 대체)
 */
import { execSync } from 'child_process';
import { cpSync, existsSync, rmSync } from 'fs';

const PREV = '.next-static-prev';

if (existsSync('.next/static')) {
  rmSync(PREV, { recursive: true, force: true });
  cpSync('.next/static', PREV, { recursive: true });
  console.log('[keep-chunks] 직전 빌드 static 백업');
}

execSync('npx next build', { stdio: 'inherit' });

if (existsSync(PREV)) {
  cpSync(PREV, '.next/static', { recursive: true, force: false, errorOnExist: false });
  console.log('[keep-chunks] 이전 빌드 청크 병합 (열린 클라이언트 ChunkLoadError 방지)');
}

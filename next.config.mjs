import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // 2026-08-20: 무중단 빌드용 출력 경로 오버라이드.
  //   기본 동작은 `next build` 가 *가동 중인* .next 를 그 자리에서 덮는다. 이번 세션에서 실제로
  //   타입오류로 빌드가 중간에 죽어 .next 가 반쯤 덮인 채 남았고 사이트가 내려갔다 — 빌드 실패가
  //   곧 서비스 중단이 되는 구조였다. 스테이징 경로로 빌드해 *성공했을 때만* 교체하면
  //   중단 구간이 빌드 전체 시간에서 서버 재시작 몇 초로 줄고, 실패해도 가동본은 그대로 남는다.
  //   미지정 시 기존과 동일한 '.next' — 배포 경로의 기본 동작은 바뀌지 않는다.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default withNextIntl(nextConfig);

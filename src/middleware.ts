import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

// 2026-08-22: 종전 matcher 는 `.*\\..*` 로 *점이 든 모든 경로* 를 제외했다.
//   흔한 편법이지만 이 서비스에는 치명적이다 — 한국 티커가 005930.KS · 196170.KQ 처럼 점을 갖는다.
//   그래서 /ko/company/005930.KS 요청이 로케일 미들웨어를 아예 안 타고, [locale]/layout.tsx 의
//   getMessages()(locale 인자 없음)가 기본 로케일로 폴백해 **모든 한국 종목 페이지가 16개 로케일
//   전부에서 영문** 으로 렌더됐다(SSR 실측: /ko/company/AAPL 한글 ✓ vs /ko/company/005930.KS 영문 ✗).
//   next-intl 문서도 "matcher 는 점 같은 예기치 않은 문자를 포함한 동적 세그먼트까지 맞춰야 한다"
//   고 경고한다. 정적 자산은 '점 유무' 가 아니라 *알려진 확장자로 끝나는가* 로 가른다.
//   scripts/lib/locale-middleware.test.mjs 가 경로 8종으로 이 판정을 고정한다.
export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|mjs|map|txt|xml|json|webmanifest|woff|woff2|ttf|otf|eot|mp4|webm|pdf)$).*)'],
};

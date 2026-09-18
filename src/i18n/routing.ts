import {defineRouting} from 'next-intl/routing';
import {createNavigation} from 'next-intl/navigation';

export const routing = defineRouting({
  // 2026-09-18 사용자 "16개 언어 다 빼고 한국어 영어만" → 일본 쇼츠 채널이 있어 ja 를 남겼다.
  //   실측 근거: reports 테이블에 ko 306건(오늘까지)인데 en/ja/zh 는 각 3건(2026-05-05 이후 없음),
  //   나머지 12개 언어는 **한 건도 없다**. 16개를 유지할 이유가 없었다.
  //   ⚠ 이 배열이 **유일한 출처**다. 종전엔 sitemap·layout·glossary·fear-greed 에 같은 목록이
  //     따로 박혀 있어 늘 어긋났다. 새 목록을 어디에도 적지 말고 여기서 가져다 쓸 것.
  locales: ['en', 'ko', 'ja'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  // Auto-detect browser language from Accept-Language header on first visit
  localeDetection: true,
});

export const {Link, redirect, usePathname, useRouter} = createNavigation(routing);

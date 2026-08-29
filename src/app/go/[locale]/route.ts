// /go/[locale] — 로케일을 **강제**하고 홈으로 보낸다.
//
// 왜 필요한가(2026-08-29): routing 이 localePrefix:'as-needed' 라 기본 로케일(en)에는
//   주소 접두사가 없다. 그래서 `/en` 은 `/` 로 되돌려지고, 거기서 다시 Accept-Language 를
//   보고 `/ko` 로 간다 — **영어를 강제할 수 있는 주소가 아예 없었다.**
//   영어 유튜브 채널에서 온 한국 시청자가 전부 한국어 사이트로 떨어졌다.
//
// 왜 localePrefix 를 'always' 로 바꾸지 않았나: 그러면 사이트 전체 URL 이 바뀐다
//   (/company/AAPL → /en/company/AAPL). 필요한 건 "영어 채널 시청자를 영어로" 하나인데
//   그것 때문에 기존 링크·SEO·사이트맵을 전부 흔들 이유가 없다.
//
// next-intl 은 NEXT_LOCALE 쿠키를 Accept-Language 보다 우선한다 — 그 쿠키를 심어준다.
import { NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const url = new URL(req.url);

  // 모르는 로케일이면 조용히 홈으로. 임의 값으로 쿠키를 심게 두지 않는다.
  if (!(routing.locales as readonly string[]).includes(locale)) {
    return NextResponse.redirect(new URL('/', url.origin), 307);
  }

  // 기본 로케일은 접두사가 없고, 나머지는 /{locale} 로 간다.
  const dest = locale === routing.defaultLocale ? '/' : `/${locale}`;
  // 원래 가려던 경로를 이어붙일 수 있게 ?to= 를 지원한다(외부 입력이므로 내부 경로만 허용).
  const to = url.searchParams.get('to');
  const suffix = to && /^\/[A-Za-z0-9/_-]*$/.test(to) ? to : '';

  const res = NextResponse.redirect(new URL(`${dest}${suffix}`.replace(/\/{2,}/g, '/'), url.origin), 307);
  res.cookies.set('NEXT_LOCALE', locale, {
    path: '/', maxAge: ONE_YEAR, sameSite: 'lax',
  });
  return res;
}

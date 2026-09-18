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
//
// 2026-09-03: Location 을 **상대 경로**로 낸다. 종전엔 `new URL(dest, url.origin)` 으로
//   절대 주소를 만들었는데, 이 사이트는 Cloudflare 터널 뒤라 req.url 이 내부 주소다.
//   그래서 실제 응답이 이랬다:
//     curl -I https://flowvium.net/go/ko → 307 Location: https://localhost:3000/ko
//   **유튜브 설명란 링크를 누른 사람이 전부 로컬호스트로 떨어졌다** — 유입이 통째로 사라진다.
//   프록시 뒤에서 req.url 로 공개 주소를 알 방법은 없다. x-forwarded-host 를 믿는 방법도
//   있지만, 상대 경로는 믿을 것이 없다 — 브라우저가 현재 origin 기준으로 푼다(RFC 7231 §7.1.2).
//
// 2026-09-18: **클릭을 센다.** 이 주소는 유튜브 설명란의 유일한 유입 경로인데 그동안
//   아무도 세지 않았다. 그래서 "어떤 소재가 사이트 방문을 만드는가" 를 물어도 답할 수가 없었고,
//   편성을 조회수라는 대리 지표로만 정하고 있었다.
//   날짜별·로케일별 카운터 하나면 충분하다 — 개인을 식별하지 않는다.
import { NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';
import { createRedis } from '@/lib/redis';

/** 유입 1건 기록. 실패해도 이동은 막지 않는다 — 통계 때문에 사람을 붙잡아 두지 않는다. */
async function countHit(locale: string, ref: string | null) {
  try {
    const redis = createRedis();
    if (!redis) return;
    const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);   // KST 기준
    const src = ref && /youtu/.test(ref) ? 'youtube' : ref ? 'other' : 'direct';
    await redis.incr(`flowvium:go:${day}:${locale}:${src}`);
    await redis.expire(`flowvium:go:${day}:${locale}:${src}`, 60 * 60 * 24 * 400);
  } catch { /* 통계는 비치명 */ }
}

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const url = new URL(req.url);
  // await 하지 않는다 — 리다이렉트가 통계를 기다릴 이유가 없다.
  void countHit(locale, req.headers.get('referer'));

  // 모르는 로케일이면 조용히 홈으로. 임의 값으로 쿠키를 심게 두지 않는다.
  if (!(routing.locales as readonly string[]).includes(locale)) {
    return new NextResponse(null, { status: 307, headers: { Location: '/' } });
  }

  // 기본 로케일은 접두사가 없고, 나머지는 /{locale} 로 간다.
  const dest = locale === routing.defaultLocale ? '/' : `/${locale}`;
  // 원래 가려던 경로를 이어붙일 수 있게 ?to= 를 지원한다(외부 입력이므로 내부 경로만 허용).
  const to = url.searchParams.get('to');
  const suffix = to && /^\/[A-Za-z0-9/_-]*$/.test(to) ? to : '';

  const location = `${dest}${suffix}`.replace(/\/{2,}/g, '/');
  const res = new NextResponse(null, { status: 307, headers: { Location: location } });
  res.cookies.set('NEXT_LOCALE', locale, {
    path: '/', maxAge: ONE_YEAR, sameSite: 'lax',
  });
  return res;
}

#!/usr/bin/env node
/**
 * go-redirect.test.mjs — /go/{locale} 이 **공개 주소로** 되돌려 보내는가.
 *
 * 배경(2026-09-03 실측): 유튜브 설명란 링크를 눌러 보니 이렇게 나왔다.
 *     curl -I https://flowvium.net/go/en  → 307 Location: https://localhost:3000/
 *     curl -I https://flowvium.net/go/ko  → 307 Location: https://localhost:3000/ko
 *   즉 **영상을 보고 사이트로 오려던 사람이 전부 로컬호스트로 떨어졌다.**
 *   그 주소는 시청자 기계에서 열리지 않는다 — 유입이 통째로 사라진다.
 *
 * 원인: route.ts 가 `new URL(req.url).origin` 으로 절대 주소를 만든다.
 *   이 사이트는 Cloudflare 터널 뒤에 있어서 req.url 이 **내부 주소**(localhost:3000)다.
 *   프록시 뒤에서 req.url 로 공개 주소를 알아낼 수는 없다.
 *
 * 고친 방식: Location 을 **상대 경로**로 낸다. HTTP 는 상대 Location 을 허용하고
 *   (RFC 7231 §7.1.2) 브라우저가 현재 origin 기준으로 푼다 — 프록시가 몇 겹이든 맞는다.
 *   x-forwarded-host 를 읽는 방법도 있지만, 그건 헤더를 믿는 것이고 상대 경로는 믿을 게 없다.
 *
 * 이 검사는 **소스를 본다.** 라우트를 띄우려면 Next 런타임이 필요한데, 그것 때문에
 * 이 결함을 안 잡는 것보다 "절대 origin 을 쓰지 않는다" 를 구조로 확인하는 편이 낫다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };

const raw = readFileSync(resolve(ROOT, 'src/app/go/[locale]/route.ts'), 'utf8');
// 주석은 걷어낸다 — 사고 경위에 옛 코드를 인용해 두므로, 안 걷으면 그 예시에 검사가 걸린다
// (실제로 처음 실행에서 내가 쓴 주석의 `new URL(dest, url.origin)` 이 잡혔다).
const src = raw.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── req.url 의 origin 으로 절대 주소를 만들면 프록시 뒤에서 localhost 가 샌다 ──────
!/new URL\([^)]*,\s*url\.origin\s*\)/.test(src)
  ? ok('req.url 의 origin 으로 절대 주소를 만들지 않는다')
  : bad('url.origin 으로 리다이렉트한다 — 프록시 뒤에서 localhost:3000 이 새어 나간다');

// ── 상대 Location 이어야 한다 ────────────────────────────────────────────────────
/Location/.test(src)
  ? ok('Location 을 직접 설정한다(상대 경로)')
  : bad('Location 을 직접 안 쓴다 — NextResponse.redirect 는 절대 주소를 요구한다');

// ── 로케일 강제의 본래 목적(쿠키)은 유지돼야 한다 ────────────────────────────────
/NEXT_LOCALE/.test(src)
  ? ok('NEXT_LOCALE 쿠키를 계속 심는다(로케일 강제의 핵심)')
  : bad('쿠키를 잃었다 — Accept-Language 가 다시 이긴다');

// ── 모르는 로케일은 여전히 거부해야 한다(임의 값으로 쿠키를 심지 않는다) ──────────
/routing\.locales/.test(src)
  ? ok('허용된 로케일만 받는다')
  : bad('로케일 검증을 잃었다');

// ── ?to= 의 내부 경로 제한이 남아 있어야 한다(오픈 리다이렉트 방지) ──────────────
/\^\\\/\[A-Za-z0-9/.test(src) || /startsWith\('\/'\)/.test(src)
  ? ok('?to= 는 내부 경로만 허용(오픈 리다이렉트 차단)')
  : bad('외부 주소로 보낼 수 있다 — 오픈 리다이렉트');

console.log(fail === 0 ? '\n✅ go-redirect 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

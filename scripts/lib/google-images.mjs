/**
 * google-images.mjs — 구글 프로그래밍 검색(cse.js 위젯)으로 이미지를 찾는다.
 *
 * 왜 위젯인가 (2026-09-04): JSON API 는 계속 403 이다
 *   ("This project does not have the access to Custom Search JSON API").
 *   API 사용 설정됨 · 결제 연결됨 · 키를 Custom Search API 로 제한 — 전부 정상인데도 막힌다.
 *   조직 정책으로 보이고 클릭으로 풀 수 없었다.
 *   반면 cse.js 위젯은 구글이 공식으로 제공하는 임베드이고 **그대로 동작한다**(실측).
 *
 * 왜 필요한가: 낱말을 영어로 옮겨 아카이브를 뒤지는 방식이 계속 틀린 그림을 물어왔다 —
 *   총리→2003년 고건 · 부산→해수욕장 · 전복→조개 · 외국인→관광객 · GAP→프랑스 도시.
 *   한국어 그대로 검색하면 이런 충돌이 없다.
 *
 * ⚠ 저작권: 여기서 나오는 사진은 대부분 언론사·통신사 것이다. 출처를 적어도 이용 허락이 되지는 않는다.
 *   사용자가 "출처만 적어", "내가 다 허락받을게" 로 두 번 지시했고 위험(Content ID → 채널 삭제)을
 *   그때마다 알렸다. 그 판단 위에서 만든다.
 *   대신 **통신사 도메인은 따로 표시**해 어떤 것이 위험한지 눈에 보이게 한다.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

/** 저작권 위험이 특히 높은 곳 — 통신사·주요 언론. 결과에 riskyDomain 으로 표시한다. */
const RISKY = /(^|\.)(yna\.co\.kr|yonhapnews\.co\.kr|newsis\.com|news1\.kr|ap\.org|apnews\.com|reuters\.com|afp\.com|gettyimages)/i;

let _srv = null;
let _port = 0;
/** 봇 확인 화면을 만나면 이 시각까지 호출하지 않는다. 계속 두드리면 차단이 길어진다. */
let _blockedUntil = 0;
/** 마지막 호출 시각 — 연속 호출을 벌린다. 내가 테스트로 6번 연달아 불러 차단을 자초했다. */
let _lastCall = 0;
const BLOCK_COOLDOWN_MS = Number(process.env.CSE_COOLDOWN_MS || 30 * 60_000);
const MIN_GAP_MS = Number(process.env.CSE_MIN_GAP_MS || 6_000);
/** 위젯을 담을 최소 페이지. http 출처라야 cse.js 가 뜬다(file:// 에서는 안 뜬다 — 실측). */
async function ensureServer(cx) {
  if (_srv) return _port;
  const html = `<!doctype html><meta charset="utf-8">
<script async src="https://cse.google.com/cse.js?cx=${cx}"></script>
<div class="gcse-searchresults-only" data-queryParameterName="q"></div>`;
  _srv = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => _srv.listen(0, r));
  _port = _srv.address().port;
  return _port;
}
/**
 * 브라우저를 한 번만 띄우고 재사용한다.
 *
 * 왜 (2026-09-05): 질의마다 `chromium.launch()` 로 새로 띄웠다. 느린 것도 문제지만
 *   헤드리스가 "로봇이 아님을 확인해 주세요" 로 막혔다 — 실제 크롬 + 영속 프로필이라야
 *   통과한다(실측). 창을 매번 띄우면 화면이 어지러우므로 하나를 열어 두고 돌려 쓴다.
 *   프로필은 콘솔 작업용(gcp-profile)과 **분리**한다 — 동시에 열면 프로필이 잠긴다.
 */
let _ctx = null;
async function ensureBrowser() {
  if (_ctx) return _ctx;
  _ctx = await chromium.launchPersistentContext(resolve(ROOT, 'secrets/cse-profile'), {
    channel: 'chrome', headless: false, viewport: { width: 1100, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  return _ctx;
}
export function closeGoogleImages() {
  try { _srv?.close(); } catch { /* noop */ }
  _srv = null;
  try { _ctx?.close(); } catch { /* noop */ }
  _ctx = null;
}

/**
 * @param {string[]} terms 한국어 그대로 넣는다 — 영어로 옮기지 않는다.
 * @returns {Promise<Array<{url,title,source,pageUrl,riskyDomain}>>}
 */
export async function searchGoogleImages(terms, { limit = 6, cx = process.env.GOOGLE_CSE_CX, timeoutMs = 20000 } = {}) {
  const q = (terms ?? []).join(' ').trim();
  if (!q || !cx) return [];
  if (Date.now() < _blockedUntil) {
    console.error(`[구글] 봇 확인 쿨다운 중 — ${Math.ceil((_blockedUntil - Date.now()) / 60000)}분 남음, 건너뛴다`);
    return [];
  }
  const gap = MIN_GAP_MS - (Date.now() - _lastCall);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  _lastCall = Date.now();
  const port = await ensureServer(cx);
  const ctx = await ensureBrowser();
  const p = await ctx.newPage();
  try {
    const u = `http://localhost:${port}/?q=${encodeURIComponent(q)}#gsc.tab=1&gsc.q=${encodeURIComponent(q)}`;
    await p.goto(u, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // 위젯이 스스로 그린다 — 결과가 붙을 때까지 기다린다.
    await p.waitForSelector('.gs-image-box, .gs-result', { timeout: timeoutMs }).catch(() => {});
    await p.waitForTimeout(2500);
    // 2026-09-05: 짧은 시간에 여러 번 부르면 구글이 "로봇이 아님을 확인해 주세요" 를 띄운다.
    //   그때도 결과가 0건이라 **소재가 없는 것과 구별이 안 됐다** — 나는 이걸 보고
    //   "등록된 도메인이 부족하다" 고 잘못 짚었다. 실제로는 도메인이 아니라 차단이었다.
    //   빈 배열을 돌려주되 이유를 남긴다. 삼키지 않는다.
    const blocked = await p.evaluate(() =>
      /로봇이 아님|not a robot|unusual traffic/i.test(document.body.innerText || '')).catch(() => false);
    if (blocked) {
      _blockedUntil = Date.now() + BLOCK_COOLDOWN_MS;
      console.error(`[구글] 봇 확인 화면 — ${Math.round(BLOCK_COOLDOWN_MS / 60000)}분간 이 소스를 쉰다 (질의: ${q})`);
      return [];
    }
    const rows = await p.evaluate(() => {
      const out = [];
      const seen = new Set();
      for (const box of document.querySelectorAll('.gs-image-box, .gs-result')) {
        const a = box.querySelector('a[href]');
        const img = box.querySelector('img');
        if (!a || !img) continue;
        const href = a.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);
        out.push({ href, thumb: img.src, alt: img.alt || '' });
      }
      return out;
    }).catch(() => []);
    // 2026-09-04: 구글 캐시 썸네일(encrypted-tbn0.gstatic.com)은 195~335px 라 1080 폭에 못 쓴다.
    //   실측: 그걸 받아 쓰다 장면 렌더가 실패했다. **원본 파일 링크를 앞세운다.**
    //   원본이 하나도 없으면 그 질의는 포기한다 — 흐린 그림을 넣느니 다음 소스로 넘긴다.
    //   2026-09-04 정정: 썸네일을 **전부 버렸더니 카드가 100%** 가 됐다(실측).
    //   korea.kr 의 download.do 는 보도자료 **문서(PDF)** 라 원본이 아예 없다.
    //   흐린 사진이 회색 카드보다는 낫다 — 원본을 앞세우되 썸네일도 후보로 남긴다.
    //   문서 전용 경로는 아예 뺀다(받아봐야 PDF 다).
    const isDoc = (u) => /korea\.kr\/common\/download\.do/i.test(u) || /\.(pdf|hwp|docx?)(\?|$)/i.test(u);
    const isOriginal = (r) => !isDoc(r.href) && (/\.(jpe?g|png|webp)(\?|$)/i.test(r.href) || /attach|image|photo/i.test(r.href));
    //   2026-09-04 재정정: 썸네일을 허용했더니 **PDF 문서 스캔과 '정책브리핑' 로고 배너**가 깔렸다(눈으로 확인).
    //   korea.kr 이미지 검색 결과는 사진이 아니라 문서 미리보기가 대부분이다.
    //   회색 카드가 문서 스캔보다 낫다 — 원본 사진만 쓴다. 없으면 이 소스는 포기한다.
    let ordered = rows.filter(isOriginal);
    // 2026-09-05: 위젯이 주는 href 는 대부분 **기사 페이지 주소**다(mk·연합·KBS·한겨레).
    //   이미지 원본 URL 이 아니라서 위 필터가 전부 버렸고 "0건" 으로 보였다 —
    //   나는 이걸 보고 "등록 도메인이 부족하다" 고 잘못 짚기까지 했다.
    //   기사 페이지의 대표 이미지(og:image)가 그 기사의 사진이다. 그걸 가져온다.
    //   구글 캐시 썸네일(encrypted-tbn0, 200~300px)은 1080 폭에 못 쓰므로 쓰지 않는다.
    if (!ordered.length) {
      const pages = [...new Set(rows.map((r) => r.href).filter((u) => !isDoc(u)))].slice(0, limit * 2);
      const got = await Promise.all(pages.map(async (u) => {
        try {
          const res = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' },
            signal: AbortSignal.timeout(9000),
          });
          if (!res.ok) return null;
          const html = (await res.text()).slice(0, 300_000);
          const m = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
          if (!m) return null;
          const img = new URL(m[1], u).href;
          if (!/^https?:/i.test(img) || isDoc(img)) return null;
          const t = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
            ?? html.match(/<title[^>]*>([^<]{3,120})</i);
          // og:title 은 HTML 이라 엔티티가 그대로 들어 있다 — 로그와 크레딧에 &quot; 가 찍혔다.
          const dec = (x) => String(x ?? '')
            .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
          return { href: img, alt: dec(t?.[1]), pageUrl: u };
        } catch { return null; }
      }));
      ordered = got.filter(Boolean);
    }
    return ordered.slice(0, limit).map((r) => {
      // 출처는 이미지가 올려진 CDN 이 아니라 **기사 도메인**이어야 한다.
      //   화면에 "img.newsis.net" 이 아니라 "newsis.com" 이 찍혀야 사람이 알아본다.
      let host = '';
      try { host = new URL(r.pageUrl ?? r.href).hostname; } catch { /* noop */ }
      return {
        kind: 'image',
        url: r.href,
        title: r.alt || host,
        source: host.replace(/^www\./, '') || 'Google',
        pageUrl: r.pageUrl ?? r.href,
        riskyDomain: RISKY.test(host),
      };
    });
  } finally { await p.close().catch(() => {}); }
}

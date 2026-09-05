/**
 * article-image.mjs — **우리가 이미 가진 기사**에서 대표 사진을 가져온다.
 *
 * 왜 (2026-09-05): 오늘 하루 종일 구글 위젯으로 "그 기사"를 찾아 헤맸다. 봇 차단에 두 번 걸렸고
 *   회차 셋을 잃었다. 그런데 이슈를 묶는 뉴스 DB(news_archive)에 **기사 링크가 전부 있다**
 *   (최근 24시간 38,821건 중 38,821건). 우리가 다루기로 고른 바로 그 기사들이다.
 *
 *   이미 손에 든 주소를 두고 검색엔진에 그 기사를 물어보고 있었다.
 *   여기서 가져오면:
 *     · 봇 차단이 없다(언론사 서버에 기사 하나씩 요청할 뿐이다)
 *     · **관련성을 추측할 필요가 없다** — 그 기사의 사진이다
 *     · 날짜도 확실하다 — 그 기사의 날짜다
 *
 *   구글은 이 경로가 사진을 못 준 장면에만 쓴다.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const dec = (x) => String(x ?? '')
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

const isDoc = (u) => /\.(pdf|hwp|docx?)(\?|$)/i.test(u);

/**
 * 기사 한 건의 대표 사진.
 * @param {string} url 기사 주소
 * @returns {Promise<{url:string,title:string,source:string,pageUrl:string,publishedAt:string|null}|null>}
 */
export async function articleImage(url, { timeoutMs = 9000 } = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 300_000);
    const m = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
    if (!m) return null;
    const img = new URL(m[1], url).href;
    if (!/^https?:/i.test(img) || isDoc(img)) return null;
    const t = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<title[^>]*>([^<]{3,120})</i);
    const dm = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+(?:name|itemprop)=["'](?:date|pubdate|datePublished)["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    const um = url.match(/\/(20\d{2})[/-]?(\d{2})[/-]?(\d{2})(?:[/_-]|$)/);
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* noop */ }
    return {
      kind: 'image',
      url: img,
      title: dec(t?.[1]) || host,
      source: host || '기사',
      pageUrl: url,
      publishedAt: dm?.[1] ?? (um ? `${um[1]}-${um[2]}-${um[3]}` : null),
    };
  } catch { return null; }
}

/**
 * 이슈에 딸린 기사들에서 사진을 모은다. 서로 다른 기사에서 하나씩 —
 * 같은 기사를 여러 장면에 쓰면 같은 사진이 반복된다.
 *
 * @param {Array<{link?:string}>} items 이슈의 기사들
 * @param {{max?:number, concurrency?:number}} [opts]
 */
export async function issueImages(items, { max = 8, concurrency = 4 } = {}) {
  const links = [...new Set((items ?? []).map((x) => x?.link).filter(Boolean))].slice(0, max * 2);
  const out = [];
  for (let i = 0; i < links.length && out.length < max; i += concurrency) {
    const batch = await Promise.all(links.slice(i, i + concurrency).map((u) => articleImage(u)));
    for (const r of batch) if (r) out.push(r);
  }
  // 같은 사진(주소가 같은 것)은 한 번만
  const seen = new Set();
  return out.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

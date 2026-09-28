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

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

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
 * 이 주소가 **매체 기본 배너·로고**인가.
 *
 * 2026-09-06: 17:00 재제작의 한 장면이 "성공을 부르는 습관 / 한국경제" 배너로 채워져 나갔다.
 *   주소가 `static.hankyung.com/img/logo/logo-news-sns.png` 였다 — 로고라고 주소에 적혀 있었다.
 *   로고 걸러내기는 구글 검색 경로(footage.mjs)에만 있었고 여기엔 없었다.
 *   "같은 주소가 셋 이상이면 배너" 라는 규칙만으로는 한 번만 나온 배너를 못 잡는다.
 *
 * 판단은 **경로**로 한다. 기사 사진은 날짜·일련번호가 붙은 경로에 있고(`/photo/2026/09/…`),
 *   배너는 `logo`·`default`·`share`·`noimage` 같은 말이 경로에 그대로 들어간다.
 *   파일 이름만이 아니라 디렉터리까지 본다 — `/img/logo/` 처럼 폴더에만 있는 경우가 있다.
 */
const BRAND_PATH = /(^|[/_-])(logo|logos|wordmark|lettermark|brandmark|watermark|default|defaults|placeholder|noimage|no-image|blank|dummy|share|sns|og-?image|og-?default|common)([/_.-]|$)/i;

export function isBrandImage(url) {
  let path = String(url ?? '');
  try { path = new URL(path).pathname; } catch { /* 상대 주소면 그대로 본다 */ }
  return BRAND_PATH.test(path);
}

// ── 매체 템플릿 이미지 기억 (2026-09-29, article-template.test 머리말) ──────────────────────────
const TEMPLATE_STORE = resolve(ROOT, 'logs/og-image-seen.json');
const KEEP_MS = 30 * 864e5;
const MAX_URLS = 5000;

const titleWords = (t) => new Set(String(t ?? '')
  .replace(/\[[^\]]{1,8}\]/g, ' ')            // [속보] [단독] 같은 머리표
  .replace(/\s[|｜-]\s[^|｜]{1,20}$/, ' ')      // " | 연합뉴스" 같은 매체 꼬리
  .toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2));

/** 두 제목이 같은 사건인가 — 단어 겹침(작은 쪽 기준)이 0.3 이상이면 같은 사건의 다른 판으로 본다. */
function sameStory(a, b) {
  const A = titleWords(a), B = titleWords(b);
  if (!A.size || !B.size) return false;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.3;
}

/** 이 제목들 중 **서로 다른 사건** 둘이 있는가. */
export function sharedAcrossStories(titles) {
  const t = titles ?? [];
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (!sameStory(t[i], t[j])) return true;
  return false;
}

/**
 * 이번에 받은 이미지들을 기억에 적고, 템플릿으로 드러난 것을 뺀 목록을 돌려준다. store 는 제자리에서 바뀐다.
 * @param {Array<{url:string,title?:string}>} items
 */
export function noteImages(items, { store, now = Date.now() }) {
  for (const [u, e] of Object.entries(store)) if (now - (e?.at ?? 0) > KEEP_MS) delete store[u];
  const out = [];
  for (const it of items ?? []) {
    const e = store[it.url] ?? { titles: [], at: now };
    const title = String(it.title ?? '').trim();
    if (title && !e.titles.includes(title)) e.titles = [...e.titles, title].slice(-8);
    e.at = now;
    store[it.url] = e;
    if (!sharedAcrossStories(e.titles)) out.push(it);
  }
  const keys = Object.keys(store);
  if (keys.length > MAX_URLS) keys.sort((a, b) => store[a].at - store[b].at).slice(0, keys.length - MAX_URLS).forEach((k) => delete store[k]);
  return out;
}

function loadTemplateStore() { try { return JSON.parse(readFileSync(TEMPLATE_STORE, 'utf8')); } catch { return {}; } }
function saveTemplateStore(store) { try { writeFileSync(TEMPLATE_STORE, JSON.stringify(store)); } catch { /* 기억 실패는 비치명 — 이번 판정은 이미 했다 */ } }

/**
 * 이슈에 딸린 기사들에서 사진을 모은다. 서로 다른 기사에서 하나씩 —
 * 같은 기사를 여러 장면에 쓰면 같은 사진이 반복된다.
 *
 * @param {Array<{link?:string}>} items 이슈의 기사들
 * @param {{max?:number, concurrency?:number}} [opts]
 */
export async function issueImages(items, opts = {}) {
  const { max = 8, concurrency = 4 } = opts;
  const links = [...new Set((items ?? []).map((x) => x?.link).filter(Boolean))].slice(0, max * 2);
  const out = [];
  for (let i = 0; i < links.length && out.length < max; i += concurrency) {
    const batch = await Promise.all(links.slice(i, i + concurrency).map((u) => articleImage(u)));
    for (const r of batch) if (r) out.push(r);
  }
  // 여러 기사가 **같은 사진**을 가리키면 그건 그 기사의 사진이 아니라 매체 기본 배너일 수 있다.
  //   실측(2026-09-05): 연합 23건 중 20종, 한경 11건 중 9종으로 대개는 기사마다 다르다.
  //   그래도 셋 이상이 같은 주소면 기사 사진으로 보지 않는다 — 로고가 화면을 채우면 안 된다.
  const count = new Map();
  for (const r of out) count.set(r.url, (count.get(r.url) ?? 0) + 1);
  // 실행을 넘어: 다른 사건의 기사에서 이미 본 이미지면 매체 템플릿이다(한경 「속보」 카드 — 9/29).
  const store = opts.store ?? loadTemplateStore();
  const notTemplate = new Set(noteImages(out, { store }).map((r) => r.url));
  if (!opts.store) saveTemplateStore(store);
  const seen = new Set();
  return out.filter((r) => {
    // 한 번만 나와도 주소가 로고라고 말하면 거른다 — 셋 이상 세는 규칙만으로는 늦다.
    if (isBrandImage(r.url)) return false;
    if (count.get(r.url) >= 3) return false;
    if (!notTemplate.has(r.url)) return false;
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

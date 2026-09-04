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

/** 저작권 위험이 특히 높은 곳 — 통신사·주요 언론. 결과에 riskyDomain 으로 표시한다. */
const RISKY = /(^|\.)(yna\.co\.kr|yonhapnews\.co\.kr|newsis\.com|news1\.kr|ap\.org|apnews\.com|reuters\.com|afp\.com|gettyimages)/i;

let _srv = null;
let _port = 0;
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
export function closeGoogleImages() { try { _srv?.close(); } catch { /* noop */ } _srv = null; }

/**
 * @param {string[]} terms 한국어 그대로 넣는다 — 영어로 옮기지 않는다.
 * @returns {Promise<Array<{url,title,source,pageUrl,riskyDomain}>>}
 */
export async function searchGoogleImages(terms, { limit = 6, cx = process.env.GOOGLE_CSE_CX, timeoutMs = 20000 } = {}) {
  const q = (terms ?? []).join(' ').trim();
  if (!q || !cx) return [];
  const port = await ensureServer(cx);
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    const u = `http://localhost:${port}/?q=${encodeURIComponent(q)}#gsc.tab=1&gsc.q=${encodeURIComponent(q)}`;
    await p.goto(u, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // 위젯이 스스로 그린다 — 결과가 붙을 때까지 기다린다.
    await p.waitForSelector('.gs-image-box, .gs-result', { timeout: timeoutMs }).catch(() => {});
    await p.waitForTimeout(2500);
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
    const ordered = rows.filter(isOriginal);
    return ordered.slice(0, limit).map((r) => {
      let host = '';
      try { host = new URL(r.href).hostname; } catch { /* noop */ }
      return {
        kind: 'image',
        url: r.href,
        title: r.alt || host,
        source: host || 'Google',
        pageUrl: r.href,
        riskyDomain: RISKY.test(host),
      };
    });
  } finally { await b.close(); }
}

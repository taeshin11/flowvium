#!/usr/bin/env node
/**
 * scripts/check-data-quality.mjs ??production ?곗씠???덉쭏 紐⑤땲??
 *
 * ?ъ슜??吏??2026-06-02): "蹂닿퀬??寃?좏븷 ???붾뱶?ъ씤??寃????媛숈씠 ?섍퀬 ?덈굹? contango/
 * ?댁뒪 踰덉뿭 媛숈? 寃??쒕?濡?寃?????섎뒗 寃?媛숇떎." ??verify-report(?섍컖)쨌check-stall(?좎꽑??媛
 * 紐?蹂대뒗 *?곗씠???덉쭏* ?ш컖吏?瑜?production ?ㅽ샇異쒕줈 ?먭?.
 *
 * ?먭? ??ぉ:
 *   [A] ?붾뱶?ъ씤???ъ뒪 ???듭떖 endpoint ?ㅽ샇異? non-200 ?먮뒗 body {error} 媛먯?.
 *   [B] ?댁뒪 踰덉뿭 ??news-cascade?locale=ko ?쒕ぉ???ㅼ젣 ?쒓??몄? (?곸뼱硫?踰덉뿭 誘몄셿).
 *   [C] contango ??commodity-curve 媛 synthetic(carry-model) ?몃뜲 洹??ъ떎???몄텧?섎뒗吏.
 *
 * ?ъ슜: node scripts/check-data-quality.mjs   (exit 1 = 寃고븿)
 */
const BASE = 'https://flowvium.net';
const issues = [];
const info = [];

async function getJson(path, ms = 12000, retryOnConnFail = true) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal, headers: { 'User-Agent': 'flowvium-dq' } });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, body, text };
  } catch (e) {
    // 2026-06-05: HTTP 0 = ?곌껐?덈꺼 ?ㅽ뙣(??꾩븘??由ъ뀑) ???쒓컙 遺????endpoint 留덈떎 false ?슚 churn
    //   ?좊컻(yield-curve/economic-calendar 踰덇컝??. 吏꾩쭨 二쎌? ?쇱슦?몃뒗 4xx/5xx 諛섑솚?섏? retry ???ㅽ뙣.
    //   ???곌껐?ㅽ뙣 1???쒖젙 ?ъ떆??湲???꾩븘??. ?ㅼ젣 ?μ븷???ъ쟾???≪쓬.
    if (retryOnConnFail) {
      clearTimeout(t);
      await new Promise(r => setTimeout(r, 1500));
      return getJson(path, Math.max(ms, 20000), false);
    }
    return { status: 0, body: null, text: String(e?.message || e) };
  }
  finally { clearTimeout(t); }
}

// [A] ?붾뱶?ъ씤???ъ뒪 ???듭떖 endpoint ?쒕낯
const ENDPOINTS = [
  '/api/stock-price/AAPL', '/api/stock-price/005930.KS', '/api/price-history?ticker=005930.KS&days=30',
  '/api/company-financials/AAPL', '/api/company-financials/TSM', '/api/company-kr/005930',
  '/api/fear-greed', '/api/sector-pe', '/api/commodity-curve', '/api/news-cascade?locale=ko',
  '/api/yield-curve', '/api/economic-calendar',
];

async function main() {
  // [A]
  let ok = 0;
  for (const ep of ENDPOINTS) {
    const r = await getJson(ep);
    const errField = r.body && typeof r.body === 'object' && (r.body.error || (Array.isArray(r.body) && r.body.length === 0));
    if (r.status !== 200) issues.push(`[A] ${ep} ??HTTP ${r.status}`);
    else if (errField) issues.push(`[A] ${ep} ??200 but body {error:"${r.body.error ?? 'empty'}"}`);
    else ok++;
  }
  info.push(`[A] ?붾뱶?ъ씤??${ok}/${ENDPOINTS.length} ?뺤긽`);

  // [B] ?댁뒪 踰덉뿭 ??2026-06-04: ko 留?蹂대뜕 ?ш컖吏?(ja/zh ?곸뼱 leak 誘멸컧吏) ???ㅺ뎅??寃利?
  //   ko(?쒓?) + ja(媛???쒖옄) + zh-CN(?쒖옄). cron 401 濡??ㅺ뎅??warm ?ㅽ뙣?섎뜕 寃껋쓣 紐⑤땲?곌? ?〓룄濡?
  {
    const LOC = [{ l: 'ko', re: /[媛-??/ }, { l: 'ja', re: /[?-?요?-涌?/ }, { l: 'zh-CN', re: /[訝-涌?/ }];
    for (const { l, re } of LOC) {
      const r = await getJson(`/api/news-cascade?locale=${l}`);
      const arts = (r.body?.articles || r.body?.events || r.body?.items || []);
      if (arts.length === 0) { info.push(`[B] news-cascade ${l} 湲곗궗 0`); continue; }
      const titles = arts.map(a => a.title || a.headline || '').filter(Boolean);
      const ok = titles.filter(t => re.test(t)).length;
      const pct = titles.length ? Math.round(ok / titles.length * 100) : 0;
      // 2026-06-05: JP/CN ?ㅼ씠?곕툕 ?쇰뱶 ?좎?(?ъ슜??寃곗젙) + 濡쒖뺄 8B 媛 CJK cross-translate쨌諛곗튂 踰덉뿭??
      //   100% 紐??섎뒗 ?쒓퀎 ?몄?. <50%=肄쒕뱶罹먯떆/?뚯씠?꾨씪??寃고븿(?슚, warm ?꾩슂) / 50-80%=8B 遺遺꾨쾲??
      //   (?몄??????곸뼱 base 蹂대떎 ?섏쓬) / ??0%=?뺤긽.
      if (pct < 50) issues.push(`[B] ?댁뒪 踰덉뿭 ${l} ${ok}/${titles.length} (${pct}%) ??肄쒕뱶罹먯떆/?뚯씠?꾨씪??warm ?꾩슂). ?? "${(titles.find(t => !re.test(t)) || '').slice(0, 35)}"`);
      else if (pct < 80) info.push(`[B] ?댁뒪 踰덉뿭 ${l} ${ok}/${titles.length} (${pct}%) ??8B 遺遺꾨쾲??CJK ?쒓퀎 ?몄???`);
      else info.push(`[B] ?댁뒪 踰덉뿭 ${l} ${ok}/${titles.length} (${pct}%)`);
      // [B5] 以묎뎅??bleeding ?섎꽕??(2026-06-07): qwen(以묎뎅怨???ko 異쒕젰???쒖옄 ?꾩텧. ko ?쒕ぉ??
      //   ?쒖옄 2媛? ?덉쑝硫?bleed. (ja ???쒖옄 ?뺤긽?대씪 ?쒖쇅. zh ??以묎뎅???뺤긽.)
      if (l === 'ko') {
        // 2026-06-13: bleed = *?쒓?怨??쒖옄/媛?섍? ?쇱옱*?섎뒗 諛섏そ 踰덉뿭留?(qwen ?꾩텧???ㅽ삎??.
        //   ?쒖닔 ?멸뎅???먮Ц(踰덉뿭 ?ㅽ뙣 ???뺤쭅???먮Ц ?좎?)? bleed 媛 ?꾨땲??[B] 而ㅻ쾭由ъ? ?뚭? ??
        //   ?섍퀬??湲곗궗(?쒖닔 ?쇱뼱)媛 "qwen ?꾩텧"濡??ㅻ텇瑜섎릺??寃?援먯젙.
        const bleeds = titles.filter(t => /[媛-??/.test(t) && ((t.match(/[訝-涌?/g) || []).length >= 2 || /[????/.test(t)));
        if (bleeds.length) issues.push(`[B5] ?쇱쥌 踰덉뿭(bleed) ko ${bleeds.length}嫄????쒓?+?쒖옄/媛???쇱옱. ?? "${bleeds[0].slice(0, 30)}"`);
        else info.push('[B5] ?쇱쥌 踰덉뿭 ?놁쓬 (ko bleed 0)');
      }
    }
  }

  // [B2] ?댁뒪 援?? 而ㅻ쾭由ъ? (2026-06-05 ?좎꽕) ???ъ슜??"媛?援?? ?댁뒪媛 ???ㅼ뼱媛??".
  //   news-cascade 媛 US ?곸뼱 ?쇰뱶留뚯씠???ш컖吏? ??KR/JP/CN ?ㅼ씠?곕툕 ?쇰뱶 異붽? + region 荑쇳꽣.
  //   article.source 濡?region ?먯젙: KR ?뚯뒪 0嫄댁씠硫?KR ?쇰뱶 ?딄?/荑쇳꽣 誘몄옉????寃고븿.
  {
    const r = await getJson('/api/news-cascade?locale=ko');
    const arts = (r.body?.articles || []);
    const srcs = arts.map(a => a.source || '');
    const krN = srcs.filter(s => /?고빀|?쒓뎅寃쎌젣|留ㅼ씪寃쎌젣|留ㅺ꼍|癒몃땲?щ뜲??.test(s)).length;
    const jpN = srcs.filter(s => /Japan|??Nikkei/i.test(s)).length;
    const cnN = srcs.filter(s => /SCMP|China|訝?i.test(s)).length;
    if (arts.length === 0) {
      info.push('[B2] news-cascade 湲곗궗 0 ??而ㅻ쾭由ъ? ?먭? 遺덇?');
    } else if (krN === 0) {
      issues.push(`[B2] ?댁뒪 KR 而ㅻ쾭由ъ? 0 ???고빀/?쒓꼍/留ㅺ꼍 ?쇰뱶 ?딄? ?먮뒗 region 荑쇳꽣 誘몄옉??(珥?${arts.length}嫄? jp=${jpN} cn=${cnN})`);
    } else {
      info.push(`[B2] ?댁뒪 援?? 而ㅻ쾭由ъ? KR=${krN} JP=${jpN} CN=${cnN} (珥?${arts.length})`);
    }
  }

  // [B3] ?댁뒪 ?좎꽑??(2026-06-06 ?좎꽕) ???ъ슜??"二쇱슂?댁뒪媛 ??18h ?꾧볼?? ?섎꽕?ㅼ뿉 ?덉옟??".
  //   理쒖떊 湲곗궗 age ?먭?. 二쇰쭚(?쒖옣 ?댁옣)???댁뒪 sparse ???꾧퀎 ?꾪솕(?됱씪 18h / 二쇰쭚 48h). genuinely
  //   ?딄릿 ?쇰뱶(?됱씪 18h+)???〓릺 二쇰쭚 ?뺤긽? ?듦낵. age 瑜?info 濡???긽 ?몄텧.
  {
    const r = await getJson('/api/news-cascade?locale=ko');
    const arts = (r.body?.articles || []);
    const times = arts.map(a => { const t = a.publishedAt || a.pubDate || a.date || a.isoDate; const ms = t ? Date.parse(t) : NaN; return Number.isFinite(ms) ? ms : null; }).filter(x => x != null);
    if (times.length) {
      const ageH = (Date.now() - Math.max(...times)) / 3600000;
      const weekend = [0, 6].includes(new Date().getUTCDay());
      const limit = weekend ? 48 : 18;
      if (ageH > limit) issues.push(`[B3] ?댁뒪 理쒖떊 ${ageH.toFixed(0)}h ??(>${limit}h, ${weekend ? '二쇰쭚' : '?됱씪'}) ???쇰뱶 媛깆떊 ?뺤? ?섏떖`);
      else info.push(`[B3] ?댁뒪 ?좎꽑??OK (理쒖떊 ${ageH.toFixed(0)}h ?? ${weekend ? '二쇰쭚' : '?됱씪'} ?꾧퀎 ${limit}h)`);
    } else info.push('[B3] ?댁뒪 timestamp ?뚯떛 遺덇? ???좎꽑???먭? skip');
  }

  // [B4] RSS ?쇰뱶 *?뚯뒪* 嫄닿컯??(2026-06-06 ?좎꽕) ??"???ш컖吏??" 洹쇰낯: 醫낆쟾 寃利앹? "endpoint 200"
  //   留?遊ㅼ? ?몃? RSS ?뚯뒪媛 *?댁븘?덈뒗吏/?좎꽑?쒖?* ??遊ㅼ쓬. WSJ RSS 媛 200+?좏슚XML ?댁?留?Jan 2025
  //   frozen, Reuters fetch fail ?몃뜲 紐??≪븯???뚯뒪 decay ?ш컖吏?). ??媛??쇰뱶 理쒖떊湲곗궗 age 吏곸젒 ?먭?.
  try {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/api/news-cascade/route.ts', 'utf8');
    const m = src.match(/RSS_FEEDS[^=]*=\s*\[([\s\S]*?)\];/);
    const feeds = [...(m?.[1] || '').matchAll(/url:\s*['"]([^'"]+)['"][^}]*source:\s*['"]([^'"]+)/g)].map(x => ({ url: x[1], src: x[2] }));
    let dead = 0;
    const deadList = [];
    // 2026-06-15: "200 + ?좎쭨X" ??dead 媛 ?꾨땲??rate-limit transient ???뚭? 留롮쓬 ??Yahoo ?쇰뱶 4媛쒕?
    //   蹂묐젹 fetch ?섎㈃ ?숈씪 IP per-IP rate-limit ?쇰줈 洹몄쨷 ?섎굹媛 鍮??묐떟??以??④굔? ?뺤긽). dead 濡?
    //   ?⑥젙?섏? 留먭퀬 ?좎쭨0 ?대㈃ sequential 1???ъ떆??stagger). 吏꾩쭨 dead ???ъ떆?꾨룄 0 ??洹몃븣留?flag.
    const datesOf = async (url) => {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return { http: r.status, ds: [] };
      const t = await r.text();
      const ds = [...t.matchAll(/<pubDate>([^<]+)<\/pubDate>/g), ...t.matchAll(/<published>([^<]+)<\/published>/g)].map(x => Date.parse(x[1])).filter(Number.isFinite).sort((a, b) => b - a);
      return { http: 200, ds };
    };
    await Promise.all(feeds.map(async f => {
      try {
        let { http, ds } = await datesOf(f.url);
        if (http !== 200) { dead++; deadList.push(`${f.src}(HTTP${http})`); return; }
        if (!ds.length) {   // ?좎쭨0 = rate-limit ?섏떖 ??sequential ?ъ떆??鍮??묐떟 transient ?뺤씤)
          await new Promise(r => setTimeout(r, 1500));
          ({ ds } = await datesOf(f.url));
        }
        const ageH = ds.length ? (Date.now() - ds[0]) / 3600000 : null;
        if (ageH == null || ageH > 168) { dead++; deadList.push(`${f.src}(${ageH == null ? '?좎쭨X' : Math.round(ageH) + 'h'})`); }
      } catch { dead++; deadList.push(`${f.src}(fetch?ㅽ뙣)`); }
    }));
    if (dead > 0) issues.push(`[B4] RSS 二쎌?/stale ?쇰뱶 ${dead}/${feeds.length}: ${deadList.join(', ')} ???뚯뒪 援먯껜 ?꾩슂`);
    else info.push(`[B4] RSS ?쇰뱶 ${feeds.length}媛??꾨? ?좎꽑(??d)`);
  } catch (e) { info.push(`[B4] RSS ?쇰뱶 ?먭? skip: ${String(e.message).slice(0, 40)}`); }

  // [C] contango / commodity 異붿젙 ?쒖떆
  {
    const r = await getJson('/api/commodity-curve');
    const curves = r.body?.curves || [];
    if (curves.length === 0) issues.push('[C] commodity-curve 鍮??묐떟');
    else {
      for (const c of curves) {
        // synthetic curve ?몃뜲 ticker 媛 ?ㅼ젣 ?곗씠??FRED/Yahoo) 泥섎읆 蹂댁씠硫??ㅼ씤 ?뚯? ???쒖떆 ?먭?
        const firstTicker = c.curve?.[0]?.ticker ?? '';
        const looksReal = /^(FRED|YAHOO|CME):/i.test(firstTicker);
        if (c.synthetic && looksReal) info.push(`[C] ${c.id} ${c.structure}(synthetic=true, label="${firstTicker}" ??異붿젙?몃뜲 ?ㅻ뜲?댄꽣 ?쇰꺼, UI ?쒖떆 ?먭?)`);
        else info.push(`[C] ${c.id} ${c.structure}${c.synthetic ? '(synthetic)' : '(real)'}`);
      }
    }
  }

  // [E] 踰덉뿭 ?붾뱶?ъ씤????/api/translate 媛 ?ㅼ젣 ??곸뼵??異쒕젰???대뒗吏 (cloud quota ?뚯쭊 ??
  //     ?먮Ц ?곸뼱 洹몃?濡?諛섑솚?섎뜕 ?ш컖吏?. 2026-06-03 ?뚯궗?섏씠吏 誘몃쾲???ш굔 ???좎꽕).
  {
    try {
      const res = await fetch(`${BASE}/api/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Apple designs and sells smartphones, computers, and services worldwide.', targetLocale: 'ko' }),
        signal: AbortSignal.timeout(70000),
      });
      const j = await res.json().catch(() => ({}));
      const out = j.translated || '';
      const hasKo = /[媛-??/.test(out);
      if (!hasKo) issues.push(`[E] /api/translate ko 誘몃쾲????異쒕젰???쒓? ?놁쓬 (cloud quota ?뚯쭊/Ollama ?ㅼ슫 ?섏떖). ?? "${String(out).slice(0, 50)}"`);
      else info.push(`[E] /api/translate ko OK (source=${j.source ?? '?'}${j.cached ? ',cached' : ''})`);
    } catch (e) { issues.push(`[E] /api/translate ?몄텧 ?ㅽ뙣: ${String(e.message || e).slice(0, 50)}`); }
  }

  // [F] ?숈쟻??freshness ??媛믪씠 ?ㅼ젣濡?媛깆떊?섎뒗吏(frozen/stale 罹먯떆쨌怨좎젙?곸닔 媛먯?). 2026-06-04 ?좎꽕.
  //     "異쒕젰??留욌굹"(A~E)? 蹂꾧컻濡?"怨꾩냽 ?숈쟻?쇰줈 ?낅뜲?댄듃?섎굹"瑜?updatedAt/source 濡?寃利?
  {
    const now = Date.now();
    const ageH = (ts) => ts ? (now - new Date(ts).getTime()) / 3600000 : Infinity;
    // 1) ?ㅼ떆媛??쒖꽭 ??updatedAt ?좎꽑(?쇱씠釉?媛깆떊). ?μ쨷 罹먯떆 怨좊젮 48h ?꾧퀎.
    const sp = await getJson('/api/stock-price/AAPL');
    const spAge = ageH(sp.body?.updatedAt);
    if (spAge > 48) issues.push(`[F] stock-price updatedAt ${spAge.toFixed(0)}h 寃쎄낵 ???쒖꽭 媛깆떊 ?뺤? ?섏떖(frozen)`);
    else info.push(`[F] stock-price ?좎꽑 (${spAge.toFixed(1)}h)`);
    // 2) F&G source=live (?뺤쟻 ?대갚 ?꾨떂)
    const fg = await getJson('/api/fear-greed');
    const fgSrc = fg.body?.source;
    if (fgSrc && fgSrc !== 'live') issues.push(`[F] fear-greed source=${fgSrc} (?뺤쟻 ?대갚 ???щ줎 誘멸갚???섏떖)`);
    else info.push(`[F] fear-greed source=${fgSrc ?? '?'}`);
    // 3) ADR FX 蹂???쇱씠釉????멸뎅?듯솕 ADR ?щТ媛 ?섏궛?섎뒗吏 + ?쇱씠釉?FX
    const adr = await getJson('/api/company-financials/ASML', 25000);
    const adrSrc = adr.body?.source ?? '';
    if (adr.body?.latestAnnual?.revenueUSD == null) issues.push('[F] ASML(EUR ADR) ?щТ ?꾨씫 ???ㅽ넻??FX 寃쎈줈 ?뺤? ?섏떖');
    else info.push(`[F] ADR FX 蹂??OK (ASML rev=$${(adr.body.latestAnnual.revenueUSD/1e9).toFixed(1)}B, ${adrSrc.replace('SEC EDGAR XBRL ','')})`);
  }

  // [D] 而ㅻ쾭由ъ?-李⑥썝 ??"移댄뀒怨좊━ 0嫄?= 鍮④컙遺? ?먯튃. 理쒖떊 蹂닿퀬?쒖뿉 KR portfolio 媛 ?덈뒗??
  //     companyChanges/supplyChain ??KR ??0 ?대㈃ 移⑤У???꾨땲??寃고븿?쇰줈 surface.
  //     (US-?곗꽑 ?뚯씠?꾨씪?몄씠 KR ??議곗슜???꾨씫?섎뜕 ?ш컖吏? ?먮룞 媛먯?.)
  try {
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const dir = 'C:/Flowvium/reports';
    // 2026-06-12: "理쒖떊" ???대쫫 sort 濡?戮묐뜕 踰꾧렇 ???뚰뙆踰녹긽 noon ????긽 留덉?留됱씠??evening/afternoon
    //   諛쒓컙 ?꾩뿉??noon ??寃??([D] supplyChain KR ??fix ?꾩뿉??stale ?섍쾶 ?щ컻?섎뜕 ?먯씤). mtime 湲곗?.
    const files = readdirSync(dir).filter(f => /^report-\d{4}-\d{2}-\d{2}-(midnight|morning|noon|afternoon|evening)-[a-z-]+\.json$/.test(f));
    const latest = files.map(f => ({ f, m: statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.m - a.m)[0]?.f;
    if (latest) {
      const d = JSON.parse(readFileSync(`${dir}/${latest}`, 'utf8'));
      const isKR = t => /\.(KS|KQ)$/.test(t || '');
      const krPortfolio = (d.portfolio || []).filter(p => isKR(p.ticker)).length;
      if (krPortfolio > 0) {
        const ccKr = (d.companyChanges || []).filter(x => isKR(x.ticker)).length;
        const scArr = d.supplyChainChanges || d.supplyChainSignals || [];
        const scKr = scArr.filter(x => isKR(x.ticker) || /?쇱꽦|?섏씠?됱뒪|?꾨?|?ㅼ씠踰?移댁뭅???ъ뒪肄???몃━??.test(JSON.stringify(x))).length;
        if (ccKr === 0) issues.push(`[D] companyChanges KR 0嫄?(portfolio KR ${krPortfolio}媛?蹂댁쑀) ??KR 湲곗뾽蹂???꾨씫 ?섏떖 (${latest})`);
        else info.push(`[D] companyChanges KR ${ccKr}嫄?);
        if (scKr === 0) issues.push(`[D] supplyChain KR 0嫄?(portfolio KR ${krPortfolio}媛? ??KR 怨듦툒留??꾨씫 ?섏떖`);
        else info.push(`[D] supplyChain KR ${scKr}嫄?);
      } else info.push('[D] 理쒖떊 蹂닿퀬??KR portfolio ?놁쓬 (coverage ?먭? skip)');
    }
  } catch (e) { info.push(`[D] coverage ?먭? 遺덇?: ${String(e.message || e).slice(0, 50)}`); }

  // [G0b] 13F 湲곌? 吏遺꾩쑉 臾닿껐??(2026-06-13 ?좎꽕 ??"AAPL Berkshire 13??吏遺?0%" ?ш굔). root cause:
  //   pctOfShares 媛 placeholder 0 ?쇰줈 *?곸옱 ???쒖떆?⑥뿉??梨꾩썙吏吏 ?딅뜕* ?덊떚?⑦꽩 + CUSIP 誘명빀??
  //   以묐났??+ v7 crumb ?꾨씫. 寃異? 媛숈? 湲곌? 以묐났??/ pctOfShares ?꾨? 0 / ??鍮꾪쁽??>100%).
  try {
    const r = await getJson('/api/stock-supply?ticker=AAPL', 30000);
    const o = r.body?.ownership13F ?? [];
    if (o.length === 0) {
      info.push('[G0b] 13F 吏遺꾩쑉: AAPL ?곗씠???놁쓬 (?쇱씠釉?誘몄쟻????cron ?먭?)');
    } else {
      const insts = o.map(x => x.institution);
      const dup = insts.length - new Set(insts).size;
      const pctSum = o.reduce((s, x) => s + (x.pctOfShares ?? 0), 0);
      const allZero = o.every(x => !x.pctOfShares);
      if (dup > 0) issues.push(`[G0b] 13F 媛숈? 湲곌? 以묐났??${dup}嫄?(CUSIP/湲곌? 誘명빀???뚭?)`);
      else if (allZero) issues.push('[G0b] 13F pctOfShares ?꾨? 0 (sharesOutstanding ?꾨씫/placeholder ?뚭?)');
      else if (pctSum > 100) issues.push(`[G0b] 13F 吏遺꾩쑉 ??${pctSum.toFixed(0)}% (鍮꾪쁽????諛쒗뻾二쇱떇???ㅻ쪟)`);
      else info.push(`[G0b] 13F 吏遺꾩쑉 臾닿껐 OK (AAPL ${o.length}湲곌?, ??${pctSum.toFixed(1)}%)`);
    }
  } catch (e) { info.push(`[G0b] 13F 吏遺꾩쑉 ?먭? 遺덇?: ${String(e.message || e).slice(0, 40)}`); }

  // [G0] ?덊듃留??쒖킑 吏꾩쐞 (2026-06-13 ?좎꽕 ??"媛吏??쒖킑" ?ш굔): Wikipedia ?대갚???뚰뙆踰?proxy ?쒖킑??
  //     遺?ы빐 鍮낇뀒???덈씫 + ???洹좎씪. 寃異? ??NVDA/AAPL/MSFT 以?2+ 遺?????곸쐞-?섏쐞 ?쒖킑 寃⑹감 <15%
  //     (?ㅼ젣 S&P500 ? NVDA ~5T vs 200??~50B = 100諛?. ????"200 OK + ?곗씠???덉쓬" ?몃뜲 媛吏쒖씤 ?뺥깭.
  {
    const hm = await getJson('/api/market-heatmap?country=US', 60000);
    const stocks = (hm.body?.sectors ?? []).flatMap(s => s.stocks ?? []);
    if (stocks.length >= 50) {
      const mega = ['NVDA', 'AAPL', 'MSFT'].filter(t => stocks.some(s => s.ticker === t)).length;
      const caps = stocks.map(s => s.marketCap).filter(Number.isFinite).sort((a, b) => b - a);
      const spread = caps.length > 10 ? (caps[0] - caps[caps.length - 1]) / caps[0] : 1;
      if (mega < 2) issues.push(`[G0] ?덊듃留?US 硫붽?罹?遺??(NVDA/AAPL/MSFT 以?${mega}媛? ??援ъ꽦醫낅ぉ ?대갚 ?뚰뙆踰??섎┝ ?섏떖`);
      else if (spread < 0.15) issues.push(`[G0] ?덊듃留?US ?쒖킑 洹좎씪(?곹븯??寃⑹감 ${(spread * 100).toFixed(0)}%) ??proxy 媛吏??쒖킑 ?섏떖`);
      else info.push(`[G0] ?덊듃留?US ?쒖킑 吏꾩쐞 OK (硫붽?罹?${mega}/3, 寃⑹감 ${(spread * 100).toFixed(0)}%)`);
    }
  }

  // [G] ?섏씠吏 ?꾨뱶 ?꾩쟾????"endpoint 200 ???꾨뱶 梨꾩썙吏? ?ш컖吏?. 2026-06-04 ?좎꽕.
  //     ?ъ슜?먭? 吏곸젒 諛쒓껄?섎뜕 鍮덉뭏(/earnings estimate, /insider ?쒓뎅 湲곌?)??紐⑤땲?곌? ?ъ쟾 ?ъ갑.
  //     ?먯튃: ?섏씠吏媛 *?쒖떆?섎뒗* ?됱쓽 ?듭떖 ?꾨뱶 梨꾩?瑜좎씠 ?꾧퀎 誘몃쭔?대㈃ 寃고븿.
  {
    // 1) /api/earnings ???쒖떆 醫낅ぉ??estimate 梨꾩?瑜?(CEF/留덉씠?щ줈罹??꾪꽣 ????0% 湲곕?).
    const ern = await getJson('/api/earnings', 25000);
    const cov = ern.body?.coverage;
    const arr = ern.body?.earnings ?? [];
    if (arr.length === 0) {
      issues.push('[G] /earnings 0嫄???罹섎┛???곸옱 ?뺤? ?섏떖');
    } else {
      const est = cov?.estCoverage ?? Math.round(arr.filter(e => e.epsEstimate != null || e.revenueEstimate != null).length / arr.length * 100);
      if (est < 70) issues.push(`[G] /earnings estimate 梨꾩?瑜?${est}% (<70%) ??鍮덉뭏 怨쇰떎, ?꾪꽣/?뚯뒪 ?먭?`);
      else info.push(`[G] /earnings estimate 梨꾩?瑜?${est}% (${arr.length}嫄?{cov?.droppedNoise != null ? `, ?몄씠利?${cov.droppedNoise} ?쒓굅` : ''})`);
    }
    // 2) /api/korea-flow ??湲곌? ?쒕ℓ??留ㅻ룄 鍮꾧났諛?(KRX LOGOUT/?뚯꽌踰꾧렇濡?0嫄??섎뜕 ?ш컖吏?).
    const kf = await getJson('/api/korea-flow?period=1d', 25000);
    const instBuy = kf.body?.topInstBuy?.length ?? 0;
    const instSell = kf.body?.topInstSell?.length ?? 0;
    if (instBuy === 0 && instSell === 0) {
      issues.push(`[G] /insider ?쒓뎅 湲곌? ?쒕ℓ??留ㅻ룄 0嫄?(source=${kf.body?.source ?? '?'}) ??KRX/Naver 湲곌? ?뚯떛 ?뺤? ?섏떖`);
    } else {
      info.push(`[G] /insider ?쒓뎅 湲곌? 留ㅼ닔 ${instBuy}쨌留ㅻ룄 ${instSell}嫄?(source=${kf.body?.source ?? '?'})`);
    }
    // 2b) 湲곌컙 李⑤퀎????1d vs 4w 媛 ?숈씪媛믪씠硫?period ?뚮씪誘명꽣 臾댄슚(?ъ슜??"1d=1w=4w=13w ?묎컳?? 踰꾧렇).
    const kf4w = await getJson('/api/korea-flow?period=4w', 25000);
    const n1 = kf.body?.institutionNet, n4 = kf4w.body?.institutionNet;
    if (n1 != null && n4 != null && n1 === n4) {
      issues.push(`[G] /insider 湲곌컙 1d=4w ?숈씪媛?${n1}) ??period ?꾩쟻 誘몄옉??Naver multi-day ?뺤? ?섏떖)`);
    } else if (n1 != null && n4 != null) {
      info.push(`[G] /insider 湲곌컙 李⑤퀎??OK (1d=${(n1/1e8|0)}????4w=${(n4/1e8|0)}?? 4w effDays=${kf4w.body?.effectiveTradingDays})`);
    }
  }

  // [H] OSINT ?숈쟻????social(?몄쐵/?댁뒪)쨌crypto(嫄곕옒?댁뿭)쨌sanctions(OFAC) ?ㅻ뜲?댄꽣 ?먮Ⅴ?붿?.
  //     2026-06-04 ?좎꽕: ?ъ슜?먭? /osint "蹂?섎뒗 寃??녿떎" 吏????紐⑤땲?곌? OSINT 瑜??꾪? ??蹂대뜕 ?ш컖吏?.
  {
    // 1) social ???쇰뱶 ?댁븘?덈굹 + ?몄쐵(Nitter) degraded ?щ? surface.
    const soc = await getJson('/api/osint/social', 25000);
    const newsCount = soc.body?.newsCount ?? 0;
    const tweetCount = soc.body?.tweetCount ?? 0;
    const socSrc = soc.body?.source ?? '?';
    if ((soc.body?.entries?.length ?? 0) === 0) issues.push('[H] /osint social 0嫄????쇰뱶 ?뺤?');
    else if (socSrc === 'news-only' || tweetCount === 0) info.push(`[H] /osint social ?댁뒪 ${newsCount}嫄??좑툘 ?몄쐵 0 (Nitter degraded ??source=${socSrc})`);
    else info.push(`[H] /osint social ?몄쐵 ${tweetCount}쨌?댁뒪 ${newsCount}嫄?);
    // 2) crypto ???쒖꽦 吏媛?Vitalik) 嫄곕옒?댁뿭???댁븘?덈뒗吏 (txCount=0 = ETH tx ?뚯떛 ?뺤?).
    const cr = await getJson('/api/osint/crypto?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=eth', 25000);
    const bal = cr.body?.balance ?? null;
    const txc = cr.body?.txCount ?? 0;
    if (bal == null) issues.push('[H] /osint crypto ?붿븸 null ??ETH 議고쉶 ?뺤?');
    else if (txc === 0) issues.push(`[H] /osint crypto Vitalik txCount=0 (?붿븸 ${Number(bal).toFixed(1)}ETH??OK) ??ETH 嫄곕옒?댁뿭 ?뚯떛 ?뺤?`);
    else info.push(`[H] /osint crypto OK (Vitalik ${Number(bal).toFixed(1)}ETH, tx ${txc})`);
    // 3) sanctions ??OFAC SDN ?곸옱.
    const sanc = await getJson('/api/osint/sanctions', 25000);
    const sGroups = sanc.body?.groups ? Object.keys(sanc.body.groups).length : 0;
    if (sGroups === 0) issues.push('[H] /osint sanctions 0 洹몃９ ??OFAC SDN ?곸옱 ?뺤?');
    else info.push(`[H] /osint sanctions ${sGroups} 洹몃９`);
  }

  // [K] ?뚮씪誘명꽣 李⑤퀎???꾩쟾????period/country/tf ???뚮씪誘명꽣 ?붾뱶?ъ씤?멸? *媛믩쭏?? 鍮꾩뼱?덉? ?딄퀬
  //   ?쒕줈 ?ㅻⅨ吏 寃?? 2026-06-04 ?좎꽕: "湲곕낯 param 留?蹂대뜕" ?ш컖吏?(heatmap country=US 留?OK,
  //   KR/JP 鍮덇컪 / korea-flow 1d=4w ?숈씪媛?瑜??ъ슜?먭? 癒쇱? 諛쒓껄 ??紐⑤뱺 param 媛??꾩닔 寃利?
  {
    const paramSets = [
      { name: 'market-heatmap', vals: ['US', 'KR', 'JP', 'CN', 'EU'], url: v => `/api/market-heatmap?country=${v}`, arr: b => b?.sectors, sig: b => (b?.sectors?.length ?? 0) },
      { name: 'daily-brief', vals: ['1w', '4w', '13w'], url: v => `/api/daily-brief?tf=${v}`, arr: b => [b?.outlook], sig: b => String(b?.outlook ?? '').slice(0, 40) },
      { name: 'korea-flow', vals: ['1d', '4w'], url: v => `/api/korea-flow?period=${v}`, arr: b => b?.topInstBuy, sig: b => b?.institutionNet ?? 0 },
    ];
    for (const ps of paramSets) {
      const results = await Promise.all(ps.vals.map(async v => ({ v, body: (await getJson(ps.url(v), 30000)).body })));
      // unavailable:true = ?뚯뒪 李⑤떒 known(?뺤쭅 ?쒖떆) ??silent-empty 寃고븿怨?援щ텇.
      const known = results.filter(r => r.body?.unavailable === true).map(r => r.v);
      const empties = results.filter(r => !(ps.arr(r.body)?.length) && r.body?.unavailable !== true).map(r => r.v);
      const live = results.filter(r => ps.arr(r.body)?.length);
      const sigs = live.map(r => String(ps.sig(r.body)));
      const allSame = sigs.length > 1 && new Set(sigs).size === 1;
      if (empties.length) issues.push(`[K] ${ps.name} 鍮?param(silent): ${empties.join('/')} ??媛믩쭏???곗씠???덉뼱??);
      else if (allSame) issues.push(`[K] ${ps.name} ??param ?숈씪媛????뚮씪誘명꽣 臾댄슚(?꾩쟻/?꾪꽣 誘몄옉??`);
      else info.push(`[K] ${ps.name} param 李⑤퀎??OK (live ${live.length}${known.length ? `, known-unavailable ${known.length}: ${known.join('/')}` : ''})`);
    }
  }

  // [I] 紐⑤땲???먭?-而ㅻ쾭由ъ? ??"???ш컖吏?媛 諛섎났?먮굹"??洹쇰낯 李⑤떒 (2026-06-04 ?좎꽕).
  //     洹쇰낯?먯씤: 寃利??꾨줈釉뚭? ?붾뱶?ъ씤?몃퀎 ?섎룞 異붽? ???꾨줈釉??녿뒗 ?섏씠吏???먮룞?쇰줈 ?ш컖吏??怨?
  //     "臾댁뾿??紐⑤땲?고빐???섎굹 vs ?ㅼ젣 紐⑤땲?고븯??瑜??議고븯??硫붿빱?덉쬁???놁뿀??news-gap쨌osint ?ш굔).
  //     ?닿껐: ?섏씠吏媛 fetch ?섎뒗 user-facing ?붾뱶?ъ씤??????紐⑤땲?곌? 寃?ы븯???붾뱶?ъ씤??= ?ш컖吏?.
  //     ???섏씠吏 異붽? ???먮룞?쇰줈 ?ш린 ?≫? ?꾨줈釉?異붽?瑜?媛뺤젣 ???ш컖吏? ?щ컻 遺덇?.
  try {
    const { readdirSync, readFileSync } = await import('fs');
    const PAGES_DIR = 'C:/Flowvium/src/components/pages';
    const SELF = 'C:/Flowvium/scripts/check-data-quality.mjs';
    // ?숈쟻???꾩쟾???꾨줈釉뚭? 遺덊븘?뷀븳 ?명봽???좏떥 (議댁옱留뚯쑝濡?異⑸텇?섍굅???ъ슜??鍮꾨끂異?.
    const EXCLUDE = new Set(['admin', 'cron', 'ai', 'batch-prices', 'translate', 'osint', 'member']); // osint ??[H] 媛 ?섏쐞寃쎈줈濡?而ㅻ쾭; member ???몄쬆(?곗씠???뚯뒪 ?꾨떂)
    const epRe = /\/api\/([a-z0-9][a-z0-9-]*)/g;
    const pageEndpoints = new Set();
    for (const f of readdirSync(PAGES_DIR).filter(x => x.endsWith('.tsx'))) {
      const src = readFileSync(`${PAGES_DIR}/${f}`, 'utf8');
      let m; while ((m = epRe.exec(src))) pageEndpoints.add(m[1]);
    }
    const selfSrc = readFileSync(SELF, 'utf8');
    const monitored = new Set();
    let mm; const epRe2 = /\/api\/([a-z0-9][a-z0-9-]*)/g;
    while ((mm = epRe2.exec(selfSrc))) monitored.add(mm[1]);
    // [A] ?ъ뒪泥댄겕媛 而ㅻ쾭?섎뒗 ?붾뱶?ъ씤?몃룄 "理쒖냼 alive 寃利앸맖"?쇰줈 ?몄젙
    const uncovered = [...pageEndpoints].filter(e => !EXCLUDE.has(e) && !monitored.has(e)).sort();
    const total = [...pageEndpoints].filter(e => !EXCLUDE.has(e)).length;
    // 臾닿?利??붾뱶?ъ씤?몃? ?쒕꽕由?auto-probe ??bespoke ?꾨줈釉뚭? ?놁뼱??理쒖냼 liveness+non-empty+freshness
    //   瑜?媛뺤젣. param ?붾뱶?ъ씤?몃뒗 ?섑뵆 URL. ?대윭硫?"?꾨줈釉???吏??섏씠吏"???먮룞 寃利앸뤌 ?ш컖吏? 0.
    const SAMPLE = {
      'analyst-target': '/api/analyst-target/AAPL', 'company-news': '/api/company-news?ticker=AAPL',
      'company-recs': '/api/company-recs/AAPL', 'company-desc': null, // Ollama ?먮┝ ??skip
      'investment-strategy': null, // 蹂닿퀬???????verify-report 媛 蹂꾨룄 寃利?
      'nport-holdings': '/api/nport-holdings?ticker=069500',
      'iv': '/api/iv/AAPL',
      'company-business': '/api/company-business/AAPL',  // 2026-06-07: [ticker] ?숈쟻 ?쇱슦??sample
      'company-signals': '/api/company-signals/NVDA',    // 2026-06-13: [ticker] ?숈쟻 ??base path ??404
      'manipulation-risk': '/api/manipulation-risk/NVDA', // 2026-06-13: [ticker] ?숈쟻 ?묒쟾二??ㅼ퐫??
    };
    const SKIP = new Set(['company-desc', 'investment-strategy']);
    const probeOne = async (ep) => {
      if (SKIP.has(ep)) return { ep, skip: true };
      const path = SAMPLE[ep] ?? `/api/${ep}`;
      let r = await getJson(path, 12000);
      // ??꾩븘??status 0) ???먮┛ ?붾뱶?ъ씤?몄씪 ???덉쓬. 湲???꾩븘??1???ъ떆?꾪빐 slow vs dead 援щ텇.
      if (r.status === 0) {
        const r2 = await getJson(path, 30000);
        if (r2.status === 0 || r2.status >= 400) return { ep, dead: `HTTP ${r2.status}` };
        return { ep, slow: '?묐떟 12s 珥덇낵(30s ??OK) ??罹먯떆/?깅뒫 ?먭? 沅뚯옣', skipBody: true };
      }
      if (r.status >= 400) return { ep, dead: `HTTP ${r.status}` };
      const b = r.body;
      // 2026-06-13: 鍮?諛곗뿴 []??dead ?꾨떂 ??由ъ뒪???붾뱶?ъ씤??cascade-events ?????뺤긽 '?곗씠???놁쓬'
      //   ?곹깭. Object.keys([]).length===0 ??[] 瑜?'empty body' 濡??ㅽ깘?섎뜕 寃?李⑤떒(?꾨옒 weak 寃?ш?
      //   !Array.isArray 濡??대? 諛곗뿴 硫댁젣). {} (鍮?媛앹껜)留?dead.
      if (b == null || (typeof b === 'object' && !Array.isArray(b) && Object.keys(b).length === 0)) return { ep, dead: 'empty body' };
      if (b.error && !b.entries && !b.data) return { ep, dead: `error: ${String(b.error).slice(0, 30)}` };
      // configured===false = ?좊즺 API ?湲?誘몄꽕??(?섎룄???좉툑, 寃고븿 ?꾨떂 ??locked 濡?遺꾨쪟).
      if (b.configured === false) return { ep, locked: true };
      // non-empty ?곗씠???붿쟻: 諛곗뿴 湲몄씠 OR ?ㅼ뭡??OR 援ъ“ 媛앹껜(market/outlook ?? 議댁옱.
      const arrLen = ['entries', 'data', 'results', 'signals', 'movers', 'items', 'companies', 'holdings', 'alerts', 'events', 'trades', 'rows', 'curve', 'sectors']
        .reduce((n, k) => n + (Array.isArray(b[k]) ? b[k].length : 0), 0);
      const objKeys = ['market', 'outlook', 'capital', 'company', 'summary', 'consensus', 'byCountry', 'byAsset'];
      const hasObj = objKeys.some(k => b[k] != null && (typeof b[k] !== 'object' || Object.keys(b[k]).length > 0));
      const hasScalar = b.score != null || b.value != null || b.probability != null || b.balance != null || b.total > 0 || typeof b.updatedAt === 'string' || typeof b.generatedAt === 'string';
      // company-signals: ticker蹂??쒓렇????議곗슜??醫낅ぉ? uoa/burst/contract ?꾨? 鍮꾩뼱??*?뺤긽*(?섎せ ?꾨떂).
      //   200 + ?뺤긽 shape(ticker echo + uoa 諛곗뿴 ??議댁옱)硫?alive 濡??몄젙 (empty?쟡ead).
      const hasSignalShape = typeof b.ticker === 'string' && 'uoa' in b && Array.isArray(b.uoa);
      if (hasSignalShape) return { ep, ok: true };
      if (arrLen === 0 && !hasScalar && !hasObj && !Array.isArray(b)) return { ep, weak: '鍮?諛곗뿴/?ㅼ뭡??援ъ“ ?놁쓬 ???뺤쟻/?뺤? ?섏떖' };
      return { ep, ok: true };
    };
    const probed = await Promise.all(uncovered.map(probeOne));
    const dead = probed.filter(p => p.dead);
    const weak = probed.filter(p => p.weak);
    const slow = probed.filter(p => p.slow);
    const okN = probed.filter(p => p.ok).length;
    const skipN = probed.filter(p => p.skip).length;
    const lockedN = probed.filter(p => p.locked).length;
    if (dead.length) issues.push(`[I] 臾닿?利??붾뱶?ъ씤??以?DEAD ${dead.length}: ${dead.map(d => `${d.ep}(${d.dead})`).join(', ')}`);
    if (weak.length) issues.push(`[I] 臾닿?利??붾뱶?ъ씤??以?鍮덈뜲?댄꽣 ${weak.length}: ${weak.map(w => w.ep).join(', ')}`);
    if (slow.length) info.push(`[I] ?좑툘 ?먮┛ ?붾뱶?ъ씤??${slow.length}: ${slow.map(s => s.ep).join(', ')} (live, 12s 珥덇낵 ??罹먯떆 ?먭?)`);
    info.push(`[I] ?먭?-而ㅻ쾭由ъ?: bespoke ${monitored.size}媛?+ auto-probe ${okN + slow.length}/${uncovered.length} live (locked ${lockedN}, skip ${skipN}, slow ${slow.length}, dead ${dead.length}, weak ${weak.length}) ??page ?붾뱶?ъ씤??${total}媛??꾩닔 寃利?);
  } catch (e) { info.push(`[I] ?먭?-而ㅻ쾭由ъ? ?먭? 遺덇?: ${String(e.message || e).slice(0, 50)}`); }

  // [J] ?몄뀡 enum drift 媛????"???꾩쭅???섎뱶肄붾뵫" ??寃利?(2026-06-04 ?좎꽕).
  //   蹂닿퀬???몄뀡???щ윭 ?뚯씪???섎뱶肄붾뵫???щ’ 異붽? ????怨노쭔 鍮좊쑉由щ㈃ 蹂닿퀬?쒓? silent 誘몄꽌鍮숇맖.
  //   data/report-sessions.json(?⑥씪 ?뚯뒪)???몄뀡??critical ?뚯씪?ㅼ씠 紐⑤몢 李몄“?섎뒗吏 寃?????꾨씫 ???슚.
  try {
    const { readFileSync } = await import('fs');
    const ROOT = 'C:/Flowvium';
    const cfg = JSON.parse(readFileSync(`${ROOT}/data/report-sessions.json`, 'utf8'));
    const sessionIds = cfg.sessions.map(s => s.id);
    const drift = [];
    for (const rel of cfg.criticalFiles) {
      let src = '';
      try { src = readFileSync(`${ROOT}/${rel}`, 'utf8'); } catch { drift.push(`${rel}(?쎄린?ㅽ뙣)`); continue; }
      const missing = sessionIds.filter(id => !new RegExp(`['"\`]${id}['"\`]|\\b${id}\\b`).test(src));
      if (missing.length) drift.push(`${rel.split('/').pop()}(?꾨씫: ${missing.join(',')})`);
    }
    if (drift.length) issues.push(`[J] ?몄뀡 enum drift ??${sessionIds.length}?щ’ 誘몃컲???뚯씪: ${drift.join(' 쨌 ')}`);
    else info.push(`[J] ?몄뀡 enum ?뺥빀 ??${sessionIds.length}?щ’(${sessionIds.join('/')}) critical ${cfg.criticalFiles.length}?뚯씪 紐⑤몢 諛섏쁺`);
  } catch (e) { info.push(`[J] ?몄뀡 drift ?먭? 遺덇?: ${String(e.message || e).slice(0, 50)}`); }

  // [L] live/static 鍮꾩쑉 ??mixed-source ?붾뱶?ъ씤?멸? mostly-static 濡?degrade 媛먯? (2026-06-04 ?좎꽕).
  //   ?ъ슜?먭? macro ??"?뺤쟻" 諛쒓껄 ??macro-indicators 11/13 static(staticAsOf ?쒕떖??. endpoint 媛
  //   200쨌source ?덉뼱??*?遺遺?stale static* ?대㈃ ?ъ슜?먯뿉寃??뺤쟻. liveCount/staticCount 蹂닿퀬?섎뒗
  //   ?붾뱶?ъ씤?몄쓽 static ?곗쐞瑜?flag. (FRED/?몃??뚯뒪 李⑤떒 ??議곗슜??static fallback ?섎뜕 ?ш컖吏?.)
  {
    const checks = [
      { name: 'macro-indicators', path: '/api/macro-indicators', live: 'liveCount', stat: 'staticCount', asOf: 'staticAsOf' },
    ];
    for (const c of checks) {
      const r = await getJson(c.path, 20000);
      const live = r.body?.[c.live], stat = r.body?.[c.stat];
      if (typeof live === 'number' && typeof stat === 'number') {
        const total = live + stat;
        const pct = total ? Math.round((live / total) * 100) : 0;
        if (stat > live) issues.push(`[L] ${c.name} live ${live}/${total} (${pct}%) ???遺遺??뺤쟻(${r.body?.[c.asOf] ?? '?'}), ?몃??뚯뒪 李⑤떒 ?섏떖`);
        else info.push(`[L] ${c.name} live ${live}/${total} (${pct}%)`);
      }
    }
  }

  // [L2] credit-balance 援??蹂?recoverable vs structural 遺꾨쪟 (2026-06-05 ?좎꽕).
  //   "??理쒖꽑??諛⑸쾿(?쇱씠釉??뚯뒪)???쒗뻾 ???덈굹" 瑜??먮룞 ?ъ갑 ???⑥닚 ratio 媛 ?꾨땲??
  //   *fetcher 媛 ?덈뒗??silent ?섍쾶 static 諛섑솚*(recoverable=利됱떆 fix ??? 怨?
  //   *臾대즺 吏묎퀎?뚯뒪 遺??(structural=援ъ“??遺덇?, ?몄??? 瑜?援щ텇. ?꾩옄留??슚, ?꾩옄???뱄툘.
  //   EXPECTED_LIVE = ?묐룞 ?섎룄??fetcher 蹂댁쑀. ??以?"(static est.)" 硫??뚭?/?뚯뒪?щ㈇ ??寃고븿.
  {
    const EXPECTED_LIVE = { us: 'FRED', tw: 'TWSE', cn: 'Eastmoney' };
    // kr: KRX data.krx.co.kr 媛 server-side ?붿껌??anti-scrape 濡?李⑤떒(荑좏궎 ?숇컲?대룄 400 LOGOUT, 2026-06-05
    //   ?뚯뒪???뺤씤) + BOK ECOS ??利앷텒 ?좎슜嫄곕옒?듭옄 series 誘몃낫????live 援ъ“??李⑤떒. static-estimated ?좎?.
    const STRUCTURAL = { jp: 'JPX .xls 誘명뙆??, in: 'NSE 李⑤떒', eu: 'ESMA ?⑥씪吏묎퀎 誘몃컻??, kr: 'KRX anti-scrape(LOGOUT)+BOK 誘몃낫?? };
    const r = await getJson('/api/credit-balance', 20000);
    const countries = r.body?.countries;
    if (Array.isArray(countries)) {
      const isStatic = (c) => c.liveData === false || /static est\./i.test(c.source || '');
      const recoverableBroken = countries.filter(c => EXPECTED_LIVE[c.id] && isStatic(c)).map(c => c.id);
      const structuralStatic = countries.filter(c => STRUCTURAL[c.id] && isStatic(c)).map(c => c.id);
      const liveOk = countries.filter(c => EXPECTED_LIVE[c.id] && !isStatic(c)).map(c => c.id);
      if (recoverableBroken.length) {
        issues.push(`[L2] credit-balance recoverable-but-static: ${recoverableBroken.map(id => `${id}(${EXPECTED_LIVE[id]})`).join(', ')} ??fetcher ?덈뒗???쇱씠釉??ㅽ뙣, 利됱떆 fix ???);
      }
      info.push(`[L2] credit-balance live ${liveOk.join('/')||'?놁쓬'}; structural-static(?몄??? ${structuralStatic.map(id => `${id}(${STRUCTURAL[id]})`).join(', ') || '?놁쓬'}`);
    }
  }

  // [M] narratives intensity ?쇱씠釉?寃利?(2026-06-05 ?좎꽕).
  //   narratives ??? 8媛?援ъ“???뚮쭏 ?뺤쓽(?뺤쟻 ?뺣떦) + ?쇱씠釉?intensity overlay(愿??醫낅ぉ 紐⑤찘?
  //   + ?뱁꽣 ?먭툑?먮쫫). ?ㅻ뜑媛 ?쎌냽??"AI-generated analysis" ?숈쟻 ?덉씠?닿? 誘멸뎄?꾩씠???ш컖吏?瑜?
  //   intensity 濡?援ы쁽 ??source=live + liveCount(8媛?以??좏샇 ?섏떊) 寃利? static ?대㈃ ?쒖꽭?뚯뒪 ?딄?.
  {
    const r = await getJson('/api/narratives', 20000);
    const src = r.body?.source, liveCount = r.body?.liveCount, total = (r.body?.intensities ?? []).length;
    if (src === 'live' && typeof liveCount === 'number') {
      if (liveCount < total) issues.push(`[M] narratives intensity ${liveCount}/${total} ???쇰? ?뚮쭏 ?쒖꽭/?뱁꽣 ?좏샇 誘몄닔??);
      else info.push(`[M] narratives intensity live ${liveCount}/${total} ?뚮쭏`);
    } else if (src === 'static') {
      issues.push(`[M] narratives source=static ???쒖꽭(stooq)쨌?뱁꽣?먮쫫 ?꾨? ?ㅽ뙣, intensity 誘몄궛異?(?뺤쓽留??뚮뜑)`);
    } else {
      info.push(`[M] narratives ?먭? 遺덇? (?묐떟 ${r.status})`);
    }
  }

  // [N] ?붾뱶?ъ씤??DB 而ㅻ쾭由ъ? (2026-06-05) ???ъ슜??"紐⑤뱺 ?섏씠吏/???붾뱶?ъ씤?멸? ?낅뜲?댄듃留덈떎 DB ??λ뤌??.
  //   route.ts 瑜??꾩닔 ?닿굅 ??TRACKED_ENDPOINTS(endpoint_snapshots ?곸옱 紐⑸줉)? ?議? ?곗씠???쇱슦?몄씤??
  //   誘몄텛?곸씠硫???DB ?쒓퀎???꾨씫 ?ш컖吏?). 誘몃옒 ?좉퇋 ?붾뱶?ъ씤?몃룄 ?먮룞 ?ъ갑 = "??寃?????먮굹" 諛⑹?.
  //   ?쒖쇅: admin/cron(?곌린쨌??쒕낫??쨌?좏떥(ai/translate ??쨌per-ticker([)쨌param ?꾩닔(ALLOW).
  {
    try {
      const { readdirSync } = await import('fs');
      const { fileURLToPath } = await import('url');
      const { TRACKED_ENDPOINTS } = await import('./lib/snapshot-endpoints.mjs');
      const apiDir = fileURLToPath(new URL('../src/app/api', import.meta.url));
      const routes = [];
      const walk = (dir, prefix) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(`${dir}/${e.name}`, `${prefix}/${e.name}`);
          else if (e.name === 'route.ts') routes.push(prefix || '/');
        }
      };
      walk(apiDir, '');
      const trackedSet = new Set(TRACKED_ENDPOINTS.map(e => e.replace(/^\/api/, '').split('?')[0]));
      // admin/cron(?곌린), ?좏떥, per-ticker([) ?쒖쇅
      const EXCLUDE = /^\/(admin|cron)(\/|$)|^\/(ai|translate|collect|institutional-refresh|batch-prices|member)$|\[/;
      // param ?꾩닔(per-ticker ?깃꺽) ?먮뒗 ?쒓퀎??遺덊븘??list/history) ???섎룄??誘몄텛??
      const ALLOW_UNTRACKED = new Set(['/company-news', '/stock-supply', '/osint/corporate', '/company-kr/list', '/investment-strategy/history', '/paper-trading']);
      const untracked = routes.filter(r => !EXCLUDE.test(r) && !trackedSet.has(r) && !ALLOW_UNTRACKED.has(r));
      if (untracked.length) {
        issues.push(`[N] DB 誘몄텛???곗씠???붾뱶?ъ씤??${untracked.length}媛? ${untracked.join(', ')} ??TRACKED_ENDPOINTS 異붽? ?꾩슂`);
      } else {
        info.push(`[N] ?붾뱶?ъ씤??DB 而ㅻ쾭由ъ? OK ???곗씠???쇱슦???꾨? TRACKED (${trackedSet.size} tracked / route ${routes.length}媛? util쨌per-ticker ?쒖쇅)`);
      }
    } catch (e) { info.push(`[N] 而ㅻ쾭由ъ? ?먭? 遺덇?: ${String(e.message || e).slice(0, 60)}`); }
  }

  // [O] 臾몄꽌-肄붾뱶 ?숆린??(2026-06-05) ??紐⑤땲?곌? ?고????곗씠?곕쭔 蹂닿퀬 *臾몄꽌媛 肄붾뱶? ?쇱튂?섎뒗吏* ??
  //   ??蹂대뜕 硫뷀?-?ш컖吏?(FEATURES "ETF 193"/?ㅼ젣 30, "1,210 醫낅ぉ"/?ㅼ젣 1338). check-doc-sync ?ㅽ룿.
  {
    try {
      const { execSync } = await import('child_process');
      const { fileURLToPath } = await import('url');
      const script = fileURLToPath(new URL('./check-doc-sync.mjs', import.meta.url));
      try {
        execSync(`node "${script}"`, { stdio: 'pipe' });
        info.push('[O] 臾몄꽌-肄붾뱶 ?숆린??OK (UNIVERSE_COUNT/ETF/?몄뼱 ?쇱튂)');
      } catch (e) {
        const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
        const bad = out.split('\n').filter(l => l.includes('?슚')).map(l => l.replace(/.*?슚\s*/, '').trim());
        issues.push(`[O] 臾몄꽌-肄붾뱶 遺덉씪移? ${bad.join(' | ') || '?곸꽭??check-doc-sync ?ㅽ뻾'}`);
      }
    } catch (e) { info.push(`[O] doc-sync ?먭? 遺덇?: ${String(e.message || e).slice(0, 50)}`); }
  }

  // [P] FX ?숈쟻 ?뚯뒪 (2026-06-05) ??USD/KRW 媛 KR 異붿쿇 risk ?듭떖?몃뜲 macro ???녿뜕 媛??ㅻ뒛 KR 湲됰씫
  //   誘멸컧吏 ??Kia/POSCO ?먯떎). Yahoo KRW=X 吏곸젒(?몃? 沅뚯쐞쨌?섎뱶肄붾뵫 ?꾨떂) ???뚯뒪 alive 寃利?+
  //   ?먰솕 짹1.5% 湲됰? ??KR-risk surface(蹂닿퀬??FX 諛섏쁺 ?뺤씤??.
  {
    try {
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=5d', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      const m = (await r.json())?.chart?.result?.[0]?.meta;
      const px = m?.regularMarketPrice, prev = m?.chartPreviousClose;
      if (px == null) issues.push('[P] FX USD/KRW ?뚯뒪 二쎌쓬 (Yahoo KRW=X null) ??KR risk 誘몃컲??);
      else {
        const chg = prev ? (px - prev) / prev * 100 : 0;
        if (Math.abs(chg) >= 1.5) info.push(`[P] ?좑툘 USD/KRW=${Math.round(px)} ${chg > 0 ? '+' : ''}${chg.toFixed(1)}% 湲됰? ??KR 二쇱떇 ${chg > 0 ? '?쎌꽭?뺣젰(?먰솕湲됰씫)' : '?고샇(?먰솕媛뺤꽭)'}. 蹂닿퀬??FX 諛섏쁺 ?뺤씤`);
        else info.push(`[P] FX live USD/KRW=${Math.round(px)} (${chg > 0 ? '+' : ''}${chg.toFixed(1)}%)`);
      }
    } catch (e) { issues.push(`[P] FX ?뚯뒪 ?먭? ?ㅽ뙣: ${String(e.message || e).slice(0, 40)}`); }
  }

  // [R] ?숈쟻 ?멸렇癒쇳듃 而ㅻ쾭由ъ? ????醫낅ぉ(US 873) ?숈쟻 ?곗씠??寃??(2026-06-07 "1300+ ???숈쟻寃??).
  //   cron(2h/6) ??DB company_segments 瑜??먯쭊 ?뺤옣. 紐⑤땲?곌? 留??ъ씠??而ㅻ쾭由ъ?/?좎꽑??surface.
  try {
    const { getSegmentCoverageStats } = await import('./lib/db.mjs');
    const { readFileSync: rfs } = await import('fs');
    const cand = JSON.parse(rfs('data/candidate-tickers.json', 'utf8')).tickers || [];
    const usN = cand.filter(t => !/\.(KS|KQ)$/.test(t)).length || 873;
    const st = getSegmentCoverageStats();
    const pct = Math.round(st.covered / usN * 100);
    if (st.covered === 0) issues.push('[R] ?숈쟻 ?멸렇癒쇳듃 0 ??異붿텧 ?뚯씠?꾨씪???뺤? ?섏떖(cron segments-refresh ?뺤씤)');
    else info.push(`[R] ?숈쟻 ?멸렇癒쇳듃 而ㅻ쾭由ъ? ${st.covered}/${usN} (${pct}%) 쨌 stale>35d ${st.stale} 쨌 ${JSON.stringify(st.bySource)} 쨌 cron 留ㅼ떆6 ?뺤옣以?);
  } catch (e) { info.push(`[R] ?멸렇癒쇳듃 而ㅻ쾭由ъ? ?먭? skip: ${String(e.message || e).slice(0, 40)}`); }

  const ts = new Date().toISOString().slice(0, 19);
  console.log(`\n[data-quality ${ts}]`);
  for (const i of info) console.log('  ??, i);
  for (const i of issues) console.log('  ?슚', i);
  console.log(issues.length === 0 ? '  ??醫낇빀: OK (?곗씠???덉쭏 ?뺤긽)' : `  ??醫낇빀: ${issues.length} ?곗씠???덉쭏 寃고븿`);
  process.exit(issues.length > 0 ? 1 : 0);
}
main();

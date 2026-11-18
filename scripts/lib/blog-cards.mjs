/**
 * blog-cards.mjs — 블로그 글에 넣을 그림(직접 만든 카드)을 계획하고 그린다. 근거·규칙은 blog-cards.test.mjs 머리말.
 *   그림 내용은 글에 이미 있는 숫자·문장뿐이다. 남의 사진·검색 이미지는 쓰지 않는다. 영상 썸네일은 우리 영상만.
 */
import { mkdirSync, statSync } from 'fs';
import { join } from 'path';

const MAX_CARDS = 6;
const MAX_BYTES = 500 * 1024;
const EMPTY_CELL = /^[\s–—-]*$/;

/** 글 구조: 제목, 소제목(##)들 — '---' 뒤 꼬리(사이트 안내·영상 안내)는 뺀다. */
export function parsePost(md) {
  const lines = String(md ?? '').replace(/<!--[\s\S]*?-->/, '').split('\n');
  const post = { title: '', intro: '', sections: [], raw: String(md ?? '') };
  let sec = null, sub = null, inTail = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    if (/^---+$/.test(line)) { inTail = true; continue; }
    if (inTail) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      if (h[1] === '#') post.title = h[2].trim();
      else if (h[1] === '##') { sec = { title: h[2].trim(), paras: [], table: null, list: [], subs: [] }; sub = null; post.sections.push(sec); }
      else if (sec) { sub = { title: h[2].trim(), paras: [] }; sec.subs.push(sub); }
      continue;
    }
    if (!line.trim()) continue;
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim()) && sec) {
      const cells = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line); const rows = [];
      let j = i + 2;
      while (j < lines.length && /^\|/.test(lines[j].trim())) { rows.push(cells(lines[j])); j += 1; }
      sec.table ??= { head, rows };
      i = j - 1;
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li && sec) { sec.list.push(li[1]); continue; }
    if (/^[>!]/.test(line)) continue;
    if (!sec) { if (post.title && !post.intro) post.intro = line; continue; }
    (sub ?? sec).paras.push(line);
  }
  return post;
}

/** 글에 걸린 우리 영상 id(글 끝 '최근 영상' 링크). */
export function videoIdOf(md) {
  const m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/.exec(String(md ?? ''));
  return m ? m[1] : null;
}

const plain = (s) => String(s ?? '').replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sentences = (s) => plain(s).split(/(?<=[.!?다요])\s+/).filter(Boolean);

/** 종목 하위 절 → {name, ticker, entry, stop, target}. 원문 문장에서 그대로 뽑는다(못 뽑으면 그 칸은 비운다). */
function pickRow(sub) {
  const t = /\(([A-Z0-9.]{1,10})\)\s*$/.exec(sub.title);
  const text = plain(sub.paras.join(' '));
  const grab = (re) => (re.exec(text) ?? [])[1] ?? '';
  return {
    name: plain(sub.title.replace(/\s*\([^)]*\)\s*$/, '')), ticker: t ? t[1] : '',
    entry: grab(/진입은\s*([^\s,]+)\s*구간/), stop: grab(/손절선은\s*([^\s,]+?)(?:,|\s|$)/), target: grab(/목표는\s*([^\s,]+?)(?:으로|로|,|\s|$)/),
  };
}

/** 섹션 하나 → 카드 후보. 표·종목·목록이 문단 요약보다 쓸모 있다(prio). */
function sectionCard(sec) {
  if (sec.table) {
    const keep = sec.table.head.map((_, c) => sec.table.rows.some((r) => !EMPTY_CELL.test(r[c] ?? '')));
    const pickCols = (r) => r.filter((_, c) => keep[c]);
    return { kind: 'table', prio: 2, title: sec.title, head: pickCols(sec.table.head), rows: sec.table.rows.map(pickCols),
      alt: `${sec.title} 표`, caption: cut(`${sec.title} — 직접 만든 표`, 40) };
  }
  const rows = sec.subs.map(pickRow).filter((r) => r.entry || r.stop || r.target);
  if (rows.length) {
    return { kind: 'picks', prio: 2, title: sec.title, rows,
      alt: `${sec.title}: ${rows.map((r) => r.ticker || r.name).join(', ')} 진입·손절·목표`, caption: cut('관심 종목 진입·손절·목표 — 직접 만든 표', 40) };
  }
  if (sec.list.length) {
    return { kind: 'list', prio: 2, title: sec.title, lead: sentences(sec.paras[0] ?? '')[0] ?? '', items: sec.list.map(plain).slice(0, 5),
      alt: `${sec.title} 체크리스트`, caption: cut(`${sec.title} — 체크리스트`, 40) };
  }
  const s = sentences(sec.paras.join(' ')).slice(0, 2);
  if (!s.length) return null;
  return { kind: 'quote', prio: 1, title: sec.title, lines: s, alt: `${sec.title} 요약`, caption: cut(`${sec.title} — 요약 카드`, 40) };
}

/**
 * 그림 계획: 제목 아래 1장 + 소제목마다 1장(최대 6장). 영상이 있으면 그 썸네일을 본문 앞쪽 문단 소제목 자리에.
 * @returns {Array<{id:string, kind:string, anchor:string|null, alt:string, caption:string}>}
 */
export function planCards(post, { md = '' } = {}) {
  // 제목 카드: 바로 아래 첫 문장을 되풀이하지 않는다 — 글의 첫 표에서 숫자 셋(값이 있는 첫 숫자 열). 표가 없으면 제목만.
  const t = post.sections.find((s) => s.table)?.table;
  const col = t ? t.head.findIndex((_, c) => c > 0 && t.rows.some((r) => !EMPTY_CELL.test(r[c] ?? ''))) : -1;
  const figures = col > 0 ? t.rows.filter((r) => !EMPTY_CELL.test(r[col] ?? '')).slice(0, 3).map((r) => ({ label: plain(r[0]), value: plain(r[col]) })) : [];
  const cards = [{ kind: 'hero', anchor: null, title: post.title, figures,
    alt: `${post.title} 요약 카드`, caption: '오늘 글 한눈에 — 직접 만든 카드' }];
  const per = post.sections.map((s) => ({ sec: s, card: sectionCard(s) })).filter((x) => x.card);
  const vid = videoIdOf(md || post.raw || '');
  let videoAt = -1;
  if (vid && per.length) {
    // 문단 요약 자리(prio 1)가 있으면 거기, 없으면 가운데 소제목. 표·종목 카드를 밀어내지 않는다.
    videoAt = per.findIndex((x) => x.card.prio === 1);
    if (videoAt < 0) videoAt = Math.floor(per.length / 2);
  }
  const body = per.map((x, i) => (i === videoAt
    ? { kind: 'video', prio: 3, src: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, link: `https://www.youtube.com/watch?v=${vid}`,
      alt: '플로비움 1분 영상 썸네일', caption: '우리 1분 영상 — 아래 링크로 보기', anchor: x.sec.title }
    : { ...x.card, anchor: x.sec.title }));
  // 6장을 넘으면 문단 요약 카드부터 뒤에서 뺀다.
  while (cards.length + body.length > MAX_CARDS) {
    const k = body.map((c) => c.prio).lastIndexOf(Math.min(...body.map((c) => c.prio)));
    body.splice(k, 1);
  }
  return [...cards, ...body].map((c, i) => ({ ...c, id: String(i + 1) }));
}

/**
 * 글(md)에 그림 줄을 넣는다 — 제목 바로 아래, 해당 소제목 바로 아래. 영상 카드 아래엔 영상 링크 한 줄(본문 중간 링크).
 *   이미 그림 줄이 있으면 그대로 돌려준다(두 번 넣지 않는다).
 */
export function withCardImages(md, cards, urlFor) {
  const src = String(md ?? '');
  if (/^!\[[^\]]*\]\(https:\/\//m.test(src)) return src;
  const line = (c) => `![${c.alt.replace(/[\]\n]/g, ' ')}](${c.kind === 'video' ? c.src : urlFor(c)} "${c.caption.replace(/"/g, '')}")`;
  const out = [];
  let inTail = false;
  for (const l of src.split('\n')) {
    out.push(l);
    if (/^---+$/.test(l.trim())) inTail = true;
    if (inTail) continue;
    const h = /^(#{1,2})\s+(.*)$/.exec(l.trimEnd());
    if (!h) continue;
    const c = h[1] === '#' ? cards.find((x) => x.anchor === null) : cards.find((x) => x.anchor === h[2].trim());
    if (!c) continue;
    out.push('', line(c));
    if (c.kind === 'video') out.push('', `▶ 1분 영상으로 보기: ${c.link}`);
  }
  return out.join('\n');
}

const esc = (t) => String(t ?? '').replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

/** 카드 한 장의 HTML(가로 1080). 글자만 — 그림·사진을 끌어오지 않는다. */
export function cardHtml(c, { date = '' } = {}) {
  let inner = '';
  if (c.kind === 'hero') inner = `<div class="tag">${esc(date || '오늘의 정리')}</div><h1>${esc(c.title)}</h1>${(c.figures ?? []).length ? `<div class="figs">${c.figures.map((f) => `<div class="fig"><div class="fl">${esc(f.label)}</div><div class="fv">${esc(f.value)}</div></div>`).join('')}</div>` : ''}`;
  else if (c.kind === 'table') inner = `<h2>${esc(c.title)}</h2><table><tr>${c.head.map((h, i) => `<th class="${i ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr>${c.rows.map((r) => `<tr>${r.map((x, i) => `<td class="${i ? 'n' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`;
  else if (c.kind === 'picks') inner = `<h2>${esc(c.title)}</h2><table><tr><th>종목</th><th class="n">진입</th><th class="n">손절</th><th class="n">목표</th></tr>${c.rows.map((r) => `<tr><td><b>${esc(r.ticker || r.name)}</b><div class="sub">${esc(r.ticker ? r.name : '')}</div></td><td class="n">${esc(r.entry)}</td><td class="n stop">${esc(r.stop)}</td><td class="n tgt">${esc(r.target)}</td></tr>`).join('')}</table>`;
  else if (c.kind === 'list') inner = `<h2>${esc(c.title)}</h2>${c.lead ? `<p class="lead">${esc(c.lead)}</p>` : ''}<ul>${(c.items ?? []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  else if (c.kind === 'quote') inner = `<h2>${esc(c.title)}</h2>${(c.lines ?? []).map((x) => `<p class="q">${esc(x)}</p>`).join('')}`;
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;background:#fff;font-family:-apple-system,'Apple SD Gothic Neo',Helvetica,sans-serif;color:#111}
#card{width:1080px;padding:64px 72px 56px;background:#f6f8fb;border-top:14px solid #1a3a6b}
.tag{display:inline-block;background:#1a3a6b;color:#fff;font-size:30px;font-weight:700;padding:8px 20px;border-radius:10px;margin-bottom:28px}
h1{font-size:62px;line-height:1.25;font-weight:900;letter-spacing:-.02em}
h2{font-size:50px;font-weight:900;margin-bottom:30px;letter-spacing:-.02em}
.lead{font-size:34px;line-height:1.5;color:#444;margin:26px 0 8px}
table{width:100%;border-collapse:collapse;font-size:36px;background:#fff}
th{background:#1a3a6b;color:#fff;text-align:left;padding:18px 22px;font-weight:700}th.n{text-align:right}
td{padding:18px 22px;border-bottom:2px solid #e3e8ef}
td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
td.stop{color:#c0392b}td.tgt{color:#1e8449}
.sub{font-size:24px;color:#666;font-weight:400;margin-top:4px}
ul{list-style:none}li{font-size:36px;line-height:1.45;padding:18px 0 18px 54px;position:relative;border-bottom:2px solid #e3e8ef}
li:before{content:'✓';position:absolute;left:0;top:16px;color:#1a3a6b;font-weight:900}
.q{font-size:40px;line-height:1.55;font-weight:600;margin-bottom:20px}
.figs{display:flex;gap:24px;margin-top:40px}.fig{flex:1;background:#fff;border-radius:16px;padding:24px 28px;border:2px solid #e3e8ef}.fl{font-size:28px;color:#666;font-weight:700}.fv{font-size:46px;font-weight:900;margin-top:6px;font-variant-numeric:tabular-nums}
.brand{margin-top:40px;font-size:26px;color:#7a8597;text-align:right}
</style><div id="card">${inner}<div class="brand">flowvium.net</div></div>`;
}

/**
 * 카드들을 JPEG 로 그린다(가로 1080, 장당 500KB 이하 — 넘으면 화질을 낮춰 다시). 영상 카드는 그리지 않는다(썸네일 주소 그대로).
 * @returns {Promise<Map<string,string>>} 카드 id → 파일 경로
 */
export async function renderCards(cards, outDir, prefix, { date = '' } = {}) {
  const { chromium } = await import('playwright');
  mkdirSync(outDir, { recursive: true });
  const files = new Map();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    for (const c of cards) {
      if (c.kind === 'video') continue;
      await page.setContent(cardHtml(c, { date }), { waitUntil: 'load' });
      const el = page.locator('#card');
      const path = join(outDir, `${prefix}-${c.id}.jpg`);
      for (const quality of [85, 72, 60, 48]) {
        await el.screenshot({ path, type: 'jpeg', quality });
        if (statSync(path).size <= MAX_BYTES) break;
      }
      if (statSync(path).size > MAX_BYTES) throw new Error(`카드 ${c.id} 가 500KB 를 넘는다`);
      files.set(c.id, path);
    }
  } finally {
    await browser.close();
  }
  return files;
}

const slugOf = (key) => String(key).replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const dateOf = (key) => { const m = /\d{4}-(\d{2})-(\d{2})/.exec(String(key)); return m ? `${Number(m[1])}월 ${Number(m[2])}일` : ''; };

/**
 * 글 하나의 그림을 준비한다: 계획 → 그리기(outDir) → 주소가 실제로 그림을 주는지 확인 → 그림 줄을 넣은 md.
 *   파일 이름 = 글 이름 + 카드 내용 해시 — 글이 바뀌면 이름도 바뀌어 옛 캐시가 남지 않는다.
 *   주소 확인이 안 되면 던진다(그림 없는 글을 조용히 올리지 않는다).
 * @returns {Promise<{md:string, cards:object[], files:Map<string,string>, urls:Map<string,string>}>}
 */
export async function prepareCardImages(md, key, { outDir, base = 'https://flowvium.net/api/blog-img', verify = true, fetchImpl = fetch } = {}) {
  const { createHash } = await import('crypto');
  const cards = planCards(parsePost(md));
  const date = dateOf(key);
  const hash = createHash('sha1').update(cards.map((c) => cardHtml(c, { date })).join('\n')).digest('hex').slice(0, 8);
  const prefix = `${slugOf(key)}-${hash}`;
  const files = await renderCards(cards, outDir, prefix, { date });
  const urls = new Map(cards.map((c) => [c.id, c.kind === 'video' ? c.src : `${base}/${prefix}-${c.id}.jpg`]));
  if (verify) {
    for (const [id, u] of urls) {
      const r = await fetchImpl(u, { method: 'GET', cache: 'no-store' });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.startsWith('image/')) throw new Error(`그림 주소가 그림을 안 준다: ${u} (${r.status} ${type})`);
    }
  }
  return { md: withCardImages(md, cards, (c) => urls.get(c.id)), cards, files, urls };
}

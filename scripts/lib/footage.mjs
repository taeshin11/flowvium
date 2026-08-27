/**
 * footage.mjs — 장면 배경으로 쓸 실제 그림/영상을 찾는다.
 *
 * 정지 카드만 쓰면 "PPT 읽는 것" 처럼 보인다. 그래서 화면에 실물을 깐다.
 * 다만 자동 발행 채널이라 **라이선스를 코드가 판단할 수 있는 소스만** 자동 경로에 태운다:
 *
 *   1. local     assets/broll/*.mp4 — 사람이 직접 넣은 클립(권리 판단은 넣은 사람이 한 것)
 *   2. openverse api.openverse.org — 키 불필요, 라이선스가 응답에 들어 있다
 *   3. commons   Wikimedia Commons — 키 불필요, extmetadata.LicenseShortName
 *   4. pexels    PEXELS_API_KEY 가 있을 때만. 유일한 **동영상** 자동 소스다.
 *
 * SNS(인스타·X·페이스북) 원본을 자동으로 긁지 않는 이유: 저작권과 별개로 유튜브 재사용
 *   심사가 **채널 단위**로 집행돼서, 자동 발행 중 한 편이 걸리면 채널 전체가 멈춘다.
 *   쓰고 싶은 클립이 있으면 assets/broll 에 넣으면 1번 경로로 그대로 들어간다.
 */

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'is', 'are', 'was', 'were', 'be', 'it', 'its', 'this', 'that', 'as', 'by', 'has', 'have',
  'his', 'her', 'their', 'they', 'we', 'you', 'not', 'now', 'new', 'says', 'said', 'after',
  '오늘', '이것', '그것', '있다', '없다', '한다', '대한', '위해',
]);

/**
 * 이 라이선스로 **수익화 채널에서 변형해 쓸 수 있는가**.
 * 모르면 false — 기본값이 허용이면 언젠가 사고가 난다.
 */
export function licenseUsable(license) {
  if (!license) return false;
  const s = String(license).toLowerCase().trim();
  if (!s) return false;
  const tok = s.split(/[^a-z0-9]+/).filter(Boolean);
  // NC(비상업)는 수익화와 충돌하고, ND(변경금지)는 켄번스 확대·크롭이 파생물이라 충돌한다.
  if (tok.includes('nc') || tok.includes('nd')) return false;
  if (s.includes('public domain') || s.includes('no known copyright')) return true;
  if (tok.includes('cc0') || tok.includes('pdm') || tok.includes('zero')) return true;
  // Commons 는 PD 계열을 PD-USGov / PD-US-expired 처럼 태그로 준다(실측 2026-08-27).
  if (tok[0] === 'pd') return true;
  // 스톡 사이트 자체 라이선스. 둘 다 상업 이용·변형을 명시 허용하고 표기 의무가 없다.
  if (tok.includes('pexels') || tok.includes('pixabay') || tok.includes('unsplash')) return true;
  return tok.includes('by');
}

/**
 * 장면 → 화면 검색어. **짧아야 찾아진다.**
 *
 * 실측(2026-08-27): 4B 가 visual 에 쉼표로 4개를 나열해 9단어 질의가 됐고 Commons·Openverse
 *   둘 다 0건이었다. 같은 소재를 3단어로 줄이면 12건. 스톡·아카이브 검색은 AND 매칭이라
 *   단어가 늘수록 결과가 0 으로 수렴한다. 그래서 LLM 출력을 그대로 믿지 않고 코드가 줄인다 —
 *   프롬프트만 고치면 모델을 바꿀 때 또 샌다.
 */
export function searchTerms(scene, opts = {}) {
  const { max = 3 } = opts;
  const src = scene?.visual && String(scene.visual).trim()
    ? String(scene.visual)
    : `${scene?.title ?? ''} ${scene?.say ?? ''}`;
  const seen = new Set();
  return String(src)
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')       // 쉼표·마침표가 붙은 채로 질의에 들어가면 매칭이 깨진다
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w.toLowerCase()))
    .filter((w) => { const k = w.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
}

/**
 * 넓은 질의 → 좁은 질의 순서. 3단어가 0건이면 2단어, 그것도 0건이면 1단어로 내려간다.
 * 한 번 던지고 포기하면 배경이 전부 카드로 떨어진다(실측: 8장면 전부 카드).
 * 첫 단어는 끝까지 남긴다 — LLM 이 중요한 명사를 앞에 놓기 때문이다.
 */
export function queryLadder(terms) {
  const t = (terms ?? []).filter(Boolean);
  const out = [];
  for (let n = t.length; n >= 1; n--) out.push(t.slice(0, n));
  return out;
}

/**
 * 후보 중 하나를 고른다. **적합도가 먼저다.**
 *
 * 2026-08-27 실측으로 뒤집힌 설계: 처음엔 "가로·고해상도 우선" 으로 정렬했는데, 그러면
 *   검색엔진이 매긴 적합도 순위를 코드가 뭉갠다. 실제로 이렇게 나왔다 —
 *     "presidential protection detail" → 8936px 해안선 도면(Detail Of Shore Protection)
 *     "Secret Service 조사" 장면        → 19세기 아동 초상화
 *   Commons·Openverse 는 이미 적합도 순으로 준다(rank). 그 순서를 따르고 크기는 동점일 때만 본다.
 *
 * minWidth 기본값이 1280 이던 시절 "Secret Service agents conducting investigation"(1255px)이
 *   25px 모자라 탈락했다. 1920 렌더에서 1255px 은 1.5배 확대라 조금 무를 뿐이고,
 *   **틀린 그림보다 낫다.** 문턱을 900 으로 내린다.
 *
 * 동영상은 사진을 이긴다 — 정지 그림으로는 뉴스 화면이 안 된다.
 */
export function pickFootage(candidates, opts = {}) {
  const { minWidth = 900 } = opts;
  const usable = (candidates ?? []).filter(
    (c) => c && c.url && licenseUsable(c.license)
      && Number(c.width) >= minWidth && Number(c.width) > Number(c.height),
  );
  if (usable.length === 0) return null;
  const isVideo = (c) => (c.kind === 'video' ? 0 : 1);
  const rank = (c) => (Number.isFinite(c.rank) ? c.rank : 999);
  usable.sort((a, b) => isVideo(a) - isVideo(b)
    || rank(a) - rank(b)
    || Number(b.width) - Number(a.width));
  return usable[0];
}

/** CC BY / BY-SA 는 표기 의무가 있다. CC0·PD 는 없다 → null. */
export function creditLine(item) {
  if (!item || !licenseUsable(item.license)) return null;
  const l = String(item.license);
  if (/(cc0|pdm|zero|public domain|no known copyright)/i.test(l)) return null;
  const bits = [`"${item.title ?? 'untitled'}"`];
  if (item.author) bits.push(`by ${item.author}`);
  bits.push(`— ${l}`);
  if (item.source) bits.push(`(${item.source})`);
  if (item.pageUrl) bits.push(item.pageUrl);
  return bits.join(' ');
}

/** assets/broll 파일명에서 키워드가 가장 많이 겹치는 클립. 영상 확장자만 본다. */
export function matchLocal(files, terms) {
  const keys = (terms ?? []).map((t) => String(t).toLowerCase()).filter(Boolean);
  if (keys.length === 0) return null;
  let best = null, bestScore = 0;
  for (const f of files ?? []) {
    if (!VIDEO_EXT.test(f)) continue;
    const name = String(f).toLowerCase();
    const score = keys.filter((k) => name.includes(k)).length;
    if (score > bestScore) { best = f; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

// ── 원격 제공자 ──────────────────────────────────────────────────────────────
const UA = 'FlowVium-issue-video/1.0 (https://flowvium.net)';
const j = async (url, headers = {}) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** Openverse — 키 불필요. license_type=commercial 로 서버에서 1차로 거른다. */
export async function searchOpenverse(terms, { limit = 8 } = {}) {
  const q = encodeURIComponent(terms.join(' '));
  const d = await j(`https://api.openverse.org/v1/images/?q=${q}&page_size=${limit}&license=cc0,pdm,by,by-sa&size=large&aspect_ratio=wide&mature=false`);
  return (d?.results ?? []).map((r, i) => ({
    kind: 'image', rank: i, url: r.url, width: r.width, height: r.height,
    license: [r.license, r.license_version].filter(Boolean).join(' '),
    title: r.title, author: r.creator, source: `Openverse/${r.source}`, pageUrl: r.foreign_landing_url,
  }));
}

/** Wikimedia Commons — 키 불필요. 고해상도 원본이 많다. */
export async function searchCommons(terms, { limit = 8 } = {}) {
  const q = encodeURIComponent(terms.join(' '));
  const d = await j(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1920`);
  // Commons 의 generator=search 는 index 로 적합도 순서를 준다. 객체 순회 순서에 기대지 않는다.
  return Object.values(d?.query?.pages ?? []).map((p) => {
    const i = p.imageinfo?.[0] ?? {};
    const meta = i.extmetadata ?? {};
    const strip = (v) => String(v?.value ?? '').replace(/<[^>]*>/g, '').trim() || null;
    return {
      kind: 'image', rank: Number.isFinite(p.index) ? p.index : 999,
      url: i.thumburl ?? i.url, width: i.width, height: i.height,
      license: strip(meta.LicenseShortName), title: p.title?.replace(/^File:/, ''),
      author: strip(meta.Artist), source: 'Wikimedia Commons', pageUrl: i.descriptionurl,
    };
  }).filter((c) => c.url && /\.(jpe?g|png|webp)(\?|$)/i.test(c.url));
}

/** Pexels — 유일한 자동 **동영상** 소스. 키가 없으면 조용히 빈 배열(폴백은 이미지). */
export async function searchPexelsVideo(terms, { limit = 8, apiKey = process.env.PEXELS_API_KEY } = {}) {
  if (!apiKey) return [];
  const q = encodeURIComponent(terms.join(' '));
  const d = await j(`https://api.pexels.com/videos/search?query=${q}&per_page=${limit}&orientation=landscape&size=medium`, { Authorization: apiKey });
  return (d?.videos ?? []).map((v, i) => {
    const f = (v.video_files ?? []).filter((x) => x.width >= 1280 && /mp4/i.test(x.file_type))
      .sort((a, b) => a.width - b.width)[0];
    return f && {
      kind: 'video', rank: i, url: f.link, width: f.width, height: f.height,
      license: 'Pexels License', title: v.url, author: v.user?.name,
      source: 'Pexels', pageUrl: v.url, duration: v.duration,
    };
  }).filter(Boolean);
}

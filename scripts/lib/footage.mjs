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

/**
 * .env.local 에서 값을 읽는다(process.env 우선).
 * 실측(2026-08-27): PEXELS_API_KEY 를 .env.local 에 넣었는데 이 모듈이 process.env 만 봐서
 *   동영상 소스가 **조용히 0건**이었다. 키가 있는데 안 쓰이면 "소스가 없다" 와 구분이 안 된다.
 */
export function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    const m = env.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  } catch { return ''; }
}

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

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
 * 사진이 아니라 그래픽 파일인가.
 *
 * Commons 관행: **사진은 JPEG**, 도형·로고·서명·다이어그램은 **PNG/SVG** 다.
 * 실측(2026-08-27): "Dolly Parton" 질의에 "Dolly Parton Signature.png"(1051x430, 투명 배경)가
 *   1순위로 뽑혀 영상 첫 5초가 통째로 검게 나갔다 — 투명 PNG 는 배경 없이 합성되면 검다.
 *
 * 금지가 아니라 **후순위**다. 사진이 하나도 없으면 그래픽이라도 회색 카드보다 낫다.
 */
export function isGraphicFile(url) {
  return /\.(png|svg|gif|tiff?)(\?|$)/i.test(String(url ?? ''));
}

/**
 * 장면 → 검색 질의들. **실제 대상이 먼저다.**
 *
 * 뉴스 화면은 "그 사건" 이어야 한다. Dolly Parton 부고에 국회의사당을 깔면 뉴스가 아니다.
 * 처음엔 프롬프트에 "사람 이름 쓰지 마라 — 아카이브에 없다" 고 박아뒀는데 **틀렸다.**
 *   실측(2026-08-27): Commons+Openverse 에서 Dolly Parton / Donald Trump / Secret Service 모두
 *   20건씩, **전부 상업 이용 가능 라이선스**로 나온다.
 *
 *   entity — 헤드라인의 실제 대상(인물·기관·장소). 있으면 먼저 쓴다.
 *   visual — 일반 b-roll. entity 로 못 찾았을 때, 그리고 2·3번째 컷을 채울 때 쓴다.
 *
 * 고유명사는 축약·불용어 제거에서 지켜야 하므로 max 를 넉넉히 준다
 * ("United States Secret Service" 를 3단어로 자르면 다른 걸 찾는다).
 */
export function sceneQueries(scene) {
  const out = [];
  const seen = new Set();
  const push = (raw, max) => {
    if (!raw || !String(raw).trim()) return;
    const t = searchTerms({ visual: String(raw) }, { max });
    const key = t.join(' ').toLowerCase();
    if (!t.length || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  // 장소가 먼저다. 실측(2026-08-28): LLM 이 entity 로 "hundreds of missing Americans",
  //   "teen boy" 같은 서술구를 뱉어 네팔 참사 기사인데 "Nepal" 이 어디에도 없었다.
  //   모든 뉴스에는 장소가 있고, 장소야말로 스톡이 **진짜 현지 영상**을 갖고 있는 대상이다
  //   (인물은 모델 스톡뿐이다).
  push(scene?.place, 3);
  push(scene?.entity, 4);
  const vis = searchTerms(scene, { max: 3 });
  const vkey = vis.join(' ').toLowerCase();
  if (vis.length && !seen.has(vkey)) { seen.add(vkey); out.push(vis); }
  return out;
}

/**
 * 넓은 질의 → 좁은 질의 순서. 3단어가 0건이면 2단어, 그것도 0건이면 1단어로 내려간다.
 * 한 번 던지고 포기하면 배경이 전부 카드로 떨어진다(실측: 8장면 전부 카드).
 * 첫 단어는 끝까지 남긴다 — LLM 이 중요한 명사를 앞에 놓기 때문이다.
 */
/**
 * 이 말이 **근거 텍스트에 실제로 있는가.** LLM 이 장면 메타를 지어내면 화면이 통째로 엉뚱해진다.
 *
 * 실측(2026-08-28): 트럼프·연준 기사인데 place 로 "Lake Ontario" 가 나와 토론토 스카이라인이
 *   깔렸다. 헤드라인 어디에도 없는 말이다. 프롬프트로 금지해도 또 나온다 —
 *   **근거에 있는지를 코드가 직접 보는 것**이 유일하게 안 흔들리는 방법이다.
 *
 * 근거 텍스트가 비어 있으면 판단하지 않는다(true) — 판단할 재료가 없는 것과 틀린 것은 다르다.
 */
export function grounded(term, sourceText) {
  const src = String(sourceText ?? '').toLowerCase();
  if (!src.trim()) return true;
  const keys = (String(term ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3);
  if (!keys.length) return false;
  return keys.every((w) => new RegExp(`\\b${w}\\b`).test(src));
}

/**
 * 이 프레임이 **사진이 아니라 그래픽인가** — 로고·차트·타이틀카드.
 *
 * 실측(2026-08-28): 아카이브에서 "Big Brother" 를 물으니 CBS 로고가, "Federal Reserve" 를
 *   물으니 축 글자가 박힌 차트가, 배경으로 화면을 가득 채웠다. 남의 방송사 로고가 우리
 *   화면에 깔리고, 차트는 켄번스로 확대돼 글자가 잘린 채 흐른다.
 *   확장자로 거르던 종전 규칙(png/svg/gif)은 **JPG 로 저장된 로고**를 못 잡는다.
 *
 * 판정 근거는 **평탄면 비율**이다. 로고·차트는 순백/순흑이 화면의 절반 가까이를 차지하고,
 *   사진은 — 흑백 아카이브 사진이라도 — 중간 계조가 대부분이다.
 *   채도로 가르면 흑백 실사가 같이 걸린다(그래서 안 쓴다).
 */
export function flatShare(gray, tol = 8) {
  if (!gray?.length) return 0;
  let n = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    if (v <= tol || v >= 255 - tol) n++;
  }
  return n / gray.length;
}

/**
 * 평탄면이 이 비율을 넘으면 그래픽으로 본다.
 *
 * 임계값은 감이 아니라 실측으로 잡았다(2026-08-28, 렌더된 배경 영역 1320x840 기준):
 *   실사 — 인용카드 .002 · 토론토 .002 · 보스니아 강 .007 · Peter Cullen .037 · 무대 .050 · 연준차트 .064
 *   그래픽 — Disney 로고 .234 · CBS 로고 .694
 * 실사 최대 .064 와 그래픽 최소 .234 사이가 비어 있다. 0.15 는 양쪽에서 2배 남짓 떨어져 있다.
 */
export function isGraphicFrame(share, threshold = 0.15) {
  return Number(share) >= threshold;
}

const PLACE_CACHE = new Map();

/**
 * 이 말이 **지리적 장소인가.** 위키백과 문서에 좌표가 달려 있으면 장소다.
 *
 * 실측(2026-08-28): place 로 "Prison" 이 나왔고, Pexels 에 "Prison" 을 물으니
 *   **주황색 죄수복을 입은 모델이 침상에 누운 연출 영상**이 나왔다. 그게 실존 인물의
 *   사망 기사 화면으로 나갔다 — 시청자는 그를 그 사람으로 읽는다.
 *   금지어 목록으로 막으면 다음번엔 "Courtroom", "Hospital" 이 나온다. 부류를 막아야 한다.
 *
 * 네트워크가 죽으면 null 을 돌려준다 — "장소가 아니다" 와 "모른다" 는 다르고,
 *   모를 때 화면을 통째로 버리면 다시 슬라이드쇼가 된다.
 */
export async function isPlace(term, opts = {}) {
  const { fetchImpl = fetch, timeoutMs = 6000 } = opts;
  const key = String(term ?? '').trim().toLowerCase();
  if (!key) return false;
  if (PLACE_CACHE.has(key)) return PLACE_CACHE.get(key);
  const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1'
    + `&prop=coordinates&titles=${encodeURIComponent(term)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ac.signal, headers: { 'user-agent': 'flowvium-video/1.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    const pages = Object.values(d?.query?.pages ?? {});
    const yes = pages.some((p) => Array.isArray(p?.coordinates) && p.coordinates.length > 0);
    PLACE_CACHE.set(key, yes);
    return yes;
  } catch { return null; } finally { clearTimeout(timer); }
}

export function queryLadder(terms) {
  const t = (terms ?? []).filter(Boolean);
  const out = [];
  for (let n = t.length; n >= 1; n--) out.push(t.slice(0, n));
  return out;
}

/**
 * 제목이 질의어와 겹치는가.
 *
 * 라이선스와 해상도만 보면 "쓸 수 있는 그림" 은 되지만 "그 뉴스의 그림" 은 안 된다.
 * 실측(2026-08-27 채택 목록): "mail truck" 에 Die Post(핀란드) · Postiauto(스위스) ·
 *   AFT227 at Liangxiangximen(중국 버스) 가 걸렸다. 검색엔진은 카테고리·설명으로 맞춘 것이고,
 *   **제목에 질의어가 한 단어도 없으면** 그 주제를 찍은 사진이 아닐 확률이 높다.
 *
 * 부분일치가 아니라 단어 경계로 본다 — 짧은 단어("us")가 "Museum" 안에서 우연히 걸린다.
 * 질의어가 없으면 거르지 않는다(판단 근거가 없는데 버리면 안 된다).
 */
export function titleRelevant(title, terms) {
  const keys = (terms ?? []).map((t) => String(t).toLowerCase()).filter((t) => t.length >= 3);
  if (keys.length === 0) return true;
  const words = new Set(String(title ?? '').toLowerCase().split(/[^a-z0-9\u3131-\uD79D]+/).filter(Boolean));
  return keys.some((k) => words.has(k) || [...words].some((w) => w.length >= 5 && k.length >= 5 && w.startsWith(k)));
}

/**
 * 삽화·도면·지도인가. **자료화면이 아니다** — 뉴스 화면에 넣으면 그림으로 보인다.
 * 실측: "courtroom bench" 에 "Drawing of an overview of the courtroom" 법정 스케치가 채택됐다.
 * 특정 입력을 겨냥한 분기가 아니라 매체 종류 판정이라 모든 후보에 같이 적용한다.
 */
const ART_WORDS = /\b(drawing|sketch|painting|portrait|illustration|engraving|lithograph|etching|map|diagram|chart|blueprint|schematic|logo|icon|emblem|seal|coat of arms|poster|cartoon|comic|woodcut|manuscript|signature|autograph)\b/i;
export function isIllustration(title) {
  return ART_WORDS.test(String(title ?? ''));
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
  const { minWidth = 900, terms = null, allowGraphics = false, preferFree = false } = opts;
  const base = (candidates ?? []).filter(
    (c) => c && c.url && licenseUsable(c.license)
      && Number(c.width) >= minWidth && Number(c.width) > Number(c.height)
      // 서명·로고·도표는 **어떤 배경에서도** 자료화면이 안 된다. 실측(2026-08-27):
      //   "Dolly Parton Signature.png" 를 어두운 배경에 얹으니 검은 잉크가 묻혀 화면이 죽었다.
      //   컷이 하나 줄어드는 게 낫다 — splitShots 가 확보한 그림 수에 맞춰 컷을 정한다.
      && (allowGraphics || !isGraphicFile(c.url)),
  );
  if (base.length === 0) return null;
  const isVideo = (c) => (c.kind === 'video' ? 0 : 1);
  const rank = (c) => (Number.isFinite(c.rank) ? c.rank : 999);
  // preferFree: 표기 의무 없는 소재(CC0·PD)를 앞으로. 금지가 아니라 우선순위다 —
  //   CC0 가 없으면 CC BY 라도 쓰는 게 회색 카드보다 낫다.
  const free = (c) => (preferFree && !attributionFree(c.license) ? 1 : 0);
  const order = (arr) => arr.slice().sort((a, b) => isVideo(a) - isVideo(b)
    || free(a) - free(b)
    || rank(a) - rank(b)
    || Number(b.width) - Number(a.width));

  // 관련성·매체종류로 좁혀 본다. 전부 걸러지면 **차선책으로 되돌린다** —
  //   틀린 사진이라도 회색 카드보다는 화면이 된다. 조용히 카드로 떨어뜨리지 않는다.
  const strict = base.filter((c) => !isIllustration(c.title) && (!terms || titleRelevant(c.title, terms)));
  return order(strict.length ? strict : base)[0];
}

/**
 * 한 장면에 쓸 후보 여러 개. 적합도 순서를 유지하고 **같은 그림을 두 번 쓰지 않는다.**
 *
 * "PPT 같다" 의 정체는 정지 화면 자체가 아니라 **한 화면이 12초 동안 안 바뀌는 것**이다.
 * 실제 뉴스 패키지는 한 나레이션 구간에 서너 컷이 지나간다.
 * 단수 pickFootage 와 같은 정렬을 쓴다 — 두 경로가 갈리면 언젠가 어긋난다.
 */
export function pickFootageMany(candidates, n, opts = {}) {
  const out = [];
  const used = new Set();
  let pool = (candidates ?? []).slice();
  while (out.length < n) {
    const pick = pickFootage(pool.filter((c) => !used.has(c.url)), opts);
    if (!pick) break;
    used.add(pick.url);
    out.push(pick);
    pool = pool.filter((c) => c !== pick);
  }
  return out;
}

/**
 * 장면 길이를 컷으로 나눈다.
 * 너무 짧은 컷은 컷이 아니라 깜빡임이라 minShot 아래로는 쪼개지 않는다.
 * **합은 반드시 원래 길이와 같아야 한다** — 어긋나면 화면이 음성보다 먼저 끝나거나 남는다.
 */
export function splitShots(duration, maxShots, minShot = 3.0) {
  const d = Number(duration) || 0;
  if (d <= 0) return [];
  const n = Math.max(1, Math.min(Math.floor(maxShots), Math.floor(d / minShot) || 1));
  const each = d / n;
  const shots = Array.from({ length: n }, () => each);
  // 부동소수 누적 오차를 마지막 컷이 흡수한다.
  shots[n - 1] = d - each * (n - 1);
  return shots;
}

/**
 * 표기 의무가 없는 라이선스인가(CC0 · Public domain).
 *
 * 이게 중요한 이유가 둘이다:
 *   · 크레딧이 편당 9~12건씩 쌓여 영상 설명란을 채운다.
 *   · CC BY-SA 소재로 2차 생성물을 만들면 **동일조건변경허락이 결과물까지 전파된다** —
 *     Flow 로 움직이게 만든 클립에도 같은 조건이 붙는다.
 */
export function attributionFree(license) {
  const s = String(license ?? '').toLowerCase();
  if (!licenseUsable(license)) return false;
  // 스톡 사이트 자체 라이선스도 표기 의무가 없다(Pexels/Pixabay/Unsplash 모두 명시).
  return /(cc0|pdm|zero|public domain|no known copyright|pexels|pixabay|unsplash)/.test(s)
    || s.split(/[^a-z0-9]+/)[0] === 'pd';
}

/** CC BY / BY-SA 는 표기 의무가 있다. CC0·PD 는 없다 → null. */
export function creditLine(item) {
  if (!item || !licenseUsable(item.license)) return null;
  const l = String(item.license);
  // 판정을 attributionFree 하나로 모은다 — 종전엔 여기와 attributionFree 가 각자 판단해서
  //   Pexels(무의무)에 크레딧이 붙었다. 없는 의무가 쌓이면 진짜 표기 대상이 그 안에 묻힌다.
  if (attributionFree(l)) return null;
  const bits = [`"${item.title ?? 'untitled'}"`];
  if (item.author) bits.push(`by ${item.author}`);
  bits.push(`— ${l}`);
  if (item.source) bits.push(`(${item.source})`);
  if (item.pageUrl) bits.push(item.pageUrl);
  return bits.join(' ');
}

/** assets/broll 파일명에서 키워드가 가장 많이 겹치는 클립. 영상 확장자만 본다. */
export function matchLocal(files, terms) {
  // 2026-08-27 사고: 우편 장면과 트럼프 장면에 us-capitol-dome.mp4(국회의사당)가 깔렸다.
  //   visual "US mail truck" 의 **US**(2글자)가 파일명의 "us-" 에 부분일치한 것이다.
  //   짧은 토막의 부분일치는 아무 데나 걸린다 → 4글자 이상만, 그리고 **단어 경계**로 본다.
  const keys = (terms ?? []).map((t) => String(t).toLowerCase()).filter((t) => t.length >= 4);
  if (keys.length === 0) return null;
  let best = null, bestScore = 0;
  for (const f of files ?? []) {
    if (!VIDEO_EXT.test(f)) continue;
    // 파일명을 단어로 쪼갠다: capitol-dome-night.mp4 → [capitol, dome, night, mp4]
    const words = new Set(String(f).toLowerCase().replace(VIDEO_EXT, '').split(/[^a-z0-9]+/).filter(Boolean));
    const score = keys.filter((k) => words.has(k)).length;
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

/**
 * Pexels 의 여러 화질 중 하나를 고른다.
 *
 * 실측(2026-08-27): 같은 영상이 426x240 / 640x360 / 960x540 / 1280x720 / 1920x1080 /
 *   2560x1440 / 3840x2160 로 온다. **응답 순서가 화질 순이 아니다**(hd→uhd→sd→sd→uhd…).
 *   처음엔 "1280 이상 중 최소" 를 골라 720p 를 집었는데 우리 영상은 1080p 다.
 * 4K 를 통째로 받지는 않는다 — 편당 24컷이면 내려받기가 부담이다.
 */
export function pickVideoFile(files, targetWidth = 1920) {
  const mp4 = (files ?? []).filter((f) => f?.link && /mp4/i.test(String(f.file_type ?? 'mp4')));
  if (mp4.length === 0) return null;
  const exact = mp4.filter((f) => Number(f.width) === targetWidth);
  if (exact.length) return exact.sort((a, b) => Number(b.height) - Number(a.height))[0];
  const above = mp4.filter((f) => Number(f.width) > targetWidth);
  if (above.length) return above.sort((a, b) => Number(a.width) - Number(b.width))[0];
  return mp4.sort((a, b) => Number(b.width) - Number(a.width))[0];
}

/** Pexels — 유일한 자동 **동영상** 소스. 키가 없으면 조용히 빈 배열(폴백은 이미지). */
export async function searchPexelsVideo(terms, { limit = 8, apiKey = envValue('PEXELS_API_KEY') } = {}) {
  if (!apiKey) return [];
  const q = encodeURIComponent(terms.join(' '));
  const d = await j(`https://api.pexels.com/videos/search?query=${q}&per_page=${limit}&orientation=landscape&size=medium`, { Authorization: apiKey });
  return (d?.videos ?? []).map((v, i) => {
    const f = pickVideoFile(v.video_files, 1920);
    return f && {
      kind: 'video', rank: i, url: f.link, width: f.width, height: f.height,
      license: 'Pexels License', title: v.url, author: v.user?.name,
      source: 'Pexels', pageUrl: v.url, duration: v.duration,
    };
  }).filter(Boolean);
}

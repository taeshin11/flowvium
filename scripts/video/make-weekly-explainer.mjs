#!/usr/bin/env node
/**
 * make-weekly-explainer.mjs — 주 1회 4~6분 이슈 해설(가로 롱폼). (2026-10-12) 근거·규칙은 lib/weekly-explainer.test.mjs 머리말.
 *
 * 흐름: 이번 주 쇼츠 → agy 가 '같은 이슈' 묶음 후보 → 코드가 검사·순위(조회 합·기사 수) → 기사 **본문** 수집
 *   → agy 대본(장 5~7개, 기사에 있는 사실만) → 숫자 검사(코드) + 검증 패스(agy, 근거 없는 문장 제거) → 분량 미달이면 중단
 *   → 멜로 음성(쇼츠와 같은 목소리) → 기사 사진(배너·중복 CLIP 거름) → 1920×1080 합성(천천히 움직이는 사진·장 꼬리표·자막)
 *   → 배경음·음량(-14 LUFS) → 썸네일 → 업로드 → 홍보 댓글 → 묶음 쇼츠의 '관련 동영상' 을 이 해설로.
 *
 * 사용: node scripts/video/make-weekly-explainer.mjs [--date 2026-10-12] [--days 7] [--upload private|unlisted|public]
 *        [--keywords 농지,전수조사 --name "농지 전수조사"]   (주제를 사람이 정할 때)  [--script-only]
 *        [--script <앞 회차 script.json>]   (사람이 고친 대본으로 — 관문·검증은 그대로 다시 돈다)
 */
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright';
import { spawnSync, spawn } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync, openSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { ROOT } from '../lib/project-root.mjs';
import { articleLines, dropSharedLines, rankIssues, ungroundedNumbers, hangulNumerals, isEditorial, thumbLineOk, imagePool, scriptBudget, explainerTitle } from '../lib/weekly-explainer.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const kstDay = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const DATE = arg('date', kstDay());
const DAYS = Number(arg('days', 7));
const UPLOAD = arg('upload');
const OUT = resolve(arg('out', join(tmpdir(), 'flowvium-explainer')));
const SCRIPT_ONLY = argv.includes('--script-only');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[explainer]', ...a);
const die = (m) => { log(`❌ ${m} — 이번 주는 올리지 않는다`); process.exit(1); };
const ff = (args, what, timeout = 600_000) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', timeout }); if (r.status !== 0) throw new Error(`${what}: ${String(r.stderr || r.error?.message).slice(-300)}`); };
const probe = (f) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', f], { encoding: 'utf8' }); const s = r.stderr ?? '';
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(s); const v = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(s);
  return { dur: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null, w: v ? +v[1] : 0, h: v ? +v[2] : 0 }; };
const HIST = join(ROOT, 'logs/weekly-explainer.json');
let history = []; try { history = JSON.parse(readFileSync(HIST, 'utf8')); } catch { /* 첫 회 */ }
// 주 1회 — 일요일이 실패·보고서로 밀리면 월요일 칸이 다시 시도한다. 그 주에 이미 올렸으면 둘째 칸은 아무것도 안 한다.
const doneThisWeek = history.find((h) => h.id && h.privacy === 'public' && Date.parse(DATE) - Date.parse(h.date) < 6 * 864e5 && Date.parse(DATE) >= Date.parse(h.date));
if (UPLOAD === 'public' && doneThisWeek) { log(`이번 주 해설은 이미 올렸다(${doneThisWeek.date} ${doneThisWeek.id}) — 건너뜀`); process.exit(0); }

const { openDb } = await import('../lib/db.mjs');
const db = openDb();
const { agyReport } = await import('../lib/agy-report.mjs');
const KO_SRC = ['연합뉴스 정치', '연합뉴스 경제', '연합뉴스 국제', '연합뉴스 사회', '한국경제 정치', '한국경제', '머니투데이'];
const since = `-${DAYS} days`;

// ── 1. 주제: 이번 주 쇼츠에서 여러 편으로 다룬 이슈 ─────────────────────────────
const shorts = db.prepare(`SELECT p.video_id, p.headline, p.headlines_json headlines, p.published_at,
    (SELECT MAX(s.views) FROM shorts_stats s WHERE s.video_id = p.video_id) views
  FROM shorts_published p WHERE p.retracted_at IS NULL AND p.video_id IS NOT NULL
   AND datetime(p.published_at) >= datetime(?, '+15 hours', ?) AND datetime(p.published_at) < datetime(?, '+15 hours')`)
  .all(DATE, since, DATE);   // KST 자정 = UTC 15시 전날 — DATE 하루 끝까지
if (shorts.length < 10) die(`이번 주 쇼츠 ${shorts.length}편 — 묶을 것이 모자라다`);
const artCount = (kws) => db.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT date(datetime(captured_at, '+9 hours'))) days FROM news_archive WHERE source IN (${KO_SRC.map(() => '?').join(',')})
   AND datetime(captured_at) >= datetime(?, '+15 hours', ?) AND (${kws.map(() => 'headline LIKE ?').join(' OR ')})`)
  .get(...KO_SRC, DATE, since, ...kws.map((k) => `%${k}%`));
const recentKws = history.filter((h) => Date.parse(h.date) > Date.parse(DATE) - 28 * 864e5).flatMap((h) => h.keywords ?? []);
// --script: 사람이 눈검증하며 고친 대본(10/12 첫 회 — 보고서 제목 오기 한 문장). 주제·기사 목록·장 구성을 그대로 쓰되 관문은 다시 돈다.
const GIVEN = arg('script') ? JSON.parse(readFileSync(arg('script'), 'utf8')) : null;
let issue;
if (GIVEN) {
  issue = GIVEN.issue;
} else if (arg('keywords')) {
  const kws = arg('keywords').split(',').map((x) => x.trim()).filter(Boolean);
  const ids = shorts.filter((s) => kws.some((k) => `${s.headline}${s.headlines}`.includes(k))).map((s) => s.video_id);
  issue = { name: arg('name', kws[0]), keywords: kws, shortIds: ids, views: 0, articles: artCount(kws).n };
} else {
  const list = shorts.map((s) => { let hs = []; try { hs = JSON.parse(s.headlines ?? '[]'); } catch { /* 없음 */ }
    return `${s.video_id}|${s.views ?? 0}|${s.headline}${hs.length > 1 ? ` (같은 편: ${hs.slice(1, 4).join(' / ')})` : ''}`; }).join('\n');
  const raw = await agyReport([
    `아래는 한국 뉴스 유튜브 채널의 최근 ${DAYS}일 쇼츠 목록이다(영상id|조회수|제목).`,
    '**같은 진행 중인 이슈**(같은 정책·사건·논쟁)를 다룬 쇼츠 묶음을 최대 8개 찾아라.',
    'keywords 는 그 이슈의 **핵심 낱말 하나**(필요하면 같은 뜻의 표기 하나 더). 그 묶음 쇼츠 제목에 그대로 들어 있어야 하고, 이 낱말로 한 주 기사를 검색해 이 이슈 기사를 빠짐없이 모은다.',
    '  너무 좁으면 기사를 놓친다("농지조사" 보다 "농지"), 너무 넓으면 딴 기사가 섞인다("대통령·정부·국힘·민주·수출·연내" 같은 말 금지).',
    '한 주 동안 기사가 여러 날 이어진 이슈를 찾는 것이 목적이다. 쇼츠 1편만 다뤘어도 그런 이슈면 후보다(2편 이상이면 더 좋다).',
    '4~6분 해설 영상으로 배경·쟁점·전망을 풀 수 있는 이슈를 우선하라(단발 사고·시세 마감은 피한다).', '', list].join('\n'),
  { label: 'explainer-pick', timeoutMs: 240_000,
    schema: { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } }, shortIds: { type: 'array', items: { type: 'string' } } },
    required: ['name', 'keywords', 'shortIds'] } } }, required: ['issues'] } });
  let cands = []; try { cands = JSON.parse(raw).issues ?? []; } catch { die('주제 후보를 못 받았다(agy)'); }
  for (const c of cands) {   // 탈락 사유를 볼 수 있게 — 후보가 다 떨어지면 왜인지 알아야 고친다
    const hit = (c.shortIds ?? []).filter((id) => shorts.some((s) => s.video_id === id && (c.keywords ?? []).some((k) => `${s.headline}${s.headlines}`.includes(k))));
    log(`[주제] agy 후보 "${c.name}" kw=${(c.keywords ?? []).join(',')} · 쇼츠 ${c.shortIds?.length ?? 0}편 중 키워드 맞는 ${hit.length}편 · 기사 ${(c.keywords ?? []).length ? `${artCount(c.keywords).n}건 ${artCount(c.keywords).days}일` : 0}`);
  }
  const ranked = rankIssues(cands, shorts, artCount, { minShorts: 1, minArticles: 15, minDays: 4 })
    .filter((c) => !c.keywords.some((k) => recentKws.includes(k)));   // 최근 4주에 다룬 이슈는 다시 안 고른다
  for (const c of ranked) log(`[주제] 통과 ${c.name} · 쇼츠 ${c.shortIds.length}편 조회 ${c.views} · 기사 ${c.articles}건 ${c.days}일 · ${c.keywords.join(',')}`);
  if (!ranked.length) die(`쓸 만한 묶음이 없다(후보 ${cands.length}개 모두 탈락)`);
  issue = ranked[0];
}
log(`[주제] "${issue.name}" — 쇼츠 ${issue.shortIds.length}편 · 기사 ${issue.articles}건`);

// ── 2. 기사 본문 ─────────────────────────────────────────────────────────────────
const rows = db.prepare(`SELECT source, headline, link, captured_at FROM news_archive WHERE source IN (${KO_SRC.map(() => '?').join(',')})
   AND datetime(captured_at) >= datetime(?, '+15 hours', ?) AND (${issue.keywords.map(() => 'headline LIKE ?').join(' OR ')}) ORDER BY captured_at`)
  .all(...KO_SRC, DATE, since, ...issue.keywords.map((k) => `%${k}%`));
const seenHead = new Set();
const uniq = rows.filter((r) => { const k = r.headline.replace(/\s/g, '').slice(0, 12); if (seenHead.has(k) || !r.link) return false; seenHead.add(k); return true; });
// 고르게: 주 전체에 걸쳐 최대 24건(경위가 보이게), 가져온 뒤 본문 있는 것만.
const pickN = 24; const step = Math.max(1, uniq.length / pickN);
const want = GIVEN ? GIVEN.docs : Array.from({ length: Math.min(pickN, uniq.length) }, (_, i) => uniq[Math.floor(i * step)]);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const fetched = [];
for (let i = 0; i < want.length; i += 4) {
  fetched.push(...await Promise.all(want.slice(i, i + 4).map(async (r) => {
    try { const res = await fetch(r.link, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
      return { ...r, lines: res.ok ? articleLines((await res.text()).slice(0, 600_000)) : [] }; } catch { return { ...r, lines: [] }; }
  })));
}
const cleaned = dropSharedLines(fetched.map((d) => d.lines));
// 주어진 대본은 장마다 기사 번호(sources)를 들고 있다 — 거르면 번호가 밀린다. 순서를 그대로 둔다.
const docs0 = fetched.map((d, i) => ({ ...d, text: cleaned[i].join(' ').slice(0, 1800) }));
const docs = GIVEN ? docs0 : docs0.filter((d) => d.text.length >= 300).slice(0, 16);
log(`[기사] ${rows.length}건 중 ${want.length}건 받음 → 본문 있는 ${docs.length}건`);
if (docs.length < 6) die(`본문을 확보한 기사가 ${docs.length}건 — 5분 해설의 근거가 모자라다`);
const CORPUS = docs.map((d) => `${d.headline} ${d.text}`).join('\n');
const day = (s) => { const t = new Date(Date.parse(`${String(s).replace(' ', 'T')}Z`) + 9 * 3600e3); return `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일`; };

// ── 3. 대본 ─────────────────────────────────────────────────────────────────────
const B = scriptBudget();
const SCRIPT_SCHEMA = { type: 'object', properties: {
  title: { type: 'string' }, thumb1: { type: 'string' }, thumb2: { type: 'string' },
  chapters: { type: 'array', items: { type: 'object', properties: {
    heading: { type: 'string' }, sentences: { type: 'array', items: { type: 'string' } }, sources: { type: 'array', items: { type: 'integer' } } },
  required: ['heading', 'sentences', 'sources'] } } }, required: ['title', 'thumb1', 'thumb2', 'chapters'] };
const scriptPrompt = [
  `너는 한국 뉴스 해설 유튜브의 대본 작가다. 이번 주 이슈 "${issue.name}" 을 4~6분 해설로 쓴다.`,
  '근거는 아래 기사 본문뿐이다. **기사에 없는 사실·숫자·인물·발언·전망을 쓰지 마라.** 숫자는 기사에 적힌 그대로 옮긴다.',
  '기사 중 이 이슈와 직접 관련 없는 것은 쓰지 마라.', '',
  '구성(장 5~7개, heading 은 14자 이내):',
  ' 1장 오프닝 — 첫 문장은 시청자가 궁금해할 질문이나 이해관계로 연다("~까요?" 허용). 둘째 문장부터 이번 영상이 무엇을 풀지 단정형으로.',
  ' 그다음 — 무슨 일인가 / 어떻게 여기까지 왔나(날짜 순 경위) / 쟁점과 각 측 입장(양쪽을 같은 무게로) / 숫자로 보기 / 앞으로 일정·남은 문제 / 정리.',
  '문장 규칙: 합니다체. 한 문장 25~60자. 각 문장은 "니다." 나 "니까?" 등 완결된 말로 끝낸다. 괄호·따옴표 안 인용은 짧게.',
  '"여러분" "충격" "경악" 금지. 기자 이름·매체 서명 읽지 마라. "화면" "영상" 같은 화면 지시어 금지. 투자 권유 금지.',
  '숫자·날짜는 아라비아 숫자로 쓴다("7일", "5월", "37.4%"). "칠일"·"오월" 처럼 한글로 쓰지 마라.',
  '"여당·야당·여권·야권" 이라고 쓰지 말고 기사에 적힌 정당·인물 이름을 그대로 써라(누가 여당인지 네 기억으로 정하지 마라).',
  '채널의 의견을 쓰지 마라 — "~해야 합니다", "기대합니다", "필요합니다" 같은 당위·기대는 그 말을 한 사람·기관을 밝혀 옮길 때만("…해야 한다고 촉구했습니다").',
  '마지막 장 "정리" 는 앞 장의 사실을 짧게 다시 묶고, 앞으로 지켜볼 일정(기사에 있는 것)으로 끝낸다.',
  `분량: 모든 문장 합계 ${B.min}~${B.max}자(목표 ${B.target}자). 모자라면 기사의 구체 사실(날짜·수치·발언)을 더 옮겨라.`,
  'sources 는 그 장에서 쓴 기사 번호들. title 은 시청자가 궁금해할 이 이슈의 핵심을 묻는 한 줄(45자 이내, 기사에 있는 말로).',
  '  title 에 한쪽 정당·인물의 비난·구호를 채널의 질문처럼 쓰지 마라(예: 피켓 문구). 무엇이 바뀌고 누구에게 영향이 있는지를 묻는다.',
  'thumb1·thumb2 는 썸네일 큰 글 두 줄 — 각각 그 자체로 끝나는 명사구(2~8자, 기사에 있는 낱말). 조사·"및" 으로 끝내지 마라.', '',
  ...docs.map((d, i) => `[${i}] ${day(d.captured_at)} · ${d.source} · ${d.headline}\n${d.text}`),
].join('\n');
let script = GIVEN ? { title: GIVEN.hook ?? String(GIVEN.title).replace(/ \| \d+월 \d+일 이번 주 이슈 해설$/, ''), thumb1: GIVEN.thumb?.[0], thumb2: GIVEN.thumb?.[1], chapters: GIVEN.chapters } : null;
for (let attempt = 1; attempt <= 2 && !script; attempt++) {
  const raw = await agyReport(scriptPrompt, { label: 'explainer-script', timeoutMs: 420_000, schema: SCRIPT_SCHEMA });
  try { const j = JSON.parse(raw); if (Array.isArray(j.chapters) && j.chapters.length >= 4) script = j; } catch { /* 다시 */ }
  if (!script) log(`[대본] ${attempt}회차 형식 불량 — ${attempt < 2 ? '다시 묻는다' : '포기'}`);
}
if (!script) die('대본을 못 받았다');
const END = /(니다|니까|세요|까요)[.?!]?["”’)]*$/;
let chapters = script.chapters.map((c) => ({ heading: String(c.heading).trim().slice(0, 16), sources: (c.sources ?? []).filter((n) => docs[n]),
  sentences: (c.sentences ?? []).map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean) }));
const total = () => chapters.reduce((a, c) => a + c.sentences.join('').length, 0);
log(`[대본] 장 ${chapters.length}개 · ${chapters.reduce((a, c) => a + c.sentences.length, 0)}문장 · ${total()}자`);

// 관문 ① 숫자 — 근거에 없는 숫자가 든 문장은 뺀다. ② 끝맺음.
for (const c of chapters) c.sentences = c.sentences.filter((s) => {
  const bad = ungroundedNumbers(s, CORPUS);
  if (bad.length) { log(`[검사] 숫자 근거 없음(${bad.join(',')}) — 뺀다: ${s.slice(0, 50)}`); return false; }
  const hn = hangulNumerals(s);
  if (hn.length) { log(`[검사] 숫자를 한글로 씀(${hn.join(',')}) — 뺀다: ${s.slice(0, 50)}`); return false; }
  if (isEditorial(s)) { log(`[검사] 출처 없는 당위·기대 — 뺀다: ${s.slice(0, 50)}`); return false; }
  if (!END.test(s)) { log(`[검사] 끝맺음 아님 — 뺀다: ${s.slice(0, 50)}`); return false; }
  return true;
});
// 관문 ③ 검증 패스 — 문장마다 근거가 기사에 있는지 agy 가 판정한다. 판정을 못 받으면 올리지 않는다.
async function verifySentences() {
  const flat = chapters.flatMap((c, ci) => c.sentences.map((s, si) => ({ ci, si, s })));
  const raw = await agyReport([
    '아래 "문장" 각각이 "기사" 본문으로 뒷받침되는지 판정하라. 기사에 없는 사실·숫자·인물·발언·인과·전망을 담은 문장, 기사 내용을 틀리게 옮긴 문장의 번호를 unsupported 에 넣어라.',
    '오프닝의 질문 문장과 "이번 영상에서 ~를 짚어 봅니다" 같은 안내 문장은 사실 주장이 아니므로 통과다. 기사 내용을 요약·재진술한 것은 통과다.',
    '누가 한 말·행동인지(정당·인물·기관)를 기사와 다르게 붙인 문장, 주체 없이 채널이 의견·당위를 말하는 문장도 unsupported 다.', '',
    '## 문장', ...flat.map((x, i) => `${i}: ${x.s}`), '', '## 기사', ...docs.map((d, i) => `[${i}] ${d.headline}\n${d.text}`)].join('\n'),
  { label: 'explainer-verify', timeoutMs: 300_000, schema: { type: 'object', properties: {
    unsupported: { type: 'array', items: { type: 'integer' } }, reasons: { type: 'array', items: { type: 'string' } } }, required: ['unsupported'] } });
  let j; try { j = JSON.parse(raw); } catch { return null; }
  const drop = new Set((j.unsupported ?? []).filter((n) => Number.isInteger(n) && flat[n]));
  [...drop].forEach((n, k) => log(`[검증] 근거 없음 — 뺀다: ${flat[n].s.slice(0, 60)}${j.reasons?.[k] ? ` (${String(j.reasons[k]).slice(0, 60)})` : ''}`));
  return flat.filter((_, i) => !drop.has(i));
}
const kept = await verifySentences();
if (!kept) die('검증 패스 응답을 못 받았다 — 검증 안 된 해설은 올리지 않는다');
chapters = chapters.map((c, ci) => ({ ...c, sentences: kept.filter((x) => x.ci === ci).map((x) => x.s) })).filter((c) => c.sentences.length >= 2);
log(`[대본] 관문 뒤 장 ${chapters.length}개 · ${total()}자 (하한 ${B.min})`);
if (chapters.length < 4 || total() < B.min) die(`관문 뒤 분량 ${total()}자 · 장 ${chapters.length}개 — 4분이 안 된다`);
const title = explainerTitle({ headline: ungroundedNumbers(script.title, CORPUS).length ? issue.name : script.title, date: DATE });
// 썸네일 글 — 기사·대본에 실제로 있는 말만. 아니면 장 제목.
const inText = (w) => thumbLineOk(w) && `${CORPUS}${chapters.map((c) => c.sentences.join('')).join('')}`.replace(/\s/g, '').includes(w.replace(/\s/g, ''));
const fallbackThumb = [issue.keywords[0], ...chapters.map((c) => c.heading)].filter(thumbLineOk);
const thumb = inText(script.thumb1) && inText(script.thumb2) ? [script.thumb1, script.thumb2] : [fallbackThumb[0] ?? issue.keywords[0], fallbackThumb[1] ?? ''];
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'script.json'), JSON.stringify({ issue, title, hook: script.title, thumb, chapters, docs: docs.map((d) => ({ source: d.source, headline: d.headline, link: d.link })) }, null, 2));
log(`[대본] 제목 "${title}" · 썸네일 ${thumb.join(' / ')} → ${join(OUT, 'script.json')}`);
if (SCRIPT_ONLY) process.exit(0);

// ── 4. 음성 — 쇼츠와 같은 목소리(멜로). 숫자·약어 한글 읽기와 귀검증은 synthesizeKoreanAuto 가 한다.
const { synthesizeKoreanAuto } = await import('../lib/tts-korean.mjs');
const sents = chapters.flatMap((c, ci) => c.sentences.map((s) => ({ ci, s })));
const voice = synthesizeKoreanAuto(sents.map((x) => x.s), { outPrefix: join(OUT, 'v'), log: (m) => log(`[음성] ${m}`) });
sents.forEach((x, i) => { x.audio = voice[i].path; x.dur = voice[i].durationSec; x.alignment = voice[i].alignment; });
const speech = sents.reduce((a, x) => a + x.dur, 0);
log(`[음성] ${sents.length}문장 ${speech.toFixed(0)}초`);
if (speech < 220) die(`낭독 ${speech.toFixed(0)}초 — 4분이 안 된다`);

// ── 5. 사진 — 이 이슈 기사들의 대표 사진. 배너·로고·같은 사진은 거른다.
const { articleImage, isBrandImage } = await import('../lib/article-image.mjs');
const { isRealFootage } = await import('../lib/footage.mjs');
const { clipCheck, clipDuplicates } = await import('../lib/clip-gate.mjs');
const imgs = [];
const imgLinks = imagePool(docs.map((d, i) => ({ link: d.link, doc: i })), chapters);
for (let i = 0; i < imgLinks.length; i += 4) {
  const got = await Promise.all(imgLinks.slice(i, i + 4).map(async (x) => ({ ...x, img: await articleImage(x.link) })));
  for (const g of got) {
    if (!g.img || isBrandImage(g.img.url) || !isRealFootage(g.img) || imgs.some((m) => m.url === g.img.url)) continue;
    const f = join(OUT, `img${imgs.length}.jpg`);
    try {
      const res = await fetch(g.img.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      const p = probe(f);
      if (p.w < 640 || p.h < 360) continue;   // 작은 사진은 1920 으로 키우면 뭉개진다
      imgs.push({ url: g.img.url, file: f, source: g.img.source, doc: g.doc });
    } catch { /* 다음 사진 */ }
  }
}
{
  const banner = clipCheck(imgs.map((m) => ({ image: m.file })), issue.name).filter((v) => (v.formDecoy ?? 0) >= 0.2).map((v) => v.index);
  const dup = clipDuplicates(imgs.map((m) => m.file));
  const drop = new Set([...banner, ...dup]);
  if (drop.size) log(`[사진] 배너 ${banner.length} · 같은 사진 ${dup.length} 장 뺀다`);
  for (const i of [...drop].sort((a, b) => b - a)) imgs.splice(i, 1);
}
log(`[사진] ${imgs.length}장`);
if (imgs.length < 6) die(`쓸 사진 ${imgs.length}장 — 5분을 정지 화면으로 채울 수 없다`);

// 사진 배정 — 두 문장(약 8~10초)마다 바꾼다. 그 장의 기사 사진을 먼저, 없으면 전체에서 돌린다. 바로 앞과 같은 사진은 피한다.
const segs = []; let last = null; const useCount = new Map();
for (let ci = 0; ci < chapters.length; ci++) {
  const ss = sents.filter((x) => x.ci === ci);
  const own = imgs.filter((m) => chapters[ci].sources.includes(m.doc));
  for (let k = 0; k < ss.length; k += 2) {
    const pool = [...own, ...imgs].filter((m) => m !== last);
    const m = pool.sort((a, b) => (useCount.get(a) ?? 0) - (useCount.get(b) ?? 0))[0];
    useCount.set(m, (useCount.get(m) ?? 0) + 1); last = m;
    segs.push({ ci, first: k === 0, sents: ss.slice(k, k + 2), img: m });
  }
}

// ── 6. 화면 겹침(장 꼬리표·출처·장 시작 큰 제목) + 끝 카드 ─────────────────────────
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const [, M, D] = DATE.split('-').map(Number);
const CSS = `*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;background:transparent;font-family:'Apple SD Gothic Neo',sans-serif;position:relative;overflow:hidden}
.tag{position:absolute;left:56px;top:48px;display:flex;gap:14px;align-items:center;font-size:34px;font-weight:800;color:#fff;background:rgba(6,9,15,.78);padding:12px 22px;border-radius:12px}
.tag b{color:#06090f;background:#ffd400;border-radius:8px;padding:2px 12px}.wm{position:absolute;right:56px;top:56px;font-size:28px;font-weight:900;letter-spacing:3px;color:rgba(255,255,255,.85)}
.cr{position:absolute;right:40px;bottom:250px;font-size:22px;color:rgba(255,255,255,.8);text-shadow:0 0 6px #000}
.shade{position:absolute;left:0;right:0;bottom:0;height:330px;background:linear-gradient(0deg,rgba(0,0,0,.72),rgba(0,0,0,0))}
.big{position:absolute;left:56px;top:150px;max-width:1500px;font-size:96px;font-weight:900;color:#fff;-webkit-text-stroke:4px #000;paint-order:stroke fill;line-height:1.1}
.big span{display:block;font-size:44px;color:#ffd400;-webkit-text-stroke:2px #000;margin-bottom:12px}`;
const ovHtml = (s) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="shade"></div>
<div class="tag"><b>${s.ci + 1}</b>${esc(chapters[s.ci].heading)}</div><div class="wm">FLOWVIUM</div><div class="cr">사진: ${esc(s.img.source)}</div>`;
const bigHtml = (s) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="big"><span>${s.ci === 0 ? `${M}월 ${D}일 이번 주 이슈 해설` : `${s.ci + 1}장`}</span>${esc(s.ci === 0 ? issue.name : chapters[s.ci].heading)}</div>`;
const outroHtml = `<!doctype html><meta charset="utf-8"><style>*{margin:0}body{width:1920px;height:1080px;background:#06090f;font-family:'Apple SD Gothic Neo',sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;text-align:center}
.t{font-size:92px;font-weight:900}.t span{color:#ffd400}.s{font-size:44px;color:#cbd5e1;margin-top:30px}</style>
<div class="t">매주 한 이슈, <span>끝까지 풀어 드립니다</span></div><div class="s">구독하시면 다음 주 해설도 받아 보실 수 있습니다 · flowvium.net</div>`;
const br = await chromium.launch({ headless: true });
const pg = await br.newPage({ viewport: { width: 1920, height: 1080 } });
const shot = async (html, f, transparent = true) => { await pg.setContent(html); await pg.waitForTimeout(120); await pg.screenshot({ path: f, omitBackground: transparent }); };
for (const [k, s] of segs.entries()) { await shot(ovHtml(s), join(OUT, `ov${k}.png`)); if (s.first) await shot(bigHtml(s), join(OUT, `big${k}.png`)); }
await shot(outroHtml, join(OUT, 'outro.png'), false);
await br.close();

// ── 7. 조각 합성 — 사진은 1.12배로 키워 천천히 가로지른다(줌팬보다 가볍고 떨림이 없다). 블러 채우기 없음.
const { cuesFromAlignment, toAss } = await import('../lib/subtitle.mjs');
const parts = []; const cues = []; let t = 0;
for (const [k, s] of segs.entries()) {
  const wav = join(OUT, `a${k}.wav`);
  const gap = 0.35;   // 문장 사이 숨
  const inputs = s.sents.flatMap((x) => ['-i', x.audio]);
  const filt = s.sents.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${gap}[s${i}]`).join(';')
    + `;${s.sents.map((_, i) => `[s${i}]`).join('')}concat=n=${s.sents.length}:v=0:a=1[a]`;
  ff([...inputs, '-filter_complex', filt, '-map', '[a]', wav], `음성 이어붙이기 ${k}`);
  let off = t;
  for (const x of s.sents) { cues.push(...cuesFromAlignment(x.alignment, { maxChars: 30, maxLines: 1, maxDur: 3.2, offset: off })); off += x.dur + gap; }
  const d = probe(wav).dur;
  const dir = k % 4;   // 왼→오 / 오→왼 / 위→아래 / 아래→위
  const X = dir === 0 ? `(iw-1920)*t/${d.toFixed(2)}` : dir === 1 ? `(iw-1920)*(1-t/${d.toFixed(2)})` : '(iw-1920)/2';
  const Y = dir === 2 ? `(ih-1080)*t/${d.toFixed(2)}` : dir === 3 ? `(ih-1080)*(1-t/${d.toFixed(2)})` : '(ih-1080)/2';
  const out = join(OUT, `p${k}.mp4`);
  const big = s.first ? ['-i', join(OUT, `big${k}.png`)] : [];
  ff(['-loop', '1', '-i', s.img.file, '-i', join(OUT, `ov${k}.png`), ...big, '-i', wav,
    '-filter_complex', `[0:v]scale=2150:1210:force_original_aspect_ratio=increase,crop=2150:1210,crop=1920:1080:x='${X}':y='${Y}',fps=30[bg];[bg][1:v]overlay=0:0[o1]`
      + (s.first ? `;[o1][2:v]overlay=0:0:enable='lt(t,3.2)',format=yuv420p[v]` : ';[o1]format=yuv420p[v]'),
    '-map', '[v]', '-map', `${s.first ? 3 : 2}:a`, '-t', d.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', out], `조각 ${k}`);
  parts.push(out); t += probe(out).dur;
}
ff(['-loop', '1', '-t', '6', '-i', join(OUT, 'outro.png'), '-f', 'lavfi', '-t', '6', '-i', 'anullsrc=r=44100:cl=mono',
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '160k', '-shortest', join(OUT, 'p_outro.mp4')], '끝 카드');
parts.push(join(OUT, 'p_outro.mp4'));
writeFileSync(join(OUT, 'list.txt'), parts.map((p) => `file '${p}'`).join('\n'));
const JOINED = join(OUT, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', join(OUT, 'list.txt'), '-c', 'copy', JOINED], '이어 붙이기');
writeFileSync(join(OUT, 'subs.ass'), toAss(cues, { font: 'Apple SD Gothic Neo', fontSize: 58, marginV: 70, playResX: 1920, playResY: 1080 }));

// ── 8. 자막 굽기 + 배경음(쇼츠와 같은 방식: loudnorm 뒤 목소리 대역 깎고 더킹) + 최종 음량 -14 LUFS
const SUBBED = join(OUT, 'subbed.mp4');
const beds = (() => { try { return readdirSync(join(ROOT, 'assets/bgm')).filter((f) => /\.(wav|mp3|m4a)$/i.test(f)).sort(); } catch { return []; } })();
const week = Math.floor(Date.parse(DATE) / (7 * 864e5));
const subFilter = `subtitles=${join(OUT, 'subs.ass').replace(/:/g, '\\:')}`;
if (beds.length) {
  ff(['-i', JOINED, '-stream_loop', '-1', '-i', join(ROOT, 'assets/bgm', beds[week % beds.length]), '-filter_complex',
    `[0:v]${subFilter}[v];[1:a]loudnorm=I=-24:TP=-2:LRA=7,equalizer=f=900:t=q:w=1.6:g=-6,equalizer=f=2200:t=q:w=1.6:g=-5,highpass=f=70,lowpass=f=9000[bed];`
    + '[0:a]asplit=2[v1][v2];[bed][v2]sidechaincompress=threshold=0.10:ratio=4:attack=20:release=400[duck];[v1][duck]amix=inputs=2:duration=first:dropout_transition=0:weights=1 1,alimiter=limit=0.95[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', SUBBED], '자막·배경음', 1_500_000);
  log(`[소리] 배경음 ${beds[week % beds.length]}`);
} else {
  ff(['-i', JOINED, '-vf', subFilter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', SUBBED], '자막', 1_500_000);
}
const FINAL = join(OUT, 'explainer.mp4');
{
  const { measure, normalize } = await import('../lib/loudness.mjs');
  const r = normalize(SUBBED, FINAL, -14, { extraOut: ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] });
  const after = r.ok ? measure(['-i', FINAL]) : null;
  if (r.ok && after && Math.abs(after.I - -14) <= 1.5) log(`[소리] ${r.before.toFixed(1)} → ${after.I.toFixed(1)} LUFS`);
  else { log(`[소리] ⚠ 음량 맞추기 실패 — 원래 크기로: ${r.reason ?? after?.I}`); copyFileSync(SUBBED, FINAL); }
}
const LEN = probe(FINAL).dur;
log(`✅ ${FINAL} · ${(LEN / 60).toFixed(1)}분`);
if (!(LEN >= 240 && LEN <= 400)) die(`길이 ${LEN?.toFixed(0)}초 — 4~6분 밖`);

// ── 9. 썸네일 · 설명 ─────────────────────────────────────────────────────────────
const timeline = []; { let acc = 0; for (const [k, s] of segs.entries()) { if (s.first) timeline.push({ title: chapters[s.ci].heading, start: Math.round(acc) }); acc += probe(parts[k]).dur; } }
const { chapterLines } = await import('../lib/roundup.mjs');
const { trackedUrl } = await import('../lib/site-link.mjs');
const description = [`${chapters[0].sentences.slice(0, 2).join(' ')}`, '',
  ...chapterLines(timeline), '',
  `이번 주 관련 쇼츠: ${issue.shortIds.map((id) => `https://youtube.com/shorts/${id}`).join(' ')}`, '',
  `📈 매일 AI 투자 리포트(무료): ${trackedUrl({ source: 'youtube', medium: 'explainer', campaign: DATE })}`, '',
  '참고 기사:', ...docs.slice(0, 12).map((d) => `· ${d.source} — ${d.headline} ${d.link}`), '',
  '※ 기사 내용을 정리한 해설이며 특정 종목의 매수·매도 권유가 아닙니다.', `#이슈해설 #${issue.keywords[0].replace(/\s/g, '')} #뉴스 #Flowvium`].join('\n').slice(0, 4900);
const THUMB = join(OUT, 'thumb.jpg');
{
  const tb = await chromium.launch({ headless: true }); const tp = await tb.newPage({ viewport: { width: 1280, height: 720 } });
  const pic = segs[0].img.file;
  await tp.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0}body{width:1280px;height:720px;background:#06090f;font-family:'Apple SD Gothic Neo',sans-serif;position:relative;overflow:hidden}
img{position:absolute;right:0;top:0;width:660px;height:720px;object-fit:cover}.g{position:absolute;right:560px;top:0;width:160px;height:720px;background:linear-gradient(90deg,#06090f,rgba(6,9,15,0))}
.t{position:absolute;left:52px;top:120px;width:640px;font-weight:900;line-height:1.08}
.a{font-size:120px;color:#ffd400;-webkit-text-stroke:5px #000;paint-order:stroke fill;white-space:nowrap}.b{font-size:120px;color:#fff;-webkit-text-stroke:5px #000;paint-order:stroke fill;white-space:nowrap;margin-top:10px}
.d{position:absolute;left:52px;bottom:52px;font-size:38px;font-weight:800;color:#06090f;background:#ffd400;padding:8px 18px;border-radius:8px}</style>
<img src="data:image/jpeg;base64,${readFileSync(pic).toString('base64')}"><div class="g"></div>
<div class="t"><div class="a">${esc(thumb[0])}</div><div class="b">${esc(thumb[1])}</div></div><div class="d">이번 주 이슈 해설 · ${Math.round(LEN / 60)}분</div>`);
  await tp.evaluate(() => { for (const el of document.querySelectorAll('.a,.b')) { let f = parseFloat(getComputedStyle(el).fontSize); while (el.scrollWidth > 640 && f > 48) { f -= 4; el.style.fontSize = `${f}px`; } } });
  await tp.screenshot({ path: THUMB, type: 'jpeg', quality: 88 }); await tb.close();
}
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ date: DATE, title, description, seconds: LEN, issue }, null, 2));
log(`[메타] "${title}"`);

// ── 10. 올리기 · 홍보 댓글 · 쇼츠 → 해설 관련 동영상 ─────────────────────────────────
if (UPLOAD) {
  const { upload, setThumbnail, currentChannel, channelMismatch } = await import('../lib/youtube.mjs');
  const { loadEnvLocal } = await import('../lib/llm-config.mjs'); loadEnvLocal();
  const bad = channelMismatch(await currentChannel(), process.env.YOUTUBE_CHANNEL_ID);
  if (bad) die(bad);
  const u = await upload({ file: FINAL, title, description, tags: ['이슈해설', '뉴스해설', ...issue.keywords, '뉴스', 'Flowvium'].slice(0, 12), privacy: UPLOAD });
  const th = await setThumbnail(u.id, THUMB);
  log(`✅ 올림 ${u.url} (${UPLOAD}) · 썸네일 ${th.ok ? '적용' : `실패 ${th.reason}`}`);
  history.push({ date: DATE, id: u.id, privacy: UPLOAD, title, name: issue.name, keywords: issue.keywords, shortIds: issue.shortIds, seconds: Math.round(LEN), at: new Date().toISOString() });
  writeFileSync(HIST, JSON.stringify(history, null, 2));
  if (UPLOAD === 'public') {
    const out = openSync(join(ROOT, 'logs/pin-comment.log'), 'a');
    spawn(process.execPath, [join(ROOT, 'scripts/yt-pin-comment.mjs'), '--ids', u.id, '--kind', 'long', '--then-verify', '600'], { detached: true, stdio: ['ignore', out, out] }).unref();
    // 묶음 쇼츠의 '관련 동영상' 을 이 해설로 — 쇼츠 화면에서 눌리는 유일한 링크다(yt-related-video 머리말).
    //   빈 --ids 를 넘기면 yt-related-video 가 '최근 상위 40편' 으로 넓어진다 — 묶음이 없으면 걸지 않는다.
    const rel = openSync(join(ROOT, 'logs/related-explainer.log'), 'a');
    if (issue.shortIds.length) spawn(process.execPath, [join(ROOT, 'scripts/yt-related-video.mjs'), '--target', u.id, '--match', title.slice(0, 14), '--ids', issue.shortIds.join(',')], { detached: true, stdio: ['ignore', rel, rel] }).unref();
    log(`홍보 댓글 → logs/pin-comment.log · 쇼츠 ${issue.shortIds.length}편 관련 동영상 → logs/related-explainer.log`);
  }
}

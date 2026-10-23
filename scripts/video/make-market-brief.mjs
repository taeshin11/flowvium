#!/usr/bin/env node
/**
 * make-market-brief.mjs — 매일 시장 요약 롱폼(가로 1920×1080, 2~3분). 2026-10-22 신설. 근거·규칙은 lib/market-brief.test.mjs 머리말.
 *
 *   --edition us    아침(KST 07시대): 전날 뉴욕 마감 요약 + 오늘 주요 일정(경제지표·실적)
 *   --edition kreu  미국 개장 1시간 전: 오늘 한국 마감 + 유럽 장중 + 오늘 밤 일정 — 보고서(20:00~21:30) 전에 만들어 예약 공개
 *   --edition krmid   점심(12:00 공개): 한국 증시 오전장(장중 숫자) + 오늘 밤 일정 — 사장님 10/23 "점심시간·퇴근시간에 많이 보도록"
 *   --edition krclose 퇴근길(18:00 공개): 오늘 한국 증시 마감 + 오늘 밤 일정
 *
 * 숫자: 지수는 네이버 지수 API(거래소 종가·등락률·장 상태). 이유·종목 이야기는 그날 마감 기사 본문(news_archive → 원문).
 *   대본 관문은 주간 해설과 같다 — 근거에 없는 숫자·한글 숫자·채널 의견·끝맺음 아닌 문장을 빼고, agy 검증 패스가 근거 없는 문장을 뺀다.
 * 화면: 검은 제목 카드 → 지수판 → 이야기마다 기사 사진(CLIP 배너·중복 + 사진·뉴스 대조) → 일정판. 낭독 자막. 레퍼런스 구성 그대로.
 * 썸네일: 레퍼런스 꼴 — 사진 전면 + 빨간 날짜 띠 + 흰 띠 위 검은 큰 질문 + 우상단 배지.
 *
 * 사용: node scripts/video/make-market-brief.mjs --edition us|kreu|krmid|krclose [--upload public|private] [--out <폴더>] [--script-only] [--force]
 *   --force 는 시각 창·'오늘 이미 올림' 을 건너뛴다(시험용). 장이 실제로 열렸는지(sessionCheck)는 건너뛰지 않는다.
 */
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright';
import { spawnSync, spawn } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, openSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { ROOT } from '../lib/project-root.mjs';
import { licensedBeds } from '../lib/bgm-beds.mjs';
import { mixBgm } from '../lib/bgm-mix.mjs';
import { verifyChain } from '../lib/agy-models.mjs';
import { articleLines, dropSharedLines, ungroundedNumbers, hangulNumerals, isEditorial, flattenKoNumbers } from '../lib/weekly-explainer.mjs';
import { EDITIONS, naverIndexUrl, parseNaverIndex, factLine, publishTargetMs, inWindow, sessionCheck, calendarRows, pickArticles, briefTitle, headlineMove, kstClock, claimPhotos, pickCalendar, briefPromo, SESSION_LABEL } from '../lib/market-brief.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const ED = arg('edition');
if (!EDITIONS[ED]) { console.error(`--edition ${Object.keys(EDITIONS).join('|')}`); process.exit(2); }
const E = EDITIONS[ED];
const UPLOAD = arg('upload');
const FORCE = argv.includes('--force');
const SCRIPT_ONLY = argv.includes('--script-only');
const OUT = resolve(arg('out', join(tmpdir(), `flowvium-market-brief-${ED}`)));
const NOW = Date.now();
const DATE = new Date(NOW + 9 * 3600e3).toISOString().slice(0, 10);   // KST 날짜 = 영상 날짜
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), `[brief:${ED}]`, ...a);
const skip = (m) => { log(`⏭  ${m} — 이번 회차는 만들지 않는다`); process.exit(0); };
const die = (m) => { log(`❌ ${m} — 이번 회차는 올리지 않는다`); process.exit(1); };
const ff = (args, what, timeout = 600_000) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8', timeout }); if (r.status !== 0) throw new Error(`${what}: ${String(r.stderr || r.error?.message).slice(-300)}`); };
const probe = (f) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', f], { encoding: 'utf8' }); const s = r.stderr ?? '';
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(s); const v = /, (\d{2,5})x(\d{2,5})[, ]/.exec(s);
  return { dur: m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null, w: v ? +v[1] : 0, h: v ? +v[2] : 0 }; };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── 0. 돌아도 되나 ──────────────────────────────────────────────────────────────
const HIST = join(ROOT, 'logs/market-brief.json');
let history = []; try { history = JSON.parse(readFileSync(HIST, 'utf8')); } catch { /* 첫 회 */ }
if (!FORCE) {
  if (history.some((h) => h.edition === ED && h.date === DATE && h.id)) skip(`${DATE} ${E.label} 이미 올림`);
  const w = inWindow(ED, NOW); if (!w.ok) skip(w.why);
  const { isReportPipelineRunning } = await import('../lib/report-running.mjs');
  if (await isReportPipelineRunning(ROOT)) skip('보고서 생성 중(렌더는 보고서와 겹치지 않는다)');
}
// 쇼츠 렌더와 같은 락 — 둘 다 멜로 음성·ffmpeg 를 쓴다(겹치면 메모리·시간이 같이 밀린다). 쇼츠 한 편은 5~15분.
const { acquireRunLock } = await import('../lib/run-lock.mjs');
const lock = await acquireRunLock(join(ROOT, 'logs/video-publish.lock'), { waitMs: 20 * 60_000, label: `market-brief-${ED}` });
if (!lock.ok) skip(`쇼츠 렌더가 20분 넘게 락을 쥐고 있다(${JSON.stringify(lock.holder)})`);

// ── 1. 지수(네이버) ──────────────────────────────────────────────────────────────
const quotes = (await Promise.all(E.indices.map(async (code) => {
  try { const r = await fetch(naverIndexUrl(code), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? parseNaverIndex(code, await r.json()) : null; } catch { return null; }
}))).filter(Boolean);
const sess = sessionCheck(ED, quotes, { nowMs: NOW });
if (!sess.ok) skip(sess.why);
// 다룬 장의 날짜 — 미국판은 뉴욕 날짜(10/23 아침에 올리는 영상은 10/22 장). 화면·제목·첫 문장은 이 날짜를 쓴다(Claude 검토 10/23).
const DAY = sess.day;
const DAY_MD = `${Number(DAY.slice(5, 7))}월 ${Number(DAY.slice(8))}일`;
const SPOKEN = { us: '미국 증시 마감', kreu: '한국·유럽 증시', krmid: '한국 증시 오전장', krclose: '한국 증시 마감' }[ED];
// 유럽(한국·유럽판)·한국(오전판)은 이 시각 장중이다 — 장중 값이라고, 몇 시 값인지 밝혀 읽는다(마감 숫자로 오해하지 않게).
const FACTS = quotes.map((q) => `${factLine(q)}${q.closed ? ' 마감' : ` 장중${kstClock(q.at) ? ` ${kstClock(q.at)} 기준` : ''}`}`);
log(`[지수] ${FACTS.join(' · ')}`);

// ── 2. 기사 ──────────────────────────────────────────────────────────────────────
const { openDb } = await import('../lib/db.mjs');
const db = openDb();
const KO_SRC = ['연합뉴스 국제', '연합뉴스 경제', '머니투데이', '한국경제'];
// 미국판: 전날 KST 15:00 부터(뉴욕 개장 전 기사 포함). 한국·유럽판: 오늘 KST 08:00 부터.
const fromIso = new Date(Date.parse(`${DATE}T00:00:00+09:00`) + (ED === 'us' ? -9 : 8) * 3600e3).toISOString();
const rows = db.prepare(`SELECT source, headline, link, captured_at FROM news_archive WHERE source IN (${KO_SRC.map(() => '?').join(',')})
   AND datetime(captured_at) >= datetime(?) AND link IS NOT NULL ORDER BY captured_at`).all(...KO_SRC, fromIso);
const wraps = pickArticles(ED, rows).slice(0, 6);
// 이야기 재료 — 같은 창의 종목·실적 기사(마감 기사가 이름만 든 종목의 '왜' 가 여기 있다).
// 10/22 첫 시험: '실적|주가' 같은 넓은 말이 한국 종목 기사(LS일렉·삼성E&A)를 미국판에 끌어왔다 — 판의 시장을 가리키는 말만.
const STORY_RE = ED === 'us'
  ? /뉴욕|월가|美|미\s?증시|나스닥|S&P|다우|국채|연준|파월|엔비디아|테슬라|애플|마이크로소프트|아마존|메타|알파벳|구글|스페이스X|마켓워치|블룸버그/
  : ED === 'kreu' ? /\[특징주\]|코스피|코스닥|외국인|환율|원\/달러|유럽\s?증시|삼성전자|SK하이닉스/
  : /\[특징주\]|코스피|코스닥|외국인|환율|원\/달러|삼성전자|SK하이닉스/;
const seen = new Set(wraps.map((r) => r.link));
const extra = rows.filter((r) => STORY_RE.test(r.headline) && !/^\s*\[(속보|스팟)\]/.test(r.headline) && !seen.has(r.link))
  .filter((r) => { const k = r.headline.replace(/\s/g, '').slice(0, 12); if (seen.has(k)) return false; seen.add(k); return true; })
  .slice(-14);
const want = [...wraps, ...extra];
const fetched = [];
for (let i = 0; i < want.length; i += 4) {
  fetched.push(...await Promise.all(want.slice(i, i + 4).map(async (r) => {
    try { const res = await fetch(r.link, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
      return { ...r, lines: res.ok ? articleLines((await res.text()).slice(0, 600_000)) : [] }; } catch { return { ...r, lines: [] }; }
  })));
}
const cleaned = dropSharedLines(fetched.map((d) => d.lines));
const docs = fetched.map((d, i) => ({ ...d, wrap: i < wraps.length, text: cleaned[i].join(' ').slice(0, 1600) })).filter((d) => d.text.length >= 200).slice(0, 14);
log(`[기사] 마감 기사 ${wraps.length}건 + 관련 ${extra.length}건 → 본문 있는 ${docs.length}건 (마감 ${docs.filter((d) => d.wrap).length})`);
if (docs.filter((d) => d.wrap).length < 1) skip('본문을 받은 장 마감 기사가 없다 — 이유 없이 숫자만 읽는 영상은 만들지 않는다');

// ── 3. 일정(경제지표 ForexFactory 주간 JSON · 실적 Nasdaq) ──────────────────────
// 오전판은 낮 12시 공개라 오늘 밤 미국 일정까지 닿도록 14시간.
const calTo = NOW + ({ us: 24, krmid: 14 }[ED] ?? 12) * 3600e3;
let econ = [];
try { const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (r.ok) econ = calendarRows(await r.json(), { fromMs: NOW, toMs: calTo }); } catch (e) { log(`[일정] 경제지표 못 받음: ${e.message}`); }
let earn = [];
try { const r = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${DATE}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  const j = r.ok ? await r.json() : null;
  earn = ((j?.data?.rows) ?? []).map((x) => ({ symbol: x.symbol, name: x.name, when: /pre/.test(x.time) ? '장전' : /after/.test(x.time) ? '장후' : null,
    cap: Number(String(x.marketCap ?? '').replace(/[$,]/g, '')) || 0 })).filter((x) => x.when && x.cap >= 30e9).sort((a, b) => b.cap - a.cap).slice(0, 6);
} catch (e) { log(`[일정] 실적 못 받음: ${e.message}`); }
// 한국·유럽판은 오늘 밤 장전 실적만(장후는 내일 아침 미국판이 다룬다).
if (ED !== 'us') earn = earn.filter((x) => x.when === '장전');
// '오늘 체크' 2~3개 — 화면과 낭독이 같은 것을 말하도록 여기서 고른다(lib pickCalendar: High → 미국 → 이른 시각, 같은 시각 하나).
const CAL = pickCalendar(econ, earn);
log(`[일정] 지표 ${econ.length} · 실적 ${earn.length}`);
const calLines = CAL.map((c, i) => c.kind === 'econ'
  ? `(${i}) ${c.kstDay === DATE ? '' : '다음 날 '}${c.kst} ${c.country} ${c.title}${c.forecast ? ` 예상 ${c.forecast}` : ''}${c.previous ? ` 이전 ${c.previous}` : ''}`
  : `(${i}) 실적 발표 ${c.when} ${c.symbol} ${c.name}`);

// ── 4. 대본 ─────────────────────────────────────────────────────────────────────
const CPS = 7.4;   // 멜로 실측 7.47자/초(lib/weekly-explainer)
const B = { min: Math.round(85 * CPS), max: Math.round(190 * CPS), target: Math.round(140 * CPS) };
const SCRIPT_SCHEMA = { type: 'object', properties: {
  hook: { type: 'string' }, thumb_lines: { type: 'array', items: { type: 'string' } },
  chapters: { type: 'array', items: { type: 'object', properties: {
    kind: { type: 'string' }, heading: { type: 'string' }, sentences: { type: 'array', items: { type: 'string' } }, sources: { type: 'array', items: { type: 'integer' } } },
  required: ['kind', 'heading', 'sentences', 'sources'] } },
  calendar_ko: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, ko: { type: 'string' } }, required: ['i', 'ko'] } } },
required: ['hook', 'thumb_lines', 'chapters', 'calendar_ko'] };
const scope = {
  us: '어젯밤 뉴욕 증시 마감을 아침 출근길 투자자에게 2분 남짓으로 요약한다.',
  kreu: '오늘 한국 증시 마감과 유럽 증시 장중 흐름을, 미국 장 시작 1시간 전에 2분 남짓으로 요약한다.',
  krmid: '오늘 한국 증시 오전장 흐름을 점심시간 직장인 투자자에게 2분 남짓으로 요약한다. 장은 아직 열려 있다.',
  krclose: '오늘 한국 증시 마감을 퇴근길 투자자에게 2분 남짓으로 요약한다.',
}[ED];
const marketHeading = { us: '뉴욕 증시 마감', kreu: '한국·유럽 증시', krmid: '한국 증시 오전장', krclose: '한국 증시 마감' }[ED];
const scriptPrompt = [
  `너는 한국 증시 뉴스 유튜브의 대본 작가다. ${scope}`,
  '근거는 아래 [지수]·[기사]·[일정] 뿐이다. **거기 없는 사실·숫자·인물·발언·전망을 쓰지 마라.** 숫자는 적힌 그대로 옮긴다.',
  '구성(chapters):',
  ` 1) kind "market" heading "${marketHeading}" — 첫 문장은 "${DAY_MD} ${SPOKEN}입니다." 그다음 **가장 크게 움직인 지수부터** 등락률(%) 위주로(종가는 대표 지수 하나만), 그리고 그 이유 한두 문장. 거의 안 움직인 지수는 짧게 묶거나 빼라.`,
  ED === 'kreu' ? '    유럽 지수는 [지수]에 "장중" 으로 적힌 값이다 — "장중" 이라고 밝혀 쓴다.' : '',
  ED === 'krclose' ? '    유럽 지수는 [지수]에 "장중" 으로 적힌 값이다 — market 장 끝에 "유럽 증시는 장 초반 …" 한 문장으로만, 숫자만 짧게(이유를 지어내지 마라).' : '',
  '    지수판 화면에 모든 숫자가 나온다 — 거의 안 움직인 지수까지 다 읽지 마라. "한편" "보도에 따르면" "살펴보겠습니다" 같은 연결어·예고 문장 금지.',
  ED === 'krmid' ? '    지수는 [지수]에 "장중 HH:MM 기준" 으로 적힌 아직 끝나지 않은 장의 값이다 — "마감" "마쳤습니다" 를 쓰지 말고 "오전 11시 35분 기준" 처럼 시각을 밝혀 쓴다.' : '',
  ' 2) kind "story" 2~4개 — 오늘 시장을 움직인 종목·이슈 하나씩(heading 12자 이내, 회사·이슈 이름). 무엇이 몇 % 움직였고 왜인지, 기사에 있는 증권가·전문가 말이 **그 장의 회사·이슈에 관한 것이면** 누가 했는지 밝혀 한 문장 옮긴다(시장 전체 논평은 market 장에).',
  ` 3) kind "calendar" heading "${ED === 'krclose' ? '오늘 밤 체크' : '오늘 체크'}" — [일정] 을 **모두** 한 문장씩 시각과 함께 읽는다(한국 시각, "밤 9시 30분" 처럼). 예상치·이전치 숫자는 읽지 마라(화면에 나온다). 일정이 없으면 이 장을 빼라.`,
  '문장 규칙: 합니다체. 한 문장 20~55자. 각 문장은 "니다." 등 완결된 말로 끝낸다. 숫자는 아라비아 숫자("1.05%", "26,702.86"), 지수 소수점은 둘째 자리까지 그대로.',
  '"여러분" "충격" "경악" 금지. 기자 이름·매체 서명 읽지 마라. 화면 지시어 금지. 투자 권유·매수 매도 제안 금지. 채널의 의견·당위·전망 금지(말한 사람을 밝혀 옮길 때만).',
  `분량: 모든 문장 합계 ${B.min}~${B.max}자(목표 ${B.target}자).`,
  'sources: 그 장에서 쓴 기사 번호들(정수). market 장은 쓴 기사 번호, calendar 장은 [].',
  // 10/22 첫 시험: 예시로 레퍼런스 영상 제목을 그대로 줬더니 그 제목을 그대로 베꼈다 — 예시 문장을 주지 않는다.
  'hook: 오늘 시장의 핵심을 말하는 결론형 한 줄(22자 이내, 물음표 금지 — 영상이 답하지 않는 질문은 낚시다). **가장 크게 움직인 지수의 이유**(market 장의 이유)에서 뽑아라 — 이야기 장 하나의 곁가지 회사로 낚지 마라. 숫자를 넣지 마라(제목 앞에 숫자가 따로 붙는다).',
  '  이미 일어난 일을 "~할까요?" 로 묻지 마라(10/22 시험: 이미 오른 장을 "반등할까요?"). 묻는다면 아직 안 정해진 것(합병 성사, 상승 지속, 오늘 밤 지표)을 묻는다.',
  'thumb_lines: 썸네일 큰 글 **정확히 2줄**, 오늘 시장의 결론(market 장의 이유). 각 줄 띄어쓰기 포함 **8자 이하** 명사구(예 ["AI 투자 불안", "반도체 급락"]). 숫자·물음표 없이.',
  'calendar_ko: [일정] 각 줄 번호 i 의 한국어 이름(14자 이내, 예 "신규 실업수당 청구건수", 실적은 "프록터앤드갬블 실적"). 숫자는 넣지 마라.', '',
  '[지수]', ...FACTS, '',
  '[일정]', ...(calLines.length ? calLines : ['(없음)']), '',
  '[기사]', ...docs.map((d, i) => `[${i}] ${d.source} · ${d.headline}\n${d.text}`),
].filter((x) => x !== '').join('\n');
const { agyReport } = await import('../lib/agy-report.mjs');
let script = null;
for (let attempt = 1; attempt <= 2 && !script; attempt++) {
  const raw = await agyReport(scriptPrompt, { label: `brief-script-${ED}`, timeoutMs: 360_000, schema: SCRIPT_SCHEMA });
  try { const j = JSON.parse(raw); if (Array.isArray(j.chapters) && j.chapters.length >= 2) script = j; } catch { /* 다시 */ }
  if (!script) log(`[대본] ${attempt}회차 형식 불량 — ${attempt < 2 ? '다시 묻는다' : '포기'}`);
}
if (!script) die('대본을 못 받았다');
// 일정 이름(한국어) — 숫자를 지어 넣었거나 길면 원문 이름을 쓴다.
const calKo = new Map((script.calendar_ko ?? []).filter((x) => Number.isInteger(x.i) && CAL[x.i] && x.ko && String(x.ko).length <= 18 && !/\d/.test(x.ko)).map((x) => [x.i, String(x.ko).trim()]));
CAL.forEach((c, i) => { c.ko = calKo.get(i) ?? (c.kind === 'econ' ? c.title : `${c.name} 실적`); });
const CORPUS = flattenKoNumbers([
  ...FACTS, ...FACTS.map((f) => f.replace(/,/g, '')),
  ...CAL.map((c) => c.kind === 'econ' ? `${c.kst} ${Number(c.kst.slice(0, 2)) % 12 || 12}시 ${c.kst.slice(3)}분 ${c.country} ${c.ko} ${c.title} ${c.forecast ?? ''} ${c.previous ?? ''}` : `${c.when} ${c.symbol} ${c.ko}`),
  ...docs.map((d) => `${d.headline} ${d.text}`), DATE, DAY, DAY_MD].join('\n'));
const END = /(니다|니까|세요|까요)[.?!]?["”’)]*$/;
let chapters = script.chapters.map((c) => ({ kind: ['market', 'story', 'calendar'].includes(c.kind) ? c.kind : 'story', heading: String(c.heading).trim().slice(0, 14),
  sources: (c.sources ?? []).filter((n) => Number.isInteger(n) && docs[n]), sentences: (c.sentences ?? []).map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean) }));
const total = () => chapters.reduce((a, c) => a + c.sentences.join('').length, 0);
log(`[대본] 장 ${chapters.length}개 · ${total()}자`);
for (const c of chapters) c.sentences = c.sentences.filter((s) => {
  const bad = ungroundedNumbers(s, CORPUS);
  if (bad.length) { log(`[검사] 숫자 근거 없음(${bad.join(',')}) — 뺀다: ${s.slice(0, 50)}`); return false; }
  const hn = hangulNumerals(s); if (hn.length) { log(`[검사] 숫자를 한글로 씀(${hn.join(',')}) — 뺀다: ${s.slice(0, 50)}`); return false; }
  if (isEditorial(s)) { log(`[검사] 출처 없는 당위·기대 — 뺀다: ${s.slice(0, 50)}`); return false; }
  if (!END.test(s)) { log(`[검사] 끝맺음 아님 — 뺀다: ${s.slice(0, 50)}`); return false; }
  return true;
});
// 검증 패스 — 문장마다 근거가 있는지 agy 가 본다. 판정을 못 받으면 올리지 않는다.
{
  const flat = chapters.flatMap((c, ci) => c.sentences.map((s, si) => ({ ci, si, s })));
  const raw = await agyReport([
    '아래 "문장" 각각이 "근거"([지수]·[일정]·[기사])로 뒷받침되는지 판정하라. 근거에 없는 사실·숫자·인물·발언·인과·전망을 담은 문장, 근거를 틀리게 옮긴 문장(오름/내림, 숫자, 누가 말했나)의 번호를 unsupported 에 넣어라.',
    `"${DAY_MD} ${SPOKEN}입니다." 같은 안내 문장은 통과다.` + ' 근거를 요약·재진술한 것은 통과다. 일정 시각은 [일정] 의 한국 시각과 같아야 한다.', '',
    '## 문장', ...flat.map((x, i) => `${i}: ${x.s}`), '', '## 근거', '[지수]', ...FACTS, '[일정]', ...CAL.map((c, i) => `${calLines[i]} = ${c.ko}`), '[기사]', ...docs.map((d, i) => `[${i}] ${d.headline}\n${d.text}`)].join('\n'),
  { label: `brief-verify-${ED}`, chain: verifyChain(), timeoutMs: 300_000, schema: { type: 'object', properties: {
    unsupported: { type: 'array', items: { type: 'integer' } }, reasons: { type: 'array', items: { type: 'string' } } }, required: ['unsupported'] } });
  let j; try { j = JSON.parse(raw); } catch { die('검증 패스 응답을 못 받았다 — 검증 안 된 요약은 올리지 않는다'); }
  const drop = new Set((j.unsupported ?? []).filter((n) => Number.isInteger(n) && flat[n]));
  [...drop].forEach((n, k) => log(`[검증] 근거 없음 — 뺀다: ${flat[n].s.slice(0, 60)}${j.reasons?.[k] ? ` (${String(j.reasons[k]).slice(0, 60)})` : ''}`));
  const kept = flat.filter((_, i) => !drop.has(i));
  chapters = chapters.map((c, ci) => ({ ...c, sentences: kept.filter((x) => x.ci === ci).map((x) => x.s) }))
    .filter((c) => c.sentences.length >= (c.kind === 'market' ? 2 : 1));
}
log(`[대본] 관문 뒤 장 ${chapters.length}개 · ${total()}자 (하한 ${B.min})`);
if (chapters[0]?.kind !== 'market') die('첫 장(지수 마감)이 관문에서 빠졌다');
if (!chapters.some((c) => c.kind === 'story')) die('이야기 장이 하나도 안 남았다');
if (total() < B.min) die(`관문 뒤 분량 ${total()}자 — 1분 반이 안 된다`);
const hook = ungroundedNumbers(script.hook, CORPUS).length ? chapters.find((c) => c.kind === 'story').heading : String(script.hook).trim().slice(0, 24);
const MOVE = headlineMove(quotes);
// 썸네일 2줄 — 각 2~7자(폰에서 읽히는 크기, agy·Claude 검토). 못 받으면 이야기 장 제목 두 개.
const thumbLines = (() => {
  // 10/23 오전판 시험: 줄이 7자를 넘어 버려지고 이야기 장 제목(회사 이름 둘)으로 떨어졌다 — 8자까지 받고, 버린 이유를 남긴다.
  const raw = (script.thumb_lines ?? []).map((x) => String(x).replace(/[?？!]/g, '').trim());
  const t = raw.filter((x) => x.length >= 2 && x.length <= 8 && !/\d/.test(x)).slice(0, 2);
  if (t.length === 2) return t;
  log(`[썸네일] 2줄 못 씀(${JSON.stringify(raw)}) — 이야기 장 제목으로`);
  return chapters.filter((c) => c.kind === 'story').map((c) => c.heading.slice(0, 8)).slice(0, 2);
})();
const thumbLine = thumbLines.join(' ');
const title = briefTitle({ edition: ED, move: MOVE, hook, day: DAY });
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'script.json'), JSON.stringify({ edition: ED, date: DATE, day: DAY, title, hook, thumbLines, facts: FACTS, calendar: CAL, chapters, docs: docs.map((d) => ({ source: d.source, headline: d.headline, link: d.link })) }, null, 2));
log(`[대본] 제목 "${title}" · 썸네일 "${thumbLine}" → ${join(OUT, 'script.json')}`);
if (SCRIPT_ONLY) process.exit(0);

// ── 5. 음성 ─────────────────────────────────────────────────────────────────────
const { synthesizeKoreanAuto } = await import('../lib/tts-korean.mjs');
const sents = chapters.flatMap((c, ci) => c.sentences.map((s) => ({ ci, s })));
const voice = synthesizeKoreanAuto(sents.map((x) => x.s), { outPrefix: join(OUT, 'v'), log: (m) => log(`[음성] ${m}`) });
sents.forEach((x, i) => { x.audio = voice[i].path; x.dur = voice[i].durationSec; x.alignment = voice[i].alignment; });
const speech = sents.reduce((a, x) => a + x.dur, 0);
log(`[음성] ${sents.length}문장 ${speech.toFixed(0)}초`);
if (speech < 75) die(`낭독 ${speech.toFixed(0)}초 — 너무 짧다`);

// ── 6. 사진 — 이야기 장이 인용한 기사의 대표 사진. 배너·중복(CLIP) → 장 제목과 사진 대조(agy, 쇼츠와 같은 관문).
const { articleImage, isBrandImage } = await import('../lib/article-image.mjs');
const { isRealFootage } = await import('../lib/footage.mjs');
const { clipCheck, clipDuplicates } = await import('../lib/clip-gate.mjs');
let imgs = [];
const cited = [...new Set(chapters.flatMap((c) => c.kind === 'calendar' ? [] : c.sources))];
for (let i = 0; i < cited.length; i += 4) {
  const got = await Promise.all(cited.slice(i, i + 4).map(async (n) => ({ doc: n, img: await articleImage(docs[n].link) })));
  for (const g of got) {
    if (!g.img || isBrandImage(g.img.url) || !isRealFootage(g.img) || imgs.some((m) => m.url === g.img.url)) continue;
    const f = join(OUT, `img${imgs.length}.jpg`);
    try { const res = await fetch(g.img.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue; writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      const p = probe(f); if (p.w < 640 || p.h < 360) continue;
      imgs.push({ url: g.img.url, file: f, source: g.img.source, doc: g.doc });
    } catch { /* 다음 */ }
  }
}
// 이야기 장마다 같은 회사·이슈의 다른 기사 사진도 후보로(최근 36시간, 장 제목 낱말이 기사 제목에 있는 것).
//   10/22 첫 렌더: 이야기 3장 중 1장만 사진이 있었다 — 마감 기사 사진은 한 장이고, 한경·머투 대표 사진은 배너가 많다.
const IMG_SRC = ['연합뉴스 국제', '연합뉴스 경제', '머니투데이', '한국경제', '연합뉴스 사회', 'news-cascade'];
for (const [ci, c] of chapters.entries()) {
  if (c.kind !== 'story') continue;
  const words = c.heading.split(/[\s·,]+/).map((w) => w.replace(/[^가-힣A-Za-z0-9]/g, '')).filter((w) => w.length >= 2).slice(0, 2);
  if (!words.length) continue;
  const rel = db.prepare(`SELECT headline, link FROM news_archive WHERE source IN (${IMG_SRC.map(() => '?').join(',')}) AND link IS NOT NULL
     AND datetime(captured_at) >= datetime('now', '-36 hours') AND (${words.map(() => 'headline LIKE ?').join(' OR ')}) ORDER BY captured_at DESC LIMIT 6`)
    .all(...IMG_SRC, ...words.map((w) => `%${w}%`)).filter((r) => !docs.some((d) => d.link === r.link));
  let got = 0;
  for (const r of rel) {
    if (got >= 2) break;
    const im = await articleImage(r.link);
    if (!im || isBrandImage(im.url) || !isRealFootage(im) || imgs.some((m) => m.url === im.url)) continue;
    const f = join(OUT, `img${imgs.length}.jpg`);
    try { const res = await fetch(im.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue; writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      const p = probe(f); if (p.w < 640 || p.h < 360) continue;
      imgs.push({ url: im.url, file: f, source: im.source, doc: -1, forCi: ci }); got += 1;
    } catch { /* 다음 */ }
  }
  if (got) log(`[사진] "${c.heading}" 관련 기사 사진 ${got}장 추가 후보`);
}
if (imgs.length) {
  const banner = clipCheck(imgs.map((m) => ({ image: m.file })), E.label).filter((v) => (v.formDecoy ?? 0) >= 0.2).map((v) => v.index);
  const dup = clipDuplicates(imgs.map((m) => m.file));
  const drop = new Set([...banner, ...dup]);
  if (drop.size) log(`[사진] 배너 ${banner.length} · 같은 사진 ${dup.length} 장 뺀다`);
  imgs = imgs.filter((_, i) => !drop.has(i));
}
// 사진·뉴스 대조는 (장, 사진) 쌍마다 한다 — 마감 기사의 사진은 그 기사 첫 이야기(예: 스페이스X)라, 같은 기사를 인용한 다른 장(슈퍼마이크로)에 붙으면 틀린 사진이다.
const allowed = new Map();   // 장 번호 → 쓸 수 있는 사진들
const pairs = chapters.flatMap((c, ci) => c.kind === 'story' ? imgs.filter((m) => c.sources.includes(m.doc) || m.forCi === ci).map((m) => ({ ci, m })) : []);
if (pairs.length && process.env.SHORTS_PHOTO_STORY !== '0') {
  const { checkPhotoStory, DROP } = await import('../lib/photo-story.mjs');
  const res = await checkPhotoStory(pairs.map((x) => ({ image: x.m.file, headline: chapters[x.ci].heading, say: chapters[x.ci].sentences.slice(0, 2).join(' ') })), { timeoutMs: 180_000 });
  if (!res.verdicts) log(`[사진] 사진·뉴스 대조 못 함 — ${res.why} (CLIP 검사만 거쳤다)`);
  let dropped = 0;
  pairs.forEach((x, i) => {
    const v = res.verdicts?.[i];
    if (v && DROP.has(v.verdict)) { dropped += 1; log(`[사진] "${chapters[x.ci].heading}" 장에서 뺀다(${v.verdict}) — ${v.why}`); return; }
    if (!allowed.has(x.ci)) allowed.set(x.ci, []); allowed.get(x.ci).push(x.m);
  });
  if (res.verdicts) log(`[사진] 사진·뉴스 대조 ${pairs.length}쌍 중 ${dropped}쌍 제외`);
} else for (const x of pairs) { if (!allowed.has(x.ci)) allowed.set(x.ci, []); allowed.get(x.ci).push(x.m); }
log(`[사진] ${imgs.length}장`);

// ── 7. 화면 조각 계획 — 장마다: market = 제목 카드(첫 문장) → 지수판 · story = 사진(두 문장마다) · calendar = 일정판
const segs = []; const useCount = new Map(); let last = null;
// 사진 한 장은 한 장(章)만(lib claimPhotos — 10/23 시험 렌더: 트레이더 사진이 세 장에 떴다).
const mine = claimPhotos(allowed, chapters.map((c, i) => (c.kind === 'story' ? i : -1)).filter((i) => i >= 0));
for (let ci = 0; ci < chapters.length; ci++) {
  const c = chapters[ci]; const ss = sents.filter((x) => x.ci === ci);
  // 10/23: 검은 '날짜+판 이름' 첫 화면은 레퍼런스 꼴이고 지수판 머리와 겹친다(agy·Claude) — 첫 문장부터 지수판.
  if (c.kind === 'market') { segs.push({ ci, card: 'board', sents: ss }); continue; }
  if (c.kind === 'calendar') { segs.push({ ci, card: 'calendar', sents: ss }); continue; }
  // 그 장이 인용한 기사의 사진만 쓴다. 10/22 첫 렌더: 남의 장 사진으로 채웠더니 '메타' 장에 스페이스X 로켓이 떴다(쇼츠 V5 재사용과 같은 결함).
  //   사진이 없는 장은 큰 제목 카드(레퍼런스의 검은 제목 화면) — 틀린 사진보다 낫다.
  const own = mine.get(ci) ?? [];
  if (!own.length) { segs.push({ ci, card: 'head', sents: ss }); continue; }
  for (let k = 0; k < ss.length; k += 2) {
    const pool = own.length > 1 ? own.filter((m) => m !== last) : own;
    const m = pool.sort((a, b) => (useCount.get(a) ?? 0) - (useCount.get(b) ?? 0))[0];
    useCount.set(m, (useCount.get(m) ?? 0) + 1); last = m;
    segs.push({ ci, card: 'photo', img: m, first: k === 0, sents: ss.slice(k, k + 2) });
  }
}
log(`[화면] 조각 ${segs.length}개 — 사진 ${segs.filter((s) => s.card === 'photo').length} · 제목 카드 ${segs.filter((s) => s.card === 'head').length} · 지수판 ${segs.filter((s) => s.card === 'board').length} · 일정 ${segs.filter((s) => s.card === 'calendar').length}`);

// ── 8. 카드·겹침 그리기 ─────────────────────────────────────────────────────────
const FONT = "'Apple SD Gothic Neo',sans-serif";
const up = '#ff4d4f'; const dn = '#3b82f6';   // 한국 시세 관례: 오름 빨강·내림 파랑
const BASE = `*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;font-family:${FONT};position:relative;overflow:hidden}`;
// 지수판 — 브랜드 머리띠(사이트 파랑 #4F8FBF) + 이름 왼쪽 · 값·등락 오른쪽 정렬 열(10/23 agy·Claude: 값 열이 들쭉날쭉했다).
const BRAND = '#4F8FBF';
const hhmm = (q) => kstClock(q.at);
const boardHtml = `<!doctype html><meta charset="utf-8"><style>${BASE}body{background:#0b1220;color:#fff;padding:0 190px;display:flex;flex-direction:column;justify-content:center}
.top{position:absolute;left:0;right:0;top:0;height:14px;background:${BRAND}}
h1{font-size:58px;font-weight:900;margin-bottom:10px}.sub{font-size:34px;color:#8FB8D8;font-weight:700;margin-bottom:40px}
.r{display:grid;grid-template-columns:1fr 440px 330px;align-items:baseline;border-bottom:2px solid #1f2937;padding:24px 0}
.n{font-size:62px;font-weight:800}.v{font-size:62px;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}.p{font-size:62px;font-weight:900;text-align:right;font-variant-numeric:tabular-nums}.s{font-size:32px;color:#94a3b8;margin-left:16px;font-weight:700}</style>
<div class="top"></div><h1>${esc(DAY_MD)} ${esc(SESSION_LABEL[ED])}</h1><div class="sub">FLOWVIUM</div>${quotes.map((q) => `<div class="r"><div class="n">${esc(q.name)}${q.closed ? '' : `<span class="s">장중${hhmm(q) ? ` ${hhmm(q)}` : ''}</span>`}</div><div class="v">${q.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div class="p" style="color:${q.pct > 0 ? up : q.pct < 0 ? dn : '#fff'}">${q.pct > 0 ? '▲' : q.pct < 0 ? '▼' : ''} ${Math.abs(q.pct).toFixed(2)}%</div></div>`).join('')}`;
// "200K" → "20만" (한국 시청자 단위). 나머지(%, B 등)는 원문 그대로.
const koUnit = (v) => { const m = /^(-?[\d.]+)K$/.exec(String(v)); if (!m) return String(v); const n = Number(m[1]) * 1000; return n >= 10000 ? `${(n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만` : n.toLocaleString('ko-KR'); };
const calRows = CAL;   // 위에서 고른 2~3개 — 낭독과 같은 줄
const calHtml = `<!doctype html><meta charset="utf-8"><style>${BASE}body{background:#0b0f17;color:#fff;padding:0 300px;display:flex;flex-direction:column;justify-content:center}
h1{font-size:54px;font-weight:800;color:#cbd5e1;margin-bottom:34px}.r{display:flex;align-items:center;gap:30px;border-bottom:2px solid #1f2937;padding:16px 0;font-size:42px}
.k{width:200px;font-weight:800;font-variant-numeric:tabular-nums}.c{font-size:30px;background:#334155;border-radius:8px;padding:4px 14px;width:150px;text-align:center}.e{flex:1;font-weight:700}.f{font-size:30px;color:#94a3b8}</style>
<h1>${esc(chapters.find((c) => c.kind === 'calendar')?.heading ?? '주요 일정')}</h1>${calRows.map((c) => c.kind === 'econ'
  ? `<div class="r"><div class="k">${c.kstDay === DATE ? '' : '<span class="f">익일 </span>'}${esc(c.kst)}</div><div class="c">${esc(c.country)}</div><div class="e">${esc(c.ko)}</div><div class="f">${c.forecast ? `예상 ${esc(koUnit(c.forecast))}` : ''}</div></div>`
  : `<div class="r"><div class="k">${esc(c.when)}</div><div class="c">실적</div><div class="e">${esc(c.ko)}</div><div class="f">${esc(c.symbol)}</div></div>`).join('')}`;
const OV_CSS = `${BASE}body{background:transparent}.tag{position:absolute;left:56px;top:48px;font-size:34px;font-weight:800;color:#fff;background:rgba(6,9,15,.78);padding:12px 22px;border-radius:12px}
.cr{position:absolute;right:40px;bottom:200px;font-size:22px;color:rgba(255,255,255,.85);text-shadow:0 0 6px #000}.shade{position:absolute;left:0;right:0;bottom:0;height:300px;background:linear-gradient(0deg,rgba(0,0,0,.7),rgba(0,0,0,0))}`;
const ovHtml = (s) => `<!doctype html><meta charset="utf-8"><style>${OV_CSS}</style><div class="shade"></div><div class="tag">${esc(chapters[s.ci].heading)}</div>${s.img ? `<div class="cr">사진: ${esc(s.img.source)}</div>` : ''}`;
const headHtml = (c) => `<!doctype html><meta charset="utf-8"><style>${BASE}body{background:#000;display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;text-align:center}
.d{font-size:52px;font-weight:700;color:#cbd5e1}.t{font-size:124px;font-weight:900;margin-top:22px;padding:0 80px}</style><div class="d">${esc(E.label)}</div><div class="t">${esc(c.heading)}</div>`;
// 끝 카드 — 시계 시각 세 편 + 왜 설명란을 누르나(무료 AI 리포트). 3초(10/23 agy·Claude: 주소만 덩그러니·"개장 1시간 전" 계산은 불필요).
const outroHtml = `<!doctype html><meta charset="utf-8"><style>${BASE}body{background:#0b1220;display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;text-align:center}
.top{position:absolute;left:0;right:0;top:0;height:14px;background:${BRAND}}.t{font-size:72px;font-weight:900;line-height:1.5}.t span{color:#FFD400}.s{font-size:44px;color:#cbd5e1;margin-top:40px;font-weight:700}</style>
<div class="top"></div><div class="t">매일 <span>07시</span> 미국 증시 · <span>12시</span> 한국 오전장 · <span>18시</span> 한국 마감</div><div class="s">종목별 무료 AI 투자 리포트는 설명란 링크에서</div>`;
const br = await chromium.launch({ headless: true });
const pg = await br.newPage({ viewport: { width: 1920, height: 1080 } });
const shot = async (html, f, transparent = false) => { await pg.setContent(html); await pg.waitForTimeout(120); await pg.screenshot({ path: f, omitBackground: transparent }); };
await shot(boardHtml, join(OUT, 'c_board.png')); await shot(calHtml, join(OUT, 'c_cal.png')); await shot(outroHtml, join(OUT, 'c_outro.png'));
for (const [k, s] of segs.entries()) { if (s.card === 'photo') await shot(ovHtml(s), join(OUT, `ov${k}.png`), true); if (s.card === 'head') await shot(headHtml(chapters[s.ci]), join(OUT, `h${k}.png`)); }
await br.close();

// ── 9. 조각 합성 + 자막 + 배경음 + 음량 ─────────────────────────────────────────
const { cuesFromAlignment, toAss } = await import('../lib/subtitle.mjs');
const parts = []; const cues = []; let t = 0; const GAP = 0.3;
const venc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100'];
for (const [k, s] of segs.entries()) {
  const wav = join(OUT, `a${k}.wav`);
  const filt = s.sents.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${GAP}[s${i}]`).join(';') + `;${s.sents.map((_, i) => `[s${i}]`).join('')}concat=n=${s.sents.length}:v=0:a=1[a]`;
  ff([...s.sents.flatMap((x) => ['-i', x.audio]), '-filter_complex', filt, '-map', '[a]', wav], `음성 이어붙이기 ${k}`);
  let off = t; for (const x of s.sents) { cues.push(...cuesFromAlignment(x.alignment, { maxChars: 30, maxLines: 1, maxDur: 3.2, offset: off })); off += x.dur + GAP; }
  const d = probe(wav).dur; const out = join(OUT, `p${k}.mp4`);
  if (s.card === 'photo') {
    const dir = k % 2; const X = dir === 0 ? `(iw-1920)*t/${d.toFixed(2)}` : `(iw-1920)*(1-t/${d.toFixed(2)})`;
    ff(['-loop', '1', '-i', s.img.file, '-i', join(OUT, `ov${k}.png`), '-i', wav, '-filter_complex',
      `[0:v]scale=2150:1210:force_original_aspect_ratio=increase,crop=2150:1210,crop=1920:1080:x='${X}':y='(ih-1080)/2',fps=30[bg];[bg][1:v]overlay=0:0,format=yuv420p[v]`,
      '-map', '[v]', '-map', '2:a', '-t', d.toFixed(3), ...venc, out], `조각 ${k}`);
  } else {
    const card = { board: 'c_board.png', calendar: 'c_cal.png', head: `h${k}.png` }[s.card];
    ff(['-loop', '1', '-i', join(OUT, card), '-i', wav, '-vf', 'fps=30,format=yuv420p', '-map', '0:v', '-map', '1:a', '-t', d.toFixed(3), ...venc, out], `조각 ${k}`);
  }
  parts.push(out); t += probe(out).dur;
}
ff(['-loop', '1', '-t', '3', '-i', join(OUT, 'c_outro.png'), '-f', 'lavfi', '-t', '3', '-i', 'anullsrc=r=44100:cl=mono', '-vf', 'fps=30,format=yuv420p', ...venc, '-shortest', join(OUT, 'p_outro.mp4')], '끝 카드');
parts.push(join(OUT, 'p_outro.mp4'));
// 끝 광고(가로 긴 버전) — 올린 롱폼 수로 aisvi/flowvium 번갈아(lib briefPromo). 본편과 같은 규격으로 다시 굽는다(-c copy 로 이어 붙이려고).
const PROMO = briefPromo(history, { exists: (rel) => existsSync(join(ROOT, rel)) });
if (PROMO.path) {
  ff(['-i', join(ROOT, PROMO.path), '-vf', 'scale=1920:1080,fps=30,format=yuv420p', '-af', 'aresample=44100,aformat=channel_layouts=mono', ...venc, join(OUT, 'p_ad.mp4')], '끝 광고');
  parts.push(join(OUT, 'p_ad.mp4'));
  log(`[화면] 끝 광고 ${PROMO.name}${PROMO.fallback ? '(원한 광고가 없어 대신)' : ''}`);
} else log('[화면] 끝 광고 파일이 없다 — 없이 간다 (node scripts/video/make-brief-ads.mjs --brand aisvi|flowvium)');
writeFileSync(join(OUT, 'list.txt'), parts.map((p) => `file '${p}'`).join('\n'));
const JOINED = join(OUT, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', join(OUT, 'list.txt'), '-c', 'copy', JOINED], '이어 붙이기');
writeFileSync(join(OUT, 'subs.ass'), toAss(cues, { font: 'Apple SD Gothic Neo', fontSize: 56, marginV: 60, playResX: 1920, playResY: 1080 }));
const SUBBED = join(OUT, 'subbed.mp4');
const { beds } = licensedBeds(join(ROOT, 'assets/bgm'));
const NOBGM = beds.length ? join(OUT, 'subbed-nobgm.mp4') : SUBBED;
ff(['-i', JOINED, '-vf', `subtitles=${join(OUT, 'subs.ass').replace(/:/g, '\\:')}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', NOBGM], '자막', 1_200_000);
if (beds.length) {
  const bedName = beds[Math.floor(Date.parse(DATE) / 864e5) % beds.length];
  const r = mixBgm({ input: NOBGM, bed: join(ROOT, 'assets/bgm', bedName), output: SUBBED, workDir: OUT });
  if (r.ok) log(`[소리] 배경음 ${bedName} — 내레이션 ${r.voiceI.toFixed(1)} · 배경 ${r.bedI.toFixed(1)} LUFS (${r.gap.toFixed(1)}dB 아래)`);
  else { log(`[소리] ⚠ 배경음 실패 — 음악 없이: ${r.reason}`); copyFileSync(NOBGM, SUBBED); }
}
const FINAL = join(OUT, 'brief.mp4');
{
  const { measure, normalize } = await import('../lib/loudness.mjs');
  const r = normalize(SUBBED, FINAL, -14, { extraOut: ['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] });
  const after = r.ok ? measure(['-i', FINAL]) : null;
  if (r.ok && after && Math.abs(after.I - -14) <= 1.5) log(`[소리] ${r.before.toFixed(1)} → ${after.I.toFixed(1)} LUFS`);
  else { log(`[소리] ⚠ 음량 맞추기 실패 — 원래 크기로: ${r.reason ?? after?.I}`); copyFileSync(SUBBED, FINAL); }
}
const LEN = probe(FINAL).dur;
log(`✅ ${FINAL} · ${LEN?.toFixed(0)}초`);
if (!(LEN >= 80 && LEN <= 300)) die(`길이 ${LEN?.toFixed(0)}초 — 80~300초 밖`);

// ── 10. 썸네일(레퍼런스 꼴) · 설명 ───────────────────────────────────────────────
const THUMB = join(OUT, 'thumb.jpg');
{
  const story = chapters.find((c) => c.kind === 'story');
  const pic = (allowed.get(chapters.indexOf(story)) ?? [])[0] ?? [...allowed.values()].flat()[0] ?? null;   // 대조를 통과한 사진만
  // 10/23 사장님 "너무 오선을 따라한 형태다" → 데이터 우선 꼴(agy·Claude 검토 종합): 왼쪽 짙은 판에 그날 가장 크게 움직인 지수
  //   숫자(색 칩 위 흰 글씨 — 남색 위 파랑 글씨는 폰에서 묻힌다) + 2줄 핵심(노랑·흰, 줄당 7자 안). 오른쪽에 사진(채도 낮춤).
  //   빨간 날짜 띠·흰 띠·우상단 배지는 없앤다. 오른쪽 아래는 비운다(영상 길이 표시 자리).
  const tb = await chromium.launch({ headless: true }); const tp = await tb.newPage({ viewport: { width: 1280, height: 720 } });
  await tp.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box}body{width:1280px;height:720px;background:#0E1A2B;font-family:${FONT};position:relative;overflow:hidden}
.ph{position:absolute;right:0;top:0;width:640px;height:720px;object-fit:cover;filter:saturate(.8) brightness(.92)}.nb{position:absolute;right:0;top:0;width:640px;height:720px;background:linear-gradient(135deg,#1e293b,#0b1220)}
.pan{position:absolute;left:0;top:0;width:760px;height:720px;background:#0E1A2B;clip-path:polygon(0 0,100% 0,84% 100%,0 100%)}
.bar{position:absolute;left:0;top:0;width:760px;height:12px;background:${BRAND};clip-path:polygon(0 0,100% 0,99.8% 100%,0 100%)}
.brand{position:absolute;left:52px;top:40px;font-size:30px;font-weight:900;color:${BRAND};letter-spacing:2px}
.chip{position:absolute;left:44px;top:110px;padding:6px 30px 14px;border-radius:14px;color:#fff;font-size:116px;font-weight:900;white-space:nowrap;letter-spacing:-3px}
.l{position:absolute;left:52px;font-size:112px;font-weight:900;white-space:nowrap;letter-spacing:-4px;text-shadow:0 4px 0 rgba(0,0,0,.35)}</style>
${pic ? `<img class="ph" src="data:image/jpeg;base64,${readFileSync(pic.file).toString('base64')}">` : '<div class="nb"></div>'}
<div class="pan"></div><div class="bar"></div><div class="brand">FLOWVIUM <span style="color:#cbd5e1">· ${esc(ED === 'us' ? '미국' : '한국')} ${esc(DAY.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/'))}${ED === 'krmid' ? ' 오전' : ''}</span></div>
${MOVE ? `<div class="chip" style="background:${MOVE.up ? '#E5262B' : MOVE.pct < 0 ? '#1F5BFF' : '#475569'}">${esc(MOVE.chip)}</div>` : ''}
<div class="l" style="top:${MOVE ? 300 : 200}px;color:#FFD400">${esc(thumbLines[0] ?? '')}</div><div class="l" style="top:${MOVE ? 450 : 350}px;color:#fff">${esc(thumbLines[1] ?? '')}</div>`);
  await tp.evaluate(() => { for (const el of document.querySelectorAll('.chip,.l')) { let f = parseFloat(getComputedStyle(el).fontSize); while (el.getBoundingClientRect().right > 680 && f > 56) { f -= 4; el.style.fontSize = `${f}px`; } } });
  await tp.screenshot({ path: THUMB, type: 'jpeg', quality: 88 }); await tb.close();
}
const timeline = []; { let acc = 0; for (const [k, s] of segs.entries()) { if (!segs.slice(0, k).some((x) => x.ci === s.ci)) timeline.push({ title: chapters[s.ci].heading, start: Math.round(acc) }); acc += probe(parts[k]).dur; } }
const { chapterLines } = await import('../lib/roundup.mjs');
// 설명란 — 10/23 agy·Claude: 추적 꼬리표(utm)·수집처 이름(ForexFactory·Nasdaq)·줄마다 "마감"·포인트 변동은 시청자에게 소음.
//   첫 줄 = 가장 크게 움직인 지수와 그 이유(검색 목록 미리보기에 보이는 두 줄). 참고 기사는 장마다 하나.
const pctLine = (q) => `· ${q.name} ${q.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${q.pct > 0 ? '+' : ''}${q.pct.toFixed(2)}%)${q.closed ? '' : ` 장중${hhmm(q) ? ` ${hhmm(q)}` : ''}`}`;
const outlet = (src) => String(src).replace(/\s*(국제|경제|사회)$/, '');
// 장마다 아직 안 쓴 첫 기사 — 모든 장이 마감 종합 기사 하나를 먼저 인용해 참고 기사가 1건만 남았다(10/23 시험 렌더).
const refs = []; for (const c of chapters) { if (c.kind === 'calendar') continue; const n = c.sources.find((x) => Number.isInteger(x) && !refs.includes(x)); if (n !== undefined) refs.push(n); }
const description = [chapters[0].sentences.slice(1, 3).join(' '), '',
  '📈 매일 무료 AI 투자 리포트: https://flowvium.net/ko/report', '',
  ...chapterLines(timeline), '',
  ...quotes.map(pctLine), '',
  '참고 기사', ...refs.map((n) => `· ${outlet(docs[n].source)} — ${docs[n].headline} ${docs[n].link}`), '',
  '※ 기사·시세를 정리한 요약이며 특정 종목의 매수·매도 권유가 아닙니다.',
  `#${ED === 'us' ? '미국증시' : '한국증시'} #증시요약 #${ED === 'us' ? '나스닥' : '코스피'} #주식 #Flowvium`].join('\n').slice(0, 4800);
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ edition: ED, date: DATE, title, description, seconds: LEN }, null, 2));
log(`[메타] "${title}"`);

// ── 11. 올리기 — 한국·유럽판은 미국 개장 1시간 전 예약 공개(그 시각이 10분 안쪽이거나 지났으면 바로 공개)
if (UPLOAD) {
  const { upload, setThumbnail, currentChannel, channelMismatch } = await import('../lib/youtube.mjs');
  const { loadEnvLocal } = await import('../lib/llm-config.mjs'); loadEnvLocal();
  const bad = channelMismatch(await currentChannel(), process.env.YOUTUBE_CHANNEL_ID);
  if (bad) die(bad);
  const target = publishTargetMs(ED, DATE);
  const publishAt = UPLOAD === 'public' && target && target - Date.now() > 10 * 60_000 ? new Date(target).toISOString() : null;
  const u = await upload({ file: FINAL, title, description, privacy: UPLOAD, publishAt,
    tags: [E.label.replace(/\s/g, ''), '증시요약', ED === 'us' ? '미국증시' : '한국증시', ED === 'us' ? '나스닥' : '코스피', ED === 'us' ? '뉴욕증시' : ED === 'kreu' ? '유럽증시' : '코스닥', '주식', '경제', 'Flowvium'] });
  const th = await setThumbnail(u.id, THUMB);
  log(`✅ 올림 ${u.url} (${publishAt ? `예약 ${new Date(Date.parse(publishAt) + 9 * 3600e3).toISOString().slice(11, 16)} KST` : UPLOAD}) · 썸네일 ${th.ok ? '적용' : `실패 ${th.reason}`}`);
  history.push({ edition: ED, date: DATE, promo: PROMO.name, id: u.id, privacy: UPLOAD, publishAt, title, seconds: Math.round(LEN), at: new Date().toISOString() });
  writeFileSync(HIST, JSON.stringify(history, null, 2));
  if (UPLOAD === 'public') {
    const out = openSync(join(ROOT, 'logs/pin-comment.log'), 'a');
    // 예약 공개는 공개 뒤에야 댓글이 보인다 — 공개 시각 + 10분에 확인한다.
    const delay = publishAt ? Math.max(600, Math.round((Date.parse(publishAt) - Date.now()) / 1000) + 600) : 600;
    spawn(process.execPath, [join(ROOT, 'scripts/yt-pin-comment.mjs'), '--ids', u.id, '--kind', 'long', '--then-verify', String(delay)], { detached: true, stdio: ['ignore', out, out] }).unref();
  }
}
lock.release();

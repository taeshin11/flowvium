#!/usr/bin/env node
/**
 * make-blog-post.mjs — 발간한 보고서를 **사람이 읽는 글**로 다시 쓴다. (2026-09-18 재작성)
 *
 * 사용자 요청: "보고서 쓴 후에 이거를 정리해서 블로그에도 써주면 좋겠네. 제목은 트래픽 높게,
 *   맨 밑에 flowvium.net 광고 넣고 유투브 광고넣고" → 이어서 "좀 블로그 글 스럽게",
 *   "열심히 분석 및 정리한 글처럼".
 *
 * 첫 판은 보고서 필드를 섹션마다 그대로 붙였다. 그래서 '~했다 / ~을 의미한다' 의 문어체가
 *   그대로 남았고, 종목은 한 줄 불릿으로 떨어져 정리해 붙인 티가 났다. 이번 판은
 *     · 문장을 web 레인(:8001 소형)으로 **존댓말 블로그 말투로 고쳐 쓰고**
 *     · 고쳐 쓴 문장에 원문에 없는 숫자가 있으면 **버리고 원문으로 되돌린다**(blog-voice.mjs)
 *     · 종목을 불릿이 아니라 한 종목당 한 문단으로 풀고, 진입·손절·목표를 문장 안에 넣는다
 *     · 과거 추천 성적표를 넣는다 — 숫자를 공개하는 글이 읽을 값어치가 있다
 *   27B(:8000)는 쓰지 않는다. 보고서 직후에 도는 일이라 28GB 를 다시 올릴 수 없다.
 *
 * ⚠ 올리는 것은 이 스크립트가 하지 않는다. 네이버는 자동 게재를 약관으로 금지하고
 *   글쓰기 API 를 2020-05 종료했다. 티스토리 오픈 API 도 2024-02 완전 종료됐다.
 *   자동 게시가 되는 곳(Blogger·WordPress·자체 사이트)은 별도 스크립트로 붙인다.
 *
 * 사용: node scripts/make-blog-post.mjs [--session morning] [--date 2026-09-18] [--no-llm]
 */
import { openDb } from './lib/db.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { loadEnvLocal } from './lib/llm-config.mjs';
import { rewriteBlock, llmCaller, toPolite } from './lib/blog-voice.mjs';
import { agyCaller } from './lib/agy.mjs';
import { pickOpener } from './lib/blog-openers.mjs';

loadEnvLocal?.();
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const useLlm = !process.argv.includes('--no-llm');

const db = openDb();
const where = [`locale='ko'`];
if (arg('session')) where.push(`session='${arg('session')}'`);
if (arg('date')) where.push(`kst_date='${arg('date')}'`);
const row = db.prepare(`SELECT * FROM reports WHERE ${where.join(' AND ')} ORDER BY generated_at DESC LIMIT 1`).get();
if (!row) { console.error('❌ 보고서를 못 찾았다'); process.exit(2); }
const r = JSON.parse(row.full_json);

const SITE = process.env.SITE_URL || 'flowvium.net';
const CH = process.env.YOUTUBE_CHANNEL_ID ? `https://www.youtube.com/channel/${process.env.YOUTUBE_CHANNEL_ID}` : null;
const latestShort = db.prepare('SELECT video_id, headline FROM shorts_published WHERE retracted_at IS NULL ORDER BY published_at DESC LIMIT 1').get();

/** 보고서 원문에는 소수점이 길게 남아 있다(+2.392873302328341%). 읽는 글에는 두 자리로 줄인다. */
const tidy = (t) => String(t ?? '').replace(/-?\d+\.\d{3,}/g, (n) => Number(n).toFixed(2)).trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : null);

const sessionKo = { morning: '아침', noon: '점심', afternoon: '오후', evening: '저녁', midnight: '마감' }[row.session] ?? row.session;
const [, mm, dd] = row.kst_date.split('-');
const md = `${Number(mm)}월 ${Number(dd)}일`;
const lv = r.indexLevelsAbs ?? {};

/**
 * 지수 등락률을 보고서 문장에서 꺼낸다. 없으면 null — 지어내지 않는다.
 * 소수점 종가(VIX 15.44(-12.8%))도 잡아야 하고, 이름이 한 곳에만 나오는 지수(코스닥)도 있어
 * 기술적분석과 논지 두 곳을 다 본다.
 */
function pctOf(...names) {
  const hay = `${r.technicalAnalysis ?? ''}\n${r.thesis ?? ''}`;
  for (const name of names) {
    const m = new RegExp(`${name}\\s*(?:[\\d,]+(?:\\.\\d+)?\\s*)?\\(([-+][\\d.]+)%\\)`, 'i').exec(hay);
    if (m) return Number(m[1]);
  }
  return null;
}
const pct = {
  kospi: pctOf('KOSPI', '코스피'), kosdaq: pctOf('KOSDAQ', '코스닥'),
  nasdaq: pctOf('나스닥', 'Nasdaq'), sp500: pctOf('S&P500'), vix: pctOf('VIX'),
};

/**
 * 제목 후보.
 *
 * 긴 꼬리를 먼저 둔다 — '코스피 전망' 같은 대표 검색어는 증권사·대형 블로그가 잡고 있어
 *   새 글이 그 자리에 못 올라간다. 실제로 들어오는 검색은 "코웨이 목표주가" 처럼
 *   쓰는 사람이 적고 구체적인 말이다. 지수 숫자는 정수로 쓴다 — 사람은 6,715.41 이 아니라
 *   '코스피 6715' 로 검색한다.
 * 숫자와 이름은 전부 보고서에 있는 값이다. 끌기 위해 지어내면 그 순간 못 쓰는 글이 된다.
 */
function titles() {
  const out = [];
  // 국내 여부는 티커 접미사로 본다 — market 필드는 'korea'/'kr' 로 표기가 갈린다(실측 'korea').
  const isKr = (p) => /\.(KS|KQ)$/i.test(String(p?.ticker ?? ''));
  const kr = (r.portfolio ?? []).find(isKr);
  const us = (r.portfolio ?? []).find((p) => !isKr(p));
  const round = (v) => Math.round(Number(v)).toLocaleString('ko-KR');

  if (kr?.name) out.push(`${kr.name} 주가 ${md} 진입가·손절가 정리${kr.target ? ` (목표 ${kr.target})` : ''}`);
  if (us?.name) out.push(`${us.name}(${us.ticker}) 왜 담았나 — ${md} 미국주식 정리`);
  if (lv.KOSPI != null) {
    const dir = pct.kospi == null ? '' : pct.kospi > 0.05 ? ' 상승' : pct.kospi < -0.05 ? ' 하락' : ' 보합';
    out.push(`코스피 ${round(lv.KOSPI)}${dir} · ${md} 증시 정리와 오늘의 관심 종목`);
  }
  if (lv.Nasdaq != null && pct.nasdaq != null) out.push(`나스닥 ${round(lv.Nasdaq)}(${pct.nasdaq > 0 ? '+' : ''}${pct.nasdaq}%) ${md} 미국 증시 브리핑`);
  out.push(`${md} ${sessionKo} 증시 브리핑 · 오늘 시장 한눈에`);
  return out;
}

// ── 고쳐 쓸 덩어리를 모은다.
//
// **한 번에 하나씩만 보낸다.** 2026-09-18 실측: 처음엔 두 갈래씩 흘렸는데(최대 8개 동시)
//   mlx_lm 의 배치 생성기가 슬롯을 정리하다 `logits_processors[e]` 가 None 이 되며
//   생성 스레드가 통째로 죽었다(generate.py:1346 TypeError). 오늘 두 번 재현했고,
//   그때마다 /v1/models 는 200 인데 완료는 영영 안 왔다 — 웹 레인은 사이트 번역·챗도
//   쓰는 곳이라 내 블로그 작업이 남의 기능을 죽이는 꼴이었다.
//   한 덩어리가 1~2초라 직렬로 돌려도 전체 15초 안쪽이다. 속도를 위해 남의 기능을 걸 이유가 없다.
// 2026-09-19 사용자 "4B쓰던것들 다 넘기고 4B는 끄자" — 고쳐쓰기는 agy(gemini-3.1-pro)로 간다.
//   로컬 4B 는 번역투와 한자 섞임을 냈다("한국两地" 가 실제로 발행됐다). 같은 문장을 agy 로
//   돌리니 어순이 뒤엉킨 원문까지 바로잡혔다(실측 24초).
//   폴백은 남긴다 — 오늘 구글이 Gemini CLI 를 하루아침에 닫는 걸 봤다.
const call = useLlm ? agyCaller(llmCaller('web')) : null;
const stats = { llm: 0, fallback: 0, why: [] };
async function voice(src, style) {
  const res = await rewriteBlock(tidy(src), { call, style });
  stats[res.used] += 1;
  if (res.why) stats.why.push(res.why);
  return res.text;
}
async function mapSeq(items, fn) {
  const out = [];
  for (const [i, it] of items.entries()) out.push(await fn(it, i));
  return out;
}

const picks = (r.portfolio ?? []).slice(0, 3);
const risks = (r.riskEvents ?? []).slice(0, 2);
const reasons = (r.marketVerdict?.reasons ?? []).slice(0, 3);

const thesis = await voice(r.thesis, '시장을 매일 들여다보는 사람이 블로그 도입부에 쓰듯, 두세 문단으로 나눠');
const technical = await voice(r.technicalAnalysis, '지수 움직임을 독자에게 설명하듯 한 문단으로');
const pickTexts = await mapSeq(picks, (p) => voice(String(p.rationale ?? '').split('|')[0], '이 종목을 왜 봤는지 두세 문장으로'));
const riskTexts = await mapSeq(risks, (e) => voice(`${e.event} — ${e.watchFor ?? ''}`, '무엇을 확인해야 하는지 한 문장으로'));

// 판단 근거는 고쳐 쓰지 않는다. `경보 상승 구간(30) — EM Equities 1주 -4.03% 급락 · USD/KRW +2.39%`
//   같은 압축 기록은 세 번 시도해 둘은 뜻이 틀렸고(30→30일, 20일→20%p) 하나는 문장이 깨졌다.
//   이건 근거 목록이지 설명문이 아니다. 적어 둔 그대로 두는 편이 읽는 사람에게 정직하다.
const reasonTexts = reasons.map((x) => tidy(x));

// ── 본문 조립
const L = [];
const verdictKo = { buy: '매수', wait: '관망', sell: '축소', hold: '유지' }[r.marketVerdict?.verdict] ?? r.marketVerdict?.verdict;

// 도입부는 날짜에 따라 돌린다. 매 글이 같은 문장으로 시작하면 읽는 사람도 지겹고,
//   검색 엔진에는 대량 생산의 표시가 된다(2026-09-18 실측: 같은 날 글끼리 61% 겹침).
//   무작위가 아니라 날짜 기반이라 같은 날 다시 만들어도 같은 문장이 나온다.
L.push(pickOpener(mm, dd, row.session)(md, sessionKo));
L.push('');

L.push('## 오늘 시장, 이렇게 봤습니다');
L.push('');
L.push(thesis || toPolite(tidy(r.thesis)));
L.push('');

if (Object.keys(lv).length) {
  L.push('## 지수부터 짚고 가겠습니다');
  L.push('');
  L.push('| 지수 | 종가 | 등락 |');
  L.push('| --- | ---: | ---: |');
  for (const [key, label, p] of [['KOSPI', '코스피', pct.kospi], ['KOSDAQ', '코스닥', pct.kosdaq],
    ['Nasdaq', '나스닥', pct.nasdaq], ['S&P500', 'S&P500', pct.sp500], ['VIX', 'VIX', pct.vix]]) {
    if (lv[key] == null) continue;
    // -0.0 은 '보합'이지 하락이 아니다. 부호를 붙이면 읽는 사람이 오해한다.
    const cell = p == null ? '–' : Math.abs(p) < 0.05 ? '보합' : `${p > 0 ? '+' : ''}${p}%`;
    L.push(`| ${label} | ${num(lv[key])} | ${cell} |`);
  }
  L.push('');
  if (technical) { L.push(technical); L.push(''); }
}

if (verdictKo) {
  L.push('## 그래서 오늘은 어떻게 볼까');
  L.push('');
  L.push(`오늘 판단은 **${verdictKo}** 입니다. 근거는 이렇습니다.`);
  L.push('');
  for (const t of reasonTexts.filter(Boolean)) L.push(`- ${t}`);
  L.push('');
}

if (picks.length) {
  L.push('## 눈여겨본 종목');
  L.push('');
  picks.forEach((p, i) => {
    L.push(`### ${p.name ?? p.ticker} (${p.ticker})`);
    L.push('');
    L.push(pickTexts[i] || toPolite(tidy(String(p.rationale ?? '').split('|')[0])));
    const plan = [];
    if (p.entryZone) plan.push(`진입은 ${p.entryZone} 구간`);
    if (p.stopLoss) plan.push(`손절선은 ${p.stopLoss}`);
    if (p.target) plan.push(`목표는 ${p.target}`);
    if (plan.length) { L.push(''); L.push(`${plan.join(', ')}으로 잡았습니다.`); }
    L.push('');
  });
}

const po = r.portfolioOutcomes;
if (po?.closed > 0) {
  L.push('## 지난 추천은 어땠나');
  L.push('');
  L.push(`좋은 얘기만 적으면 읽을 값어치가 없으니 성적표도 같이 둡니다. 지금까지 정리를 끝낸 ${po.closed}건 중 ` +
    `수익으로 닫은 비중이 ${po.winRate}%, 평균 손익은 ${po.avgPnl > 0 ? '+' : ''}${po.avgPnl}% 입니다. ` +
    (po.spyAlpha != null ? `같은 기간 지수를 따라갔을 때와 비교하면 ${po.spyAlpha > 0 ? '+' : ''}${po.spyAlpha}%p 차이입니다. ` : '') +
    `종목별 기록은 사이트에서 전부 볼 수 있습니다.`);
  L.push('');
}

if (risks.length) {
  L.push('## 앞으로 확인할 일정');
  L.push('');
  risks.forEach((e, i) => L.push(`- **${e.date}** ${riskTexts[i] || toPolite(tidy(`${e.event} — ${e.watchFor ?? ''}`))}`));
  L.push('');
}

L.push('---');
L.push('');
L.push('### 이 정리는 어디서 나오나');
L.push('');
L.push(`**${SITE}** 에서 하루 다섯 번 시장을 정리하고 있습니다. 종목별 상세, 진입·손절 근거, 지난 추천의 성적표까지 사이트에서 그대로 볼 수 있습니다.`);
L.push('');
L.push(`👉 **https://${SITE}**`);
L.push('');
if (CH) {
  L.push('### 1분 영상으로도 올립니다');
  L.push('');
  L.push('글이 길어 부담스러우시면 그날 이슈만 짧게 묶은 영상도 있습니다.');
  if (latestShort?.video_id) L.push(`- 최근 영상: https://www.youtube.com/watch?v=${latestShort.video_id}`);
  L.push(`- 채널: ${CH}`);
  L.push('');
}
L.push('> 투자 판단과 그 결과는 본인에게 있습니다. 이 글은 정보 제공이며 매매 권유가 아닙니다.');

const body = L.join('\n').replace(/\n{3,}/g, '\n\n');
const outDir = resolve(ROOT, 'reports/blog');
mkdirSync(outDir, { recursive: true });
const base = `${row.kst_date}-${row.session}`;
const cand = titles();
writeFileSync(resolve(outDir, `${base}.md`), `<!-- 제목 후보\n${cand.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n-->\n\n# ${cand[0]}\n\n${body}\n`, 'utf8');
console.log(`✅ ${resolve(outDir, `${base}.md`)}`);
console.log('제목 후보:');
cand.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log(`본문 ${body.length}자 · 종목 ${picks.length} · 일정 ${risks.length}`);
console.log(`말투 고쳐쓰기: LLM ${stats.llm} · 원문유지 ${stats.fallback}${stats.why.length ? ` (${[...new Set(stats.why)].join(', ')})` : ''}`);

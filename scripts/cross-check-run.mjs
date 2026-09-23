#!/usr/bin/env node
/**
 * cross-check-run.mjs — 산출물을 두 모델에 교차검증시키고, 화면은 눈으로 보게 한다. (2026-09-23 신설)
 *
 * 왜 (사장님 "각 페이지별로 교차 검증 시키고 눈 검증 시키고 … 블로그랑 쇼츠도"):
 *   지금까지의 관문은 전부 **규칙**이다 — 길이·숫자·중복·NULL 비율. 규칙은 "말이 되는가" 를 못 본다.
 *   오늘 실제로 그게 드러났다: 쇼츠 블로그 한 절에 '작업을 완료했습니다. 추가로 도움이…' 가
 *   그대로 실렸는데 숫자 관문 넷을 전부 통과했다.
 *
 * 왜 두 모델인가:
 *   한 모델은 지어낸다. 첫 실전에서 claude-opus 가 `S&P500 키에 &amp; 가 섞였다` 고 했는데
 *   실제로는 없었다. 그래서 (1) 근거를 원문과 대조하고 (2) 두 모델이 같은 곳을 짚을 때만
 *   confirmed 로 올린다. 한쪽만 짚은 것은 버리지 않고 사람에게 남긴다.
 *
 * 눈검증은 Claude 단독이다 — Gemini 는 이미지를 못 받는다(실측 503 Eligibility, 두 번 다).
 *
 * 사용:
 *   node scripts/cross-check-run.mjs --what=page   --path=/ko/report
 *   node scripts/cross-check-run.mjs --what=blog   --limit=1
 *   node scripts/cross-check-run.mjs --what=shorts --limit=3
 *   (--shot=<png> 를 주면 그 화면을 눈검증까지 한다)
 */
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { crossCheck, ask, VISION_MODEL, NO_SHELL, OUTPUT_CONTRACT } from './lib/cross-check.mjs';
import { openDb } from './lib/db.mjs';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1] ?? d;
const WHAT = arg('what', 'page');
const LIMIT = Number(arg('limit', '1')) || 1;
const SHOT = arg('shot', '');
const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/** 무엇을 볼지에 따라 보는 눈이 다르다. 한 프롬프트로 다 보려 하면 아무것도 제대로 못 본다. */
const LENS = {
  page: [
    '아래는 flowvium.net 의 한 페이지가 쓰는 데이터다.',
    '**내부 정합성만** 보아라 — 바깥 지식으로 사실 여부를 따지지 마라.',
    '보는 것: 같은 수치가 두 곳에서 다른가 · 서술이 수치와 반대를 말하는가 ·',
    '  한국어 글에 깨진 표기(음차 중단·한자·HTML 엔티티)가 있는가 · 비면 안 되는 곳이 비었는가.',
  ],
  blog: [
    '아래는 곧 블로그에 발행될 글이다. **독자가 읽었을 때 이상한 곳**을 찾아라.',
    '보는 것: 글 대신 챗봇 답변("작업을 완료했습니다" 류)이 섞였는가 ·',
    '  제목의 따옴표·괄호가 짝이 맞는가 · 제목이 말한 건수와 본문 절 수가 맞는가 ·',
    '  한 절이 원문의 핵심(무엇을/어디서/얼마)을 빠뜨렸는가 · 같은 말이 두 번 나오는가 ·',
    '  사람이 쓴 글로 읽히는가(기계가 찍어낸 티가 나는 곳).',
  ],
  shorts: [
    '아래는 이미 발행된 쇼츠의 제목·훅·본문이다. **화면에 그대로 박혀 나간 글자들**이다.',
    '보는 것: 훅이 본문 내용과 어긋나는가(주어가 뒤집혔는가) · 훅만 보고 오해할 여지가 있는가 ·',
    '  잘린 문장이나 깨진 표기가 있는가 · 낚시라고 느낄 만큼 본문과 동떨어졌는가.',
  ],
};

function verdictPrompt(kind, subject) {
  return [...LENS[kind], '', '```', subject, '```', '',
    'where 에는 어디가 문제인지 적어라(블로그·쇼츠는 절 제목이나 훅, 페이지는 필드 경로).',
    '확실하지 않은 것은 findings 가 아니라 unknown 에 넣어라. 애매한 것을 결함으로 올리지 마라.',
  ].join('\n');
}

/** 검증 대상을 모은다. 여기서 **원문 그대로**를 함께 돌려준다 — 근거 대조에 쓴다. */
async function collect(kind) {
  if (kind === 'page') {
    const path = arg('path', '/ko/report');
    const api = path.includes('report') ? '/api/investment-strategy?locale=ko' : null;
    if (!api) throw new Error(`아직 이 경로의 데이터 출처를 모른다: ${path} — --what=blog|shorts 를 쓰거나 출처를 등록할 것`);
    const d = await (await fetch(`${BASE}${api}`, { signal: AbortSignal.timeout(30000) })).json();
    const slim = JSON.stringify({
      source: d.source, model: d.model, session: d.session, stance: d.stance, riskLevel: d.riskLevel,
      thesis: d.thesis, marketNarrative: d.marketNarrative, macroAnalysis: d.macroAnalysis,
      indexLevelsAbs: d.indexLevelsAbs, portfolio: (d.portfolio ?? []).slice(0, 5),
    }, null, 1);
    return [{ id: path, text: slim }];
  }
  if (kind === 'blog') {
    const dir = resolve(ROOT, 'reports/blog');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, LIMIT);
    return files.map((f) => ({ id: f, text: readFileSync(resolve(dir, f), 'utf8') }));
  }
  const db = openDb();
  const rows = db.prepare(
    'SELECT video_id, headline, hooks_json, bodies_json FROM shorts_published WHERE hooks_json IS NOT NULL ORDER BY published_at DESC LIMIT ?').all(LIMIT);
  return rows.map((r) => ({
    id: r.video_id,
    text: JSON.stringify({ headline: r.headline, hooks: JSON.parse(r.hooks_json || '[]'), bodies: JSON.parse(r.bodies_json || '[]') }, null, 1),
  }));
}

const items = await collect(WHAT);
if (!items.length) { console.log('검증할 것이 없다'); process.exit(0); }
console.log(`교차검증 ${WHAT} ${items.length}건 — 두 모델에 따로 묻고 맞댄다\n`);

const out = [];
for (const it of items) {
  const t0 = Date.now();
  const r = crossCheck({ prompt: verdictPrompt(WHAT, it.text), subjectText: it.text, timeoutMs: 600_000 });
  const mark = { pass: '✅', confirmed: '❌', disagree: '⚠️ ', inconclusive: '❓' }[r.status];
  console.log(`${mark} ${it.id}  (${((Date.now() - t0) / 1000).toFixed(0)}초) — ${r.status}: ${r.why}`);
  for (const run of r.runs) if (!run.verdict) console.log(`     · ${run.model} 실패: ${run.why}`);
  for (const f of r.agreed) console.log(`     ❌둘다 [${f.severity}] ${f.where} — ${String(f.what).slice(0, 160)}`);
  for (const f of [...r.onlyA, ...r.onlyB]) console.log(`     ⚠ 한쪽 [${f.severity}] ${f.where} — ${String(f.what).slice(0, 140)}`);
  for (const f of r.unverified ?? []) console.log(`     ✂ 근거없음(버림) ${f.where} — "${String(f.evidence).slice(0, 50)}"`);
  out.push({ id: it.id, status: r.status, agreed: r.agreed, onlyA: r.onlyA, onlyB: r.onlyB, unverified: r.unverified,
    runs: r.runs.map((x) => ({ model: x.model, sec: Number(x.sec.toFixed(1)), ok: Boolean(x.verdict), why: x.why })) });
}

// 눈검증 — Claude 단독. Gemini 는 이미지를 못 받는다(실측).
if (SHOT && existsSync(SHOT)) {
  console.log(`\n눈검증 (${VISION_MODEL}) — ${SHOT}`);
  const v = ask({
    model: VISION_MODEL, files: [SHOT], timeoutMs: 600_000,
    prompt: [`같은 폴더의 ${SHOT.split('/').pop()} 를 read_file 로 열어 **화면을 보아라.**`,
      '사람이 이 화면을 봤을 때 이상하게 느낄 곳만 적어라.',
      '보는 것: 글자가 잘렸는가 · 겹쳤는가 · 빈 칸이나 깨진 자리(로딩 실패·회색 상자)가 있는가 ·',
      '  숫자가 자리를 벗어났는가 · 한국어 화면에 영어가 그대로 남았는가.',
      'where 에는 화면에서의 위치를 적어라(예: "상단 요약 카드").',
      '실제로 **보이는 것**만 적어라. 안 보이면 unknown 에 넣어라.'].join('\n'),
  });
  if (!v.verdict) console.log(`  ❓ 실패: ${v.why}`);
  else {
    console.log(`  ${v.verdict.findings.length ? '⚠️ ' : '✅'} ${v.sec.toFixed(0)}초 · 지적 ${v.verdict.findings.length}건`);
    for (const f of v.verdict.findings) console.log(`     [${f.severity}] ${f.where} — ${String(f.what).slice(0, 160)}`);
  }
  out.push({ id: SHOT, kind: 'vision', model: VISION_MODEL, verdict: v.verdict, why: v.why });
}

const dest = resolve(ROOT, `logs/cross-check-${WHAT}.json`);
writeFileSync(dest, JSON.stringify({ ts: new Date().toISOString(), what: WHAT, items: out }, null, 1));
console.log(`\n기록: ${dest}`);
// 확인된 것만 실패로 센다. 한쪽 지적·판정 실패는 사람이 볼 몫이라 여기서 막지 않는다.
const confirmed = out.filter((o) => o.status === 'confirmed').length;
const blind = out.filter((o) => o.status === 'inconclusive').length;
if (blind) console.log(`❓ 판정 못 받은 것 ${blind}건 — **통과가 아니다.** 다시 돌릴 것`);
process.exit(confirmed ? 1 : 0);

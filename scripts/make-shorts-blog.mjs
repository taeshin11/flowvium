#!/usr/bin/env node
/**
 * make-shorts-blog.mjs — 올린 쇼츠를 블로그 글로 푼다. (2026-09-18 신설)
 *
 * 사용자 요청: "그냥 그 플로비움 쇼츠영상 올릴 때에도 계속 같이 올리고 그거 주제로 해 가지고."
 *
 * **하루 전편(9편)을 쓰지 않는다.** 구글은 2024년부터 대량 생성 콘텐츠를 명시적으로 강등하고,
 *   자동 생성 뉴스 요약 9편/일은 정확히 그 모양이다. 새 블로그일수록 위험하다.
 *   그래서 하루 상한을 둔다(기본 2편). 사용자에게 그 이유를 말하고 정한 값이다.
 *
 * 얇은 글을 내지 않으려면 **알맹이**가 있어야 한다. 헤드라인만으로는 제목 나열이 된다.
 *   그래서 이 편이 실제로 말한 대본(hooks_json)을 알맹이로 쓴다 — 우리가 직접 쓴 문장이다.
 *   대본이 없는 편은 건너뛴다. 쓸 말이 없으면 안 쓰는 편이 낫다.
 *
 * 말투는 blog-voice 의 관문을 그대로 통과시킨다 — 숫자·단위·한자·압축표기.
 *
 * 사용: node scripts/make-shorts-blog.mjs [--limit 2] [--hours 24] [--no-llm]
 */
import { openDb } from './lib/db.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { loadEnvLocal } from './lib/llm-config.mjs';
import { rewriteBlock, llmCaller, toPolite } from './lib/blog-voice.mjs';

loadEnvLocal?.();
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('limit', 2));
const HOURS = Number(arg('hours', 24));
const useLlm = !process.argv.includes('--no-llm');

const SITE = process.env.SITE_URL || 'flowvium.net';
const CH = process.env.YOUTUBE_CHANNEL_ID ? `https://www.youtube.com/channel/${process.env.YOUTUBE_CHANNEL_ID}` : null;

const db = openDb();
const cols = db.prepare('PRAGMA table_info(shorts_published)').all().map((c) => c.name);
if (!cols.includes('hooks_json')) {
  console.log('아직 대본이 쌓이지 않았다(hooks_json 컬럼 없음) — 다음 회차부터 쓸 수 있다');
  process.exit(0);
}

const outDir = resolve(ROOT, 'reports/blog');
mkdirSync(outDir, { recursive: true });
const LEDGER = resolve(outDir, '.shorts-blogged.json');
const done = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};

const rows = db.prepare(
  `SELECT video_id, headline, headlines_json, hooks_json, published_at, issue_key
     FROM shorts_published
    WHERE retracted_at IS NULL AND hooks_json IS NOT NULL
      AND datetime(published_at) >= datetime('now', ?)
    ORDER BY published_at DESC`,
).all(`-${HOURS} hours`).filter((r) => !done[r.video_id]);

if (!rows.length) { console.log('쓸 거리가 없다 — 대본이 남은 새 쇼츠가 없음'); process.exit(0); }

const call = useLlm ? llmCaller('web') : null;
const stats = { llm: 0, fallback: 0, why: [] };
const voice = async (src, style) => {
  const r = await rewriteBlock(src, { call, style });
  stats[r.used] += 1;
  if (r.why) stats.why.push(r.why);
  return r.text;
};

const made = [];
for (const row of rows.slice(0, LIMIT)) {
  const heads = (() => { try { return JSON.parse(row.headlines_json ?? '[]'); } catch { return []; } })();
  const hooks = (() => { try { return JSON.parse(row.hooks_json ?? '[]'); } catch { return []; } })();
  if (!hooks.length) continue;

  // 알맹이: 대본을 문단으로 푼다. 한 번에 하나씩 보낸다(mlx_lm 배치 사고 회피 — llm-config 주석).
  const paras = [];
  for (const h of hooks.slice(0, 5)) {
    const t = await voice(String(h), '뉴스를 설명하듯 한 문단으로, 없는 사실을 보태지 말고');
    if (t) paras.push(t);
  }
  if (!paras.length) continue;

  const date = String(row.published_at).slice(0, 10);
  const title = String(row.headline ?? '').replace(/^\[[^\]]*\]\s*/, '').replace(/^["“]|["”]$/g, '').trim();

  const L = [];
  L.push(`${date}에 다룬 이슈입니다. 영상으로 먼저 올렸고, 여기에 글로 풀어 둡니다.`);
  L.push('');
  L.push('## 무슨 일이 있었나');
  L.push('');
  L.push(...paras.flatMap((p) => [p, '']));

  if (heads.length > 1) {
    L.push('## 관련 보도');
    L.push('');
    for (const h of heads.slice(0, 5)) L.push(`- ${String(h).replace(/^["“]|["”]$/g, '')}`);
    L.push('');
  }

  L.push('## 영상으로 보기');
  L.push('');
  L.push(`이 내용을 1분 영상으로 정리했습니다.`);
  L.push('');
  L.push(`https://www.youtube.com/watch?v=${row.video_id}`);
  L.push('');
  L.push('---');
  L.push('');
  // 광고 — 사용자 지시("블로그글에 flowvium.net 광고붙어야"). 글마다 빠짐없이 넣는다.
  L.push('### 매일 5회, 시장을 정리합니다');
  L.push('');
  L.push(`**${SITE}** 에서 하루 다섯 번 시장 보고서를 만듭니다. 종목별 진입·손절 근거와 지난 추천의 성적표까지 그대로 볼 수 있습니다.`);
  L.push('');
  L.push(`👉 **https://${SITE}**`);
  L.push('');
  if (CH) {
    L.push('### 채널');
    L.push('');
    L.push(`하루 여러 번 짧은 영상으로도 올리고 있습니다.`);
    L.push(`- 채널: ${CH}`);
    L.push('');
  }
  L.push('> 투자 판단과 그 결과는 본인에게 있습니다. 이 글은 정보 제공이며 매매 권유가 아닙니다.');

  const body = L.join('\n').replace(/\n{3,}/g, '\n\n');
  const file = resolve(outDir, `${date}-short-${row.video_id}.md`);
  writeFileSync(file, `# ${title}\n\n${body}\n`, 'utf8');
  made.push({ file, title, video: row.video_id });
  console.log(`✅ ${file}`);
  console.log(`   ${title}`);
}

if (!made.length) { console.log('만든 글 없음(대본이 비었거나 고쳐쓰기 실패)'); process.exit(0); }
for (const m of made) done[m.video] = { file: m.file, at: new Date().toISOString() };
writeFileSync(LEDGER, JSON.stringify(done, null, 1));
console.log(`\n글 ${made.length}편 · 말투 고쳐쓰기 LLM ${stats.llm} · 원문유지 ${stats.fallback}${stats.why.length ? ` (${[...new Set(stats.why)].join(', ')})` : ''}`);

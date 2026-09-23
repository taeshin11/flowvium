#!/usr/bin/env node
/**
 * make-shorts-blog.mjs — 올린 쇼츠를 묶어서 블로그 글로 푼다. (2026-09-18 신설, 2026-09-21 묶음 방식으로 변경)
 *
 * 사용자 요청: "그냥 그 플로비움 쇼츠영상 올릴 때에도 계속 같이 올리고 그거 주제로 해 가지고."
 *
 * **왜 쇼츠 여러 편을 한 글로 묶는가? (2026-09-21)**
 *   한 편당 한 글을 썼더니, 품질 관문(`blog-quality.mjs`: 알맹이 최소 500자, 정형구 50% 상한)을 한 번도 넘지 못했다.
 *   - 기사 본문 자체가 짧음(RSS 요약 60~85자 수준).
 *   - 실측 결과: a9wdYeyLkpk(273자), tvGAycZYwAQ(192자), We_EJbJ0y9g(385자).
 *   - 결국 기능 신설 후 게시된 글이 0편이었다.
 *   얇은 글 여러 편보다 385자 × 5편 = 1,900자 수준의 두툼한 한 편이 관문 통과에도, 검색 노출(대량 생성 강등 회피)에도 낫다.
 *   그래서 한 번 실행에 글을 하나만 만들고, 거기에 여러 쇼츠를 담는다. 담을 것이 2편 미만이면 만들지 않는다(거절당할 테니).
 *
 * 얇은 글을 내지 않으려면 **알맹이**가 있어야 한다. 헤드라인만으로는 제목 나열이 된다.
 *   그래서 기사 본문(bodies_json)을 알맹이로 쓴다.
 *   본문이 없는 편은 건너뛴다. 쓸 말이 없으면 안 쓰는 편이 낫다.
 *
 * 말투는 blog-voice 의 관문을 그대로 통과시킨다 — 숫자·단위·한자·압축표기.
 *
 * 사용: node scripts/make-shorts-blog.mjs [--max-items 5] [--hours 24] [--no-llm]
 */
import { openDb } from './lib/db.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { loadEnvLocal } from './lib/llm-config.mjs';
import { rewriteBlock, llmCaller, toPolite, stripWrappingQuotes } from './lib/blog-voice.mjs';
import { agyCaller } from './lib/agy.mjs';

loadEnvLocal?.();
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('max-items', arg('limit', 5))); // --limit 은 기존 크론 호환용
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

// 2026-09-20: 조건에 bodies_json 을 넣는다. 훅만 있는 회차로 글을 쓰면 **반드시 거절당한다** —
//   훅은 화면에 띄우는 12자짜리 문구라 문단으로 펴도 알맹이가 200~300자다.
//   실측: 품질 관문이 최소 500자·정형구 50% 인데 쇼츠 글은 273자/63%, 192자/70% 로 걸렸다.
//   만들어 놓고 거절당하는 것보다 **안 만드는 게 낫다**(agy 호출도 아낀다).
//   bodies_json 은 2026-09-20 부터 쌓인다 — 그 전 회차는 재료가 없으니 건너뛴다.
const hasBodies = db.prepare('PRAGMA table_info(shorts_published)').all().some((c) => c.name === 'bodies_json');
const rows = hasBodies ? db.prepare(
  `SELECT video_id, headline, headlines_json, hooks_json, bodies_json, published_at, issue_key
     FROM shorts_published
    WHERE retracted_at IS NULL AND hooks_json IS NOT NULL AND bodies_json IS NOT NULL
      AND datetime(published_at) >= datetime('now', ?)
    ORDER BY published_at ASC`, // 오래된 것부터 담는다(시간 순서가 뒤집히면 읽기 나쁘다)
).all(`-${HOURS} hours`).filter((r) => !done[r.video_id]) : [];

if (!rows.length) {
  console.log(hasBodies
    ? '쓸 거리가 없다 — 기사 본문이 남은 새 쇼츠가 없음(본문 보관은 2026-09-20 부터)'
    : '아직 기사 본문이 쌓이지 않았다(bodies_json 컬럼 없음) — 다음 쇼츠 회차부터 쓸 수 있다');
  process.exit(0);
}

// 고쳐쓰기는 agy 로 간다(make-blog-post 주석 참고). 안 되면 로컬 4B 로 떨어진다.
const call = useLlm ? agyCaller(llmCaller('web')) : null;
const stats = { llm: 0, fallback: 0, why: [] };
const voice = async (src, style, context) => {
  const r = await rewriteBlock(src, { call, style, context });
  stats[r.used] += 1;
  if (r.why) stats.why.push(r.why);
  return r.text;
};

const includedItems = [];
for (const row of rows) {
  if (includedItems.length >= LIMIT) break;

  const heads = (() => { try { return JSON.parse(row.headlines_json ?? '[]'); } catch { return []; } })();
  const hooks = (() => { try { return JSON.parse(row.hooks_json ?? '[]'); } catch { return []; } })();
  const bodies = (() => { try { return JSON.parse(row.bodies_json ?? '[]'); } catch { return []; } })();
  if (!bodies.length) continue;

  // 알맹이: **기사 본문**을 문단으로 고쳐 쓴다. 훅이 아니라 본문이 재료다 —
  //   훅으로 쓰면 알맹이가 300자를 못 넘어 품질 관문에 반드시 걸린다(위 주석).
  //   한 번에 하나씩 보낸다(mlx_lm 배치 사고 회피 — llm-config 주석).
  // 2026-09-23: 종전 `/^["“]|["”]$/g` 은 양끝을 따로 봐서, 인용으로 끝나는 제목의
  //   닫는 따옴표만 지웠다 — 여는 따옴표가 혼자 남은 채 발행됐다. 감쌌을 때만 벗긴다.
  const title = stripWrappingQuotes(String(row.headline ?? '').replace(/^\[[^\]]*\]\s*/, ''));
  const articles = [];
  for (const [i, b] of bodies.slice(0, 5).entries()) {
    const src = String(b ?? '').trim();
    if (src.length < 40) continue;                 // 너무 짧은 본문은 펴도 알맹이가 안 된다
    // 그 회차의 기사 제목을 전부 참고로 준다. 본문과 제목을 번호로 짝지으려다가는 어긋난다 —
    //   대본 장면은 파싱 실패한 것이 걸러지므로(make-shorts 의 filter) 순서가 밀릴 수 있다.
    const t = await voice(src, '뉴스를 설명하듯 두세 문장으로, 없는 사실을 보태지 말고', heads.slice(0, 6));
    if (t) {
      // 훅이 없거나 비면 그 절의 소제목은 쇼츠 headline을 쓴다 (뉴스마다 다른 소제목 부여)
      let h = hooks[i] ? String(hooks[i]).trim() : '';
      if (!h) h = title;
      articles.push({ hook: h, para: t });
    }
  }
  if (!articles.length) continue;

  includedItems.push({ row, title, articles, video_id: row.video_id });
}

// 2편 미만이면 너무 얇아 품질 관문에 통과할 수 없으므로 포기한다.
if (includedItems.length < 2) {
  console.log(`담을 쇼츠가 ${includedItems.length}편뿐이라 만들지 않는다. (2편 미만이면 글이 얇아 품질 관문에 거절당함)`);
  process.exit(0);
}

const firstHeadline = includedItems[0].title;
// 외 N건의 N은 쇼츠 편수가 아니라 실제 담긴 기사 건수 - 1
const totalArticlesCount = includedItems.reduce((acc, cur) => acc + cur.articles.length, 0);
const count = totalArticlesCount - 1;
const recentRow = includedItems[includedItems.length - 1].row;

let pubStr = String(recentRow.published_at);
if (!pubStr.includes('T')) pubStr = pubStr.replace(' ', 'T');
if (!pubStr.endsWith('Z')) pubStr += 'Z';
const recentDateKst = new Date(new Date(pubStr).getTime() + 9 * 3600 * 1000);
const month = recentDateKst.getUTCMonth() + 1;
const day = recentDateKst.getUTCDate();
const mainTitle = `${firstHeadline} 외 ${count}건 — ${month}월 ${day}일 뉴스 정리`;

const L = [];
// 2026-09-23: 여기만 **영상 편수**(4)를 썼고 제목은 **기사 건수**(7)를 써서 같은 글이
//   '외 6건' 과 '4건' 을 동시에 말했다. 본문의 ## 절은 기사마다 하나라 독자가 세는 것은 기사 쪽이다.
//   단위를 기사로 맞추고, 영상 편수는 따로 밝힌다.
L.push(`${totalArticlesCount}건의 주요 이슈를 정리했습니다. 영상 ${includedItems.length}편으로 먼저 올렸고, 여기에 글로 모아 둡니다.`);
L.push('');

for (const item of includedItems) {
  for (const article of item.articles) {
    // 기사 한 건당 ## 절 하나 (각각의 소제목과 내용 연결)
    L.push(`## ${article.hook}`);
    L.push('');
    L.push(article.para);
    L.push('');
  }
}

// 절마다 영상 링크를 반복하지 않고, 마지막에 한 번에 모아서 보여준다 (지저분함 방지)
L.push('## 영상으로 보기');
L.push('');
for (const item of includedItems) {
  L.push(`- ${item.title} — https://www.youtube.com/watch?v=${item.video_id}`);
}
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

// 파일명: KST 기준 실행 시각
const runTimeKst = new Date(Date.now() + 9 * 3600 * 1000);
const ymd = runTimeKst.toISOString().slice(0, 10);
const hm = runTimeKst.toISOString().slice(11, 16).replace(':', '');
const file = resolve(outDir, `${ymd}-shorts-${hm}.md`);

writeFileSync(file, `# ${mainTitle}\n\n${body}\n`, 'utf8');

const nowIso = new Date().toISOString();
for (const item of includedItems) {
  done[item.video_id] = { file, at: nowIso };
}
writeFileSync(LEDGER, JSON.stringify(done, null, 1));

console.log(`✅ ${file}`);
console.log(`   ${mainTitle}`);
console.log(`\n글 1편(쇼츠 ${includedItems.length}편 담음) · 말투 고쳐쓰기 LLM ${stats.llm} · 원문유지 ${stats.fallback}${stats.why.length ? ` (${[...new Set(stats.why)].join(', ')})` : ''}`);

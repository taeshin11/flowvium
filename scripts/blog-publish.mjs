#!/usr/bin/env node
/**
 * blog-publish.mjs — 만들어 둔 블로그 글을 **Blogger 에 올린다**. (2026-09-18 신설)
 *
 * 사용자 "그거 열어서 해" — 네이버는 자동 게재가 약관 위반이라 못 하고, Blogger 는
 *   공식 API(posts.insert)로 정식 경로가 열려 있어 끝까지 자동으로 올린다.
 *
 * 같은 글을 두 번 올리지 않는다: 올린 글의 파일명을 reports/blog/.published.json 에 남기고
 *   이미 있으면 건너뛴다. 크론은 재시도가 잦아서(maxAgeH 미달 재실행) 이 기록이 없으면
 *   같은 날 글이 여러 번 올라간다.
 *
 * 사용: node scripts/blog-publish.mjs [--file <md>] [--draft] [--blog <id>]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join, basename } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { loadEnvLocal } from './lib/llm-config.mjs';
import { mdToHtml, extractTitle, stripFrontComment } from './lib/blog-html.mjs';
import { insertPost, updatePost, listBlogs, tokenPresent } from './lib/blogger.mjs';
import { checkQuality } from './lib/blog-quality.mjs';

loadEnvLocal?.();
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const draft = process.argv.includes('--draft');

if (!tokenPresent()) {
  console.error(`❌ Blogger 토큰 없음 — node scripts/blogger-auth.mjs 를 먼저 실행하라`);
  process.exit(2);
}

const dir = resolve(ROOT, 'reports/blog');
const LEDGER = resolve(dir, '.published.json');
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const force = process.argv.includes('--force');
const MAX = Number(arg('max') ?? 3);

// 올릴 글을 **여러 개** 고른다. 종전에는 최신 한 개만 봤는데, 쇼츠 글이 생기면서
//   파일 이름 정렬상 쇼츠 글이 보고서 글을 가로채는 일이 생겼다(2026-09-18).
//   아직 안 올린 글을 오래된 것부터 올린다 — 시간 순서가 뒤집히면 읽는 사람이 헷갈린다.
const files = arg('file')
  ? [arg('file')]
  : (existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.md')).sort() : [])
      .map((x) => join(dir, x))
      .filter((f) => force || !ledger[basename(f)])
      .slice(0, MAX);

if (!files.length) {
  console.log(existsSync(dir) ? '올릴 새 글이 없다(전부 올렸다)' : '올릴 글이 없다 — 먼저 node scripts/make-blog-post.mjs');
  process.exit(0);
}


let posted = 0;
for (const file of files) {
  const key = basename(file);
    const md = readFileSync(file, 'utf8');
  const title = extractTitle(md);
  if (!title) { console.error(`  ⚠ 제목(# ...)이 없어 건너뛴다: ${key}`); continue; }
  const html = mdToHtml(stripFrontComment(md));

  // 저품질 관문 (사용자 "블로그도 저품질 블로그로 걸리면 안 된다").
  //   얇음·중복·광고과다를 발행 **전에** 잡는다. 이미 올린 글과 비교해야 하므로 원문을 읽어 준다.
  //   광고 블록은 매 편 같으니 길이를 잴 때 빼고 잰다 — 안 그러면 두 줄짜리도 통과한다.
  const prevTexts = Object.keys(ledger).filter((k) => k !== key && ledger[k]?.status !== 'DRAFT')
    .map((k) => { try { return readFileSync(join(dir, k), 'utf8'); } catch { return ''; } })
    .filter(Boolean);
  const q = checkQuality(md, prevTexts);
  if (!q.ok) {
    console.error(`  ⚠ 저품질로 판단해 올리지 않는다: ${key}`);
    for (const i of q.issues) console.error(`     · ${i}`);
    continue;
  }
  console.log(`  품질: 알맹이 ${q.stats.original}자 · 정형구 ${Math.round(q.stats.boilerRatio * 100)}% · 기존글 겹침 ${Math.round(q.stats.overlap * 100)}%`);
  // 같은 날 시장 브리핑은 하루 한 편만. 회차가 달라도 같은 날 장 이야기라 내용이 겹치고,
  //   겹치는 글이 둘이면 검색에서 서로를 갉아먹는다(2026-09-18 실제로 3편이 올라가 되돌렸다).
  const sameDay = key.match(/^(\d{4}-\d{2}-\d{2})-(morning|noon|afternoon|evening|midnight)\.md$/);
  if (sameDay && !force) {
    const dup = Object.entries(ledger).find(([k, v]) => k !== key && v.status !== 'DRAFT'
      && k.startsWith(`${sameDay[1]}-`) && /-(morning|noon|afternoon|evening|midnight)\.md$/.test(k));
    if (dup) { console.log(`  · 같은 날 브리핑이 이미 올라가 있어 건너뛴다: ${key} (기존 ${dup[0]})`); continue; }
  }

let blogId = arg('blog') ?? process.env.BLOGGER_BLOG_ID;
if (!blogId) {
  const blogs = await listBlogs();
  if (blogs.length === 1) {
    blogId = blogs[0].id;
    console.log(`  블로그가 하나뿐이라 그것으로 간다: ${blogs[0].name} (${blogId})`);
  } else {
    console.error(`❌ 어느 블로그에 올릴지 모른다 — .env.local 에 BLOGGER_BLOG_ID 를 넣어라`);
    for (const b of blogs) console.error(`    ${b.id}  ${b.name}  ${b.url}`);
    process.exit(2);
  }
}

  // 라벨은 검색이 아니라 블로그 안 분류용이다. 날짜가 아니라 주제로 붙인다.
  const labels = ['증시브리핑', '주식', ...(/코스피|코스닥/.test(md) ? ['국내증시'] : []), ...(/나스닥|S&P500/.test(md) ? ['미국증시'] : [])];
  console.log(`\n글: ${key}\n제목: ${title}\n본문: ${html.length}자 · 라벨 ${labels.join(', ')}${draft ? ' · **초안**' : ''}`);

  // 이미 올린 글이면 **수정**한다. 같은 내용의 글이 둘이면 검색에서 서로를 갉아먹는다.
  const prev = ledger[key]?.id;
  const r = prev
    ? await updatePost({ blogId, postId: prev, title, html, labels })
    : await insertPost({ blogId, title, html, labels, draft });
  console.log(`✅ ${prev ? '수정' : r.status} — ${r.url}`);
  ledger[key] = { id: r.id, url: r.url, status: r.status, at: new Date().toISOString() };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
  posted += 1;
}
console.log(`\n올린 글 ${posted}편`);

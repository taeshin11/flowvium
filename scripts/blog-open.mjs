#!/usr/bin/env node
/**
 * blog-open.mjs — 만들어 둔 블로그 글을 **클립보드에 넣고 네이버 글쓰기 화면을 연다**. (2026-09-18)
 *
 * 왜 여기까지만 하는가: 네이버 약관은 매크로·로봇 등 **자동화된 수단으로 로그인하거나 게시물을
 *   게재하는 행위**를 금지한다(2018 약관 개정). 2020-05 글쓰기 API 종료도 같은 이유였다.
 *   그래서 이 스크립트는 네이버를 조작하지 않는다 — 클립보드에 넣고 주소를 열 뿐이다.
 *   붙여넣기와 발행은 사람이 한다. 자동화로 올리면 계정이 제재될 수 있고,
 *   그걸 피해 가게 짜는 건 위반을 숨기는 것이라 하지 않는다.
 *
 * 사용: node scripts/blog-open.mjs [--session morning] [--date 2026-09-18] [--no-open]
 */
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { ROOT } from './lib/project-root.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const dir = resolve(ROOT, 'reports/blog');

// 글이 없으면 먼저 만든다 — 사람이 두 번 부르지 않게.
const want = arg('date') && arg('session') ? `${arg('date')}-${arg('session')}.md` : null;
if (!existsSync(dir) || !readdirSync(dir).some((f) => f.endsWith('.md'))) {
  execFileSync('node', ['scripts/make-blog-post.mjs', ...(arg('session') ? ['--session', arg('session')] : [])],
    { cwd: ROOT, stdio: 'inherit' });
}
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const file = want && files.includes(want) ? want : files[files.length - 1];
const raw = readFileSync(join(dir, file), 'utf8');

const titles = [...raw.matchAll(/^(\d)\. (.+)$/gm)].map((m) => m[2]);
const body = raw.replace(/^<!--[\s\S]*?-->\n*/, '').replace(/^# .*\n+/, '');

// 클립보드에 본문을 넣는다(맥). 실패해도 파일 경로는 알려 준다.
let copied = false;
try { spawnSync('pbcopy', { input: body, encoding: 'utf8' }); copied = true; } catch { /* 클립보드 없으면 넘어간다 */ }

console.log(`글: ${join(dir, file)}`);
console.log('제목 후보:');
titles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log(copied ? '\n본문을 클립보드에 넣었습니다 — 글쓰기 화면에서 ⌘V 로 붙여넣으세요.' : '\n(클립보드 복사 실패 — 위 파일을 직접 여세요)');
console.log('발행은 직접 눌러 주세요. 네이버는 자동 게재를 약관으로 금지합니다.');

if (!process.argv.includes('--no-open')) {
  const url = process.env.NAVER_BLOG_WRITE_URL || 'https://blog.naver.com/GoBlogWrite.naver';
  spawnSync('open', [url]);
  console.log(`\n글쓰기 화면을 열었습니다: ${url}`);
}

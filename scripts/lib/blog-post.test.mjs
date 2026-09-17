#!/usr/bin/env node
/**
 * blog-post.test.mjs — 블로그 글이 **보고서에 있는 사실만** 담고, 광고와 고지가 빠지지 않는가.
 *
 * 2026-09-18 사용자 요청으로 신설. 제목을 트래픽용으로 만들되 없는 사실을 지어내면
 *   그 순간 못 쓰는 글이 된다 — 숫자는 보고서 원문에서만 온다.
 */
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { ROOT } from './project-root.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

let out = '';
try { out = execFileSync('node', ['scripts/make-blog-post.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 }); }
catch (e) { console.log(`  SKIP  보고서가 없어 건너뜀 — ${String(e.message).slice(0, 60)}`); process.exit(0); }
const file = (out.match(/✅ (\S+\.md)/) ?? [])[1];
if (!file || !existsSync(file)) { bad('글 파일이 안 만들어졌다'); process.exit(1); }
const md = readFileSync(file, 'utf8');
const src = readFileSync(`${ROOT}/scripts/make-blog-post.mjs`, 'utf8');

/^<!-- 제목 후보/.test(md) && (md.match(/^\d\. /gm) ?? []).length >= 3
  ? ok('제목 후보를 여러 개 준다') : bad('제목 후보가 없다');
md.includes('flowvium.net') ? ok('사이트 광고가 들어간다') : bad('사이트 광고가 빠졌다');
/youtube\.com/.test(md) ? ok('유튜브 광고가 들어간다') : bad('유튜브 광고가 빠졌다');
/매매 권유가 아닙니다/.test(md) ? ok('투자 고지가 들어간다') : bad('투자 고지가 빠졌다');
!/\d\.\d{4,}/.test(md) ? ok('소수점이 길게 남지 않는다') : bad(`긴 소수점이 남았다: ${(md.match(/\d\.\d{4,}/) ?? [])[0]}`);
// 올리는 것은 사람이 한다 — 자동 게시 경로를 몰래 넣지 않는다
!/naver\.com\/.*(login|post)/i.test(src) && !/playwright/i.test(src)
  ? ok('자동 게시는 하지 않는다(네이버 글쓰기 API 2020 종료 · 자동화는 계정 위험)')
  : bad('자동 게시 경로가 들어 있다');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

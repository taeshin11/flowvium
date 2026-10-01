#!/usr/bin/env node
/**
 * site-link.test.mjs — 우리가 내보내는 flowvium.net 링크에 출처 꼬리표(utm)를 단다. 2026-10-02 신설.
 *   사장님 "aisviagent.com 과 flowvium.net 유입 늘리는 방법이 이게 최선이니?" — 재 보니 **어디서 오는지 모른다**:
 *   14일 방문 ~5명/일, utm 0건, 유튜브 /go 클릭 30일 14건(조회 17.9만). 쇼츠 설명·댓글 링크는 2023-08-31 부터 안 눌린다.
 *   블로그·게시물·메일이 실제로 사람을 보내는지 재려면 링크마다 출처를 달아야 한다(사이트 비콘이 utm_source 를 적는다).
 */
import { trackedUrl } from './site-link.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const u = new URL(trackedUrl({ source: 'blog', medium: 'blogger', campaign: '2026-10-02 아침' }));
(u.origin === 'https://flowvium.net' && u.pathname === '/ko/report' && u.searchParams.get('utm_source') === 'blog' && u.searchParams.get('utm_medium') === 'blogger' && u.searchParams.get('utm_campaign') === '2026-10-02 아침')
  ? ok(`[1] ${u.href}`) : bad(`[1] ${u.href}`);
const v = new URL(trackedUrl({ source: 'email', path: '/ko' }));
(v.pathname === '/ko' && v.searchParams.get('utm_source') === 'email' && !v.searchParams.has('utm_campaign')) ? ok('[2] 경로·빈 칸은 빼고') : bad(`[2] ${v.href}`);
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

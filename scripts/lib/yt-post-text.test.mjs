#!/usr/bin/env node
/**
 * yt-post-text.test.mjs — 매일 게시물(이미지) 한 편의 글. 2026-09-27 신설.
 * 사장님 "구독자 올릴수있는건 다 해봐". 조사: 게시물은 이제 모든 채널이 쓸 수 있고(구독자 문턱 없음),
 *   이미지 게시물은 쇼츠 피드에서 **비구독자에게도** 추천된다(Help Center · Made on YouTube 2026-09).
 * 원칙: 이미 낸 쇼츠의 사실만 — 지어낸 문장·편드는 설문 없음. 쇼츠 링크와 이유 있는 구독 권유.
 */
import { buildPostText, pickPostVideo } from './yt-post-text.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const t = buildPostText({ title: '이란 고위 관리 "美 호르무즈 재개방 조건…" #Shorts', videoId: 'abc123' });
(/오늘 가장 많이 본/.test(t) && /https:\/\/youtube\.com\/shorts\/abc123/.test(t) && /구독/.test(t) && !/#Shorts/.test(t))
  ? ok('[1] 제목(#Shorts 뗌)·쇼츠 링크·구독 권유') : bad(`[1] ${t}`);
// [2] 오늘 나온 것 중 조회 최고, 내린 편은 뺀다
{
  const rows = [
    { video_id: 'a', views: 900, published_at: '2026-09-27T01:00:00Z', retracted_at: null, title: 'A' },
    { video_id: 'b', views: 1500, published_at: '2026-09-27T03:00:00Z', retracted_at: '2026-09-27T05:00:00Z', title: 'B' },
    { video_id: 'c', views: 1200, published_at: '2026-09-27T02:00:00Z', retracted_at: null, title: 'C' },
  ];
  const p = pickPostVideo(rows);
  p?.video_id === 'c' ? ok('[2] 내린 편 빼고 조회 최고(c)') : bad(`[2] ${p?.video_id}`);
  pickPostVideo([]) === null ? ok('[2b] 없으면 null(안 올린다)') : bad('[2b]');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

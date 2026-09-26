#!/usr/bin/env node
/**
 * yt-playlists.test.mjs — 쇼츠를 주제별 재생목록에 넣는다(구독 유도 — 채널 페이지 정리). 2026-09-27 신설.
 * 사장님 "구독자 올릴수있는건 다 해봐 웹검색, 레퍼런스 검색 다 해봐". 채널 재생목록이 0개였다.
 * 조사: 주제 재생목록은 근거가 약하지만(일화) 채널 페이지에서 구독을 결정하는 사람에게 보이는 자리이고,
 *   Data API(youtube 스코프)로 자동화된다(playlists.insert · playlistItems.insert, 각 50 units).
 */
import { playlistTitleFor, ensureTopicPlaylist } from './yt-playlists.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
(playlistTitleFor('국내정치') === '국내정치 이슈 · 40초 쇼츠' && playlistTitleFor('국제·외교·전쟁') === '국제·외교 이슈 · 40초 쇼츠'
  && playlistTitleFor('증시·금리·환율') === '증시·금리·환율 · 40초 쇼츠' && playlistTitleFor('기업·산업') === '기업·산업 · 40초 쇼츠')
  ? ok('[1] 주요 4주제 → 재생목록 제목') : bad('[1]');
(playlistTitleFor('재난·재해') === '오늘의 이슈 · 40초 쇼츠' && playlistTitleFor(null) === null)
  ? ok('[2] 그 밖 주제 → 모음 재생목록 · 주제 없음 → 넣지 않음') : bad(`[2] ${playlistTitleFor('재난·재해')} ${playlistTitleFor(null)}`);
// [3] 이미 있으면 새로 만들지 않는다(이름으로 찾는다) — 만들면 재생목록이 매번 늘어난다
{
  const calls = [];
  const api = { list: async () => [{ id: 'PL1', title: '국내정치 이슈 · 40초 쇼츠' }], create: async (t) => { calls.push(t); return 'NEW'; } };
  const id = await ensureTopicPlaylist(api, '국내정치 이슈 · 40초 쇼츠');
  const id2 = await ensureTopicPlaylist(api, '기업·산업 · 40초 쇼츠');
  (id === 'PL1' && id2 === 'NEW' && calls.length === 1) ? ok('[3] 있으면 그 id · 없을 때만 만든다') : bad(`[3] ${id} ${id2} ${calls}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

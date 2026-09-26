/**
 * yt-playlists.mjs — 쇼츠를 주제별 재생목록에 넣는다. (2026-09-27 신설)
 * 사장님 "구독자 올릴수있는건 다 해봐". 채널 재생목록이 0개였다 — 채널 페이지에서 구독을 정하는 사람에게 보이는 자리.
 * 근거는 약하다(일화). 대신 싸다: playlists.insert·playlistItems.insert 각 50 units, youtube 스코프로 된다.
 * 주제는 lib/topic-classify 의 고정 목록. 주요 4주제만 따로, 나머지는 '오늘의 이슈' 모음.
 */
import { google } from 'googleapis';
import { authorizedClient } from './youtube.mjs';

const MAIN = { '국내정치': '국내정치 이슈', '국제·외교·전쟁': '국제·외교 이슈', '증시·금리·환율': '증시·금리·환율', '기업·산업': '기업·산업' };
const SUFFIX = ' · 40초 쇼츠';

/** 주제 → 재생목록 제목. 주제가 없으면 null(넣지 않는다). */
export function playlistTitleFor(topic) {
  if (!topic) return null;
  return (MAIN[topic] ?? '오늘의 이슈') + SUFFIX;
}

/** 이름으로 찾고, 없으면 만든다. api = { list(): [{id,title}], create(title): id } — 테스트에서 바꿔 끼운다. */
export async function ensureTopicPlaylist(api, title) {
  const hit = (await api.list()).find((p) => p.title === title);
  if (hit) return hit.id;
  return api.create(title);
}

/** 실제 YouTube 로 도는 api. 목록은 한 프로세스에서 한 번만 읽는다. */
export function youtubePlaylistApi() {
  const yt = google.youtube({ version: 'v3', auth: authorizedClient() });
  let cache = null;
  return {
    async list() {
      if (cache) return cache;
      const r = await yt.playlists.list({ part: ['snippet'], mine: true, maxResults: 50 });
      cache = (r.data.items ?? []).map((i) => ({ id: i.id, title: i.snippet.title }));
      return cache;
    },
    async create(title) {
      const r = await yt.playlists.insert({ part: ['snippet', 'status'], requestBody: {
        snippet: { title, description: `${title.replace(SUFFIX, '')} 뉴스를 40초 쇼츠로 매일 정리합니다. 구독해 두시면 놓치지 않습니다.`, defaultLanguage: 'ko' },
        status: { privacyStatus: 'public' } } });
      cache = null;
      return r.data.id;
    },
    async add(playlistId, videoId) {
      await yt.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } } });
    },
  };
}

/** 한 편을 주제 재생목록에 넣는다. 실패는 던진다(호출부가 로그만 남기고 발행은 계속). */
export async function addToTopicPlaylist(videoId, topic, api = youtubePlaylistApi()) {
  const title = playlistTitleFor(topic);
  if (!title || !videoId) return null;
  const id = await ensureTopicPlaylist(api, title);
  await api.add(id, videoId);
  return { playlistId: id, title };
}

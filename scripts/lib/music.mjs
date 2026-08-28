/**
 * music.mjs — 배경음악 한 곡 고르기.
 *
 * 왜(2026-08-27): 나레이션만 있으면 화면이 정적으로 느껴진다. 뉴스 채널은 거의 예외 없이
 *   저음 베드를 깐다. "살짝만" — 존재를 의식하지 못할 정도가 맞다.
 *
 * 소스는 Openverse 오디오(키 불필요). 주의할 점 둘:
 *   · 결과에 **랜딩페이지 URL 이 섞여 온다** — 실측 22건 중 5건은 오디오 파일이 아니었다.
 *   · CC0 우선. 사진 크레딧을 0 으로 만들어놨는데 음악 하나로 되살아나면 아깝다.
 */
import { licenseUsable, attributionFree } from './footage.mjs';

const AUDIO_EXT = /\.(mp3|ogg|wav|flac|m4a)(\?|$)/i;

/**
 * @param {{url:string,license:string,duration?:number,title?:string,author?:string}[]} tracks
 * @param {{needSec?:number}} opts needSec 영상 길이. 이보다 긴 곡이면 반복 없이 덮는다.
 */
export function pickTrack(tracks, opts = {}) {
  const { needSec = 90 } = opts;
  const usable = (tracks ?? []).filter(
    (t) => t?.url && AUDIO_EXT.test(t.url) && licenseUsable(t.license),
  );
  if (usable.length === 0) return null;
  const secs = (t) => (Number(t.duration) || 0) / 1000;
  // 영상보다 긴 곡 우선(이음매가 없다) → 표기 의무 없는 것 우선 → 그 안에서 짧은 것(내려받기 부담).
  const enough = (t) => (secs(t) >= needSec ? 0 : 1);
  const free = (t) => (attributionFree(t.license) ? 0 : 1);
  const sorted = usable.slice().sort((a, b) => enough(a) - enough(b)
    || free(a) - free(b)
    || (enough(a) === 0 ? secs(a) - secs(b) : secs(b) - secs(a)));
  return sorted[0];
}

/** CC BY 는 크레딧이 필요하다. CC0 는 null. */
export function musicCredit(track) {
  if (!track || attributionFree(track.license)) return null;
  const bits = [`Music: "${track.title ?? 'untitled'}"`];
  if (track.author) bits.push(`by ${track.author}`);
  bits.push(`— ${track.license}`);
  if (track.pageUrl) bits.push(track.pageUrl);
  return bits.join(' ');
}

/** Openverse 오디오 검색. 키 불필요. NC/ND 는 서버에서 미리 뺀다. */
export async function searchMusic(query = 'ambient underscore', { limit = 20 } = {}) {
  // 익명 요청은 page_size 20 이 상한이다. 넘기면 **401** 로 응답해서 인증 문제로 보이지만
  //   실제 본문은 "page_size may not exceed 20 for anonymous requests" 다(실측 2026-08-27).
  //   상태 코드만 보고 판단했으면 계속 헤맸을 것이다 — 에러는 본문까지 읽어야 한다.
  const size = Math.min(20, Math.max(1, limit));
  const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}`
    + `&page_size=${size}&license=cc0,pdm,by`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'FlowVium-issue-video/1.0 (https://flowvium.net)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${body.slice(0, 140)}`);
  }
  const d = await r.json();
  return (d?.results ?? []).map((x) => ({
    url: x.url,
    license: [x.license, x.license_version].filter(Boolean).join(' '),
    duration: x.duration,
    title: x.title,
    author: x.creator,
    pageUrl: x.foreign_landing_url,
  }));
}

/**
 * youtube-cc.mjs — 대본의 컷마다 유튜브에서 **CC 라이선스 영상만** 찾는다.
 *
 * 왜 필요한가 (2026-09-15 실측):
 *   아카이브(커먼즈/KOGL)는 한국 시사 주제에서 사실상 빈손이다. 제목 매칭이 한국어 낱말이
 *   제목에 그대로 박혀 있기를 요구하는데 커먼즈 제목은 영어라, 8개 주제에서 쓸 수 있는 것이
 *   2~4건뿐이었다(코스피·삼성전자·원자력·한화에어로는 0건). 그래서 회색 카드가 남는다.
 *   같은 낱말을 유튜브 CC 검색에 넣으면 6개 주제 **전부 5/5** 가 나온다.
 *
 * 라이선스:
 *   유튜브의 "크리에이티브 커먼즈" 는 **CC BY 3.0** 한 가지뿐이다(NC·ND 옵션이 없다).
 *   그래서 licenseUsable 을 통과하고(by 포함), attributionFree 는 false 라 **표기 의무가 생긴다**.
 *   후보 모양을 기존 소재와 똑같이 맞춰 두면 creditLine() 이 그대로 크레딧을 만들어 준다 —
 *   새 규약을 만들면 표기가 그 틈으로 샌다.
 *
 *   검색 필터를 그냥 믿지 않는다. search.list 의 videoLicense 는 검색 쪽 색인이고,
 *   실제 라이선스는 videos.list 의 status.license 다. **받아서 한 번 더 확인한다.**
 *   (실측 10건은 10건 다 일치했다. 그래도 확인은 남긴다 — 틀렸을 때 조용히 남의 것을 쓰게 된다.)
 *
 * 쿼터:
 *   search.list 는 한 번에 100 units, 하루 기본 10,000 이다. 컷 4개짜리 한 편이면 400.
 *   videos.list 는 1 unit 이라 무시할 만하다. 한 번에 다 태워 먹으면 그날 남은 편성이
 *   전부 소재 없이 나가므로 **실행당 예산을 두고 넘으면 멈춘다.**
 */
import { google } from 'googleapis';
import { authorizedClient, tokenPresent, credentialsPresent } from './youtube.mjs';

/** 실행 한 번에 쓸 search.list 횟수. 100 units × 이 값. */
const BUDGET = Math.max(0, Number(process.env.YT_CC_SEARCH_BUDGET ?? 8));
let spent = 0;

/** 남은 검색 횟수. 호출부가 미리 보고 다른 소재원으로 갈 수 있게 열어 둔다. */
export function ccBudgetLeft() { return Math.max(0, BUDGET - spent); }

export function ytCcReady() {
  if (!credentialsPresent()) return { ok: false, reason: 'secrets/youtube-oauth.json 없음' };
  if (!tokenPresent()) return { ok: false, reason: 'secrets/youtube-token.json 없음 — youtube-auth 먼저' };
  if (BUDGET <= 0) return { ok: false, reason: 'YT_CC_SEARCH_BUDGET=0' };
  return { ok: true };
}

/** PT1M4S → 64. 못 읽으면 null(모르는 것을 0 으로 적으면 길이 검사가 통과해 버린다). */
export function durationSec(iso) {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [, d, h, mi, s] = m.map((x) => (x == null ? 0 : Number(x)));
  const t = d * 86400 + h * 3600 + mi * 60 + s;
  return t > 0 ? t : null;
}

/**
 * 컷 하나에 쓸 수 있는 길이인가.
 *
 * 위는 실측으로 정했다 — "국회 본회의" CC 결과 10건 중 3건이 43분·2시간·4시간짜리
 * 정치 채널 **라이브 통방송**이었다. 그런 영상은 아무 데나 잘라도 주제와 무관한 장면이 나온다.
 * 아래는 컷 하나가 보통 6~10초라 그보다 짧으면 잘라 쓸 구간이 없다.
 */
export const MIN_SEC = Number(process.env.YT_CC_MIN_SEC ?? 12);
export const MAX_SEC = Number(process.env.YT_CC_MAX_SEC ?? 600);

/**
 * 컷 하나치 CC 영상 후보.
 *
 * @param {string[]|string} terms  그 컷의 검색 낱말
 * @returns {Promise<object[]>} 기존 소재와 같은 모양 — creditLine() 이 그대로 먹는다
 */
export async function searchCcVideos(terms, opts = {}) {
  const ready = ytCcReady();
  if (!ready.ok) return [];
  if (spent >= BUDGET) return [];
  const q = (Array.isArray(terms) ? terms.join(' ') : String(terms ?? '')).trim();
  if (!q) return [];

  const yt = google.youtube({ version: 'v3', auth: authorizedClient() });
  let ids = [];
  try {
    spent += 1;   // 실패해도 쿼터는 나갔다 — 성공했을 때만 세면 예산이 새어 하루치를 태운다
    const r = await yt.search.list({
      part: ['snippet'], q, type: ['video'], videoLicense: 'creativeCommon',
      maxResults: Math.min(25, Number(opts.max ?? 10)),
      regionCode: opts.regionCode ?? 'KR', relevanceLanguage: opts.relevanceLanguage ?? 'ko',
      // 임베드 불가 영상은 내려받기도 막혀 있는 경우가 많다. 검색 단계에서 빼는 게 싸다.
      videoEmbeddable: 'true',
      safeSearch: 'strict',
    });
    ids = (r.data.items ?? []).map((i) => i?.id?.videoId).filter(Boolean);
  } catch (e) {
    // 쿼터 초과·인증 만료를 조용히 넘기면 "소재가 없는" 것으로 보인다. 원인을 남긴다.
    console.log(`[유튜브CC] 검색 실패 "${q}": ${String(e?.message ?? e).slice(0, 100)}`);
    return [];
  }
  if (!ids.length) return [];

  // 라이선스·길이는 검색 결과에 없다. 여기서 **받아서 확인한다**(1 unit).
  let items = [];
  try {
    const v = await yt.videos.list({ part: ['status', 'contentDetails', 'snippet'], id: ids });
    items = v.data.items ?? [];
  } catch (e) {
    console.log(`[유튜브CC] 확인 실패 "${q}": ${String(e?.message ?? e).slice(0, 100)}`);
    return [];
  }

  const out = [];
  for (const [i, it] of items.entries()) {
    if (it?.status?.license !== 'creativeCommon') continue;   // 색인과 실제가 어긋난 것
    if (it?.status?.uploadStatus && it.status.uploadStatus !== 'processed') continue;
    const sec = durationSec(it?.contentDetails?.duration);
    if (sec == null || sec < MIN_SEC || sec > MAX_SEC) continue;
    // 라이브는 길이가 있어도 구간이 통방송이다
    if (it?.snippet?.liveBroadcastContent && it.snippet.liveBroadcastContent !== 'none') continue;
    out.push({
      kind: 'video', rank: i,
      url: `https://www.youtube.com/watch?v=${it.id}`,
      videoId: it.id,
      durationSec: sec,
      // 유튜브 CC 는 CC BY 3.0 한 가지다. 값을 지어내지 않고 그대로 적는다.
      license: 'CC BY 3.0',
      title: it?.snippet?.title ?? '',
      author: it?.snippet?.channelTitle ?? '',
      channelId: it?.snippet?.channelId ?? '',
      source: 'YouTube',
      pageUrl: `https://youtu.be/${it.id}`,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 내려받기
//
// ⚠ 라이선스와 이용약관은 **다른 문제**다. CC BY 3.0 은 내용을 다시 쓸 권리를 주지만,
//   유튜브 이용약관은 유튜브가 제공하는 기능 밖의 내려받기를 따로 제한한다.
//   그래서 이 함수는 기본으로 꺼져 있고 YT_CC_DOWNLOAD=1 일 때만 움직인다.
//   켤지 말지는 채널 주인이 정할 일이지 스크립트가 조용히 정할 일이 아니다.
// ───────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const YTDLP_PY = process.env.YT_DLP_PYTHON || join(homedir(), '.flowvium-tools', 'melo-venv', 'bin', 'python');
const FFMPEG = process.env.FFMPEG_BIN || join(homedir(), '.flowvium-tools', 'bin', 'ffmpeg');

export function ccDownloadReady() {
  if (process.env.YT_CC_DOWNLOAD !== '1') return { ok: false, reason: 'YT_CC_DOWNLOAD=1 이 아니다(기본 꺼짐)' };
  if (!existsSync(YTDLP_PY)) return { ok: false, reason: `python 없음: ${YTDLP_PY}` };
  if (!existsSync(FFMPEG)) return { ok: false, reason: `ffmpeg 없음: ${FFMPEG}` };
  return { ok: true };
}

/**
 * 앞뒤를 피해 가운데에서 구간을 잡는다.
 *
 * 앞은 인트로·채널 소개, 뒤는 구독 요청·엔드카드가 오는 자리다. 실측한 클립들도
 * 첫 2~3초가 로고 애니메이션이었다. 짧은 영상은 잘라낼 여유가 없으므로 비율로 민다.
 */
export function pickSegment(totalSec, wantSec) {
  const t = Number(totalSec) || 0;
  const w = Math.max(1, Number(wantSec) || 6);
  if (t <= w) return { start: 0, dur: t || w };
  const head = Math.min(t * 0.15, 20);
  const tail = Math.min(t * 0.10, 20);
  const usable = Math.max(0, t - head - tail);
  if (usable < w) return { start: Math.max(0, (t - w) / 2), dur: w };
  return { start: head + (usable - w) / 2, dur: w };
}

/**
 * CC 영상에서 구간 하나를 mp4 로 받는다. 실패하면 null — 발행은 막지 않는다.
 * @returns {string|null} 받은 파일 경로
 */
export function downloadCcClip(cand, outFile, { seconds = 6 } = {}) {
  const r = ccDownloadReady();
  if (!r.ok) return null;
  if (!cand?.videoId) return null;
  const { start, dur } = pickSegment(cand.durationSec, seconds);
  mkdirSync(dirname(outFile), { recursive: true });
  const tmpl = outFile.replace(/\.mp4$/i, '') + '.%(ext)s';
  try {
    execFileSync(YTDLP_PY, ['-m', 'yt_dlp', '--ffmpeg-location', FFMPEG,
      '--socket-timeout', '20', '--no-warnings', '-q', '--no-playlist',
      // 소리는 안 쓴다 — 우리 나레이션이 깔린다. 영상만 받으면 빠르고 가볍다.
      '-f', 'bv*[height<=1080][ext=mp4]/bv*[height<=1080]/b[height<=1080]',
      '--download-sections', `*${start.toFixed(1)}-${(start + dur).toFixed(1)}`,
      '--force-keyframes-at-cuts',
      '-o', tmpl, cand.url],
    { timeout: 180_000, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.log(`[유튜브CC] 내려받기 실패 ${cand.videoId}: ${String(e?.message ?? e).slice(0, 90)}`);
    return null;
  }
  return existsSync(outFile) ? outFile : null;
}

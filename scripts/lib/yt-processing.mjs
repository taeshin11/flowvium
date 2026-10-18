/**
 * yt-processing.mjs — 업로드한 영상의 처리가 끝났는지 API 로 본다. (2026-10-19)
 *
 * 왜: 관련 동영상 걸기(yt-related-video)가 업로드 직후 스튜디오를 열어, 처리 중이라 '관련 동영상' 칸이 없는
 *   화면에서 30초를 기다리다 실패했다(10/14~10/17 32편 중 7편 실패, 남은 실패 화면 3장 모두 '업로드 중·대기 중').
 */

/** @returns {'ready'|'pending'|'dead'} */
export function processingState(item) {
  const u = item?.status?.uploadStatus, p = item?.processingDetails?.processingStatus;
  if (u === 'failed' || u === 'rejected' || u === 'deleted' || p === 'failed' || p === 'terminated') return 'dead';
  return u === 'processed' && p === 'succeeded' ? 'ready' : 'pending';
}

/** 기본 조회: videos.list(status, processingDetails). */
export async function listProcessing(ids) {
  const { authorizedClient, with401Retry } = await import('./youtube.mjs');
  const { google } = await import('googleapis');
  const yt = google.youtube({ version: 'v3', auth: await authorizedClient() });
  const r = await with401Retry(() => yt.videos.list({ part: ['status', 'processingDetails'], id: ids }), { label: '처리 상태' });
  return r.data.items ?? [];
}

/**
 * 처리가 끝날 때까지 pollMs 마다 다시 묻는다(최대 timeoutMs).
 * @returns {Promise<{ready:string[], pending:string[], dead:string[]}>}
 */
export async function waitProcessed(ids, { list = listProcessing, timeoutMs = 20 * 60_000, pollMs = 30_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const ready = [], dead = [];
  let pending = [...ids];
  const until = Date.now() + timeoutMs;
  while (pending.length) {
    const items = new Map((await list(pending)).map((x) => [x.id, x]));
    const still = [];
    for (const id of pending) {
      const s = processingState(items.get(id));
      if (s === 'ready') ready.push(id); else if (s === 'dead') dead.push(id); else still.push(id);
    }
    pending = still;
    if (!pending.length || Date.now() >= until) break;
    await sleep(pollMs);
  }
  return { ready: ids.filter((id) => ready.includes(id)), pending, dead };
}

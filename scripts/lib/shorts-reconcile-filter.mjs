/**
 * shorts-reconcile-filter.mjs — 채널 업로드 중 쇼츠만 고른다. 근거는 shorts-reconcile.test.mjs 머리말.
 */
/** "PT4M31S" → 271. 못 읽으면 null. */
export function isoDurationSec(s) {
  const m = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s ?? ''));
  if (!m || !s) return null;
  const v = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return v > 0 ? v : null;
}
/** 유튜브 쇼츠 길이 상한 3분 이하만. 길이를 모르면 쇼츠로 세지 않는다. */
export const isShortUpload = ({ durationSec }) => Number.isFinite(durationSec) && durationSec > 0 && durationSec <= 180;

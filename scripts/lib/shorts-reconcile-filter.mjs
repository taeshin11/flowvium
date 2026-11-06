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
/** 유튜브 쇼츠 = 3분 이하 + 세로. 길이를 모르면 쇼츠로 세지 않는다. 화면비(player embed)를 알면 가로는 쇼츠 아님 —
 *  2026-11-07 증시 브리핑 롱폼(가로, 2~3분)이 길이만으로 쇼츠 원장에 21편 들어갔다. */
export const isShortUpload = ({ durationSec, width, height }) => Number.isFinite(durationSec) && durationSec > 0 && durationSec <= 180
  && !(width > 0 && height > 0 && width >= height);

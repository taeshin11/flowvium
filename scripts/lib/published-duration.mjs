/**
 * published-duration.mjs — 올린 영상이 만든 영상과 같은 길이인가.
 *
 * 왜 (2026-09-10): 렌더 로그는 "고정 홍보 클립을 끝에 붙인다" 를 찍지만 **붙었는지는 확인하지 않는다.**
 *   concat 이 조용히 실패하거나 업로드가 잘려도 로그는 똑같이 성공으로 보인다.
 *   하루 10편이 나가고 사람이 다 볼 수 없다 — 길이만이라도 기계가 대조한다.
 *   광고 클립이 5.1초라 그게 빠지면 길이로 드러난다.
 *
 * 판정하지 못하는 경우(기준이 없음)는 결함이 아니다. 모르는 것을 틀렸다고 하지 않는다.
 */

/** 유튜브 contentDetails.duration(ISO 8601) → 초. 못 읽으면 null. */
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [, d, h, min, s] = m;
  const total = (+(d ?? 0)) * 86400 + (+(h ?? 0)) * 3600 + (+(min ?? 0)) * 60 + (+(s ?? 0));
  return Number.isFinite(total) ? total : null;
}

/** 광고 클립(5.1초)보다 작아야 누락을 잡는다. 유튜브는 초 단위로 반올림해 보고하므로 2초를 준다. */
export const TOLERANCE_SEC = 2;

/**
 * @param {number|null} localSec  업로드한 파일의 실제 길이
 * @param {string|null} ytIso     유튜브가 보고하는 길이
 * @returns {{ok: boolean|null, reason?: string, localSec?: number, ytSec?: number}}
 */
export function durationVerdict(localSec, ytIso) {
  const ytSec = parseIsoDuration(ytIso);
  if (!Number.isFinite(localSec) || ytSec == null) return { ok: null };
  const diff = ytSec - localSec;
  if (Math.abs(diff) <= TOLERANCE_SEC) return { ok: true, localSec, ytSec };
  return {
    ok: false, localSec, ytSec,
    reason: diff < 0
      ? `올라간 영상이 ${Math.abs(diff).toFixed(1)}초 짧다 — 광고 클립 누락 또는 업로드 잘림 의심`
      : `올라간 영상이 ${diff.toFixed(1)}초 길다 — 중복 부착 의심`,
  };
}

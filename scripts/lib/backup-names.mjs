/**
 * backup-names.mjs — Drive 로 올리는 밤 DB 백업의 이름과 보존정책. 근거는 backup-names.test.mjs 머리말(11/17 gzip 사본).
 *   로컬 2차 백업(~/flowvium_backups)은 그대로 .db 다 — 여기는 Drive 쪽만.
 */
export const remoteDbName = (day) => `flowvium-${day}.db.gz`;
export const REMOTE_DB_RE = /^flowvium-\d{4}-\d{2}-\d{2}\.db\.gz$/;
/** 지울 원격 파일 — .db.gz 중 오래된 것만. 옛 .db 자리표시는 사람이 정상 파일을 확인한 뒤 정리한다. */
export function remoteRetention(files, keep) {
  const gz = (files ?? []).filter((f) => REMOTE_DB_RE.test(f)).sort();
  return gz.slice(0, Math.max(0, gz.length - keep));
}

/**
 * publish-queue.mjs — 블로그 발행 줄이 머리에서 막히지 않게 한다. (2026-09-20 신설)
 *
 * 실제 사고: 미발행 글 6편 중 오래된 3편만 집는데(slice(0,3)) 그 3편이 전부 "같은 날 중복"·
 *   "저품질" 로 걸러졌다. 걸러진 글은 원장에 안 남아서 **다음 실행도 같은 3편**을 집었다.
 *   오늘 아침 글은 6번째라 영영 차례가 오지 않았고, 어제 12:21 이후 블로그가 한 편도
 *   안 올라갔다. 스스로 낫지 않는 종류다 — 매 실행이 같은 자리에서 같은 결론을 낸다.
 *
 * 고친 생각: **거른 것도 결론이다.** 결론을 적어야 줄이 움직인다.
 *   다만 거른 글을 '올린 글' 로 세면 안 된다 — 같은 날 중복 검사와 겹침 비교가
 *   올리지도 않은 글을 기준으로 삼게 된다. 그래서 '올림' 은 id 가 있고 초안이 아닌 것만이다.
 */

/** 이 기록이 **실제로 게시된 글**인가. 거른 기록·초안은 아니다. */
export function isPublished(entry) {
  return Boolean(entry && entry.id && entry.status !== 'DRAFT');
}

/** 이번에 시도할 글. 원장에 결론이 없는 것만, 오래된 것부터. */
export function pickQueue(files, ledger = {}, max = 3) {
  return (files ?? []).slice().sort().filter((f) => !ledger[f]).slice(0, max);
}

/** 거른 결론을 적는다. 이미 결론이 있으면 덮지 않는다(게시 기록을 잃지 않으려고). */
export function markSkipped(ledger, key, reason) {
  if (ledger?.[key]) return ledger;
  return { ...ledger, [key]: { skipped: true, reason, at: new Date().toISOString() } };
}

/**
 * related-pick.mjs — 새 쇼츠의 '관련 동영상' 으로 걸 같은 주제의 다른 쇼츠를 고른다. (2026-10-18)
 *
 * 왜: 재방문 시청자 0.1% 미만, 내 다른 영상에서 온 조회 0.4%(10/17 점검). 관련 동영상은 쇼츠 화면에서 눌리는
 *   유일한 자리인데 사이트 소개 롱폼(10/02~)에 걸려 있었다 — 쇼츠 시청자가 롱폼으로 넘어가지 않는다.
 *   agy·새 Claude·ChatGPT 가 모두 "같은 주제 쇼츠로" 를 냈고 10/18 Mac mini2(사장님 위임)가 정했다. 사이트 링크는 설명란에 남는다.
 * 고르는 법: 같은 사건(issue_key)의 앞선 쇼츠 → 없으면 같은 주제(topic, '기타' 제외)에서 조회 1위.
 *   최근 DAYS 일 · 내린 편 제외 · 제목을 아는 편만(스튜디오 선택 창에서 제목으로 찾는다). 없으면 null — 호출부가 사이트 롱폼으로.
 */
export const RELATED_DAYS = 7;
const VAGUE_TOPICS = new Set(['기타']);

/** 스튜디오 선택 창에서 카드를 찾을 제목 앞부분. #태그·앞쪽 이모지를 빼고 30자. */
export function matchText(title) {
  return String(title ?? '').replace(/#\S+/g, '').replace(/^[^\p{L}\p{N}"'“‘\[(]+/u, '').trim().slice(0, 30).trim();
}

/**
 * @param {Array<{video_id,issue_key,topic,title,views,published_at,retracted_at?}>} rows
 * @returns {{id:string, match:string, why:'same-issue'|'same-topic', title:string}|null}
 */
export function pickRelated(rows, { videoId, issueKey, topic, now = Date.now(), days = RELATED_DAYS }) {
  const live = rows.filter((r) => r.video_id && r.video_id !== videoId && !r.retracted_at && matchText(r.title)
    && now - Date.parse(r.published_at) <= days * 864e5);
  const best = (xs) => xs.sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
  const issue = issueKey ? best(live.filter((r) => r.issue_key === issueKey)) : null;
  const pick = issue ?? (topic && !VAGUE_TOPICS.has(topic) ? best(live.filter((r) => r.topic === topic)) : null);
  return pick ? { id: pick.video_id, match: matchText(pick.title), why: issue ? 'same-issue' : 'same-topic', title: pick.title } : null;
}

/** 편성 원장 + 조회 기록에서 후보 행. */
export function relatedCandidates(db, days = RELATED_DAYS) {
  return db.prepare(`SELECT p.video_id, p.issue_key, p.topic, p.published_at, p.retracted_at,
      (SELECT title FROM shorts_stats s WHERE s.video_id = p.video_id AND s.title IS NOT NULL ORDER BY s.checked_at DESC LIMIT 1) title,
      (SELECT MAX(views) FROM shorts_stats s WHERE s.video_id = p.video_id) views
    FROM shorts_published p WHERE p.video_id IS NOT NULL AND datetime(p.published_at) >= datetime('now', ?)`).all(`-${days} days`);
}

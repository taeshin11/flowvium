/**
 * site-tour-video.mjs — 쇼츠 '관련 동영상' 으로 거는 사이트 소개 롱폼(한 곳에서 정한다). (2026-10-02)
 *   OwRQLZ8DHzU "AI가 매일 고르는 투자 종목, 무료 — flowvium.net 2분 사용법" (make-site-tour 로 만들어 올림).
 *   새 롱폼으로 바꾸면 여기만 고친다. match 는 스튜디오 선택 창에서 카드를 찾는 제목 앞부분.
 */
export const TOUR_VIDEO = Object.freeze({ id: 'OwRQLZ8DHzU', match: 'AI가 매일 고르는' });
/** 전용 유튜브 프로필(secrets/youtube-profile)을 쓰는 스크립트끼리 동시에 열지 않게 — 크롬 프로필은 한 번에 하나만 열린다. */
export const YT_PROFILE_LOCK = 'logs/youtube-profile.lock';

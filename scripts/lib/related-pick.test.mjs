#!/usr/bin/env node
/**
 * related-pick.test.mjs — 쇼츠 '관련 동영상' 을 같은 주제의 다른 쇼츠로. 2026-10-18 신설.
 *
 * 성장 지표 점검(10/17): 재방문 시청자 0.1% 미만 · 새 시청자 93% · 내 다른 영상에서 온 조회 0.4%.
 *   agy(argon)·새 Claude·ChatGPT 셋 다 "관련 동영상을 같은 주제 쇼츠로" — 10/02 사이트 소개 롱폼 결정과 충돌해 보류했다가
 *   10/18 Mac mini2(사장님 "최대한 알아서") 결정으로 다음 업로드부터 바꾼다. 사이트 링크는 설명란에 남는다.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { pickRelated } = await import('./related-pick.mjs');
const now = Date.parse('2026-10-18T13:00:00Z');
const ago = (h) => new Date(now - h * 3600e3).toISOString();
const rows = [
  { video_id: 'self', issue_key: '소방', topic: '국내정치', title: '지금 이 편 #Shorts', views: 9999, published_at: ago(0) },
  { video_id: 'pol1', issue_key: '국감', topic: '국내정치', title: '국감 고성 충돌, 무슨 일이 #Shorts', views: 1500, published_at: ago(30) },
  { video_id: 'pol2', issue_key: '국감2', topic: '국내정치', title: '다른 정치 편', views: 900, published_at: ago(40) },
  { video_id: 'same', issue_key: '소방', topic: '국내정치', title: '소방관 순직, 앞선 편', views: 600, published_at: ago(20) },
  { video_id: 'old', issue_key: '옛', topic: '증시·금리·환율', title: '오래된 증시 편', views: 5000, published_at: ago(24 * 20) },
  { video_id: 'gone', issue_key: '내림', topic: '증시·금리·환율', title: '내린 편', views: 8000, published_at: ago(10), retracted_at: ago(5) },
  { video_id: 'mkt', issue_key: '금리', topic: '증시·금리·환율', title: '', views: 3000, published_at: ago(10) },
];
const a = pickRelated(rows, { videoId: 'self', issueKey: '소방', topic: '국내정치', now });
(a?.id === 'same' && a.why === 'same-issue') ? ok('[1] 같은 사건의 앞선 쇼츠가 먼저') : bad(`[1] ${JSON.stringify(a)}`);
const b = pickRelated(rows, { videoId: 'self', issueKey: '새사건', topic: '국내정치', now });
(b?.id === 'pol1' && b.why === 'same-topic' && b.match === '국감 고성 충돌, 무슨 일이') ? ok('[2] 없으면 같은 주제에서 조회 1위 · 카드 찾을 제목 앞부분(#태그 뺌)') : bad(`[2] ${JSON.stringify(b)}`);
const c = pickRelated(rows, { videoId: 'x', issueKey: 'y', topic: '증시·금리·환율', now });
(c === null) ? ok('[3] 오래된 편·내린 편·제목 없는 편은 안 건다 → null(호출부가 사이트 롱폼으로)') : bad(`[3] ${JSON.stringify(c)}`);
(pickRelated(rows, { videoId: 'self', issueKey: null, topic: null, now }) === null) ? ok('[4] 주제를 모르면 null') : bad('[4]');

const pub = readFileSync(new URL('../video-publish.mjs', import.meta.url), 'utf8');
(/pickRelated\(/.test(pub) && /'--target', rel\.id/.test(pub) && /'--match', rel\.match/.test(pub))
  ? ok('[5] 발행이 같은 주제 쇼츠를 골라 관련 동영상으로 건다') : bad('[5] video-publish 연결 안 됨');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

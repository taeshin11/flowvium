#!/usr/bin/env node
/**
 * blog-video.test.mjs — 증시 글에 거는 영상은 증시·기업 쪽 쇼츠로. (2026-11-19 신설)
 * 왜: 11/19 블로그 글(URI 왜 담았나) 본문에 '전북 국힘' 정치 쇼츠 썸네일이 들어갔다 — make-blog-post 가 주제와 상관없이
 *   가장 최근 쇼츠를 걸었다. 정치 편이 7할이라 대개 엉뚱한 영상이 걸린다.
 */
import { pickBlogShort, relinkVideo, BLOG_TOPICS } from './blog-video.mjs';
let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

const rows = [
  { video_id: 'POLITICS001', topic: '국내정치', published_at: '2026-11-18T12:56:00Z' },
  { video_id: 'STOCKS00001', topic: '증시·금리·환율', published_at: '2026-11-18T08:00:00Z' },
  { video_id: 'COMPANY0001', topic: '기업·산업', published_at: '2026-11-18T07:00:00Z' },
];
pickBlogShort(rows)?.video_id === 'STOCKS00001' ? ok('[1] 최근 정치 편보다 최근 증시 편') : bad(`[1] ${JSON.stringify(pickBlogShort(rows))}`);
pickBlogShort(rows, { before: '2026-11-18T07:30:00Z' })?.video_id === 'COMPANY0001' ? ok('[1b] 글 시각 이전 것만') : bad('[1b]');
pickBlogShort([rows[0]])?.video_id === 'POLITICS001' ? ok('[1c] 증시 편이 없으면 최근 영상') : bad('[1c]');
pickBlogShort([]) === null ? ok('[1d] 없으면 null') : bad('[1d]');
BLOG_TOPICS.includes('증시·금리·환율') && !BLOG_TOPICS.includes('국내정치') ? ok('[2] 주제 목록') : bad('[2]');

const md = '- 최근 영상: https://www.youtube.com/watch?v=jI7ic_KJih0\n- 채널: https://www.youtube.com/channel/UCx';
const out = relinkVideo(md, 'STOCKS00001');
(out.includes('watch?v=STOCKS00001') && !out.includes('jI7ic_KJih0') && out.includes('channel/UCx')) ? ok('[3] 글 끝 영상 링크를 바꾼다(채널 링크는 그대로)') : bad(`[3] ${out}`);
relinkVideo(md, null) === md ? ok('[3b] 고를 영상이 없으면 그대로') : bad('[3b]');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

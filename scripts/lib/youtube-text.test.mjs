#!/usr/bin/env node
/**
 * youtube-text.test.mjs — 제목·설명에 '<' '>' 가 들어가면 유튜브가 업로드를 통째로 거절한다. 2026-10-25 신설.
 *
 * 실측(10/24 밤 쇼츠 두 편 0편 발행): 헤드라인 '"김정은, 中단둥 떠나…왕후닝 신압록강대교서 배웅" <신화통신>' 이
 *   21:54 제목에 들어가 "invalid or empty video title", 22:52 브리핑 설명란(헤드라인 목록)에 들어가 "invalid video description".
 *   렌더·눈검증은 다 통과했고 마지막 업로드에서 버려졌다. 모든 업로드는 uploadRequestBody 를 지난다 — 한 곳에서 바꾼다.
 *   제목 바꾸기(youtube-retitle)·설명 고치기(youtube-refresh-desc)도 같은 글을 보낸다 — 같은 함수로.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const Y = await import('./youtube.mjs');
const H = '"김정은, 中단둥 떠나…왕후닝 신압록강대교서 배웅" <신화통신>';
{
  const b = Y.uploadRequestBody({ title: `${H} #Shorts`, description: `오늘의 뉴스\n· ${H}\n· a > b` });
  (!/[<>]/.test(b.snippet.title) && !/[<>]/.test(b.snippet.description)) ? ok('[1] 업로드 제목·설명에 < > 가 남지 않는다') : bad(`[1] ${JSON.stringify([b.snippet.title, b.snippet.description.slice(0, 80)])}`);
  (b.snippet.title.includes('〈신화통신〉') && b.snippet.description.includes('a 〉 b')) ? ok('[2] 지우지 않고 비슷한 꺾쇠(〈 〉)로 — 뜻이 남는다') : bad(`[2] ${b.snippet.title}`);
}
(typeof Y.ytSafeText === 'function' && Y.ytSafeText('<a>') === '〈a〉' && Y.ytSafeText(null) === '') ? ok('[3] ytSafeText 를 내보낸다') : bad('[3]');
{
  const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  (/ytSafeText\(title\)/.test(src('youtube-retitle.mjs'))) ? ok('[4] youtube-retitle 도 같은 함수') : bad('[4] retitle 이 < > 를 그대로 보낸다');
  (/ytSafeText\(next\)/.test(src('youtube-refresh-desc.mjs'))) ? ok('[5] youtube-refresh-desc 도 같은 함수') : bad('[5] refresh-desc 가 < > 를 그대로 보낸다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

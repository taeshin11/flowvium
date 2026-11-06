#!/usr/bin/env node
/**
 * shorts-reconcile.test.mjs — 원장 맞추기가 롱폼을 쇼츠 원장에 넣지 않는가. 2026-10-06 신설.
 *
 * 사고(10/06 22:10): 첫 '뉴스 총정리' 공개 발행이 실패했다 — "3w3khRJLu-o: Private video".
 *   아침에 올린 비공개 시험판 롱폼이 shorts_published 에 들어가 '오늘의 쇼츠' 로 뽑혔다.
 *   넣은 건 shorts-reconcile: 채널 업로드 목록 **전부**를 쇼츠로 보고 원장에 채웠다(길이를 안 봄).
 *   사이트 소개 롱폼 OwRQLZ8DHzU(10/02)도 같은 경로로 들어가 있었다 — 쇼츠 성적·주제 판정·관련 동영상 대상에 섞였다.
 * 고침: 유튜브 쇼츠 길이 상한(3분) 이하만 쇼츠로 본다. 길이를 모르면 넣지 않는다(모르는 걸 쇼츠로 세지 않는다).
 */
import { isShortUpload, isoDurationSec } from './shorts-reconcile-filter.mjs';
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
(isoDurationSec('PT43S') === 43 && isoDurationSec('PT4M31S') === 271 && isoDurationSec('PT1H2M3S') === 3723 && isoDurationSec('') === null) ? ok('[1] ISO 길이 읽기') : bad('[1]');
(isShortUpload({ durationSec: 43 }) && isShortUpload({ durationSec: 180 }) && !isShortUpload({ durationSec: 271 }) && !isShortUpload({ durationSec: null })) ? ok('[2] 3분 이하만 쇼츠 · 모르면 아님') : bad('[2]');
const src = readFileSync(new URL('../shorts-reconcile.mjs', import.meta.url), 'utf8');
/isShortUpload\(/.test(src) && /contentDetails/.test(src) ? ok('[3] reconcile 이 길이를 보고 거른다') : bad('[3] reconcile 이 아직 전부 넣는다');
// [4] 2026-11-07: 증시 브리핑 롱폼(가로 1920x1080, 2분 54초 등)이 3분 이하라 쇼츠 원장에 21편 들어가 쇼츠 중앙값·주제별 성적을 깎았다.
//   유튜브 쇼츠는 세로다. videos.list part=player(maxHeight) 의 embedWidth/Height 가 화면비를 따른다(실측: 브리핑 640x360, 쇼츠 203x360).
(!isShortUpload({ durationSec: 174, width: 640, height: 360 }) && isShortUpload({ durationSec: 43, width: 203, height: 360 }) && isShortUpload({ durationSec: 43 }))
  ? ok('[4] 3분 이하라도 가로면 쇼츠 아님 · 화면비 모르면 길이로') : bad('[4] 가로 롱폼이 쇼츠로 셌다');
/part:\s*\[[^\]]*'player'/.test(src) && /maxHeight/.test(src) ? ok('[5] reconcile 이 화면비(player)를 받는다') : bad('[5] reconcile 이 화면비를 안 본다');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

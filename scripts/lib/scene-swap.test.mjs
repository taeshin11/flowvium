#!/usr/bin/env node
/**
 * scene-swap.test.mjs — 첫 장면이 도표일 때 자리 바꾸기. 브리핑은 장면을 **통째로** 옮긴다. 2026-10-17 신설.
 *   증상(10/14 uMQ75NoXXko "홍콩 IPO"): 1번 장면 훅·사진은 "안산 성폭력 부실수사"(2번 뉴스)인데 내레이션·자막은 홍콩.
 *   원인: 브리핑 자리 바꾸기가 media·pick·credit·hook·say 만 옮겼다. 음성(audio·alignment·dur)은 3단계에서 이미
 *   만들어져 장면에 붙어 있는데 남겨 둬서, 훅·사진은 2번 뉴스로 갔고 소리·자막은 1번 뉴스로 남았다.
 *   say 를 옮겨도 소리는 다시 안 만든다 — 장면이 곧 뉴스 하나인 브리핑에서는 객체 자체를 바꿔야 짝이 안 깨진다.
 * 한 이슈 편은 지금처럼 그림(media·pick·credit)만 바꾼다 — 대본 순서가 이야기 순서다.
 */
import { readFileSync } from 'fs';
import { swapScenePair } from './scene-swap.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const mk = (n) => ({ hook: `훅${n}`, say: `말${n}`, audio: `q${n}.wav`, alignment: { n }, dur: n, media: `m${n}.jpg`, pick: { n }, credit: `c${n}`, faces: n });
{
  const s = [mk(0), mk(1), mk(2)];
  swapScenePair(s, 0, 2, { brief: true });
  const same = (x) => [x.hook, x.say, x.audio, x.media, x.credit].every((v) => v.endsWith(String(x.dur)) || v.includes(String(x.dur)));
  (s[0].dur === 2 && s[2].dur === 0 && s.every(same)) ? ok('[1] 브리핑: 훅·말·소리·정렬·사진·출처가 한 장면으로 함께 움직인다') : bad(`[1] ${JSON.stringify(s)}`);
}
{
  const s = [mk(0), mk(1), mk(2)];
  swapScenePair(s, 0, 2, { brief: false });
  (s[0].media === 'm2.jpg' && s[0].credit === 'c2' && s[0].hook === '훅0' && s[0].audio === 'q0.wav' && s[2].media === 'm0.jpg')
    ? ok('[2] 한 이슈: 그림·출처만 바꾸고 대본·소리는 제자리') : bad(`[2] ${JSON.stringify(s)}`);
}
{
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  (/swapScenePair\(scenes,/.test(ms) && !/\['media', 'pick', 'credit', 'hook', 'say'\]/.test(ms))
    ? ok('[3] make-shorts 썸네일 자리 바꾸기가 swapScenePair 를 쓴다(필드 나열 제거)') : bad('[3] make-shorts 연결 안 됨');
}
console.log(fail ? `\n❌ scene-swap ${fail}건 실패` : '\n✅ scene-swap 전부 통과');
process.exit(fail ? 1 : 0);

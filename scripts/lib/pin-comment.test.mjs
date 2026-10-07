#!/usr/bin/env node
/**
 * pin-comment.test.mjs — 업로드 직후 홍보 댓글을 달고 바로 확인하는가. 2026-10-08 신설.
 *
 * 사장님 "aisviagent.com 광고를 쿠팡파트너스 링크 달듯이 댓글에" + "영상 업로드 후 댓글 달렸는지 바로바로 체크하는걸 원칙으로".
 * Mac mini2 공지(사장님 원칙): 공개 직후 시청자 화면에서 ①고정 댓글이 보이는지 ②작성자가 그 채널인지 ③고정됐는지,
 *   링크 댓글은 스팸 필터로 사라질 수 있어 10분 뒤 다시 확인.
 * → 업로드 직후 yt-pin-comment 를 띄운다: 로그인 상태로 달기·고정·되읽기(①②③) 후 10분 뒤 **로그아웃 브라우저**로 다시 본다
 *   (주인 화면에는 걸러진 댓글도 보일 수 있다 — 시청자 화면이 기준).
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const pub = src('video-publish.mjs');
(/yt-pin-comment\.mjs/.test(pub) && /--then-verify/.test(pub)) ? ok('[1] 쇼츠 발행 직후 댓글 달기 + 10분 뒤 재확인을 띄운다') : bad('[1] video-publish 가 댓글 단계를 안 띄운다');
const rd = src('video/make-daily-roundup.mjs');
(/yt-pin-comment\.mjs/.test(rd) && /--then-verify/.test(rd) && /'long'/.test(rd)) ? ok('[2] 총정리 롱폼 업로드 직후에도(링크 눌리는 utm 판)') : bad('[2] 총정리에 댓글 단계 없음');
const pc = src('yt-pin-comment.mjs');
(/then-verify/.test(pc) && /chromium\.launch\(/.test(pc) && /@flowvium/.test(pc) && /offsetWidth \|\| b\.offsetHeight/.test(pc)) ? ok('[3] 재확인은 로그아웃 브라우저 · 작성자 @flowvium · 고정 표시가 보이는지') : bad('[3] 재확인 조건 부족');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

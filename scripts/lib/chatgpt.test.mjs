#!/usr/bin/env node
/**
 * chatgpt.test.mjs — ChatGPT 를 자동으로 묻되, 로그인은 한 번만. 2026-10-10 신설.
 *
 * 사장님(10/10): "너가 플레이라이트로 사용해" · "앞으로 자동로그인되게해".
 *   기본 크롬(spinaiceo 창)은 디버그 포트가 없어 자동화가 못 붙는다(chrome-default-profile-not-automatable).
 *   → 전용 프로필 secrets/chatgpt-profile(포트 9334)에 사장님이 spinaiceo 로 1회 로그인. 쿠키가 프로필에 남는다.
 *   크롬이 꺼져 있으면(재부팅 등) 같은 프로필로 **다시 띄워서** 로그인 상태 그대로 쓴다 = 자동 로그인.
 *   Playwright connectOverCDP 는 이 크롬에서 "Browser context management is not supported" 로 붙지 못해
 *   페이지 CDP(웹소켓)로 직접 다룬다.
 */
import { readFileSync } from 'fs';
import * as CG from './chatgpt.mjs';
const { answerFromTurns, isLoggedOut } = CG;
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// 화면의 대화 조각: 접근성 제목(sr-only h4) "ChatGPT 답변:" 이 붙은 덩어리만 답이다.
const turns = [
  { label: '내가 한 말:', text: '내가 한 말: 테스트: 2+3은?' },
  { label: 'ChatGPT 답변:', text: 'ChatGPT 답변:\n5' },
];
answerFromTurns(turns) === '5' ? ok('[1] 마지막 답에서 제목 글자를 떼고 본문만') : bad(`[1] ${JSON.stringify(answerFromTurns(turns))}`);
answerFromTurns(turns.slice(0, 1)) === null ? ok('[2] 답이 아직 없으면 null') : bad('[2] 질문을 답으로 읽었다');
answerFromTurns([...turns, { label: 'ChatGPT 답변:', text: 'ChatGPT 답변:\n두 번째' }]) === '두 번째' ? ok('[3] 여러 답이면 마지막') : bad('[3]');

isLoggedOut({ email: null }) ? ok('[4] 세션 이메일 없으면 로그아웃으로 본다(조용히 빈 답 금지)') : bad('[4]');
!isLoggedOut({ email: 'spinaiceo@gmail.com' }) ? ok('[5] 이메일 있으면 로그인') : bad('[5]');

// [6][7] 공용 맥 규칙(10/15 Mac mini2 조건 — 10/14 다른 세션이 활성 탭이 Flow 로 바뀐 걸 몰라 Flow 에 오입력):
//   입력·엔터 직전마다 그 탭이 아직 chatgpt.com 인지 본다. 탭은 포커스 없이 새 창으로 연다(뒤쪽 탭은 hidden — 10/15 실측).
const on = CG.onChatGpt ?? (() => null);
on('https://chatgpt.com/c/abc') === true && on('https://labs.google/fx/tools/flow') === false && on('https://chatgpt.com.evil.io/') === false
  ? ok('[6] chatgpt.com 인지 판정(Flow·비슷한 도메인은 아님)') : bad('[6] onChatGpt');
/Target\.createTarget[^)]*newWindow: true, background: true/.test(readFileSync(new URL('./chatgpt.mjs', import.meta.url), 'utf8'))
  ? ok('[7] 따로 연 창(newWindow·background) — 뒤쪽 탭은 hidden 이라 ChatGPT 가 안 그린다') : bad('[7] 창 여는 방식');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

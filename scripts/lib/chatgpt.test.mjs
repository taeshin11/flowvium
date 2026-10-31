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
// 2026-10-31: 시험은 공용 9334 에 닿으면 안 된다 — 고치기 전 [9] 가 진짜 ask 로 빠져 'q' 를 실제 ChatGPT 에 보냈다. 닫힌 포트로 묶는다.
process.env.CHATGPT_CDP_PORT = '1';
const CG = await import('./chatgpt.mjs');
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
// [8] 2026-10-31 Mac mini2: Claude Code 의 Bash 셸에서 띄운 크롬은 detached+unref 여도 그 셸 프로세스 트리와 함께 18~20분 뒤 죽는다
//   (9334 가 하루 세 번 죽음, 충돌 보고서 없음). LaunchServices(open -na)로 띄워 부모를 launchd 로 만든다.
{ const L = CG.launchCommand?.();
  L && L.cmd === 'open' && L.args[0] === '-na' && L.args[1] === 'Google Chrome' && L.args[2] === '--args'
    && L.args.includes(`--remote-debugging-port=${CG.PORT}`) && L.args.some((a) => a.startsWith('--user-data-dir=') && a.endsWith('secrets/chatgpt-profile'))
    ? ok('[8] 크롬은 open -na 로(부모 launchd) — 띄운 셸이 죽어도 산다') : bad(`[8] ${JSON.stringify(L)}`); }
// [9] 2026-10-31 Mac mini2: 9334 는 launchd(KeepAlive)가 되살리는데 그 틈이 ~10초. 연결 오류(거부·창 못 엶)만 20초 쉬고 한 번 더.
//   시간초과·로그아웃은 다시 묻지 않는다(같은 답을 두 번 기다리거나 사람 일을 기계가 반복하지 않는다).
{
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  (CG.isConnError?.(refused) && CG.isConnError(new Error('새 탭의 디버거 주소를 못 찾았다'))
    && !CG.isConnError(new Error('ChatGPT 답이 180초 안에 끝나지 않았다')) && !CG.isConnError(new Error('ChatGPT 로그아웃 상태 — …')))
    ? ok('[9a] 연결 오류만 연결 오류로 본다') : bad('[9a] isConnError');
  const run = async (errs) => { const calls = [], slept = [];
    const r = await CG.ask('q', { _once: async () => { calls.push(1); const e = errs.shift(); if (e) throw e; return 'A'; }, _sleep: async (ms) => { slept.push(ms); } })
      .then((a) => ({ a }), (e) => ({ e: e.message }));
    return { ...r, calls: calls.length, slept }; };
  const a = await run([refused]);
  (a.a === 'A' && a.calls === 2 && a.slept.join() === '20000') ? ok('[9b] 연결 거부 → 20초 쉬고 한 번 더 → 답') : bad(`[9b] ${JSON.stringify(a)}`);
  const b = await run([refused, refused]);
  (b.e === 'fetch failed' && b.calls === 2) ? ok('[9c] 두 번째도 거부면 던진다(한 번만)') : bad(`[9c] ${JSON.stringify(b)}`);
  const c = await run([new Error('ChatGPT 답이 180초 안에 끝나지 않았다')]);
  (c.e && c.calls === 1 && c.slept.length === 0) ? ok('[9d] 시간초과는 다시 안 묻는다') : bad(`[9d] ${JSON.stringify(c)}`);
  // ensureBrowser: 안 살아 있어도 launchd 가 되살리는 중일 수 있다 — 20초 기다려 보고 그래도 없을 때만 직접 띄운다(같은 프로필 둘 방지).
  const seq = [false, false, true]; let launched = 0;
  const st = await CG.ensureBrowser?.({ _alive: async () => seq.shift() ?? true, _launch: () => { launched++; }, _sleep: async () => {} });
  (st === 'running' && launched === 0) ? ok('[9e] 되살아나는 중이면 직접 띄우지 않는다') : bad(`[9e] ${st} launched=${launched}`);
  let up = false; launched = 0;
  const st2 = await CG.ensureBrowser?.({ _alive: async () => up, _launch: () => { launched++; up = true; }, _sleep: async () => {} });
  (st2 === 'launched' && launched === 1) ? ok('[9f] 20초 지나도 없으면 직접 띄운다') : bad(`[9f] ${st2} launched=${launched}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

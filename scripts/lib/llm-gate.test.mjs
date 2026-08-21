#!/usr/bin/env node
/**
 * llm-gate.test.mjs — "백엔드가 직렬이면 클라이언트도 동시에 던지면 안 된다".
 *
 * 배경(2026-08-21 실측). 보고서 8건 중 2건에서 marketNarrative·shortSqueeze·topOpportunity
 *   3개가 *정확히 같이* 비었다. 셋은 Wave1 의 opportunity/narrative 호출에서 나온다.
 *
 *   :8000 의 27B 서버는 이렇게 떠 있다(com.spinai.flowvium-llm.plist):
 *       --prompt-concurrency 1 --decode-concurrency 1
 *   즉 한 번에 한 건만 처리한다. 그런데 generate-report-local.mjs 는 Wave1 에서
 *   Promise.all 로 5건을 동시에 던진다. 성공 런의 완료시각이 그 증거다 —
 *       regional 215.4s → opportunity 335.6s → macro 603.6s → narrative 765.2s → portfolio 1667.7s
 *   병렬이 아니라 단조 증가, 곧 직렬 처리다.
 *
 *   큐에 걸린 요청이 어떤 상태인지 직접 측정했다(probe: A 점유 + B 대기):
 *       A  헤더 17.3s · 첫 바디청크 44.2s · 완료 91.5s
 *       B  헤더 17.3s · 첫 바디청크 90.5s(=A 종료 직후) · 최대 청크간격 73.2s
 *   헤더는 즉시 오고, 그 뒤 앞 요청이 끝날 때까지 바디가 한 바이트도 안 온다.
 *   이 공백은 소켓 유휴 타임아웃(undici bodyTimeout, 기본 300s)의 사정권이다 —
 *   로컬 LLM 진영에서 널리 보고된 실패 형태다(cline#6549, Roo-Code#6570 등).
 *   이 저장소는 그 타임아웃을 이미 꺼 두었으므로(생성기 상단 참조) *그* 경로로는 안 죽는다.
 *
 *   확증된 사망 경로는 두 번째 것이다(미드나이트): 5건이 3600s AbortSignal 한 시계를
 *   나눠 쓰다 큐 대기시간이 각자의 예산을 먹어치워 동시 전멸했다 —
 *       Wave1 총 소요: 3598.1s / The operation was aborted due to timeout  (4건)
 *   게이트는 이 대기를 AbortSignal 이 시작되기 *전* 으로 옮긴다(호출부에서 slot 획득 후에야
 *   callVLLMOnce 가 signal 을 만든다). 그래서 이 경로가 근본적으로 없어진다.
 *
 *   오후 런의 fetch failed 3건은 원인이 아직 *미상* 이다. 옛 코드가 e.message 만 찍어
 *   cause 코드를 버렸기 때문이다(describeFetchError 로 고쳤다 — 다음 발생 때 드러난다).
 *   여기서 아는 척하지 않는다. 다만 동시 5건이 직렬 서버에 몰리는 구조 자체가
 *   재현 가능한 위험이고(아래 [1]), 게이트가 그 구조를 없앤다.
 *
 *   대조군이 진단을 확정한다 — regional-retry 는 두 번 다 성공했다(158.7s · 314.4s).
 *   단독 호출은 살고 동시 호출만 죽는다.
 *
 * 이 테스트는 그 메커니즘을 가짜 서버로 재현하고, 게이트가 그것을 없애는지 본다.
 *   시간축만 압축한다(생성 900ms / bodyTimeout 500ms). 구조는 실측 그대로:
 *   헤더 즉시 → 순번 대기 → 스트리밍.
 */
import http from 'node:http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Agent, fetch as ufetch } from 'undici';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const GEN_MS       = 900;  // 서버가 1건 생성하는 데 걸리는 시간
const BODY_TIMEOUT = 500;  // undici bodyTimeout — 실제 300s 를 압축한 값
const N            = 3;    // 동시 요청 수

// ── 실측 거동을 흉내 내는 직렬 SSE 서버 ─────────────────────────────────────────
//    핵심 두 가지: (1) 헤더는 받자마자 즉시 (2) 본문은 앞 요청이 끝나야 시작
let served = 0, maxInFlight = 0, inFlight = 0;
let chain = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  req.resume();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  // Node http 는 writeHead 만으로는 헤더를 소켓에 안 흘린다(첫 write 까지 버퍼링).
  // 실측한 mlx 거동은 '헤더 즉시 · 본문은 순번 대기' 였으므로 여기서 강제로 내보내야
  // 재현이 성립한다. 이게 없으면 클라이언트는 headersTimeout 쪽으로 새고 버그가 안 난다.
  res.flushHeaders();
  chain = chain.then(async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(GEN_MS);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    served++; inFlight--;
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const URL_ = `http://127.0.0.1:${PORT}/v1/chat/completions`;

const dispatcher = new Agent({ bodyTimeout: BODY_TIMEOUT, headersTimeout: 10000 });
async function callOnce() {
  const res = await ufetch(URL_, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{}', dispatcher,
  });
  const reader = res.body.getReader();
  for (;;) { const { done } = await reader.read(); if (done) break; }
  return 'ok';
}

// runner: 게이트가 있으면 그걸 통해서, 없으면 그냥 동시에
async function fireAll(wrap) {
  const rs = await Promise.allSettled(
    Array.from({ length: N }, () => (wrap ? wrap(callOnce) : callOnce()))
  );
  return {
    okCount: rs.filter(r => r.status === 'fulfilled').length,
    errs: rs.filter(r => r.status === 'rejected').map(r => `${r.reason?.cause?.code ?? r.reason?.name}: ${r.reason?.message}`),
  };
}

console.log(`\n[1] 게이트 없이 ${N}건 동시 — 버그가 재현되어야 한다`);
const before = await fireAll(null);
console.log(`    성공 ${before.okCount}/${N}` + (before.errs.length ? ` · 실패: ${before.errs.join(' | ')}` : ''));
if (before.okCount < N) ok(`동시 호출 시 뒤쪽 요청이 죽는다 (직렬 백엔드 + 소켓 유휴 타임아웃의 일반 위험)`);
else bad(`재현 실패 — 가짜 서버가 실측 거동(직렬+헤더즉시)을 못 흉내내고 있다. 테스트가 무의미하다`);

// 클라이언트가 죽어도 서버는 그 요청을 끝까지 처리한다. 비우지 않고 다음 단계로 가면
// [2] 가 [1] 의 잔여 백로그 뒤에 줄을 서서, 게이트와 무관하게 죽는다(실제로 그렇게 오탐했다).
async function drain() { await chain; await sleep(50); }
await drain();

console.log(`\n[2] 게이트(width=1) 통과 ${N}건 — 전부 살아야 한다`);
let createLimiter = null;
try { ({ createLimiter } = await import('./llm-gate.mjs')); }
catch (e) { bad(`scripts/lib/llm-gate.mjs 없음 — ${e.message}`); }

if (createLimiter) {
  const limit = createLimiter(1);
  const after = await fireAll(fn => limit(fn));
  console.log(`    성공 ${after.okCount}/${N}` + (after.errs.length ? ` · 실패: ${after.errs.join(' | ')}` : ''));
  if (after.okCount === N) ok('게이트 통과 시 전건 성공 — 큐 대기가 사라져 bodyTimeout 을 안 건드린다');
  else bad(`게이트를 써도 ${N - after.okCount}건 실패`);

  // 동시성 상한 자체 검사 — 서버가 본 동시 처리 수
  await drain();
  const limit2 = createLimiter(2);
  maxInFlight = 0;
  await Promise.allSettled(Array.from({ length: 4 }, () => limit2(callOnce)));
  if (limit2.stats().width === 2) ok('width 노출 정확');
  else bad(`width 노출 오류: ${limit2.stats().width}`);
}

console.log('\n[3] 생성기가 실제로 게이트를 경유하는가 (소스 불변식)');
const gsrc = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
if (/llm-gate\.mjs/.test(gsrc)) ok('generate-report-local.mjs 가 llm-gate 를 import 한다');
else bad('generate-report-local.mjs 가 게이트를 안 쓴다 — Wave1 은 여전히 5건을 동시에 던진다');

// callVLLM 안에서 감싸는지 — import 만 하고 안 쓰면 의미 없다
const vIdx = gsrc.indexOf('async function callVLLM');
const vBody = vIdx >= 0 ? gsrc.slice(vIdx, gsrc.indexOf('\n}', vIdx)) : '';
if (/limiterFor|llmSlot|limit\(/.test(vBody)) ok('callVLLM 본문이 게이트로 감싸여 있다 (모든 호출부가 한 지점을 지난다)');
else bad('callVLLM 본문에 게이트 적용 흔적 없음');

console.log('\n[4] LLM 요청의 타임아웃 해제가 실제로 적용되는가');
// 실측 A/B(서버 지연 3000ms · bodyTimeout 300ms): 내장 global fetch·npm undici fetch 둘 다
//   UND_ERR_BODY_TIMEOUT. 즉 setGlobalDispatcher 는 문서대로 내장 fetch 에도 반영된다
//   (Dispatcher1Wrapper 경유). 처음엔 900ms 지연으로 재서 "무효" 라고 잘못 판단했었다 —
//   undici 타이머 해상도가 ~1s 라 300ms 설정이 1009ms 에 발화한 것이 원인이었다.
//   그래서 전역 설정을 금지하지 않는다. 다만 LLM 호출은 명시 디스패처로도 못박는다:
//   전역은 파일 밖에서 덮이거나 초기화 순서에 얽힐 수 있고, 그 사고는 곧 발간 결함이 된다.
{
  const vIdx2 = gsrc.indexOf('async function callVLLMOnce');
  const body2 = vIdx2 >= 0 ? gsrc.slice(vIdx2, vIdx2 + 3000) : '';
  if (/undiciFetch\(/.test(body2) && /dispatcher:\s*LLM_DISPATCHER/.test(body2))
    ok('LLM 요청이 명시 디스패처를 쓴다');
  else bad('LLM 요청이 명시 디스패처를 안 쓴다 — 전역 설정에만 의존하게 된다');

  if (/headersTimeout:\s*0/.test(gsrc) && /bodyTimeout:\s*0/.test(gsrc))
    ok('LLM 경로의 소켓 유휴 타임아웃이 해제되어 있다 (프리필·조절기 정지 대비)');
  else bad('타임아웃 해제가 없다 — 긴 프리필/정지에서 소켓이 끊긴다');

  // import 누락 회귀 방지: 이번 세션에 실제로 내가 치환하다 import 3줄을 지웠고
  //   node --check 는 통과했다(문법만 본다). 런타임 ReferenceError 가 될 뻔했다.
  for (const need of ["from 'undici'", "./lib/llm-gate.mjs", "./lib/report-sessions.mjs"]) {
    gsrc.includes(need) ? ok(`import 존재: ${need}`) : bad(`import 누락: ${need} — 런타임에 죽는다`);
  }
}

console.log(`\n서버 처리 ${served}건 · 서버가 본 최대 동시 처리 ${maxInFlight}`);
server.close();
console.log(fail === 0 ? '\n✅ llm-gate 전부 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

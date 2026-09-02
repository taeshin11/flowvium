#!/usr/bin/env node
/**
 * llm-health.test.mjs — "포트가 살아있다" 를 "LLM 이 정상이다" 로 읽던 게이트를 잡는다.
 *
 * 재현하는 사건 (2026-08-31 확인, 3일간 보고서 0건):
 *   mlx_lm.server 는 요청마다 스레드를 띄운다. Metal OOM 으로 생성 워커가 죽어도
 *   /v1/models 는 계속 200 을 준다. run-report.sh 의 게이트는 그 200 만 보고
 *   "LLM 정상" 을 찍은 뒤 파이프라인을 4시간짜리 정지로 밀어넣었다.
 *
 * 그래서 이 테스트의 1번 케이스가 핵심이다 — /v1/models 는 200, 생성은 무응답인 서버.
 *   종전 게이트: 통과 (사건 재현)
 *   probeGeneration: 반드시 불합격이어야 한다.
 */
import { createServer } from 'http';
import { probeGeneration } from './llm-health.mjs';

let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };

const LOADED = '/Users/x/.cache/huggingface/hub/models--org--M/snapshots/abc';

/** 테스트용 서버를 띄우고 베이스 URL 을 준다. handler(req,res,body) 로 응답을 정한다. */
function serve(handler) {
  return new Promise((res) => {
    const s = createServer((req, rq) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, rq, body));
    });
    s.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${s.address().port}/v1`, close: () => s.close() }));
  });
}

const modelsBody = JSON.stringify({ data: [{ id: 'org/M' }, { id: LOADED }] });
const sendJson = (rs, obj) => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(obj)); };

// ── 1. 사건 그 자체: 목록은 200, 생성은 영영 안 돌아온다 ────────────────────────
{
  const held = [];
  const srv = await serve((rq, rs) => {
    if (rq.url.endsWith('/models')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(modelsBody); return; }
    held.push(rs); // 생성 요청은 붙잡아 두고 응답하지 않는다 = 죽은 워커
  });

  // 종전 게이트의 판정을 그대로 재현해 둔다 — 이 서버는 옛 기준으로는 '정상' 이다.
  const legacy = await fetch(`${srv.url}/models`).then((r) => r.status);
  legacy === 200
    ? ok('종전 게이트(/v1/models 200)는 이 죽은 서버를 정상으로 본다 — 사건 재현됨')
    : bad('사건 재현 실패 — 테스트 서버가 200 을 주지 않는다');

  const r = await probeGeneration({ url: srv.url, timeoutMs: 1500 });
  !r.ok && r.stage === 'generate'
    ? ok(`생성 프로브는 불합격 판정 (${r.detail})`)
    : bad(`생성이 죽었는데 통과시켰다: ${JSON.stringify(r)}`);

  held.forEach((rs) => rs.destroy());
  srv.close();
}

// ── 2. 정상 서버는 통과해야 한다 (오경보로 보고서를 막으면 그것도 사고다) ────────
{
  const srv = await serve((rq, rs) => {
    if (rq.url.endsWith('/models')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(modelsBody); return; }
    sendJson(rs, { choices: [{ index: 0, message: { role: 'assistant', content: 'p' } }] });
  });
  const r = await probeGeneration({ url: srv.url, timeoutMs: 5000 });
  r.ok && r.model === 'org/M'
    ? ok(`정상 서버 통과, 적재 모델 해석 = ${r.model}`)
    : bad(`정상 서버를 막았다: ${JSON.stringify(r)}`);
  srv.close();
}

// ── 3. 200 이지만 choices 가 빈 응답 — 생성 경로 이상으로 잡아야 한다 ───────────
{
  const srv = await serve((rq, rs) => {
    if (rq.url.endsWith('/models')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(modelsBody); return; }
    sendJson(rs, { choices: [] });
  });
  const r = await probeGeneration({ url: srv.url, timeoutMs: 5000 });
  !r.ok && r.stage === 'generate'
    ? ok('choices 빈 200 응답도 불합격')
    : bad(`빈 응답을 통과시켰다: ${JSON.stringify(r)}`);
  srv.close();
}

// ── 4. 적재본을 특정할 수 없으면 추측하지 않는다 (목록 첫 항목 집기가 종전 버그) ─
{
  const srv = await serve((rq, rs) => {
    if (rq.url.endsWith('/models')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ data: [{ id: 'org/A' }, { id: 'org/B' }] })); return; }
    sendJson(rs, { choices: [{ message: { content: 'p' } }] });
  });
  const r = await probeGeneration({ url: srv.url, timeoutMs: 5000 });
  !r.ok && r.stage === 'model-id'
    ? ok('적재본 근거 없으면 추측 대신 불합격')
    : bad(`근거 없이 모델을 골랐다: ${JSON.stringify(r)}`);
  srv.close();
}

// ── 5. 포트가 아예 닫혀 있으면 models 단계에서 잡힌다 ──────────────────────────
{
  const srv = await serve(() => {});
  const url = srv.url; srv.close();
  await new Promise((r) => setTimeout(r, 50));
  const r = await probeGeneration({ url, timeoutMs: 2000 });
  !r.ok && r.stage === 'models'
    ? ok('포트 닫힘은 models 단계에서 불합격')
    : bad(`닫힌 포트를 통과시켰다: ${JSON.stringify(r)}`);
}

// ── 2026-08-31 오후: "느림" 을 "죽음" 으로 읽던 경로 ──────────────────────────────
//   오전에 check-stall 의 `r.down` 을 issues 로 승격했다(3일 침묵의 원인). 그런데 그 프로브의
//   상한이 20s 다. 이 기계에서 그 값은 현실과 안 맞는다 — 실측:
//
//     :8000 27B  1회차 114.6s → 2회차 1.09s → 3회차 1.09s   (105배)
//     :8001 4B   1회차  1.86s → 2회차 0.12s
//
//   원인은 사망이 아니라 콜드 페이지인이다. 이 기계는 wired 34.8GB · 스왑 4.2/6.1GB 로
//   상시 압박 상태라, 유휴 동안 macOS 가 모델 가중치를 압축·스왑아웃한다. 첫 요청이 그걸
//   도로 끌어올리는 값이 30~115s 다. 20s 상한은 **유휴 뒤 첫 프로브를 항상 실패시킨다.**
//
//   그리고 나쁜 쪽으로 겹친다: 클라이언트가 abort 해도 mlx_lm 은 그 요청을 계속 처리한다.
//   짧은 상한으로 끊은 프로브는 서버 큐에 일감을 남기고, 다음 프로브가 그 뒤에 선다.
//   실제로 20s 프로브 직후에 쏜 90s 프로브가 97.4s 만에 타임아웃 났다 — 짧은 상한이
//   상황을 *악화* 시킨 것이다.
//
//   그래서 판정을 두 단계로 나눈다. 빠른 상한으로 먼저 묻고(정상이면 1s), 실패하면
//   **한 번 더 길게** 묻는다. 첫 시도가 이미 페이지를 데워놨으므로 두 번째는 싸다.
//   두 번째까지 실패해야 사망이다. 콜드와 사망은 다른 것이고, 감시가 그 둘을 못 가르면
//   3일 침묵과 매일 오경보 사이를 오갈 뿐이다.
/** 신호가 먼저 끊으면 TimeoutError 로 거절 — 실제 fetch 가 하는 것과 같은 모양. */
function raceSignal(takesMs, signal) {
  return new Promise((res, rej) => {
    const t = setTimeout(res, takesMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      rej(e);
    }, { once: true });
  });
}
/** probeGeneration 이 부르는 두 엔드포인트에 각각 맞는 최소 응답. */
function jsonRes(url) {
  const body = url.endsWith('/models')
    ? { data: [{ id: '/Users/x/.cache/huggingface/hub/models--mlx-community--Qwen3.8-27B-8bit/snapshots/abc' }] }
    : { choices: [{ message: { role: 'assistant', content: 'pong' } }] };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

{
  const H = await import('./llm-health.mjs');
  typeof H.probeWithColdRetry === 'function'
    ? ok('probeWithColdRetry 제공')
    : bad('콜드/사망을 가르는 경로가 없다 — 유휴 뒤 첫 프로브가 항상 DEAD 로 찍힌다');

  if (typeof H.probeWithColdRetry === 'function') {
    // ① 콜드: 첫 요청은 상한을 넘기고, 두 번째(길게)는 성공한다 → 살아있다고 판정해야 한다
    // 예산(ms)을 스텁이 읽을 방법은 없다 — AbortSignal 에서 남은 시간을 못 꺼낸다.
    // 그래서 실제 서버처럼 '걸리는 시간' 을 두고 신호와 경쟁시킨다. 값만 작게 잡는다.
    // 이 서버는 사건의 실제 모양이다: /v1/models 는 ThreadingHTTPServer 라 언제나 즉답이고,
    // 느린 것은 *생성* 뿐이다. 그래서 콜드 판정은 생성 단계에서만 갈려야 한다.
    let gen = 0;
    const coldServer = async (url, opt) => {
      if (String(url).endsWith('/models')) return jsonRes(String(url));   // 23ms 즉답
      gen++;
      await raceSignal(gen === 1 ? 300 : 20, opt?.signal);                // 페이지인 → 데워진 뒤
      return jsonRes(String(url));
    };
    const cold = await H.probeWithColdRetry({ url: 'http://x/v1', fetchImpl: coldServer, timeoutMs: 100, coldTimeoutMs: 2_000 });
    cold.ok ? ok(`콜드는 사망이 아니다 — 재시도로 통과 (${cold.detail})`) : bad(`콜드 페이지인을 사망으로 판정: ${cold.detail}`);
    cold.cold ? ok('콜드였음을 표시한다(운영자가 원인을 알 수 있게)') : bad('콜드 표시가 없다');

    // ② 진짜 사망: 두 번 다 무응답이면 사망이다. 여기까지 완화하면 3일 침묵이 재발한다.
    // 08-28~08-31 실제 사건: 목록은 200 인데 생성만 영원히 안 나온다.
    const deadServer = async (url, opt) => {
      if (String(url).endsWith('/models')) return jsonRes(String(url));
      await raceSignal(60_000, opt?.signal);
      throw new Error('여기 오면 안 된다');
    };
    const dead = await H.probeWithColdRetry({ url: 'http://x/v1', fetchImpl: deadServer, timeoutMs: 200, coldTimeoutMs: 400 });
    !dead.ok && dead.stage === 'generate'
      ? ok(`목록 200 + 생성 무응답 두 번 → 사망 판정 (${dead.stage})`)
      : bad(`진짜 죽은 서버 판정 오류: ok=${dead.ok} stage=${dead.stage}`);
    !dead.cold ? ok('사망을 콜드로 감싸지 않는다') : bad('사망인데 콜드로 표시 — 3일 침묵이 재발한다');

    // ③ 정상(웜)이면 재시도를 하지 않는다 — 20분마다 도는 감시가 매번 두 번 쏘면 안 된다
    const warmServer = async (url) => jsonRes(String(url));
    const warm = await H.probeWithColdRetry({ url: 'http://x/v1', fetchImpl: warmServer, timeoutMs: 2_000 });
    warm.ok && !warm.cold ? ok('웜이면 콜드 표시 없음') : bad(`웜인데 ${JSON.stringify({ ok: warm.ok, cold: warm.cold })}`);
  }
}

// ── 2026-09-02: 재기동 직후 성급하게 포기하던 경로 ──────────────────────────────
//   실측 사고: :8001 이 Metal OOM 으로 죽어(09-01 05:58) 유튜브가 37시간 멈췄다.
//   `--repair` 를 돌리니 kickstart 는 정상으로 나갔는데(레인·라벨·메모리 판정 전부 옳음)
//   직후 프로브가 ECONNREFUSED 를 받고 "재기동 후에도 불합격" 으로 중단했다.
//   그런데 실제로는 살아났다 — 2초 뒤 로그에 `Starting httpd at 127.0.0.1 on port 8001`,
//   포트 200. 즉 **복구에 성공해 놓고 실패로 보고**했다.
//
//   원인: probeWithColdRetry 는 stage==='models' 면 재시도 없이 즉시 판정한다.
//   그 규칙 자체는 옳다 — 평상시 포트가 닫혔으면 느린 게 아니라 죽은 것이다.
//   하지만 *막 재기동한 직후* 는 다르다. 포트가 아직 안 열린 게 정상이다(실측 1.1~2s).
//   상태가 다르면 판정도 달라야 한다. 그래서 "서빙 시작까지 기다리는" 경로를 따로 둔다.
{
  const H = await import('./llm-health.mjs');
  typeof H.waitUntilServing === 'function'
    ? ok('waitUntilServing 제공')
    : bad('재기동 직후를 기다리는 경로가 없다 — 복구에 성공하고도 실패로 보고한다');

  if (typeof H.waitUntilServing === 'function') {
    // 처음 두 번은 포트가 안 열려 있고 세 번째에 열린다 — 기다려서 통과해야 한다
    let n = 0;
    const late = async () => {
      if (++n < 3) { const e = new Error('connect ECONNREFUSED'); e.name = 'TypeError'; throw e; }
      return { ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '{}' };
    };
    const r = await H.waitUntilServing({ url: 'http://x/v1', fetchImpl: late, timeoutMs: 5_000, intervalMs: 50 });
    r.ok && n === 3 ? ok(`포트가 열릴 때까지 기다린다 (${n}회 시도)`) : bad(`기다리지 않았다: ok=${r.ok} 시도=${n}`);

    // 영영 안 열리면 기다림에도 상한이 있어야 한다 — 크론이 여기서 영구히 멈추면 안 된다
    const never = async () => { const e = new Error('connect ECONNREFUSED'); e.name = 'TypeError'; throw e; };
    const t0 = Date.now();
    const r2 = await H.waitUntilServing({ url: 'http://x/v1', fetchImpl: never, timeoutMs: 400, intervalMs: 50 });
    const spent = Date.now() - t0;
    !r2.ok && spent < 3_000 ? ok(`상한 안에서 포기 (${spent}ms)`) : bad(`상한을 안 지켰다: ok=${r2.ok} ${spent}ms`);
  }
}

console.log(fail === 0 ? '\n✅ llm-health 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

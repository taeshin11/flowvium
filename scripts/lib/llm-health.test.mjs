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

console.log(fail === 0 ? '\n✅ llm-health 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

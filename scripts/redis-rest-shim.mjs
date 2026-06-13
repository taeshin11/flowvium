#!/usr/bin/env node
/**
 * scripts/redis-rest-shim.mjs — Upstash REST API 호환 shim → 로컬(WSL) Redis (2026-06-14).
 *
 * 발생 경위: Upstash Redis 요청 한도(50만) 소진 → 사이트 데이터계층 전체 read/write 차단
 *   (리포트 업로드 불가·캐시 stale·fallback). 사용자 "redis를 local 로 돌리면 회피 안되나?".
 *   자가호스팅 머신의 WSL Ubuntu 에 redis-server 설치(무한도) + 이 shim 이 @upstash/redis 클라이언트의
 *   REST 프로토콜을 그대로 받아 ioredis 로 로컬 redis 에 중계. 앱 코드 0 변경 — UPSTASH_REDIS_REST_URL
 *   만 이 shim 으로 바꾸면 됨. Upstash 의존·쿼터 영구 제거.
 *
 * 프로토콜(@upstash/redis v1):
 *   - POST /            body=["SET","key","val","EX","60"]      → {"result": ...}
 *   - POST /pipeline    body=[["SET",...],["GET",...]]          → [{"result":...},...]
 *   - POST /multi-exec  body=[[...],[...]]  (MULTI/EXEC 트랜잭션) → [{"result":...},...]
 *   - GET  /get/key  등 path-style 도 방어적 지원.
 *   - Authorization: Bearer <SRH_TOKEN> 검증.
 */
import http from 'http';
import Redis from 'ioredis';

const PORT = Number(process.env.SRH_PORT || 8079);
const TOKEN = process.env.SRH_TOKEN || 'flowvium-local-redis';
const redis = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 3, enableReadyCheck: true });

redis.on('error', (e) => console.error('[shim] redis error:', e.message));

async function runCmd(arr) {
  if (!Array.isArray(arr) || !arr.length) return { error: 'empty command' };
  try {
    // ioredis call: 모든 인자 문자열화(숫자 EX 등) — Redis 는 문자열 프로토콜.
    const args = arr.map((a) => (a == null ? '' : typeof a === 'object' ? JSON.stringify(a) : String(a)));
    const res = await redis.call(args[0], ...args.slice(1));
    return { result: res };
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 64 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
    // Auth
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });

    const url = req.url || '/';
    const bodyStr = await readBody(req);

    // path-style 명령 (GET /get/key, /set/key/val ...) — @upstash 는 주로 POST body 지만 방어적 지원
    if (req.method === 'GET' && url !== '/') {
      const parts = url.slice(1).split('/').map(decodeURIComponent);
      return send(200, await runCmd(parts));
    }

    let payload;
    try { payload = bodyStr ? JSON.parse(bodyStr) : []; } catch { return send(400, { error: 'bad json' }); }

    if (url === '/pipeline' || url === '/multi-exec') {
      // payload = [[cmd,...],...] → 순차 실행(트랜잭션도 순차로 충분 — 단일 인스턴스)
      if (!Array.isArray(payload)) return send(400, { error: 'pipeline expects array' });
      const out = [];
      for (const cmd of payload) out.push(await runCmd(cmd));
      return send(200, out);
    }
    // 단일 명령: body = ["CMD", ...args]
    return send(200, await runCmd(payload));
  } catch (e) {
    send(500, { error: e?.message ?? 'shim error' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`[redis-rest-shim] listening http://127.0.0.1:${PORT} → local redis :6379 (token len ${TOKEN.length})`));

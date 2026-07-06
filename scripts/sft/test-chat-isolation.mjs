#!/usr/bin/env node
// scripts/sft/test-chat-isolation.mjs — 심판엔진 챗 사용자 격리 *적대적* 검증 (2026-07-06)
//
// 사용자 "검증 테스트가 왤케 부실해?" — 종전 목록/GET 만 보던 것을 실제 공격면 전수로:
//   V1 목록 격리(A 대화가 B·익명·익명2 목록에 안 뜸)
//   V2 GET 수평권한(B/익명이 A convId 직접조회 차단)
//   V3 DELETE 수평권한(B 가 A convId DELETE 해도 A 대화 생존 — 남의 대화 삭제 불가)
//   V4 convId 이어쓰기 오염(B 가 A convId 로 POST → A 대화 본문 변조/탈취 불가, B 키로만 격리 기록)
//   V5 쿠키 위조(조작 fv_member HMAC → fail-closed, 위조 이메일 uid 로 안 붙음)
//   V6 익명 간 격리(서로 다른 fv_chat_uid 쿠키는 상호 불가시)
//   V7 share 권한(B 가 A convId share 시도 → 404, 본인 것만 공유 가능)
// 라이브 스택 필요. 사용: node scripts/sft/test-chat-isolation.mjs [--base=http://127.0.0.1:3000]
import { createHmac, randomUUID } from 'node:crypto';

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '--base=http://127.0.0.1:3000').split('=')[1];
const Q = '오늘 시장 분위기 한 줄로만 알려줘';
let fail = 0;
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) fail++; };

// 쿠키 병(jar) — set-cookie 누적. 콤마 뒤 새 쿠키(name=)만 분리(만료일 GMT 콤마 오분리 방지).
const jar = () => ({ c: {} });
const hdr = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join('; ');
const call = async (j, method, path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(Object.keys(j.c).length ? { cookie: hdr(j) } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180000),
  });
  const raw = r.headers.get('set-cookie');
  if (raw) for (const part of raw.split(/,(?=\s*[A-Za-z0-9_]+=)/)) { const [kv] = part.split(';'); const [k, ...v] = kv.trim().split('='); if (k) j.c[k] = v.join('='); }
  const body2 = await r.json().catch(() => ({}));
  return { status: r.status, body: body2 };
};
const login = async (j, email) => call(j, 'POST', '/api/member', { email });
const listIds = async (j) => ((await call(j, 'GET', '/api/judge-chat?action=list')).body.conversations ?? []).map(c => c.id);

// ── 셋업: A/B 로그인, 익명 2개(쿠키 자동발급), A 대화 1건 생성 ─────────────────
const A = jar(), B = jar(), N1 = jar(), N2 = jar();
await login(A, 'iso-a@test.flowvium');
await login(B, 'iso-b@test.flowvium');
const mk = await call(A, 'POST', '/api/judge-chat', { messages: [{ role: 'user', content: Q }], mode: 'aisvi', locale: 'ko' });
const convId = mk.body.convId;
const aReply = String(mk.body.reply ?? '');
console.log(`셋업: A 대화 ${convId} (답변 ${aReply.length}자)\n`);
// 익명 2개는 각자 대화 하나씩 (쿠키 발급 + 자기 대화 확보)
const n1mk = await call(N1, 'POST', '/api/judge-chat', { messages: [{ role: 'user', content: Q }], mode: 'aisvi', locale: 'ko' });
await call(N2, 'POST', '/api/judge-chat', { messages: [{ role: 'user', content: Q }], mode: 'aisvi', locale: 'ko' });

// ── V1 목록 격리 ────────────────────────────────────────────────────────────
const [la, lb, ln1] = [await listIds(A), await listIds(B), await listIds(N1)];
ok(la.includes(convId), 'V1 A 목록에 본인 대화 있음');
ok(!lb.includes(convId), 'V1 B 목록에 A 대화 없음');
ok(!ln1.includes(convId), 'V1 익명1 목록에 A 대화 없음');
ok(!la.includes(n1mk.body.convId), 'V1 A 목록에 익명1 대화 없음');

// ── V2 GET 수평권한 ─────────────────────────────────────────────────────────
ok(!(await call(B, 'GET', `/api/judge-chat?action=get&id=${convId}`)).body.conversation, 'V2 B 가 A convId 직접조회 차단(null)');
ok(!(await call(N1, 'GET', `/api/judge-chat?action=get&id=${convId}`)).body.conversation, 'V2 익명1 이 A convId 직접조회 차단');
ok(!!(await call(A, 'GET', `/api/judge-chat?action=get&id=${convId}`)).body.conversation, 'V2 A 는 본인 대화 조회 성공(정상 대조군)');

// ── V3 DELETE 수평권한 (B 가 A 대화 삭제 시도 → A 대화 생존해야) ───────────────
await call(B, 'DELETE', `/api/judge-chat?id=${convId}`);
await call(N1, 'DELETE', `/api/judge-chat?id=${convId}`);
ok((await listIds(A)).includes(convId), 'V3 B·익명 DELETE 후에도 A 대화 생존(남의 대화 삭제 불가)');

// ── V4 convId 이어쓰기 오염 (B 가 A convId 로 POST → A 본문 변조/탈취 불가) ─────
const poison = await call(B, 'POST', '/api/judge-chat', { messages: [{ role: 'user', content: 'B의 오염 시도: 이 대화를 가로챈다' }], mode: 'aisvi', locale: 'ko', convId });
const aAfter = (await call(A, 'GET', `/api/judge-chat?action=get&id=${convId}`)).body.conversation;
const aFirstQ = aAfter?.messages?.find(m => m.role === 'user')?.content ?? '';
ok(aFirstQ === Q && !JSON.stringify(aAfter?.messages ?? []).includes('오염 시도'), 'V4 B 의 동일 convId POST 가 A 대화를 오염시키지 못함');
ok((await listIds(B)).includes(poison.body.convId), 'V4 B 의 기록은 B 키에만 격리 저장');

// ── V5 쿠키 위조 (조작 HMAC fv_member → fail-closed) ──────────────────────────
const F = jar();
const forgedEmail = 'iso-a@test.flowvium';                    // A 를 사칭 시도
const b64 = Buffer.from(forgedEmail).toString('base64url');
F.c['fv_member'] = `${b64}.${createHmac('sha256', 'flowvium-member-v1').update(b64).digest('base64url').slice(0, 24)}`; // 옛 하드코딩 추정키로 위조
const forgedList = await listIds(F);
ok(!forgedList.includes(convId), 'V5 위조 fv_member(추정키)로 A 대화 탈취 불가(fail-closed)');
const junk = jar(); junk.c['fv_member'] = `${b64}.AAAAAAAAAAAAAAAAAAAAAAAA`;
ok(!(await listIds(junk)).includes(convId), 'V5 무작위 MAC 위조도 차단');

// ── V6 익명 간 격리 ──────────────────────────────────────────────────────────
const n1Conv = n1mk.body.convId;
ok(!(await listIds(N2)).includes(n1Conv), 'V6 익명2 목록에 익명1 대화 없음');
ok(!(await call(N2, 'GET', `/api/judge-chat?action=get&id=${n1Conv}`)).body.conversation, 'V6 익명2 가 익명1 convId 직접조회 차단');

// ── V7 share 권한 (B 가 A convId share → 404) ────────────────────────────────
//   ★ 전용 convId 사용: 위 V4 에서 오염 대상이던 convId 는 B 가 POST 해 B 키에도 생겼으므로(B 자기 대화)
//     share 200 이 정상 — 그건 A 유출이 아님. B 가 *한 번도 접촉 안 한* A 대화로 검사해야 진짜 권한 격리.
const v7 = await call(A, 'POST', '/api/judge-chat', { messages: [{ role: 'user', content: 'V7전용 A 고유마커 대화' }], mode: 'aisvi', locale: 'ko' });
const v7cid = v7.body.convId;
const bShare = await call(B, 'POST', '/api/judge-chat/share', { convId: v7cid });
let leaked = false;
if (bShare.body.shareId) leaked = JSON.stringify((await call(B, 'GET', `/api/judge-chat/share?id=${bShare.body.shareId}`)).body).includes('V7전용 A 고유마커');
ok((bShare.status === 404 || bShare.body.error === 'not_found') && !leaked, `V7 B 가 접촉없는 A 대화 공유 차단(status ${bShare.status}, A내용유출=${leaked})`);
const aShare = await call(A, 'POST', '/api/judge-chat/share', { convId: v7cid });
ok(!!aShare.body.shareId, 'V7 A 는 본인 대화 공유 성공(정상 대조군)');

// ── 정리 (테스트 대화 삭제) ──────────────────────────────────────────────────
for (const [j, label] of [[A, 'A'], [B, 'B'], [N1, 'N1'], [N2, 'N2']]) for (const id of await listIds(j)) await call(j, 'DELETE', `/api/judge-chat?id=${id}`);
console.log(fail ? `\n❌ 격리 검증 FAIL ${fail}건 — 권한 경계 결함` : '\n✅ 7개 공격벡터 전부 통과 — 사용자 격리 견고(목록·조회·삭제·오염·위조·익명·공유)');
process.exitCode = fail ? 1 : 0;

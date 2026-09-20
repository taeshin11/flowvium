#!/usr/bin/env node
/**
 * git-credential-health.test.mjs — 푸시가 막히기 **전에** 아는가. 2026-09-20 신설.
 *
 * 왜: 이 저장소의 크론은 매 실행마다 origin/master 를 checkout 해서 미푸시 변경을 지운다
 *   (CLAUDE.md 맨 위 사건). 그래서 "푸시가 된다" 는 것이 안전장치다.
 *   2026-09-20 에 그 장치가 조용히 빠져 있었다 — 키체인에 깃허브 자격증명이 아예 없었고,
 *   푸시는 VS Code 의 인증 소켓을 타고 나가고 있었다. 그 소켓이 죽자 크론이 만든 커밋 4개가
 *   밀리지 않은 채 쌓였다. 지금은 토큰을 키체인에 넣었지만 그건 VS Code 가 발급한
 *   gho_ 토큰이라 세션이 갱신되면 죽을 수 있다. 죽는 순간을 증상이 아니라 **점검으로** 안다.
 */
import { parseCredential, credentialVerdict } from './git-credential-health.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 헬퍼 출력에서 사용자와 토큰 종류를 읽는다 — 값 자체는 돌려주지 않는다
{
  const c = parseCredential('protocol=https\nhost=github.com\nusername=58167590\npassword=gho_AAAABBBBCCCC\n');
  c.username === '58167590' && c.hasPassword === true && c.kind === 'gho'
    ? ok(`[1] 사용자 ${c.username} · 종류 ${c.kind}`) : bad(`[1] ${JSON.stringify(c)}`);
  'password' in c ? bad('[1b] 비밀번호를 그대로 돌려줬다 — 로그로 샌다') : ok('[1b] 비밀번호는 돌려주지 않는다');
}

// [2] 자격증명이 아예 없으면 그것부터가 결함이다 (2026-09-20 의 실제 상태)
{
  const c = parseCredential('');
  c.hasPassword === false ? ok('[2] 빈 출력 → 자격증명 없음') : bad(`[2] ${JSON.stringify(c)}`);
  const v = credentialVerdict({ hasPassword: false });
  v.level === 'error' && /키체인|자격증명/.test(v.line)
    ? ok(`[2b] 없으면 error: ${v.line.slice(0, 40)}…`) : bad(`[2b] ${JSON.stringify(v)}`);
}

// [3] 있는데 API 가 거절하면(401) 죽은 토큰이다 — 푸시가 실패하기 전에 안다
{
  const v = credentialVerdict({ hasPassword: true, apiStatus: 401 });
  v.level === 'error' && /만료|폐기|다시/.test(v.line)
    ? ok(`[3] 401 → error: ${v.line.slice(0, 40)}…`) : bad(`[3] ${JSON.stringify(v)}`);
}

// [4] 200 이지만 쓰기 권한이 없으면 푸시는 못 한다 — 읽기만 되는 토큰을 통과시키지 않는다
{
  const v = credentialVerdict({ hasPassword: true, apiStatus: 200, canPush: false });
  v.level === 'error' ? ok('[4] 읽기 전용 토큰 → error') : bad(`[4] ${JSON.stringify(v)}`);
}

// [5] 200 + 쓰기 가능이면 정상
{
  const v = credentialVerdict({ hasPassword: true, apiStatus: 200, canPush: true, kind: 'gho' });
  v.level === 'ok' ? ok(`[5] 정상: ${v.line.slice(0, 50)}`) : bad(`[5] ${JSON.stringify(v)}`);
}

// [6] 망 오류로 못 물어봤으면 ok 라고 하지 않는다 — 모르면 모른다고 한다
//     (어제 token-age 에서 배운 것: 모르는 것을 정상이라 말하면 관문이 죽는다)
{
  const v = credentialVerdict({ hasPassword: true, apiStatus: null });
  v.level === 'unknown' ? ok('[6] 확인 못 했으면 unknown') : bad(`[6] ${JSON.stringify(v)}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);

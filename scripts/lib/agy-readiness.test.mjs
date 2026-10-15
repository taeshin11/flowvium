#!/usr/bin/env node
/**
 * agy-readiness.test.mjs — 보고서 회차를 접을지 정하는 'agy 준비됨' 판정. 2026-10-15 신설.
 *
 * 왜: 10/15 10:30 정오 회차가 "[FATAL] agy 가 준비 안 됐고 로컬 27B 는 disable" 로 통째로 접혔다.
 *   그날은 KOSPI -8% 였다 — 09:40 쇼크 감지가 "정기 실행까지 50분" 이라 비정기 발간을 양보했는데, 양보받은
 *   정기 회차가 접혀 08:44 아침판('KR 분할 매수 관찰')이 장중 내내 라이브에 남았다.
 *   원인: 준비 확인(`agy models`, 60초 한 번)이 그 순간 503 으로 60초를 넘겨 끊겼다(agy 로그 10:30:02→10:31:02
 *   SIGTERM, 'UNAVAILABLE (code 503)'). 종전 판정은 '종료코드 0 이고 sign in 문구가 없다' 하나라서
 *   **일시 장애(시간 초과·503)를 로그인 안 됨과 같은 것으로** 봤다. 접는 게 맞는 건 로그인 문제뿐이다 —
 *   일시 장애는 본 호출들(모델 사슬·호출별 시간 제한·차단기)이 스스로 다룬다. 정말 계속 죽어 있으면
 *   그 호출들이 실패하고 보고서는 안 나간다(지금과 같은 결과), 살아나면 나간다.
 * 규칙: auth(로그인) → 안 됨 · ok → 됨 · transient(시간 초과·503·429·네트워크) → 됨(본 호출에 맡김)
 *   · 그 밖에 이유를 모르는 실패 → 안 됨(종전대로).
 */
import { agyReadiness } from './agy.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const t = (r, want, label) => { const got = agyReadiness(r); got === want ? ok(`${label} → ${want}`) : bad(`${label}: ${got} (기대 ${want})`); };

t({ status: 0, stdout: 'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n', stderr: '' }, 'ok', '[1] 정상 목록');
t({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' }, 'transient', '[2] 10/15 10:30 실측: 60초 시간 초과');
t({ status: 1, stdout: '', stderr: 'error: Eligibility check failed: UNAVAILABLE (code 503): The service is currently unavailable.' }, 'transient', '[3] 503');
t({ status: 1, stdout: '', stderr: 'RESOURCE_EXHAUSTED (code 429)' }, 'transient', '[4] 429');
t({ status: 1, stdout: '', stderr: 'Please sign in to continue' }, 'auth', '[5] 로그인 요구');
t({ status: 0, stdout: 'You must sign in first', stderr: '' }, 'auth', '[6] 종료코드 0 이어도 sign in 문구면 로그인 문제');
t({ status: 2, stdout: '', stderr: 'segmentation fault' }, 'unknown', '[7] 이유 모를 실패는 unknown(접는다)');
t({ status: 0, stdout: 'Fetching available models...\n', stderr: '' }, 'unknown', '[8] 종료 0 인데 목록이 비었으면 unknown');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * report-sessions.test.mjs — 세션 단일소스 회귀·기능 검증.
 *  ① 24시간 전 구간에서 이관 전 매핑과 100% 동일한가 (회귀 없음 증명)
 *  ② --session=<id> 명시가 벽시계를 무시하는가 (크론 시각을 당겨도 라벨이 안 흔들림)
 *  ③ 잘못된 세션 id 는 조용히 넘어가지 않고 throw 하는가
 *  ④ publishKst / leadMinutes 가 JSON 에서 오는가 (코드 리터럴 아님)
 */
const M = await import('./report-sessions.mjs');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// ① 이관 전 getSession() 의 정확한 동작표 (generate-report-local.mjs:887-892 원본)
const LEGACY = h =>
  (h >= 6  && h < 11) ? 'morning'   :
  (h >= 11 && h < 15) ? 'noon'      :
  (h >= 15 && h < 20) ? 'afternoon' :
  (h >= 20 && h < 23) ? 'evening'   : 'midnight';
let mismatch = [];
for (let h = 0; h < 24; h++) {
  // KST h시가 되도록 UTC epoch 구성 (KST = UTC+9)
  const now = Date.UTC(2026, 7, 20, (h - 9 + 24) % 24, 30) - (h < 9 ? 0 : 0);
  const got = M.resolveSession([], now);
  const want = LEGACY(new Date(now + 9 * 3600000).getUTCHours());
  if (got !== want) mismatch.push(`${h}시: got=${got} want=${want}`);
}
mismatch.length ? bad(`24시간 회귀 — 불일치 ${mismatch.length}건: ${mismatch.slice(0,4).join(' | ')}`)
                : ok('24시간 전 구간 이관 전 매핑과 동일 (회귀 없음)');

// ② 명시 지정이 벽시계를 이긴다
const noonEpoch = Date.UTC(2026, 7, 20, 3, 0);           // KST 12:00 → 벽시계로는 noon
const forced = M.resolveSession(['--session=morning'], noonEpoch);
forced === 'morning' ? ok('--session=morning 이 벽시계(noon)를 무시')
                     : bad(`--session 무시됨 — got=${forced}`);

// ③ 잘못된 id 는 throw
try { M.resolveSession(['--session=nope'], noonEpoch); bad('잘못된 세션 id 가 조용히 통과'); }
catch { ok('잘못된 세션 id → throw (조용한 통과 없음)'); }

// ④ 발간시각·리드타임이 JSON 출처
for (const id of M.sessionIds()) {
  const cfg = M.getSessionConfig(id);
  const { target } = M.getPublishTarget(id, Date.UTC(2026, 7, 20, 3, 0));
  const hhmm = new Date(target).toISOString().slice(11, 16);
  hhmm === cfg.publishKst ? ok(`${id.padEnd(9)} publish ${hhmm} (JSON) · trigger ${M.getTriggerKst(id)} · lead ${cfg.leadMinutes ?? 'default'}분`)
                          : bad(`${id} publish 불일치 target=${hhmm} json=${cfg.publishKst}`);
}
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

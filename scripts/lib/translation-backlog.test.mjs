#!/usr/bin/env node
/**
 * translation-backlog.test.mjs — 거부된 번역을 대기열에 남겨 27B 가 나중에 채운다.
 *
 * 배경(2026-08-20 실측, 홈 화면 눈검증): 사용자에게 영문이 그대로 보이는 3건이 남아 있었다.
 *     "hawkish (prev 224K/wk)"  → 4B "호각적 (전 224K/주)"  (오역: 정답은 '매파적'. 한국어라 게이트 통과)
 *     "Pharma / Biotech"        → garbage-fallback   (가드가 거부 → 원문 노출)
 *     "Industrial conglomerates, machinery, aerospace, and transportation companies."
 *                               → mixed-fallback     (가드가 거부 → 원문 노출)
 *   가드는 제대로 동작한다 — 나쁜 번역 대신 원문을 보여준다. 문제는 그 다음이 없다는 것이다.
 *   같은 문자열이 다음에도 또 4B 로 가서 또 거부되고, 영원히 영문으로 남는다.
 *
 *   27B 를 웹에 붙이는 건 답이 아니다 — 실측으로 확인: 이 검증 도중 27B 는
 *   segments-refresh cron 의 4,609토큰 프리필에 점유돼 300초 타임아웃이 났다.
 *   대신 거부를 기록해 두고, 한가할 때 27B 가 채워 사전에 넣는다.
 */
import { existsSync, rmSync } from 'fs';
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let B;
try { B = await import('./translation-backlog.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const DB = '/tmp/tb-test.db';
if (existsSync(DB)) rmSync(DB);
const bl = B.openBacklog(DB);

bl.record('Pharma / Biotech', 'ko', 'garbage-fallback');
bl.pending('ko').some(r => r.text === 'Pharma / Biotech') ? ok('거부 기록 → 대기열') : bad('기록 안 됨');

// 같은 문자열이 반복 거부돼도 행이 늘면 안 된다 — 횟수만 오른다(우선순위 근거)
bl.record('Pharma / Biotech', 'ko', 'mixed-fallback');
bl.record('Pharma / Biotech', 'ko', 'garbage-fallback');
const rows = bl.pending('ko').filter(r => r.text === 'Pharma / Biotech');
rows.length === 1 ? ok('중복 거부는 1행 유지') : bad(`행이 ${rows.length}개로 늘어남`);
rows[0].hits === 3 ? ok(`거부 횟수 누적 (${rows[0].hits})`) : bad(`횟수 ${rows[0].hits} (3 기대)`);
rows[0].last_reason === 'garbage-fallback' ? ok('마지막 사유 보존') : bad(`사유: ${rows[0].last_reason}`);

// 자주 거부된 것이 먼저 — 27B 시간은 유한하다
bl.record('rare term', 'ko', 'mixed-fallback');
bl.pending('ko')[0].text === 'Pharma / Biotech' ? ok('거부 잦은 순 정렬') : bad('정렬 안 됨');

// 로케일 분리
bl.pending('ja').length === 0 ? ok('로케일 분리') : bad('로케일이 섞임');

// 해결되면 대기열에서 빠져야 한다 — 안 그러면 매번 다시 번역한다
bl.resolve('Pharma / Biotech', 'ko');
!bl.pending('ko').some(r => r.text === 'Pharma / Biotech') ? ok('해결 시 대기열 제거') : bad('해결됐는데 남아 있음');

// 지나치게 긴 문자열은 용어가 아니라 문단이다 — 사전 대상이 아니므로 받지 않는다
bl.record('x'.repeat(500), 'ko', 'mixed-fallback');
!bl.pending('ko').some(r => r.text.length > 300) ? ok('과도하게 긴 입력 거부') : bad('문단이 대기열에 들어감');

bl.close(); rmSync(DB, { force: true });
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

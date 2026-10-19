#!/usr/bin/env node
/**
 * slot-trial.test.mjs — 9번째 칸(22:45) 7일 시험. 2026-10-19 신설.
 *
 * 근거(10/19 12:46 실측, 72h 넘은 쇼츠 97편): 하루 4~8편 사이 편당 3일 조회 중앙 999~1215 로 평평, 하루 합은 편수와 함께 오른다
 *   (스피어먼 0.71), 하루 안 8번째 편 1159 — 희석이 안 보인다. 9편 이상은 잰 적이 없다.
 * Mac mini2(사장님 결정 전달): 8편 유지 + 10/20 부터 7일 22:45 9번째 칸 시험. **서로 다른 이슈가 충분한 날만** —
 *   그날 기사 풀에 새 이슈가 없으면 지난 며칠 국뽕(넓은 풀)·예비로 채우지 않고 거른다. 10/27 같은 잣대로 판정.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { parseTrial, trialPhase, TRIAL_ENV, matureDays } = await import('./slot-trial.mjs');

// [1] 기간은 한국 날짜로 — 10/20 22:45 KST = 10/20 13:45Z.
const t = parseTrial('2026-10-20:2026-10-26');
(t && t.from === '2026-10-20' && t.until === '2026-10-26') ? ok('[1a] 기간 읽기') : bad(`[1a] ${JSON.stringify(t)}`);
(parseTrial('2026-10-26:2026-10-20') === null && parseTrial('x') === null && parseTrial('') === null) ? ok('[1b] 거꾸로·깨진 기간은 null') : bad('[1b]');
const at = (iso) => trialPhase(Date.parse(iso), t);
(at('2026-10-19T13:45:00Z') === 'before') ? ok('[1c] 10/19 22:45 KST — 아직') : bad(`[1c] ${at('2026-10-19T13:45:00Z')}`);
(at('2026-10-20T13:45:00Z') === 'active' && at('2026-10-26T13:45:00Z') === 'active') ? ok('[1d] 10/20·10/26 22:45 KST — 시험 중') : bad('[1d]');
(at('2026-10-26T15:30:00Z') === 'ended') ? ok('[1e] 10/27 00:30 KST(대기 뒤 늦은 실행) — 끝, 8일째를 내지 않는다') : bad(`[1e] ${at('2026-10-26T15:30:00Z')}`);

// [2] 시험 칸은 그날 풀만 — 넓은 풀(지난 며칠)·예비로 채우지 않는다.
(TRIAL_ENV.SHORTS_TODAY_ONLY === '1' && TRIAL_ENV.SHORTS_SPARE === '0') ? ok('[2] 시험 칸 환경: 그날 이슈만 · 예비 안 씀') : bad(`[2] ${JSON.stringify(TRIAL_ENV)}`);

// [3] 판정은 다 익은 날만 — 그날 마지막 편(22:45 + 대기)이 72시간을 넘긴 날. 덜 익은 날을 넣으면 하루 합이 작게 나온다.
const md = matureDays(['2026-10-20', '2026-10-23', '2026-10-24'], Date.parse('2026-10-27T13:00:00Z'), 72);
(md.join() === '2026-10-20,2026-10-23') ? ok('[3] 10/27 22:00 KST 판정 — 10/23 까지(10/24 밤 편은 아직 72시간 전)') : bad(`[3] ${md}`);

// [4] 연결
const pub = readFileSync(new URL('../video-publish.mjs', import.meta.url), 'utf8');
const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
const rr = readFileSync(new URL('../related-remeasure.mjs', import.meta.url), 'utf8');
(/arg\('--trial'/.test(pub) && /parseTrial\(TRIAL_ARG\)/.test(pub) && /trialPhase\(/.test(pub) && /TRIAL_ENV/.test(pub)) ? ok('[4a] 발행이 --trial 기간 밖이면 바로 끝, 안이면 시험 환경') : bad('[4a]');
(/SHORTS_TODAY_ONLY !== '1'/.test(ms)) ? ok('[4b] make-shorts 넓은 풀 대체가 시험 칸에선 꺼진다') : bad('[4b]');
(/recordTrialVideo\(/.test(pub)) ? ok('[4c] 시험 칸으로 나간 편 id 를 남긴다(판정이 시각 추측 대신 id 로)') : bad('[4c]');
(/trialIds\(/.test(rr)) ? ok('[4d] 관련 동영상 재측정은 시험 칸 편을 뺀다(같은 기간, 다른 시각대)') : bad('[4d]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

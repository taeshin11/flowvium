#!/usr/bin/env node
/**
 * topic-stay.test.mjs — 브리핑 첫 꼭지(=첫 화면)를 '계속 시청' 이 높은 주제로. 2026-10-09 신설.
 *
 * 사장님 지시(Mac mini2 경유 10/09): 조회·구독 전환·시청 지속이 낮은 편을 뽑아 원인을 정하고 바로 고쳐라(ChatGPT·agy 상의).
 *   ChatGPT: 맥 크롬(공용 9223)에 로그인 안 돼 있음(입력창 0·로그인 버튼) — 로그인은 사장님 몫이라 agy 만.
 * 실측(132편, 48h 근처·분석 API 채워진 110편): 계속 시청 중앙 — 국내정치 0.44(57편) · IT·AI 0.44 · 국제 0.39 ·
 *   증시·금리·환율 0.31(11) · 사회 0.30(10) · 기업·산업 0.30(8). 구독/1천도 사회·기업·IT 0.00.
 *   agy 가설 중 데이터로 검증한 것: 훅에 숫자 0.37 vs 0.41(약함, 미채택) · 훅↔제목 불일치 무해(0.44 vs 0.38, 기각)
 *   · 증시/AI 주제 차단(채널 정체성과 충돌, 4% 표본 — 기각). 채택: 브리핑 1번 꼭지를 계속 시청이 높은 주제로(agy 2순위안).
 * 규칙은 손으로 주제를 고르지 않는다 — DB 실측 중앙값(주제당 8편 이상), 0.05 단위로 묶어 잡음에 순서가 흔들리지 않게.
 */
import { topicStay, stayKey } from './topic-lift.mjs';
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const rows = [];
for (let i = 0; i < 10; i++) rows.push({ video_id: `p${i}`, topic: '국내정치', engaged_ratio: 0.44 + (i % 3) * 0.01, age_hours: 50 });
for (let i = 0; i < 10; i++) rows.push({ video_id: `m${i}`, topic: '증시·금리·환율', engaged_ratio: 0.30 + (i % 2) * 0.02, age_hours: 50 });
for (let i = 0; i < 3; i++) rows.push({ video_id: `x${i}`, topic: '재난·재해', engaged_ratio: 0.9, age_hours: 50 });
const s = topicStay(rows, { minSamples: 8 });
(s.get('국내정치') > s.get('증시·금리·환율') && !s.has('재난·재해')) ? ok(`[1] 주제별 계속시청 중앙(8편 미만 제외) 국내정치 ${s.get('국내정치')} · 증시 ${s.get('증시·금리·환율')}`) : bad(`[1] ${JSON.stringify([...s])}`);
(stayKey(s, '국내정치') > stayKey(s, '증시·금리·환율') && stayKey(s, '모름') === stayKey(s, null)) ? ok('[2] 모르는 주제는 같은 값(순서를 안 바꾼다)') : bad('[2]');
(stayKey(new Map([['a', 0.41], ['b', 0.43]]), 'a') === stayKey(new Map([['a', 0.41], ['b', 0.43]]), 'b')) ? ok('[3] 0.05 안의 차이는 같은 칸(잡음으로 순서 안 흔들림)') : bad('[3]');
const src = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
/stayKey\(STAY, b\.it\.__topic\) - stayKey\(STAY, a\.it\.__topic\)/.test(src) ? ok('[4] 브리핑 정렬이 주제 계속시청을 본다') : bad('[4] make-shorts 브리핑 정렬에 연결 안 됨');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * shorts-opener-ab.test.mjs — 쇼츠 첫 문장 A/B(앵커 단정 vs 질문·이해관계). 2026-10-11 신설.
 *
 * 사장님 지시(Mac mini2 경유 10/11): 성적 점검 → 상위 채널 레퍼런스로 보완, 안 나오면 전략 전환을 A/B 로 바로.
 * 실측(28일 196편): 편당 조회 중앙 1,038 · 상위10% 1,261 · 최고 1,866 — **한 편도 초기 풀을 못 벗어났다.**
 *   계속 시청 중앙 0.40(7일 0.44). 첫 문장은 전부 앵커 단정형("현대차가 16년 만에 최악의 부진을 겪고 있습니다").
 * 상위 채널(최근 30일): 연합뉴스경제TV "삼성전자 보유자에게 말씀드립니다…" 25만 vs 같은 채널 사실형 1.3~1.4만,
 *   경제스타 "12조 세금 다 내고 이번엔 아들이…" 57만, 정치일분(구독 2천) 의견·도발형 첫 마디 1.4~2.1만.
 * ChatGPT·agy 둘 다 1순위 원인 = 첫 3초가 사실 발표라 볼 이유가 약함 → B: 질문·시청자 이해관계로 연다.
 * → question 칸: 1번 장면 첫 문장을 '무슨 일/왜/나에게 무엇'의 질문 또는 이해관계로 시작(기사에 있는 사실만).
 *   anchor(지금 그대로)와 반반 — 다른 실험(제목·구독·광고·배분)과 독립. 48h·7일 계속 시청·조회 중앙·최고를 비교.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { openerFor, layoutFor } = await import('./explore-slot.mjs');
const { promoFor } = await import('./promo-card.mjs');
// 2026-10-20 A/B 종료 — 모든 편 question. 72시간 넘은 46편(question 17 · anchor 29, 10/20 08:12 channel-performance):
//   평균 시청률 61.9→72.9%(순열 p=0.035), 길이 띠마다 같은 방향(≤43초 54.5→71.0 · 44~47초 61.9→72.9 · 48초+ 65.9→82.2).
//   3일 조회는 차이 없음(1,046→1,070), 본 비율은 반대 방향(0.51→0.45, p=0.065) — 그래서 끝낸 뒤에도 본 비율을 지켜본다.
//   자문: agy(gemini-4-argon-medium) 조건부 찬성(본 비율 지켜볼 것) · ChatGPT 'question 기본 + anchor 20~30% 대조군' · Claude 같은 의견.
//   → question 기본, anchor 1/4 대조군(본 비율·조회가 따라오는지 계속 잰다).
const N = 600, O = Array.from({ length: N }, (_, n) => openerFor(n));
const qr = O.filter((x) => x === 'question').length / N;
(O.every((x) => x === 'question' || x === 'anchor') && qr > 0.68 && qr < 0.82) ? ok(`[1] question 기본(${(qr * 100).toFixed(0)}%) · anchor 대조군`) : bad(`[1] question ${(qr * 100).toFixed(0)}%`);
void layoutFor; void promoFor;
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const pub = src('video-publish.mjs'), ms = src('video/make-shorts.mjs');
(/SHORTS_OPENER: OPENER_ENV/.test(pub) && /opener: last\.opener/.test(pub)) ? ok('[3a] 발행이 칸을 정하고 기록') : bad('[3a]');
(/OPENER === 'question'/.test(ms) && /OPENER_RULE/.test(ms) && /opener: OPENER/.test(ms)) ? ok('[3b] question 칸에서만 첫 문장 규칙을 붙이고 meta.opener') : bad('[3b]');
(/SHORTS_OPENER \?\? 'question'/.test(pub) && /SHORTS_OPENER === 'anchor' \? 'anchor' : 'question'/.test(ms)) ? ok('[3e] 모를 때(값 없음·DB 실패) 기본도 question') : bad('[3e] 기본값이 아직 anchor');
!/\[이번 편 실험\]/.test(ms) ? ok('[3f] 첫 문장 규칙이 더는 실험이라고 말하지 않는다') : bad('[3f]');
/기사에 있는 사실만/.test(ms.match(/const OPENER_RULE[\s\S]{0,900}/)?.[0] ?? '') ? ok('[3c] 질문형도 기사에 있는 사실만(낚시 금지)') : bad('[3c] 사실 제한 문구 없음');
(/ADD COLUMN opener TEXT/.test(src('lib/db.mjs')) && /'shorts_published\.opener'/.test(src('audit-coverage.mjs'))) ? ok('[3d] DB 열·감사') : bad('[3d]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

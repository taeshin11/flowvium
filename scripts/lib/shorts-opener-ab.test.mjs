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
// 2026-10-13 구독 권유 A/B 종료(전 편에 붙음, lib/sub-cta) — 독립성은 남은 실험(제목·광고…)끼리만 본다.
const N = 600, O = Array.from({ length: N }, (_, n) => openerFor(n));
const qr = O.filter((x) => x === 'question').length / N;
(O.every((x) => x === 'question' || x === 'anchor') && qr > 0.42 && qr < 0.58) ? ok(`[1] anchor|question 반반(${(qr * 100).toFixed(0)}%)`) : bad(`[1] qr=${qr}`);
const share = (f) => { const e = O.map((x, n) => [x === 'question', f(n)]).filter(([x]) => x); return e.filter(([, v]) => v).length / e.length; };
const t = share((n) => n % 2 === 0), p = share((n) => promoFor(n) === 'flowvium'), l = share((n) => layoutFor(n) === 'zoom');
[t, p, l].every((v) => v > 0.38 && v < 0.62) ? ok(`[2] 다른 실험과 독립 — question 안에서 제목 ${(t * 100).toFixed(0)}% · 광고 ${(p * 100).toFixed(0)}% · 배분 ${(l * 100).toFixed(0)}%`) : bad(`[2] t=${t} p=${p} l=${l}`);
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const pub = src('video-publish.mjs'), ms = src('video/make-shorts.mjs');
(/SHORTS_OPENER: OPENER_ENV/.test(pub) && /opener: last\.opener/.test(pub)) ? ok('[3a] 발행이 칸을 정하고 기록') : bad('[3a]');
(/OPENER === 'question'/.test(ms) && /OPENER_RULE/.test(ms) && /opener: OPENER/.test(ms)) ? ok('[3b] question 칸에서만 첫 문장 규칙을 붙이고 meta.opener') : bad('[3b]');
/기사에 있는 사실만/.test(ms.match(/const OPENER_RULE[\s\S]{0,900}/)?.[0] ?? '') ? ok('[3c] 질문형도 기사에 있는 사실만(낚시 금지)') : bad('[3c] 사실 제한 문구 없음');
(/ADD COLUMN opener TEXT/.test(src('lib/db.mjs')) && /'shorts_published\.opener'/.test(src('audit-coverage.mjs'))) ? ok('[3d] DB 열·감사') : bad('[3d]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

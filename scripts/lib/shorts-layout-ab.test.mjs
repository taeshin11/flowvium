#!/usr/bin/env node
/**
 * shorts-layout-ab.test.mjs — 쇼츠 화면 배분 A/B(classic vs zoom). 2026-10-03 신설.
 *
 * 사장님 지시(Mac mini2 경유): 시청 지속 시간 — 첫 1초·전개·전환·끝맺음·소재를 분석해 바로 적용, 48시간 뒤 비교.
 * 실측(79편): '계속 시청 비율'(스와이프 안 함) 중앙 0.38 — 62% 가 첫 화면에서 넘긴다. log 조회수와 상관 0.60(가장 큼).
 *   첫 화면 얼굴 있음 23편 0.42 vs 없음 16편 0.38(방향은 맞으나 표본 작음).
 *   화면: 사진이 16:9 라 폭 1080 에서 높이 607px — 화면의 1/3, 나머지는 검은 띠. agy 분석도 '꽉 찬 화면' 을 1순위권으로 꼽았다.
 * 제약: 9/21 사장님이 블러 채우기를 빼라 했다(검정 배경 유지). 사진 영역만 키우면 폭에 걸려 검정만 는다.
 * → zoom: 위 띠 560→440, 사진 영역 760→820, 사진을 4:3 까지만 가운데 잘라(폭 70% 이상 유지) 약 1.33배 크게.
 *   지금 모습(classic)과 반반 — 섞은 누적 편수로 고르고 기록해 48h 계속 시청·평균 시청을 비교한다.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const probe = (layout) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import('${new URL('./shorts-layout.mjs', import.meta.url).href}'); console.log(JSON.stringify({ g: m.SHORTS, f: m.mediaFilter('0:v', 'out'), layout: m.LAYOUT }))`],
    { encoding: 'utf8', env: { ...process.env, SHORTS_LAYOUT: layout } });
  return JSON.parse(r.stdout || '{}');
};
const c = probe('classic'), z = probe('zoom');
(c.layout === 'classic' && c.g?.hook?.height === 560 && c.g?.media?.height === 760 && !/ih\*1\.3333/.test(c.f)) ? ok('[1] classic = 지금 그대로(560/760, 자르기 없음)') : bad(`[1] ${JSON.stringify(c).slice(0, 200)}`);
(z.layout === 'zoom' && z.g?.hook?.height === 440 && z.g?.media?.height === 820 && /crop=/.test(z.f) && /0\.7/.test(z.f)) ? ok('[2] zoom = 440/820 + 4:3 까지 가운데 자르기(폭 70% 이상)') : bad(`[2] ${JSON.stringify(z).slice(0, 300)}`);
const { layoutFor } = await import('./explore-slot.mjs');
const { promoFor } = await import('./promo-card.mjs');
const { subCtaFor } = await import('./sub-cta.mjs');
const N = 600, L = Array.from({ length: N }, (_, n) => layoutFor(n));
const zr = L.filter((x) => x === 'zoom').length / N;
const share = (f) => { const e = L.map((x, n) => [x === 'zoom', f(n)]).filter(([x]) => x); return e.filter(([, v]) => v).length / e.length; };
const t = share((n) => n % 2 === 0), s = share((n) => subCtaFor(n)), p = share((n) => promoFor(n) === 'flowvium');
(zr > 0.42 && zr < 0.58 && [t, s, p].every((v) => v > 0.38 && v < 0.62)) ? ok(`[3] 반반(${(zr * 100).toFixed(0)}%) · zoom 안에서 제목 ${(t * 100).toFixed(0)}% · 구독 ${(s * 100).toFixed(0)}% · 광고 ${(p * 100).toFixed(0)}% — 다른 실험과 안 겹친다`) : bad(`[3] zr=${zr} t=${t} s=${s} p=${p}`);
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
(/SHORTS_LAYOUT: LAYOUT_ENV/.test(src('video-publish.mjs')) && /layout: last\.layout/.test(src('video-publish.mjs'))) ? ok('[4a] 발행이 칸을 정하고 기록') : bad('[4a]');
/layout: LAYOUT/.test(src('video/make-shorts.mjs')) ? ok('[4b] meta.layout') : bad('[4b]');
/ADD COLUMN layout TEXT/.test(src('lib/db.mjs')) && /'shorts_published\.layout'/.test(src('audit-coverage.mjs')) ? ok('[4c] DB 열·감사') : bad('[4c]');
/p\.layout/.test(src('yt-trend-topics.mjs')) ? ok('[4d] 주간 보고에 배분별 성적') : bad('[4d]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

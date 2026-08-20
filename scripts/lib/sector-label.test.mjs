#!/usr/bin/env node
/**
 * sector-label.test.mjs — 보고서 생성 시 섹터 표기를 한국어로 굽는지 검증.
 *
 * 배경(2026-08-21 발간본 눈검증): /ko/report 'ETF 전략'에
 *   "Financials 중립 — 섹터 분산 노출" · "Energy 테마 — 청정에너지" · "Healthcare 중립 …"
 * 가 영문으로 떴다. generate-report-local.mjs:4507 이 생성 시점에
 *   `${s.sector} ${stance} — 섹터 분산 노출`
 * 로 LLM 이 준 영문 섹터명을 문자열에 그대로 구워 넣기 때문이다.
 * 보고서는 ko 단일 진실원으로 생성되므로(다른 로케일은 런타임 번역) 여기서 한국어여야 한다.
 *
 * 값의 표기가 흔들린다 — 같은 보고서 안에 'industrials'(소문자)와 'Consumer Defensive'(제목대소문자)가
 * 섞여 있었다. 그래서 슬러그로 정규화한 뒤 messages/ko.json 의 explore.sectors 를 본다.
 * 카탈로그를 두 곳에 적지 않는다 — 웹(src/lib/sector-label.ts)과 같은 규칙, 같은 원천이다.
 */
import { sectorSlug, localizeSectorKo, sectorCatalogKo } from './sector-label.mjs';

let fail = 0;
const eq = (g, w, m) => { g === w ? console.log(`  PASS  ${m}`) : (console.log(`  FAIL  ${m}\n          got ${JSON.stringify(g)} want ${JSON.stringify(w)}`), fail++); };

// ① 표기 변형 흡수
eq(sectorSlug('Consumer Defensive'), 'consumer-defensive', '공백+대문자 → 슬러그');
eq(sectorSlug('industrials'), 'industrials', '소문자 그대로');
eq(sectorSlug('  Health Care '), 'health-care', '앞뒤 공백 제거');

// ② 실측된 7종 (2026-08-21 보고서 JSON 에서 관측)
const KO = sectorCatalogKo();
for (const [en, ko] of [
  ['Financials', KO['financials']], ['Energy', KO['energy']], ['Healthcare', KO['healthcare']],
  ['Technology', KO['technology']], ['Consumer Defensive', KO['consumer-defensive']],
  ['industrials', KO['industrials']],
]) {
  eq(localizeSectorKo(en), ko, `${en} → ${ko}`);
}
// GICS/Morningstar 명칭 차이 (확실한 것만 별칭)
eq(localizeSectorKo('Consumer Staples'), KO['consumer-defensive'], 'Consumer Staples → 경기방어주 (GICS↔Morningstar)');
eq(localizeSectorKo('Health Care'), KO['healthcare'], 'Health Care(두 단어) → 헬스케어');

// ③ 모르는 값은 창작하지 않는다
eq(localizeSectorKo('Zephyr Sector'), 'Zephyr Sector', '미지 섹터는 원값 유지');
eq(localizeSectorKo(''), '', '빈 문자열 안전');
eq(localizeSectorKo(null), '', 'null 안전');

// ④ 카탈로그가 비어 있지 않다 (messages 경로가 어긋나면 전부 원값이 되어 조용히 통과한다)
Object.keys(KO).length >= 15 ? console.log(`  PASS  ko 카탈로그 ${Object.keys(KO).length}종 로드`) : (console.log('  FAIL  ko 카탈로그 로드 실패'), fail++);

// ⑤ 실제 생성 코드가 이 경로를 탄다
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gen = readFileSync(resolve(ROOT, 'scripts/generate-report-local.mjs'), 'utf8');
/localizeSectorKo\(\s*s\.sector\s*\)/.test(gen)
  ? console.log('  PASS  생성 코드가 localizeSectorKo(s.sector) 를 쓴다')
  : (console.log('  FAIL  생성 코드가 여전히 s.sector 를 그대로 굽는다'), fail++);

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

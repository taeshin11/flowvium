/**
 * sector-label.mjs — 보고서 생성 시 섹터 표기의 한국어 변환 (src/lib/sector-label.ts 의 node 짝).
 *
 * 왜 생성 시점인가: 이 저장소의 보고서는 ko 단일 진실원으로 생성되고 다른 로케일은 런타임 번역이다.
 *   generate-report-local.mjs:4507 이 `${s.sector} 중립 — 섹터 분산 노출` 처럼 문자열을 굽는데,
 *   s.sector 는 LLM 이 준 영문이라 발간본에 "Financials 중립 — 섹터 분산 노출" 로 나갔다.
 *
 * 카탈로그를 여기에 다시 적지 않는다 — messages/ko.json 의 explore.sectors 를 그대로 읽는다.
 * 같은 목록을 두 곳에 두면 한쪽만 고쳐져 조용히 어긋난다(이번 세션에 반복해 본 실패 유형).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

let _ko = null;

/** messages/ko.json 의 explore.sectors. 읽기 실패하면 빈 객체 — 그 경우 전부 원값이 된다. */
export function sectorCatalogKo() {
  if (_ko) return _ko;
  try {
    const m = JSON.parse(readFileSync(resolve(ROOT, 'messages/ko.json'), 'utf8'));
    _ko = m?.explore?.sectors ?? {};
  } catch { _ko = {}; }
  return _ko;
}

/** 표기 변형을 흡수해 카탈로그 키 형태로. 'Consumer Defensive' → 'consumer-defensive' */
export function sectorSlug(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 분류 체계가 달라 이름만 다른 같은 섹터. 확실한 것만 둔다.
 *   GICS 'Consumer Staples' == Morningstar 'Consumer Defensive' (이 저장소 카탈로그는 후자)
 *   'Health Care'(GICS 는 두 단어) == 'Healthcare'
 * 'Information Technology' 는 카탈로그에 technology 와 it-software 가 둘 다 있어 단정할 수 없다 —
 * 넣지 않는다. 모르는 건 원값으로 두는 편이 조용히 틀리는 것보다 낫다.
 */
const ALIAS = {
  'consumer-staples': 'consumer-defensive',
  'health-care': 'healthcare',
  // 2026-08-21: 권위 소스(data/candidate-tickers.json meta.sector)의 실제 도메인을 대조한 결과
  //   고유값 65종 / 1,338종목 중 472종목(35%)이 카탈로그 밖이었다. 라이브 화면에서 "Chemicals" 확인.
  //   65종은 GICS·SIC·비섹터 마커(ETF·KR·Other)·이미 한국어인 값이 뒤섞인 *데이터 모델* 문제라
  //   통째로 매핑하는 건 분류체계 결정이다 — 내가 정하지 않는다.
  //   문서화된 표준 등가만 넣는다. 산업→섹터 롤업(Chemicals→Materials)은 정보를 잃으므로 하지 않는다.
  'consumer-cyclical': 'consumer-discretionary',   // Morningstar == GICS 'Consumer Discretionary'
  'basic-materials': 'materials',                  // Morningstar == GICS 'Materials'
  'financial-services': 'financials',              // Morningstar == GICS 'Financials'
};

/** @returns {string} 한국어 섹터명. 카탈로그에 없으면 원값. */
export function localizeSectorKo(raw) {
  const s = String(raw ?? '');
  if (!s.trim()) return s;
  const slug = sectorSlug(s);
  const id = ALIAS[slug] ?? slug;
  const ko = sectorCatalogKo()[id];
  return typeof ko === 'string' && ko ? ko : s;
}

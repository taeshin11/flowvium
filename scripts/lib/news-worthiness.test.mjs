/**
 * news-worthiness.test.mjs — 분석할 뉴스를 최신순 말고 값어치 순으로 고른다.
 *
 * 왜 (2026-09-11 사용자 "선별을 너가 잘 해야지"):
 *   news-cascade 의 선별은 **최신순뿐**이다(지역 쿼터 후 recency, TOTAL_CAP 12).
 *   관련도·영향도 점수가 하나도 없어서 2분 전 사진기사가 40분 전 ECB 금리 인상을 밀어낸다.
 *
 *   실측 2,307건: 분석하고도 연결고리를 못 찾은 것이 443건(19%)이다. 그 안을 갈라 보면
 *     거시 핵심어 36건(ECB 금리·국고채·美물가·환율 1500원·엔캐리 쇼크)
 *     기업명 43건 · 사진/부고 10건 · 나머지 354건
 *   즉 버려지는 쪽에 진짜 신호가 섞여 있고, 뽑히는 쪽에 사진기사가 섞여 있다.
 *
 * 점수는 **결정론**이다 — LLM 을 부르지 않는다. 선별에 모델을 쓰면 느려지고 매번 달라진다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worthiness, pickForAnalysis } from './news-worthiness.mjs';

test('사진·부고·인사는 바닥', () => {
  assert.ok(worthiness('[포토] 축구 동작 학습하는 아틀라스') < 0);
  assert.ok(worthiness('[부고] 김모씨 별세') < 0);
  assert.ok(worthiness('[인사] 국토교통부') < 0);
});

test('거시 핵심어는 높다', () => {
  assert.ok(worthiness('ECB, 3년만에 금리 인상…이란전쟁 후 주요국 중 처음') >= 3);
  assert.ok(worthiness('국고채 금리 일제히 하락…3년물 연 3.808%') >= 2);
});

test('기업 + 숫자는 높다', () => {
  assert.ok(worthiness('삼성전자, 3분기 영업이익 12조원…시장 예상 상회') >= 3);
  assert.ok(worthiness('SK하이닉스, 40조 자사주 취득·소각') >= 3);
});

test('티커가 적힌 영문 기사도 높다', () => {
  assert.ok(worthiness('NVDA beats on Q3 revenue, guides higher') >= 2);
});

test('밋밋한 공지는 낮다', () => {
  assert.ok(worthiness('한-세르비아 투자 증진 및 보호 협정 오늘 발효') < 2);
  assert.ok(worthiness('중진공, 청년주간 맞아 창업학교서 프로그램 24개 추진') < 2);
});

test('고를 때 지역 쿼터를 지킨다 — 점수만 보면 US 가 다 먹는다', () => {
  const items = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `us${i}`, region: 'us', title: `Fed rate decision ${i} 금리`, at: 100 + i })),
    { id: 'kr1', region: 'kr', title: '코스피 마감 시황', at: 1 },
    { id: 'kr2', region: 'kr', title: '환율 동향', at: 2 },
    { id: 'jp1', region: 'jp', title: '日銀 정책 결정', at: 3 },
  ];
  const picked = pickForAnalysis(items, { cap: 12, quota: { kr: 3, jp: 1, cn: 1 } });
  assert.equal(picked.length, 12);
  assert.ok(picked.filter((x) => x.region === 'kr').length >= 2, 'KR 이 밀려나면 안 된다');
  assert.ok(picked.some((x) => x.region === 'jp'));
});

test('같은 점수면 최신이 이긴다', () => {
  const items = [
    { id: 'old', region: 'us', title: '금리 인상', at: 1 },
    { id: 'new', region: 'us', title: '금리 인상', at: 9 },
  ];
  assert.equal(pickForAnalysis(items, { cap: 1, quota: {} })[0].id, 'new');
});

// ⚠ 2026-09-11 검증: 키워드 가점은 성공률을 못 가린다(0점 81% · 3~4점 82%, 전체 81%).
//   그래서 선별은 **형식 배제 + 최신순** 만 한다. 아래 테스트가 그 계약이다.
test('키워드가 많아도 최신순을 뒤집지 않는다 — 검증 안 된 가정을 선별에 넣지 않는다', () => {
  const items = [
    { id: 'plain', region: 'us', title: '코스피 마감', at: 9 },
    { id: 'loaded', region: 'us', title: '삼성전자 영업이익 12조 금리 관세 인수', at: 1 },
  ];
  assert.equal(pickForAnalysis(items, { cap: 1, quota: {} })[0].id, 'plain');
});

test('사진기사는 자리가 남아도 뒤로 간다', () => {
  const items = [
    { id: 'photo', region: 'kr', title: '[포토] 개막식', at: 9 },
    { id: 'real', region: 'kr', title: '한은, 기준금리 동결…물가 전망 상향', at: 1 },
  ];
  assert.equal(pickForAnalysis(items, { cap: 1, quota: {} })[0].id, 'real');
});

// topic-mix.test.mjs — 쇼츠 주제 배분(11/02 주제·흐름 점검). node scripts/lib/topic-mix.test.mjs
//
// 사장님 지시(11/02, Mac mini2 경유): 우리 주제가 최신 흐름에 맞는지 → 다음 7일 주제를 고친다(30% 는 새 실험).
// 실측: 지난 14일 쇼츠 84편 중 흐름 맞음 29% · 금융인데 낡음 5% · 분야 밖 64%(대부분 국회·정당 공방).
//   같은 분야 상위 채널 1~2주 상위 10편 = 삼성·하이닉스 실적·주주환원·외국인, 금값·환율. 자동완성: 코스피 5000·삼성 주가 전망·배당금·
//   환율 1500원·국민연금 환율방어·금리인하 수혜주·금값·배당소득 분리과세·연말정산·엔비디아 실적. 11월: 美 중간선거·수능 개장 지연·광군제·블프·김장·한파.
// 자문 agy(gemini-4-argon-medium)·Claude(2/3): 정치는 60% → 15~20%, 돈과 이어진 것(세법·예산·연금·부동산·관세·선거의 시장 영향)만,
//   정당 공방은 뺀다(0 으로 끊지는 않는다 — 조회는 비슷). 실험 30% 는 11월 일정·생활 물가·배당세·연말정산.
// → ① 국내정치 중 돈과 안 이어진 공방은 후보 맨 뒤로(지우지 않는다 — 다른 게 없으면 그대로 나간다)
//   ② 트렌드 칸(1/6)은 스튜디오 트렌드 낱말 + 날짜가 붙은 11월 일정 낱말(data/season-terms.json, 기간 지나면 저절로 빠짐)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { isMoneyLinked, demoteSquabble, activeSeasonTerms } = await import('./topic-mix.mjs');
assert.ok(isMoneyLinked("예정처 \"2029년부터 추가세수 없다\"…미래기금 재원에 우려 제기"), '세수·재원 = 돈');
assert.ok(isMoneyLinked('李대통령, 사상 첫 \'수출 1조달러\' 앞두고'), '수출 = 돈');
assert.ok(isMoneyLinked('국민연금 환율방어 연장'), '연금·환율');
assert.ok(!isMoneyLinked('민주당 경기도당 긴급회의, 추미애 논란 대응 논의'), '정당 공방');
assert.ok(!isMoneyLinked("與 \"내란 부정 사과해야\"…'김태규 참여' 충돌에 靑국감 파행"));
const c = (k, t, h) => ({ keyword: k, __topic: t, headlines: [h] });
const head = [c('a', '국내정치', '여야 국감 고성 공방'), c('b', '국내정치', '예산안 세수 부족 우려'), c('c', '사회·사건사고', '해루질 사고'), c('d', '국내정치', '장외집회 개최')];
assert.deepEqual(demoteSquabble(head).map((x) => x.keyword), ['b', 'c', 'a', 'd'], '공방은 뒤로, 나머지 순서는 그대로');
assert.deepEqual(demoteSquabble([c('a', '국내정치', '여야 공방')]).map((x) => x.keyword), ['a'], '하나뿐이면 그대로(지우지 않는다)');
const list = [{ term: '중간선거', from: '2026-11-01', to: '2026-11-06' }, { term: '수능', from: '2026-11-08', to: '2026-11-13' }, { term: '광군제', from: '2026-11-05', to: '2026-11-12' }];
assert.deepEqual(activeSeasonTerms(list, Date.parse('2026-11-02T03:00:00Z')), ['중간선거']);
assert.deepEqual(activeSeasonTerms(list, Date.parse('2026-11-10T03:00:00Z')), ['수능', '광군제']);
assert.deepEqual(activeSeasonTerms(list, Date.parse('2026-12-01T03:00:00Z')), [], '기간 지나면 저절로 빠진다');
const season = JSON.parse(readFileSync(new URL('../../data/season-terms.json', import.meta.url), 'utf8'));
assert.ok(season.length >= 8 && season.every((x) => x.term && x.from <= x.to), '11월 일정 파일');
const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
assert.ok(/demoteSquabble\(/.test(ms), '렌더가 공방을 뒤로 민다');
assert.ok(/activeSeasonTerms\(/.test(ms), '트렌드 칸이 11월 일정 낱말을 쓴다');
console.log('topic-mix.test: ✅ 전부 통과');

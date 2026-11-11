// market-close.test.mjs — 날짜별 '한국 증시 마감' 페이지의 순수 규칙. node --test scripts/lib/market-close.test.mjs
// 왜(11/11 성장 점검 A, Claude·agy·ChatGPT 3/3): 하루 다섯 번 바뀌는 /report 한 주소로는 검색에 쌓이는 게 없다.
//   마감 요약(krclose)은 이미 매일 숫자 근거·출처 검사를 통과한 문단을 만든다 — 임시 폴더에 두다 다음 날 지워질 뿐.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closePageRecord, closeDates, companyLinks } from '../../src/lib/market-close.mjs';

const script = {
  edition: 'krclose', date: '2026-11-11', day: '2026-11-11', title: '코스닥 +5.6% | 11/11(수) 한국 증시 마감',
  facts: ['코스피 5,375.36 (+2.60%, +136.23) 마감', '코스닥 705.10 (+5.62%, +37.49) 마감'],
  calendar: [{ ko: '라가르드 연설', at: 'x' }],
  chapters: [
    { kind: 'market', heading: '한국 증시 마감', sources: [0], sentences: ['코스피는 2.60% 올랐습니다.', '외국인이 순매수했습니다.'] },
    { kind: 'story', heading: '삼성전자', sources: [0, 1], sentences: ['삼성전자는 3.57% 오른 20만6000원에 마감했습니다.'] },
  ],
  docs: [{ source: '연합뉴스 경제', headline: 'h0', link: 'https://www.yna.co.kr/view/A' }, { source: '연합뉴스 경제', headline: 'h1', link: 'https://www.yna.co.kr/view/B' }],
};

test('마감판만 기록한다 — 오전판(장중 숫자)은 날짜 페이지가 되지 않는다', () => {
  assert.equal(closePageRecord({ ...script, edition: 'krmid' }), null);
  const r = closePageRecord(script);
  assert.equal(r.date, '2026-11-11');
  assert.deepEqual(r.facts, script.facts);
  assert.equal(r.chapters.length, 2);
});

test('장마다 출처는 그 장이 쓴 기사만, 주소가 http(s) 인 것만', () => {
  const r = closePageRecord({ ...script, docs: [...script.docs, { source: 'x', headline: 'bad', link: 'javascript:alert(1)' }],
    chapters: [{ ...script.chapters[0], sources: [0, 2, 9] }, script.chapters[1]] });
  assert.deepEqual(r.chapters[0].sources.map((s) => s.link), ['https://www.yna.co.kr/view/A']);
  assert.deepEqual(r.chapters[1].sources.map((s) => s.headline), ['h0', 'h1']);
});

test('날짜가 이상하거나 숫자·이야기가 없으면 기록하지 않는다', () => {
  assert.equal(closePageRecord({ ...script, day: '11/11' }), null);
  assert.equal(closePageRecord({ ...script, facts: [] }), null);
  assert.equal(closePageRecord({ ...script, chapters: [script.chapters[0]] }), null);
});

test('날짜 목록은 최신순, 형식이 맞는 파일만', () => {
  assert.deepEqual(closeDates(['2026-11-10.json', 'x.json', '2026-11-11.json', '2026-11-09.json.tmp']), ['2026-11-11', '2026-11-10']);
});

test('종목 연결: 이름이 긴 쪽이 이기고, 내용 있는 종목 페이지만', () => {
  const names = [['005930.KS', '삼성전자'], ['005935.KS', '삼성전자우'], ['000660.KS', 'SK하이닉스'], ['035420.KS', 'NAVER']];
  const links = companyLinks(['삼성전자우는 1% 올랐고 삼성전자는 3.57% 올랐습니다.', 'SK하이닉스 채용.'], names);
  assert.deepEqual(links.map((l) => l.ticker), ['005935.KS', '005930.KS', '000660.KS']);
  assert.deepEqual(companyLinks(['네이버 얘기'], names), []);
});

test('두 글자 이름은 장 제목일 때만 — "소각 대상은" 이 회사 대상으로 연결되면 안 된다', () => {
  const names = [['001680.KS', '대상'], ['002320.KS', '한진']];
  assert.deepEqual(companyLinks(['소각 대상은 보통주입니다.', '한진은 15% 올랐습니다.'], names), []);
  assert.deepEqual(companyLinks(['소각 대상은 보통주입니다.', '한진은 15% 올랐습니다.'], names, { headings: ['한진'] }).map((l) => l.ticker), ['002320.KS']);
});

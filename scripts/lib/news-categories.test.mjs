#!/usr/bin/env node
/**
 * news-categories.test.mjs — 뉴스 수집이 경제 밖 카테고리도 덮는가.
 *
 * 배경(2026-08-27): 종합 이슈 유튜브 채널(한국어·영어 별도)을 만들기로 했다.
 *   그런데 실측하니 news_archive 의 출처가 **전부 경제·산업**이었다:
 *     Yahoo Japan 경제 · Seeking Alpha · Yahoo Semis · 연합뉴스 경제 · 한국경제 ·
 *     머니투데이 · Yahoo Finance · MarketWatch
 *   정치·사회·연예 0건. 종합 이슈 영상의 소재가 아예 없었다.
 *
 * 이 확장은 영상 전용이 아니다 — 정치·사회 뉴스는 규제·정책으로 시장에 직접 닿고
 *   연예는 엔터주에 닿는다. 수집기 하나를 넓히고 소비처가 둘(리포트·영상)이 되는 구조다.
 *
 * 카테고리는 별도 컬럼을 만들지 않는다. 기존 관례대로 `source` 이름이 카테고리를 담는다
 *   ("연합뉴스 경제" → "연합뉴스 정치"). 스키마를 늘리면 소비처를 전부 고쳐야 한다.
 *
 * 실측 확인된 피드(2026-08-27): 한국 7개(연합 정치/사회/연예/스포츠/국제, 한경 정치/사회),
 *   미국 8개(NPR 톱·정치, NBC, CBS, Politico, Variety, Hollywood Reporter, The Verge).
 *   AP 는 fetch 자체가 실패해 넣지 않았다 — 죽은 피드를 목록에 두면 폴러가 매번 헛돈다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const raw = JSON.parse(readFileSync(resolve(ROOT, 'data/news-feeds.json'), 'utf8'));
const feeds = raw.feeds ?? [];
const nameOf = (f) => String(f.source ?? '');

// [1] 한국 정치·사회·연예가 있는가
for (const cat of ['정치', '사회', '연예']) {
  const hit = feeds.filter((f) => f.region === 'kr' && nameOf(f).includes(cat));
  hit.length > 0 ? ok(`KR ${cat}: ${hit.map(nameOf).join(', ')}`) : bad(`KR ${cat} 피드 없음 — 종합 이슈 소재가 비어 있다`);
}
// [2] 미국도 같은 폭을 갖는가 (사용자: "한국 뉴스, 미국 뉴스는 확실히 다 최신거로")
{
  const us = feeds.filter((f) => f.region === 'us');
  const politics = us.filter((f) => /politic|정치/i.test(nameOf(f)));
  const ent = us.filter((f) => /variety|hollywood|entertain|연예/i.test(nameOf(f)));
  const general = us.filter((f) => /npr|nbc|cbs|top|톱/i.test(nameOf(f)));
  politics.length ? ok(`US 정치: ${politics.map(nameOf).join(', ')}`) : bad('US 정치 피드 없음');
  ent.length ? ok(`US 연예: ${ent.map(nameOf).join(', ')}`) : bad('US 연예 피드 없음');
  general.length ? ok(`US 종합: ${general.map(nameOf).join(', ')}`) : bad('US 종합 피드 없음');
}
// [3] 비경제 피드가 금융 필터에 걸려 버려지지 않는가 — 이걸 놓치면 수집해도 0건이 된다
{
  const nonFin = feeds.filter((f) => /정치|사회|연예|스포츠|국제|npr|nbc|cbs|politico|variety|hollywood|verge/i.test(nameOf(f)));
  const filtered = nonFin.filter((f) => f.requireFinancial === true);
  filtered.length === 0
    ? ok(`비경제 피드 ${nonFin.length}개 전부 금융필터 미적용`)
    : bad(`금융필터에 걸리는 비경제 피드: ${filtered.map(nameOf).join(', ')} — 수집해도 버려진다`);
}
// [4] region 이 비지 않는가 (채널별 소재 선정이 region 으로 갈린다)
{
  const noRegion = feeds.filter((f) => !f.region);
  noRegion.length === 0 ? ok('모든 피드에 region 지정') : bad(`region 없는 피드: ${noRegion.map(nameOf).join(', ')}`);
}
// [5] url 중복이 없는가 (같은 피드를 두 번 긁으면 폴러가 낭비된다)
{
  const urls = feeds.map((f) => f.url);
  const dup = urls.filter((u, i) => urls.indexOf(u) !== i);
  dup.length === 0 ? ok(`중복 URL 없음 (총 ${feeds.length}개)`) : bad(`중복: ${[...new Set(dup)].join(', ')}`);
}

console.log(fail === 0 ? '\n✅ news-categories 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

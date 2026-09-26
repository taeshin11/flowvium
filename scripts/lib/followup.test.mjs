#!/usr/bin/env node
/**
 * followup.test.mjs — 72시간 안에 다룬 이슈가 다시 오면 '후속 편' 으로 다룬다. 2026-09-27 신설.
 * 사장님 "제일 좋은 방향으로 해"(후속 편). 레퍼런스: 짧주가 한 사건을 여러 편 이어 내 최고 성적(290K~1.1M, 일화).
 * 우리 실측(9/1~26): 72h 안 같은 이슈 재등장 12편 — 조회 중앙 1,117 · engaged 0.43 · 구독 0.97/1k,
 *   처음 다루는 이슈 144편 — 1,002 · 0.39 · 0.86/1k. 표본이 작아 **약하게만**: 대본이 '새로 나온 사실부터'
 *   (같은 말 되풀이 방지) + 같은 등급 안에서 지난 편 성적이 좋았던 후속을 먼저.
 * 24시간 안 재등장은 편성 대장이 이미 막는다 — 여기서는 24~72시간만 본다.
 */
import { followupInfo, followupPromptLine } from './followup.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const now = Date.parse('2026-09-27T12:00:00Z');
const H = (h) => new Date(now - h * 3600e3).toISOString();
const eps = [
  { issue_key: '김승원', published_at: H(30), headline: '김승원 청문회 D-2…', views: 1200, dayMedian: 1000 },
  { issue_key: '기준금리', published_at: H(50), headline: '英 기준금리 동결', views: 700, dayMedian: 1000 },
  { issue_key: 'dmz', published_at: H(10), headline: 'DMZ 지뢰', views: 2000, dayMedian: 1000 },
  { issue_key: '호르무즈', published_at: H(90), headline: '호르무즈', views: 2000, dayMedian: 1000 },
];
const a = followupInfo('김승원', eps, now);
(a?.hoursAgo === 30 && a.good === true) ? ok('[1] 30시간 전·그날 중앙 이상 → 후속(좋았음)') : bad(`[1] ${JSON.stringify(a)}`);
const b = followupInfo('기준금리', eps, now);
(b && b.good === false) ? ok('[2] 50시간 전·중앙 아래 → 후속이지만 우선은 없음') : bad(`[2] ${JSON.stringify(b)}`);
(followupInfo('dmz', eps, now) === null && followupInfo('호르무즈', eps, now) === null && followupInfo('새이슈', eps, now) === null)
  ? ok('[3] 24시간 안(대장이 막음)·72시간 넘음·처음 → 후속 아님') : bad('[3]');
(followupInfo('김승원!', eps, now)?.hoursAgo === 30) ? ok('[4] 키는 정규화해서 맞춘다') : bad('[4]');
const line = followupPromptLine(a);
(/30시간 전/.test(line) && /새로 나온 사실/.test(line) && /되풀이하지 마라/.test(line) && line.includes('김승원 청문회')) ? ok('[5] 대본 지시: 새 사실부터, 되풀이 금지') : bad(`[5] ${line}`);
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

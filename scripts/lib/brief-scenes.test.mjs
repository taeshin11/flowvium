#!/usr/bin/env node
/**
 * brief-scenes.test.mjs — 브리핑(서로 다른 뉴스 여러 건) 장면은 자기 뉴스 번호를 들고 다닌다. 2026-10-18 신설.
 *
 * 실측(WYtOA2WgZTI, 10/18 21:45): 4건 브리핑에서 2·3번이 사진을 잃어 빠지고 화면에는 추미애 → LG전자 2장면만 남았다.
 *   그런데 메타의 headlines 는 **4건 그대로**라, 제목은 '한국 성과' 규칙으로 4번(LG전자)을 앞세우고
 *   설명란은 화면에 없는 DMZ·젤렌스키 뉴스까지 적었다. 썸네일·첫 장면은 추미애였다.
 * 같은 뿌리: 사진 찾기·CLIP 대조가 BRIEF[i] 를 **장면 번호 i** 로 찾는다 — 파싱·중복 거르기로 장면이 하나 빠지면
 *   뒤 장면이 전부 한 칸씩 밀려 남의 뉴스 사진을 받는다.
 * Mac mini2(10/18 사장님 위임): 브리핑 제목은 첫 뉴스(썸네일·첫 장면)를 따른다. 제목·첫 화면·첫 문장이 맞아야 한다.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { tagBriefScenes, briefMeta, leadStory } = await import('./brief-scenes.mjs');
const { orderForTitle, buildTitle, buildDescription } = await import('./video-meta.mjs');

// [1] 번호는 거르기 전에 붙는다 — 2번이 깨져 빠져도 3번은 3번 뉴스다.
const parsed = tagBriefScenes([{ say: 'a', hook: 'A' }, { say: '', hook: '' }, { say: 'c', hook: 'C' }]).filter((x) => x.say && x.hook);
(parsed.map((x) => x.story).join() === '0,2') ? ok('[1] 깨진 장면이 빠져도 뒤 장면 번호가 밀리지 않는다') : bad(`[1] ${JSON.stringify(parsed)}`);

// [2] 메타는 화면에 남은 장면 순서대로 — 빠진 뉴스는 제목·설명 후보에서 빠진다.
const heads = ['추미애 사퇴 맹공', '브런슨 DMZ 발언', '젤렌스키 오판', 'LG전자, 미국 최대 소비자매체 신뢰도 1위'];
const bodies = ['b0', 'b1', 'b2', 'b3'];
const onScreen = [{ story: 3 }, { story: 0 }, { isOutro: true }];
const m = briefMeta(onScreen, heads, bodies);
(m.headlines.join('|') === 'LG전자, 미국 최대 소비자매체 신뢰도 1위|추미애 사퇴 맹공' && m.bodies.join() === 'b3,b0')
  ? ok('[2] 화면 순서대로 · 빠진 뉴스 없음') : bad(`[2] ${JSON.stringify(m)}`);

// [3] 브리핑 제목은 첫 뉴스를 지킨다 — 한국 성과 헤드라인이 뒤에 있어도 앞세우지 않는다.
const two = ["野, 추미애 '사과 바라니 사과한다' 발언에 \"사퇴 바란다\" 맹공", 'LG전자, 미국 최대 소비자매체 프리미엄 주방가전 신뢰도 1위'];
const o = orderForTitle(two, true, { keepFirst: true });
(o.ordered[0] === two[0] && o.proud === false) ? ok('[3a] keepFirst — 첫 뉴스 그대로, 국뽕 앞머리 없음') : bad(`[3a] ${JSON.stringify(o)}`);
(orderForTitle(two, true).ordered[0] === two[1]) ? ok('[3b] 한 사건 편(keepFirst 없음)은 종전대로 성과 헤드라인을 앞세운다') : bad('[3b]');
const t = buildTitle(two, true, 0, { maxLen: 38, keepFirst: true });
(/추미애/.test(t) && !/LG/.test(t)) ? ok(`[3c] 제목 "${t}"`) : bad(`[3c] ${t}`);
(buildDescription(two, true, { keepFirst: true }).indexOf('추미애') < buildDescription(two, true, { keepFirst: true }).indexOf('LG'))
  ? ok('[3d] 설명란도 첫 뉴스부터') : bad('[3d]');

// [5] 2026-10-19 실측: 브리핑의 주제·키가 **처음 고른 이슈** 것으로 기록됐다 — 첫 화면 뉴스가 아니다.
//   Kf_DTXTrmds: 첫 뉴스 KKR 채권(분류기 → 증시·금리·환율)인데 '임광현'·국내정치로 기록.
//   tILYRdDAKl8: 첫 뉴스 인니 산불(분류기 → 재난·재해)인데 '김민석'·국내정치로 기록. 분류기는 맞았고, 다른 이슈의 값을 옮겨 적었다.
const kkrIssue = { keyword: '임광현', __topic: '국내정치' }, kkr = { keyword: 'kkr', __topic: '증시·금리·환율' };
const fireIssue = { keyword: '김민석', __topic: '국내정치' }, fire = { keyword: '인니', __topic: '재난·재해' };
const L1 = leadStory([{ story: 1 }, { story: 0 }, { isOutro: true }], [{ it: kkrIssue }, { it: kkr }], kkrIssue);
(L1 === kkr) ? ok('[5a] KKR 채권 편 — 첫 화면 뉴스(kkr·증시)를 고른다') : bad(`[5a] ${JSON.stringify(L1)}`);
const L2 = leadStory([{ isOutro: false, story: 2 }, { story: 3 }], [{ it: { keyword: 'x' } }, { it: { keyword: 'y' } }, { it: fire }, { it: fireIssue }], fireIssue);
(L2 === fire) ? ok('[5b] 인니 산불 편 — 첫 화면 뉴스(인니·재난)를 고른다') : bad(`[5b] ${JSON.stringify(L2)}`);
(leadStory([{ say: 'a' }], null, kkrIssue) === kkrIssue) ? ok('[5c] 한 사건 편은 그 이슈 그대로') : bad('[5c]');
// [4] 연결
const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
const pub = readFileSync(new URL('../video-publish.mjs', import.meta.url), 'utf8');
(!/BRIEF\[i\]/.test(ms) && !/BRIEF\[r\.k\]/.test(ms) && /tagBriefScenes\(/.test(ms))
  ? ok('[4a] make-shorts 가 장면 번호가 아니라 장면이 든 뉴스 번호로 찾는다') : bad('[4a]');
(/briefMeta\(/.test(ms) && /brief: !!BRIEF/.test(ms)) ? ok('[4b] 메타가 화면에 남은 뉴스만 · brief 표시') : bad('[4b]');
(/leadStory\(scenes, BRIEF, issue\)/.test(ms) && /keyword: LEAD\.keyword/.test(ms) && /topic: LEAD_TOPIC/.test(ms))
  ? ok('[4d] 메타의 키·주제가 첫 화면 뉴스 것') : bad('[4d]');
(/keepFirst: !!last\.brief/.test(pub)) ? ok('[4c] 발행이 브리핑이면 첫 뉴스를 제목으로') : bad('[4c]');
// [6] 2026-10-20 코드 점검(Claude·ChatGPT 둘 다 REAL): 썸네일 글자는 headlines[0](처음 고른 순서)인데 배경은 '사진 남은 첫 장면'.
//   1번 뉴스가 사진을 잃어 빠지거나 도표 자리바꿈으로 순서가 바뀌면 1번 뉴스 제목이 다른 뉴스 사진 위에 찍힌다(유튜브 제목은 첫 화면 뉴스).
{
  const BM = await import('./brief-scenes.mjs');
  const heads = ['A 뉴스', 'B 뉴스', 'C 뉴스'];
  const sc = [{ story: 1, media: 'b.jpg', hook: 'B 훅' }, { story: 2, media: 'c.jpg' }, { isOutro: true }];
  (typeof BM.thumbHeadline === 'function' && BM.thumbHeadline(sc, heads, true) === 'B 뉴스' && BM.thumbHeadline([{ media: 'x.jpg', hook: '훅' }], heads, false) === 'A 뉴스')
    ? ok('[6a] 썸네일 제목 = 배경 사진 장면의 뉴스(브리핑) · 한 사건 편은 대표 헤드라인') : bad('[6a] 썸네일 제목이 배경 사진과 다른 뉴스일 수 있다');
  (/thumbHeadline\(scenes, headlines, !!BRIEF\)/.test(ms) && !/String\(headlines\[0\] \|\| first\?\.hook/.test(ms))
    ? ok('[6b] make-shorts 썸네일이 thumbHeadline 을 쓴다') : bad('[6b] make-shorts 썸네일이 아직 headlines[0]');
}
// [7] 같은 점검: 브리핑은 사진 없는 장면을 **먼저 지우고** 나서 '절반은 실사진' 을 센다 → total 이 남은 장면 수라 절대 안 걸린다.
//   4건 중 1장만 남아도 10초짜리 한 장면 영상이 나간다. 기준은 **계획한** 장면 수의 절반이다.
{
  const BM = await import('./brief-scenes.mjs');
  (typeof BM.footageFloor === 'function' && BM.footageFloor(1, 4) === 2 && BM.footageFloor(2, 4) === 2 && BM.footageFloor(3, 3) === 2 && BM.footageFloor(0, 0) === 1)
    ? ok('[7a] 실사진 하한 = 계획 장면(빼기 전) 절반 — 4건 중 1장은 거른다, 2장은 낸다') : bad('[7a] 하한이 남은 장면 수로 계산된다');
  (/footageFloor\(total, PLANNED_SCENES\)/.test(ms) && /const PLANNED_SCENES = /.test(ms))
    ? ok('[7b] make-shorts 관문이 계획 장면 수로 센다') : bad('[7b] make-shorts 관문이 아직 지운 뒤 장면 수로 센다');
}
// [8] 2026-10-20 실측(10/18 21:45 WYtOA2WgZTI 로그): 브리핑 네 장면이 모두 "visual 비어 있음 → 한국어 개체명 'LG전자 신뢰도'" —
//   빈 visual 을 메우는 개체명을 **네 뉴스 헤드라인을 다 합친 데서** 뽑아 추미애·DMZ·젤렌스키 장면이 LG전자로 사진을 찾았다.
//   브리핑 장면은 자기 뉴스 헤드라인에서만 뽑는다.
{
  const BM = await import('./brief-scenes.mjs');
  const heads = ['野, 추미애 발언에 맹공', '젤렌스키, 트럼프 대러제재 유예 비판', 'LG전자 신뢰도 1위'];
  (typeof BM.sceneHeadlines === 'function' && BM.sceneHeadlines({ story: 1 }, heads, true).join() === heads[1]
    && BM.sceneHeadlines({ story: 1 }, heads, false).join() === heads.join())
    ? ok('[8a] 브리핑 장면은 자기 뉴스 헤드라인만, 한 사건 편은 전부') : bad('[8a] 브리핑 장면이 남의 뉴스 헤드라인을 섞는다');
  (/sceneHeadlines\(scenes\[i\], headlines, !!BRIEF\)/.test(ms) && !/const pool = `\$\{scenes\[i\]\.hook \?\? ''\} \$\{headlines\.join\(' '\)\}`/.test(ms))
    ? ok('[8b] make-shorts 빈 visual 메우기가 sceneHeadlines 를 쓴다') : bad('[8b] make-shorts 가 아직 모든 헤드라인을 합친다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

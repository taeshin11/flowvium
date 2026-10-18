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
const { tagBriefScenes, briefMeta } = await import('./brief-scenes.mjs');
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

// [4] 연결
const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
const pub = readFileSync(new URL('../video-publish.mjs', import.meta.url), 'utf8');
(!/BRIEF\[i\]/.test(ms) && !/BRIEF\[r\.k\]/.test(ms) && /tagBriefScenes\(/.test(ms))
  ? ok('[4a] make-shorts 가 장면 번호가 아니라 장면이 든 뉴스 번호로 찾는다') : bad('[4a]');
(/briefMeta\(/.test(ms) && /brief: !!BRIEF/.test(ms)) ? ok('[4b] 메타가 화면에 남은 뉴스만 · brief 표시') : bad('[4b]');
(/keepFirst: !!last\.brief/.test(pub)) ? ok('[4c] 발행이 브리핑이면 첫 뉴스를 제목으로') : bad('[4c]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

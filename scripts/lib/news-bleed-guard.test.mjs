#!/usr/bin/env node
/**
 * news-bleed-guard.test.mjs — 번역 캐시에서 *읽을 때* 도 혼종(bleed) 제목을 거른다.
 *
 * 배경(2026-08-21 라이브): /ko 뉴스에 "금요일 경제行事일정" 이 노출됐다(한글+한자 혼재).
 *   원문은 ja "金曜日の経済行事". check-data-quality [B5] 가 잡아냈다.
 *
 *   쓰기측 가드는 정상이다 — 같은 원문을 지금 코드로 3회 재번역하니 전부 "금요일의 경제 일정"
 *   으로 깨끗했다(한자 0). 즉 이 값은 옛 코드/모델이 남긴 *캐시 잔재* 다.
 *
 *   문제는 읽기측이다:
 *     · translatedKey(locale) 캐시 히트 경로는 어떤 검증도 없이 그대로 반환한다.
 *     · 유일한 읽기측 필터 dropForeignTitles 는 *가나만* 본다 — /[぀-ゟ゠-ヿ]/.
 *       한글+한자 혼종은 가나가 없으니 그냥 통과한다.
 *   그래서 한 번 오염되면 TTL(6h ~ stale) 동안 계속 사용자에게 나간다.
 *   생성 시점에만 검사하는 구조는 "한 번의 탈출이 영구화" 된다는 뜻이다.
 *
 *   locale 별 정책은 이미 hasChineseBleed 에 있다(ko 는 zero-Hanja, ja 는 한자 정상 …).
 *   읽기측이 그 정책을 재사용하면 정책이 한 곳에서만 정의된다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'src/app/api/news-cascade/route.ts'), 'utf8');

// 1) 읽기측 필터가 locale 정책(hasChineseBleed)을 쓰는가
const fnIdx = src.indexOf('function dropForeignTitles');
const fnBody = fnIdx >= 0 ? src.slice(fnIdx, src.indexOf('\n}', fnIdx)) : '';
if (!fnBody) bad('dropForeignTitles 를 못 찾음 — 테스트 앵커가 낡았다');
else if (/hasChineseBleed\(/.test(fnBody)) ok('읽기측 필터가 hasChineseBleed 정책을 재사용한다');
else bad('읽기측 필터가 가나만 본다 — 한글+한자 혼종이 통과한다');

// 2) 번역 캐시 히트 반환도 그 필터를 거치는가 (여기가 실제 유출 지점이었다)
const hitIdx = src.indexOf('const translatedCache =');
const hitBlock = hitIdx >= 0 ? src.slice(hitIdx, hitIdx + 420) : '';
if (!hitBlock) bad('번역 캐시 히트 경로를 못 찾음 — 앵커가 낡았다');
else if (/const translatedCache\s*=\s*dropForeignTitles\(/.test(hitBlock)) ok('번역 캐시 히트도 읽기측 필터를 거친다');
else bad('번역 캐시를 검증 없이 그대로 반환한다 — 오염되면 TTL 내내 서빙된다');

console.log(fail === 0 ? '\n✅ news-bleed-guard 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

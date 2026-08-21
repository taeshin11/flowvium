#!/usr/bin/env node
/**
 * enum-label-i18n.test.mjs — 원시 enum·슬러그를 화면에 그대로 찍지 않는가.
 *
 * 배경(2026-08-22 눈검증 → 페이지 감사). 발간본을 보다 뉴스 태그 영문을 발견해
 *   audit-pages 를 돌렸더니 english_leak 이 여러 페이지에서 나왔다. 전부 같은 부류다 —
 *   번역 키가 있는데도 *원시 값* 을 그대로 렌더한다:
 *     /ko/compare  Compare · leader · accumulating · reducing · supplier  (17건)
 *     /ko/short    crypto · technology                                    (2건)
 *     /ko/blog     semiconductors · defense                               (4건)
 *
 *   role 라벨은 이미 CompanyPage.tsx 안에 roleLabel() 로 있었다 — 내가 어제 거기만 고쳤다.
 *   ComparePage 는 같은 값을 그대로 찍는다. 섹터는 useSectorLabel 훅이 이미 있는데
 *   ShortPage 는 7개짜리 손수 맵을 따로 들고 있어 crypto·technology 가 빠졌다.
 *   "한 곳만 고치고 나머지 점검 안 함" — CLAUDE.md 가 반복해 경고하는 그 패턴이다.
 *
 * 그래서 두 가지를 함께 본다: ① 배선이 공유 훅을 쓰는가 ② 번역 키가 전 로케일에 있는가.
 * 손수 맵을 다시 만들면 또 빠진다 — 맵의 존재 자체를 결함으로 본다.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8'); } catch { return ''; } };

// [1] role 라벨은 공유 훅으로
existsSync(resolve(ROOT, 'src/hooks/useRoleLabel.ts'))
  ? ok('useRoleLabel 훅이 있다 (단일 출처)')
  : bad('role 라벨 배선이 컴포넌트마다 따로다 — 한 곳만 고치면 나머지가 남는다');

for (const f of ['src/components/pages/CompanyPage.tsx', 'src/components/pages/ComparePage.tsx']) {
  const src = read(f);
  if (!src) { bad(`${f} 을 못 읽음 — 테스트 앵커가 낡았다`); continue; }
  /useRoleLabel/.test(src) ? ok(`${f.split('/').pop()} 이 useRoleLabel 을 쓴다`)
                           : bad(`${f.split('/').pop()} 이 useRoleLabel 을 안 쓴다`);
}

// [2] ComparePage 가 원시 role/type 을 그대로 찍지 않는가
{
  const src = read('src/components/pages/ComparePage.tsx');
  const raws = [...src.matchAll(/\{\s*(?:company\.role|rel\.type|step\?\.role[^}]*)\s*\}/g)].map((m) => m[0]);
  raws.length ? bad(`ComparePage 가 원시 값을 렌더한다: ${raws.slice(0, 3).join(' ')}`)
              : ok('ComparePage 가 원시 role/type 을 렌더하지 않는다');
}

// [3] 섹터 라벨은 손수 맵이 아니라 훅으로
{
  const src = read('src/components/pages/ShortPage.tsx');
  /useSectorLabel/.test(src) ? ok('ShortPage 가 useSectorLabel 을 쓴다')
                             : bad('ShortPage 가 손수 섹터 맵을 든다 — 목록 밖 섹터가 영문으로 샌다');
  /sectorLabels\s*:\s*Record<string, string>\s*=\s*\{/.test(src)
    ? bad('ShortPage 에 하드코딩 섹터 맵이 남아 있다 (crypto·technology 가 빠져 실제로 샜다)')
    : ok('ShortPage 에 하드코딩 섹터 맵이 없다');
}

// [3b] 수급 행동 라벨도 공유 훅으로 — 페이지마다 손수 맵을 만들다 ComparePage 만 빠졌다.
{
  const cmp = read('src/components/pages/ComparePage.tsx');
  /useActionLabel/.test(cmp) ? ok('ComparePage 가 useActionLabel 을 쓴다')
                             : bad("ComparePage 가 sig.action 을 원시로 찍는다 — /ko 에 'accumulating' 노출");
  /\.action\.replace\(/.test(cmp)
    ? bad('원시 action 값을 replace 로 다듬어 찍는다 — 그건 번역이 아니다')
    : ok('원시 action 렌더 없음');
}

// [4] 번역 키 — 전 16 로케일
const LOCALES = ['ko','en','ja','zh-CN','zh-TW','es','fr','de','pt','ru','ar','hi','id','th','tr','vi'];
const needSectors = ['crypto', 'technology', 'semiconductors', 'defense'];
const needRoles = ['leader', 'supplier', 'customer', 'partner', 'competitor'];
let missS = [], missR = [];
for (const l of LOCALES) {
  let m; try { m = JSON.parse(read(`messages/${l}.json`)); } catch { missS.push(`${l}:파싱실패`); continue; }
  const sec = m?.explore?.sectors ?? {};
  const rol = m?.roles ?? {};
  for (const k of needSectors) if (!sec[k]) missS.push(`${l}.${k}`);
  for (const k of needRoles) if (!rol[k]) missR.push(`${l}.${k}`);
}
missS.length ? bad(`섹터 키 누락 ${missS.length}건: ${missS.slice(0, 6).join(', ')}`) : ok('섹터 키 16 로케일 완비');
missR.length ? bad(`role 키 누락 ${missR.length}건: ${missR.slice(0, 6).join(', ')}`) : ok('role 키 16 로케일 완비');

console.log(fail === 0 ? '\n✅ enum-label-i18n 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

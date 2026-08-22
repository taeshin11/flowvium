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
import { readFileSync, existsSync, readdirSync } from 'fs';
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

// [3c] 데이터 설명문 번역 래퍼는 공용 하나만 — 08-20 에 공용으로 뺐는데 3개 파일이
//   지역 정의를 그대로 들고 있었고, ComparePage 는 아예 안 써서 소개문이 영문이었다.
{
  const dup = ['src/components/intelligence/CapitalFlowsTab.tsx',
               'src/components/pages/CascadeDetailPage.tsx',
               'src/components/pages/CompanyPage.tsx',
               'src/components/pages/ComparePage.tsx']
    .filter((f) => /function T\(\{ text \}/.test(read(f)));
  dup.length ? bad(`지역 T 정의가 남아 있다: ${dup.map((f) => f.split('/').pop()).join(', ')}`)
             : ok('T 래퍼는 공용 TranslatedText 하나뿐');
  /<T text=\{company\.description\}/.test(read('src/components/pages/ComparePage.tsx'))
    ? ok('ComparePage 소개문이 번역 경로를 탄다')
    : bad('ComparePage 소개문이 원문 그대로다 — /ko 에 영문 문단이 노출된다');
}

// [3d] 대문자화는 번역이 아니다 — 어제 capitalize 로 배운 것과 같은 실수가 toUpperCase 로 반복됐다.
{
  const cmp = read('src/components/pages/ComparePage.tsx');
  /\.toUpperCase\(\)\}<\/span>/.test(cmp)
    ? bad('원시 enum 을 toUpperCase 로 찍는다 — 16 로케일 전부 영문이 된다')
    : ok('enum 을 대문자화해서 찍지 않는다');
}

// [4] 번역 키 — 전 16 로케일
const LOCALES = ['ko','en','ja','zh-CN','zh-TW','es','fr','de','pt','ru','ar','hi','id','th','tr','vi'];
// 2026-08-22: 필요한 섹터 키를 손으로 나열하지 않는다 — 나열하면 새 값이 생길 때마다 샌다.
//   실제 데이터가 쓰는 값에서 유도한다. blog 배지에 'general' 이 영문으로 남은 걸
//   눈검증에서 발견하고 전수 유도로 바꿨다(같이 'macro' 도 빠져 있었다).
const dataSrc = ['src/data/blog-posts.ts', 'src/data/sectors.ts'].map(read).join('\n');
const usedSectors = [...new Set([
  ...[...dataSrc.matchAll(/sector:\s*['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]),
  ...[...read('src/data/sectors.ts').matchAll(/id:\s*['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]),
])].filter((x) => x !== 'all');
// 런타임 API 가 내보내는 섹터 값도 같은 규칙을 받아야 한다 — 소스 리터럴만 보면
//   /ko/short 처럼 API 데이터로 그리는 화면이 영문으로 샌다(눈검증에서 실제로 발견:
//   infrastructure · other · mining · cloud · biotech · pharma · hardware).
//   특히 'other' 는 내가 ShortPage 의 손수 맵을 훅으로 바꾸면서 되돌린 회귀였다.
//   라이브 응답이 필요하므로 전제조건으로 선언한다 — CI 에서는 이 부분만 건너뛴다.
let liveSectors = [];
try {
  const r = await fetch('http://127.0.0.1:3000/api/short-interest', { signal: AbortSignal.timeout(8000) });
  if (r.ok) {
    const j = await r.json();
    liveSectors = [...new Set((j.entries ?? []).map((e) => e.sector).filter(Boolean))];
  }
} catch { /* 라이브 없음 — 아래에서 건너뛴다 */ }
if (liveSectors.length) {
  ok(`라이브 API 섹터 값 ${liveSectors.length}종도 대상에 포함`);
} else {
  console.log('  SKIP-부분  라이브 short-interest 미응답 — API 섹터 값 검사 생략');
}
const needSectors = [...new Set([...usedSectors, ...liveSectors])];
usedSectors.length > 10
  ? ok(`데이터가 실제로 쓰는 섹터 값 ${usedSectors.length}종을 유도했다`)
  : bad(`섹터 값 유도 실패(${usedSectors.length}종) — 앵커가 낡았다`);
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

// [5] 사용자에게 보이는 label/aria-label 에 영문을 박지 않았는가 — 눈검증에서 실제로 나왔다
//   (SortTh label="Short Vol % (FINRA)" · "Days to Cover" · "Short Vol %").
//   같은 파일의 다른 12개는 t() 를 쓰고 있었다 — 또 '일부만' 이다.
//   금융 약어(PER·N-PORT 등)는 로케일 무관 표기이므로 대문자·숫자·괄호만으로 이뤄진 라벨은 뺀다.
{
  const tsx = [];
  const walkSrc = (dir, d = 0) => {
    if (d > 6) return;
    let ents = []; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walkSrc(p, d + 1); else if (e.name.endsWith('.tsx')) tsx.push(p);
    }
  };
  walkSrc(resolve(ROOT, 'src'));
  const bad2 = [];
  for (const p of tsx) {
    let src = ''; try { src = readFileSync(p, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/label="([^"]+)"/g)) {
      const v = m[1];
      if (/^[A-Z0-9%().\/\-\s]+$/.test(v)) continue;        // 약어·기호만 — 번역 대상 아님
      if (/[a-z]{3,}\s+[A-Za-z]/.test(v)) bad2.push(`${p.split('/').pop()}: "${v}"`);
    }
  }
  bad2.length
    ? bad(`label/aria-label 에 영문 하드코딩 ${bad2.length}건: ${bad2.slice(0, 4).join(' · ')}`)
    : ok('label/aria-label 에 영문 하드코딩 없음');
}

console.log(fail === 0 ? '\n✅ enum-label-i18n 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

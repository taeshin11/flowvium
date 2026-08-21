#!/usr/bin/env node
/**
 * role-label-i18n.test.mjs — 역할·관계 라벨을 CSS capitalize 로 때우지 않는다.
 *
 * 배경(2026-08-22 눈검증): /ko/company/* 에 english_leak 'Supplier' 'Leader'.
 *   소스에 그 대문자 문자열이 없어 한참 찾았는데, 원인은 CSS 였다 —
 *     CompanyPage.tsx:1143  className="… capitalize">{company.role}
 *     CompanyPage.tsx:1552  className="… capitalize">{type}
 *     CompanyPage.tsx:2117  className="… capitalize">{cascadePosition.step.role…}
 *   데이터의 'supplier' 를 CSS 가 'Supplier' 로 바꿔 화면에 영문으로 보였다.
 *   `capitalize` 는 번역이 아니라 *영어 표기 규칙* 이다 — 다국어 UI 에서 라벨 생성에 쓰면
 *   그 자리는 영원히 영문이 된다. 소스 grep 으로는 안 잡히는 형태라 눈검증에서만 드러난다.
 *
 *   같은 파일 693행에는 KR_REL_LABEL 이 한국어로 *하드코딩* 돼 있었다(CLAUDE.md 위반).
 *   messages 의 roles.* 하나로 모은다 — 같은 목록이 두 곳이면 한쪽만 고쳐진다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const src = readFileSync(resolve(ROOT, 'src/components/pages/CompanyPage.tsx'), 'utf8');

// capitalize 로 라벨을 만드는 자리가 없어야 한다
const lines = src.split('\n');
const hits = [];
lines.forEach((l, i) => {
  if (!/capitalize/.test(l)) return;
  // 같은 태그의 자식으로 원본 값을 그대로 찍는지 (다음 2줄 안에 {…role|type…})
  const near = lines.slice(i, i + 3).join(' ');
  if (/\{\s*(company\.role|type|[\w.]*step\.role)[^}]*\}/.test(near)) hits.push(i + 1);
});
hits.length ? bad(`capitalize 로 라벨을 만드는 자리 ${hits.length}곳: ${hits.join(', ')}행`)
            : ok('capitalize 로 라벨을 만드는 자리 없음');

// 하드코딩 한국어 라벨 맵이 없어야 한다
/KR_REL_LABEL\s*:\s*Record<[^>]*>\s*=\s*\{[^}]*공급사/.test(src)
  ? bad('KR_REL_LABEL 이 한국어를 하드코딩 — 다른 로케일에서 그대로 노출된다')
  : ok('한국어 하드코딩 라벨 맵 없음');

// roles 번역을 쓴다. 2026-08-22: 배선이 useRoleLabel 훅으로 옮겨갔다 —
//   이 페이지 안에만 두는 바람에 ComparePage 가 영문으로 남았기 때문이다(감사에서 17건).
//   그러니 '이 파일 안에서 useTranslations 를 부르는가' 가 아니라
//   '공유 훅을 통해서든 직접이든 roles 번역에 닿는가' 를 묻는 게 맞다.
//   훅 자체의 단일 출처 여부는 enum-label-i18n.test.mjs 가 본다.
/useRoleLabel|useTranslations\(['"]roles['"]\)|tRole/.test(src)
  ? ok('roles 번역에 닿는다')
  : bad('roles 번역을 안 쓴다');

// 데이터의 모든 role/type 값에 키가 있어야 한다
const VALUES = ['leader', 'intermediary', 'supplier', 'customer', 'partner', 'competitor', 'mid_cap', 'first_follower', 'late_mover'];
const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'id', 'th', 'tr', 'vi'];
let miss = 0;
for (const v of VALUES) {
  const lack = LOCALES.filter((l) => {
    try { return JSON.parse(readFileSync(resolve(ROOT, `messages/${l}.json`), 'utf8')).roles?.[v] === undefined; }
    catch { return true; }
  });
  if (lack.length) { bad(`roles.${v} 키 없음 (${lack.length}개 로케일)`); miss++; }
}
if (!miss) ok(`역할·관계 값 ${VALUES.length}종 전부 16개 로케일에 키 존재`);

console.log(fail === 0 ? '\n✅ role-label-i18n 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

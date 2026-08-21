#!/usr/bin/env node
/**
 * fomc-next-consumer.test.mjs — "다음 FOMC" 를 meetings[0] 으로 집는 곳이 없어야 한다.
 *
 * /api/fedwatch 의 meetings 는 연초부터의 *전체 일정* 이라 [0] 은 이미 끝난 회의다.
 *   그 라우트 316행이 "meetings[0] 은 Apr 29 등 과거일 수 있음" 이라고 경고까지 적어 뒀고,
 *   소비처들은 하나씩 pickNextMeeting 으로 옮겨갔다(judge-chat · latest-updates ·
 *   investment-strategy · daily-brief). 각 파일에 그 사유 주석이 남아 있다.
 *
 *   그런데 2026-08-21 발간본 스크린샷을 눈으로 보니 상단 배지가 "FOMC Apr 29 3%" 였다.
 *   오늘은 8월 21일이고 차기 회의는 9월 17일이다 — 넉 달 전 회의의 확률을 보여주고 있었다.
 *   추적하니 ReportPage.tsx:622 의 `(j?.meetings ?? [])[0]` 하나가 남아 있었다.
 *   화면에서 가장 잘 보이는 곳이 마지막까지 안 고쳐져 있었던 셈이다.
 *
 * 주석은 제외한다(사유를 적어 둔 줄까지 잡으면 고친 파일이 오히려 실패한다).
 * 줄 단위 근사이므로 블록 주석 중간 줄('*' 로 시작)도 함께 걸러낸다.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// meetings 배열의 첫 원소를 집는 표현. 공백 변형을 허용한다.
const RE = /meetings\s*(?:\?\?\s*\[\]\s*\))?\s*\[\s*0\s*\]/;
// 이 두 파일은 meetings 로부터 '차기'를 *계산하는* 쪽이라 예외다.
const OWNERS = new Set(['src/lib/fedwatch-next.ts', 'src/app/api/fedwatch/route.ts']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.') || e === 'node_modules') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

const hits = [];
for (const p of walk(resolve(ROOT, 'src'))) {
  const rel = p.replace(`${ROOT}/`, '');
  if (OWNERS.has(rel)) continue;
  readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;  // 사유 주석 제외
    if (RE.test(l)) hits.push(`${rel}:${i + 1}  ${t.slice(0, 72)}`);
  });
}

if (hits.length) for (const h of hits) bad(`meetings[0] 을 '다음 회의' 로 집는다 — ${h}`);
else ok('meetings[0] 직접 사용 없음 (전 소비처가 pickNextMeeting 경유)');

// pickNextMeeting 이 실제로 오늘 기준 올바른 회의를 고르는지 (로직 자체 회귀 봉쇄)
const src = readFileSync(resolve(ROOT, 'src/lib/fedwatch-next.ts'), 'utf8');
/future\s*\?\?\s*ms\[ms\.length - 1\]/.test(src)
  ? ok('전부 과거일 때 첫 원소로 되돌아가지 않는다')
  : bad('전부 과거일 때 폴백이 첫 원소면 이 함수를 만든 이유가 사라진다');

console.log(fail === 0 ? '\n✅ fomc-next-consumer 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

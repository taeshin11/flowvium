#!/usr/bin/env node
/**
 * macro-valid.test.mjs — 보고서가 받는 거시지표 중 '관측이 아닌 것' 을 뺀다. 2026-10-22 신설.
 * 사건: FRED 점검 HTML 을 웹서버(10/16 빌드, 공용 해석기 이전)가 지표로 읽어 /api/macro-indicators 가
 *   actual 400 · releaseDate '<link href="https://fonts…' 를 냈다. 저녁 보고서 earlyWarning 이
 *   "HY 3.23→400%·IG 0.89→400%" 로 50(high) — flowvium.net/ko/report 에 그대로 나갔다(실측 VIX 18 평온).
 *   해석기는 고쳤지만(src/lib/fred-csv.ts) 배포 전이었다 — 소비자 쪽에도 형식 검사가 없었다.
 * 규칙: 지표의 releaseDate 가 있는데 날짜(YYYY-MM-DD 로 시작)가 아니거나, 문자열 칸에 HTML('<')이 있으면 그 지표를 뺀다.
 *   값 크기로 거르지 않는다 — 계열마다 범위가 달라 결국 특정 값 맞춤이 된다. 오염의 표지는 형식이다.
 */
import { validMacroIndicators } from './macro-valid.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const HTML = '<link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,700" rel="stylesheet">';
{
  const r = validMacroIndicators([
    { id: 'hy_spread', actual: 400, previous: 3.23, releaseDate: HTML },
    { id: 'vix', actual: 18.1, previous: 17, releaseDate: '2026-10-22' },
    { id: 'jobless', actual: 220, previous: 215 },
  ]);
  (r.kept.map((x) => x.id).join() === 'vix,jobless' && r.dropped.join() === 'hy_spread') ? ok('[1] HTML 발표일 지표는 빼고 나머지는 둔다') : bad(`[1] ${JSON.stringify(r)}`);
}
{
  const r = validMacroIndicators([{ id: 'x', actual: 1, releaseDate: '2026-10-22T13:30:00Z', note: 'a<b' }]);
  r.kept.length === 0 ? ok('[2] 다른 문자열 칸의 HTML 도 오염으로 본다') : bad(`[2] ${JSON.stringify(r)}`);
}
{
  const r = validMacroIndicators([{ id: 'x', actual: 1, releaseDate: 'Oct 22' }]);
  r.kept.length === 0 ? ok('[3] 날짜가 아닌 발표일은 뺀다') : bad(`[3] ${JSON.stringify(r)}`);
}
{
  const r = validMacroIndicators(undefined);
  (Array.isArray(r.kept) && r.kept.length === 0) ? ok('[4] 입력 없음 → 빈 목록') : bad(`[4] ${JSON.stringify(r)}`);
}
{
  const { readFileSync } = await import('node:fs');
  const g = readFileSync(new URL('../generate-report-local.mjs', import.meta.url), 'utf8');
  /validMacroIndicators\(/.test(g) ? ok('[5] 보고서 생성기가 거시지표를 거른다') : bad('[5] generate-report-local 에 연결 안 됨');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

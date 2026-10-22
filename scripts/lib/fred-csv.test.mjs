#!/usr/bin/env node
/**
 * fred-csv.test.mjs — FRED CSV 해석은 '날짜,값' 줄만 받는다. 2026-10-22 신설.
 *
 * 사건(10/22): FRED 가 점검 중이라 api.stlouisfed.org 와 fredgraph.csv 가 200 + HTML("Site Maintenance | St. Louis Fed")을 냈다.
 *   CSV 폴백 해석기 7곳이 모두 `line.split(',')` 의 둘째 칸을 parseFloat 해서, 점검 페이지의 글꼴 줄
 *   `<link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,700" …>` 의 **400** 을 최신 관측값으로 읽었다.
 *   결과: /api/macro-indicators 의 기준금리·GDP·실업률·ISM·미시간·IG·HY 스프레드가 전부 400, 발표일 칸에 HTML 조각.
 *   아침 보고서 earlyWarning 이 "HY 3.23→400%" 로 58(high) — 실측 VIX 16.7 평온(verify-report early_warning_overalarm).
 * 규칙: 첫 줄이 FRED 헤더(observation_date 또는 DATE)가 아니면 빈 배열 — 모르면 0·옛값이 아니라 '없음'.
 *   줄은 YYYY-MM-DD 날짜 + 숫자 값만. '.'(결측)은 건너뛴다.
 */
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { parseFredCsv } = await import('../../src/lib/fred-csv.ts');

const MAINT = `<!doctype html>
<html lang="en">
<head>
    <title>Site Maintenance | St. Louis Fed<</title>
    <link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,700" rel="stylesheet">
</head>`;
// [1] 점검 HTML → 빈 배열(400 을 읽지 않는다)
{
  const r = parseFredCsv(MAINT);
  (Array.isArray(r) && r.length === 0) ? ok('[1] 점검 페이지(HTML) → 관측 없음') : bad(`[1] ${JSON.stringify(r)}`);
}
// [2] 정상 CSV(새 헤더 observation_date · 옛 헤더 DATE) — 날짜 순 관측, 결측 '.' 건너뜀
{
  const a = parseFredCsv('observation_date,BAMLH0A0HYM2\n2026-10-19,3.21\n2026-10-20,.\n2026-10-21,3.23\n');
  (a.length === 2 && a[1].date === '2026-10-21' && a[1].value === 3.23) ? ok('[2] observation_date 헤더') : bad(`[2] ${JSON.stringify(a)}`);
  const b = parseFredCsv('DATE,DGS10\r\n2026-10-20,4.10\r\n2026-10-21,4.12\r\n');
  (b.length === 2 && b[0].value === 4.1 && b[1].date === '2026-10-21') ? ok('[2b] DATE 헤더 · CRLF') : bad(`[2b] ${JSON.stringify(b)}`);
}
// [3] 헤더는 맞는데 본문에 날짜가 아닌 줄이 섞이면 그 줄만 버린다
{
  const c = parseFredCsv('observation_date,X\n2026-10-21,1.5\n<p>x,400</p>\n');
  (c.length === 1 && c[0].value === 1.5) ? ok('[3] 날짜가 아닌 줄은 버린다') : bad(`[3] ${JSON.stringify(c)}`);
}
// [4] 7곳이 전부 공용 해석기를 쓴다 — 한 곳만 고치면 같은 400 이 다른 화면에 남는다
{
  const { readFileSync } = await import('node:fs');
  const files = ['src/app/api/macro-indicators/route.ts', 'src/app/api/sector-metrics/route.ts', 'src/app/api/commodity-curve/route.ts',
    'src/app/api/yield-curve/route.ts', 'src/app/api/fedwatch/route.ts', 'src/app/api/cron/verify-metrics/route.ts', 'src/lib/credit-fetchers.ts'];
  const raw = files.filter((f) => { const s = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    return /fredgraph\.csv/.test(s) && !/from ['"]@\/lib\/fred-csv['"]/.test(s); });
  raw.length === 0 ? ok('[4] fredgraph.csv 를 읽는 7곳이 모두 lib/fred-csv 를 쓴다') : bad(`[4] 아직 직접 해석: ${raw.join(', ')}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

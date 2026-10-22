#!/usr/bin/env node
/**
 * data-contamination.test.mjs — 입력이 오염된 보고서 판에서 나온 예측은 적중률에서 빼고 따로 센다. 2026-10-22 신설.
 * 사건: 10/22 FRED 점검 HTML 을 웹서버가 거시지표로 읽어 아침·점심·오후·저녁 보고서 earlyWarning 이 high(58/50) —
 *   위험 게이트(medium→high)·판정('신규 진입 보류')까지 번졌다. 그 판을 근거로 forecast-ledger 에 4줄이 기록됐다.
 * 규칙(Mac mini2 결정 10/22): 기록은 발행된 그대로 둔다(전향적 장부는 고치지 않는다 — forecast-score 머리말).
 *   data/data-contamination.json 에 오염된 판(파일+generatedAt)을 적고, 채점 집계만 그 판에서 나온 줄을 빼고 '오염일' 로 따로 센다.
 *   같은 파일명이라도 다시 만든 판(generatedAt 다름)은 오염이 아니다 — 저녁 보고서는 21:50 에 정상본으로 다시 발간됐다.
 */
import { readFileSync } from 'fs';
import { contaminationOf, splitContaminated } from './data-contamination.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const E = [{ date: '2026-10-22', reason: 'FRED 400/HTML', reports: [{ file: 'report-2026-10-22-evening-ko.json', generatedAt: '2026-10-22T11:06:40.369Z' }] }];
const rec = (id, file, gen) => ({ id, report: { file, generatedAt: gen } });
{
  const r = contaminationOf(rec('us-S&P500-2026-10-22', 'report-2026-10-22-evening-ko.json', '2026-10-22T11:06:40.369Z'), E);
  r?.reason === 'FRED 400/HTML' ? ok('[1] 오염된 판에서 나온 줄 → 이유') : bad(`[1] ${JSON.stringify(r)}`);
}
{
  const r = contaminationOf(rec('x', 'report-2026-10-22-evening-ko.json', '2026-10-22T12:50:28.372Z'), E);
  r === null ? ok('[2] 같은 파일이라도 다시 만든 판(generatedAt 다름)은 오염 아님') : bad(`[2] ${JSON.stringify(r)}`);
}
{
  const r = contaminationOf({ id: 'y' }, E);
  r === null ? ok('[3] 보고서 정보 없는 줄은 오염 아님(모르면 빼지 않는다)') : bad(`[3] ${JSON.stringify(r)}`);
}
{
  const recs = [rec('a', 'report-2026-10-22-evening-ko.json', '2026-10-22T11:06:40.369Z'), rec('b', 'report-2026-10-21-evening-ko.json', 'z')];
  const s = splitContaminated(recs, E, (r) => r);
  (s.clean.map((r) => r.id).join() === 'b' && s.contaminated.ids.join() === 'a' && s.contaminated.days.join() === '2026-10-22')
    ? ok('[4] 깨끗한 줄과 오염 줄을 나누고 오염일을 센다') : bad(`[4] ${JSON.stringify(s)}`);
}
{
  const f = readFileSync(new URL('../forecast-score.mjs', import.meta.url), 'utf8');
  (/splitContaminated\(/.test(f) && /contaminated/.test(f)) ? ok('[5] forecast-score 가 오염 줄을 빼고 summary 에 따로 적는다') : bad('[5] forecast-score 연결 안 됨');
}
{
  const d = JSON.parse(readFileSync(new URL('../../data/data-contamination.json', import.meta.url), 'utf8'));
  const n = d.entries.find((e) => e.date === '2026-10-22')?.reports.length;
  n === 4 ? ok('[6] 10/22 오염 판 4개(아침·점심·오후·저녁 첫 판)가 목록에 있다') : bad(`[6] ${n}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

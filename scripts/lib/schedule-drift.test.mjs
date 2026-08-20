#!/usr/bin/env node
/**
 * schedule-drift.test.mjs — 세션 정의(JSON) ↔ 실제 스케줄러(launchd) 일치.
 *
 * 배경(2026-08-20): 사용자 요청("보고서 제작 시작을 더 일찍")으로 launchd 를 90분 앞당기면서
 *   단일 소스인 data/report-sessions.json 의 triggerKst 를 안 고쳤다. 결과:
 *     · JSON 예산 = 발동 11:40 → 발행 12:00 = 20분.  실측 소요는 46분(10:30 발동 → 11:16 산출).
 *     · check-stall 의 HUNG_MIN=20 이 이 가짜 예산에서 왔고, 정상 런을 100% 오탐했다.
 *     · install-report-schedule.mjs 는 이 JSON 에서 plist 를 재생성한다 —
 *       누가 한 번만 돌리면 전 세션이 20분 예산으로 되돌아가 발행 시각을 못 맞춘다(회귀 지뢰).
 *   드리프트가 다시 조용히 생기지 않도록 여기서 막는다.
 */
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const cfg = JSON.parse(readFileSync(resolve(ROOT, 'data/report-sessions.json'), 'utf8'));
const OBSERVED_MIN = 46;   // 2026-08-20 noon 실측 (10:30 발동 → generatedAt 11:16:01Z+9)

for (const s of cfg.sessions) {
  const plist = `${homedir()}/Library/LaunchAgents/com.spinai.flowvium-report-${s.id}.plist`;
  if (!existsSync(plist)) { bad(`${s.id}: plist 없음 — 스케줄 미설치`); continue; }
  const raw = k => execFileSync('plutil', ['-extract', `StartCalendarInterval.${k}`, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  const actual = `${String(+raw('Hour')).padStart(2,'0')}:${String(+raw('Minute')).padStart(2,'0')}`;
  actual === s.triggerKst
    ? ok(`${s.id}: JSON ${s.triggerKst} = launchd ${actual}`)
    : bad(`${s.id}: JSON ${s.triggerKst} ≠ launchd ${actual} — install-report-schedule 재실행 시 회귀`);

  const [th, tm] = s.triggerKst.split(':').map(Number);
  const [ph, pm] = s.publishKst.split(':').map(Number);
  let budget = (ph * 60 + pm) - (th * 60 + tm);
  if (budget <= 0) budget += 1440;
  budget >= OBSERVED_MIN
    ? ok(`${s.id}: 예산 ${budget}분 ≥ 실측 ${OBSERVED_MIN}분`)
    : bad(`${s.id}: 예산 ${budget}분 < 실측 ${OBSERVED_MIN}분 — 발행 시각을 구조적으로 못 맞춘다`);
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);

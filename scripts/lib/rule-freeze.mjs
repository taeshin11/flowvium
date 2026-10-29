/**
 * rule-freeze.mjs — 전향 연구(docs/prospective-study-protocol.md v0.3) 기간에는 매수·매도 규칙 점수·임계를 자동으로 바꾸지 않는다.
 *
 * 2026-10-30 (사장님 "전향적 연구 결과를 매수엔진에 반영" → ChatGPT·agy·Claude 상의):
 *   주간 튜너가 매주 같은 실현 이력을 다시 세며 '수익 낸 비율 > 50%' 인 규칙을 한 칸씩 올렸다 — 오르는 장에선
 *   거의 모든 규칙이 50% 를 넘는다(전체 평균 64%). 8/20 이후 한 번도 안 내려가 39개 중 11개가 상한 10(10/25).
 *   이렇게 엔진이 매주 바뀌면 8주 전향 판정이 무엇을 쟀는지 알 수 없다. 셋 다 '연구 기간 고정'(agy·Claude 명시,
 *   ChatGPT '자동 재튜닝 되먹임' 을 첫 위험으로). 튜너는 계속 돌고 제안만 기록한다.
 * 기간: data/rule-freeze.json {from, until(그날 포함), why}. 없거나 깨졌으면 동결 아님(+error 로 알린다).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './project-root.mjs';

export const FREEZE_FILE = resolve(ROOT, 'data/rule-freeze.json');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function freezeOf(now = Date.now(), file = process.env.RULE_FREEZE_FILE || FREEZE_FILE) {
  if (!existsSync(file)) return { frozen: false, why: null };
  let f;
  try { f = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { frozen: false, why: null, error: `동결 파일을 읽지 못함: ${e.message}` }; }
  if (!DAY.test(f?.from ?? '') || !DAY.test(f?.until ?? '') || f.from > f.until) return { frozen: false, why: null, error: `동결 날짜가 이상함: ${f?.from}~${f?.until}` };
  // 날짜는 KST 하루 단위(튜너가 KST 일요일 새벽에 돈다).
  const day = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
  const frozen = day >= f.from && day <= f.until;
  return { frozen, why: frozen ? `${f.from}~${f.until} ${f.why ?? ''}`.trim() : null, from: f.from, until: f.until };
}

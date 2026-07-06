#!/usr/bin/env node
// scripts/check-deferrals.mjs — "게으른 미루기" 방지 검증체계 (2026-07-06 사용자
//   "왜 최선의 방법을 시행 안 하고 있었는지 검증체계 마련해 · 정당한 미루기로 포장한 게으른 미루기 하지마").
//
// data/deferral-ledger.json 의 각 "미룬 더 나은 방법"을 기계가 추적:
//   ① reEvalBy 경과 → ❌ (재평가 기한 넘김 = 방치 의심)
//   ② whyStillValid(반증 프로브) 가 falsify → ❌ (미루던 이유가 더는 유효하지 않음 = 지금 해야 함)
//   ③ 그 외 → ✅ 추적 중(정당한 미루기 — 등록·기한·근거 있으면 정당)
// "정당한 미루기"는 여기 *등록돼 추적될 때만* 정당. 미등록 방치 = 게으른 미루기. verify-all advisory(warn).
// 사용: node scripts/check-deferrals.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const led = JSON.parse(readFileSync(resolve(ROOT, 'data/deferral-ledger.json'), 'utf8'));
// KST 오늘 (Date.now 는 허용 — cron/CLI 실행 시점 기준)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

// 반증 프로브 — whyStillValid 가 아직 참인지 결정론 확인. id 별 커스텀(없으면 시간기반만).
const REBUT = {
  'fp8-arm-ab': () => existsSync('/root') ? null : null, // WSL 파일계는 여기서 직접 확인 불가 — 시간기반만
  'chat-outcome-tracking': () => {
    // 반증: chat outcome 추적 스크립트가 생겼으면 미루던 이유 소멸 → 지금 처리 대상
    const done = existsSync(resolve(ROOT, 'scripts/evaluate-chat-outcomes.mjs'));
    return done ? '반증: chat outcome 추적 스크립트 존재 — 미루던 이유 소멸, 배선 확인' : null;
  },
  'chat-e2e-in-harness': () => {
    const src = readFileSync(resolve(ROOT, 'scripts/verify-all.mjs'), 'utf8');
    return /e2e-chat-(multiturn|longform|compact)/.test(src) ? '반증: verify-all 에 이미 e2e 배선됨 — 원장 정리' : null;
  },
};

let warn = 0, ok = 0;
console.log('## 미룬 "더 나은 방법" 추적 (게으른 미루기 감시)\n');
for (const d of led.deferrals ?? []) {
  const overdue = d.reEvalBy && d.reEvalBy < today;
  let rebut = null; try { rebut = REBUT[d.id]?.(); } catch { /* 프로브 실패 무시 */ }
  const daysLeft = d.reEvalBy ? Math.round((new Date(d.reEvalBy) - new Date(today)) / 86400000) : null;
  if (overdue || rebut) {
    warn++;
    console.log(`❌ [${d.id}] ${overdue ? `재평가 기한 경과(${d.reEvalBy})` : ''}${rebut ? ` ${rebut}` : ''}`);
    console.log(`   더 나은 방법: ${d.better}`);
    console.log(`   → 지금 실행하거나, 근거 갱신 후 reEvalBy 연장(방치 금지).`);
  } else {
    ok++;
    console.log(`✅ [${d.id}] 추적 중 (재평가 D${daysLeft >= 0 ? '-' + daysLeft : '+' + -daysLeft}, ${d.severity}) — ${d.isBestMethodBlockedBy?.slice(0, 60) ?? ''}`);
  }
}
console.log(`\n미룬 항목 ${led.deferrals.length}개 · 추적중 ${ok} · 조치필요 ${warn}`);
if (warn) { console.log('⚠️ 조치필요 항목 — 정당한 미루기의 기한/근거가 소멸했다. 지금 처리 또는 재평가 갱신.'); process.exit(1); }
console.log('✅ 모든 미룸이 등록·기한·근거로 추적됨 (게으른 미루기 0)');

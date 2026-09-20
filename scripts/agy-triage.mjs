#!/usr/bin/env node
/**
 * agy-triage.mjs — 경보 하나를 agy 에게 진단시킨다(고치지는 않는다).
 *
 *   node scripts/agy-triage.mjs "[G] /insider 한국 기관 순매수/매도 0건"
 *   node scripts/agy-triage.mjs --auto     # 지금 뜬 경보 중 첫 줄을 스스로 집는다
 *
 * 증거는 이쪽이 모은다(명령 실행). agy 는 읽기만 한다 — 이 저장소에는 secrets/ 가 있고
 *   셸 + 네트워크는 그대로 유출 경로라 코딩 에이전트에 열지 않는다(lib 머리말 참고).
 *
 * 돌려받는 것은 답이 아니라 **확인 절차**다. 후보와 그것을 가르는 명령을 받고, 고르는 것은 사람이 한다.
 */
import { spawnSync } from 'child_process';
import { ROOT } from './lib/project-root.mjs';
import { evidenceBundle, collect, triage } from './lib/agy-triage.mjs';

const AUTO = process.argv.includes('--auto');
let alert = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();

if (AUTO && !alert) {
  const r = spawnSync('bash', ['-lc', 'node scripts/check-data-quality.mjs; node scripts/check-stall.mjs'],
    { cwd: ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  const line = `${r.stdout ?? ''}`.split('\n').find((l) => /🚨|❌/.test(l));
  alert = (line ?? '').replace(/^\s*(?:🚨|❌|⚠)\s*/u, '').trim();
  if (!alert) { console.log('지금 뜬 경보가 없다 — 진단할 것이 없다'); process.exit(0); }
  console.log(`경보를 집었다: ${alert.slice(0, 120)}\n`);
}
if (!alert) { console.error('사용: node scripts/agy-triage.mjs "<경보 문구>"  또는  --auto'); process.exit(2); }

console.log('증거를 모은다…');
const ev = collect(evidenceBundle(alert), { cwd: ROOT });
for (const e of ev) console.log(`  · ${e.name} ${e.cmd ? `(${e.body.split('\n').length}줄)` : ''}`);

console.log('\nagy 에게 진단을 맡긴다…');
const t0 = Date.now();
const r = triage(alert, ev, { cwd: ROOT });
console.log(`  ${Math.round((Date.now() - t0) / 1000)}초`);
if (!r.ok) { console.error(`❌ 진단 실패: ${r.why} — 사람이 볼 것`); process.exit(1); }

const d = r.result;
if (d.where?.length) { console.log('\n■ 어디를 보나'); for (const w of d.where) console.log(`  ${w}`); }
console.log('\n■ 원인 후보');
(d.hypotheses ?? []).forEach((h, i) => {
  console.log(`  ${i + 1}. ${h.cause}`);
  console.log(`     근거: ${h.why}`);
  console.log(`     가르는 명령: ${h.check}`);
});
if (d.already_tried?.length) {
  console.log('\n■ 이 저장소가 이미 해 보고 버린 것 (그대로 다시 만들지 말 것)');
  for (const a of d.already_tried) console.log(`  · ${a}`);
}
console.log('\n■ 증거만으로는 모르는 것');
for (const u of (d.unknown ?? ['(없다고 한다)'])) console.log(`  · ${u}`);
console.log('\n위 "가르는 명령" 을 돌려 후보를 좁힌 뒤, 고칠 것이 정해지면');
console.log('  node scripts/agy-do.mjs --task <명세파일> --test "<테스트 명령>"');

#!/usr/bin/env node
/**
 * report-backend.test.mjs — "보고서가 agy 로 도는가" 를 한 곳에서 답하는가. 2026-09-23 신설.
 *
 * 오늘의 사고: 27B 를 내렸는데 되살아났다. 되살리는 곳이 둘이었고(run-report.sh 관문 ·
 *   cron-runner self-heal), 둘 다 "보고서는 :8000 을 쓴다" 를 각자 전제하고 있었다.
 *   앞의 것만 고치고 뒤를 놓쳤다.
 *
 * 모르면 모른다고 해야 한다 — plist 를 못 읽었는데 "agy 쓴다" 고 답하면 27B 를 안 올리고
 *   보고서를 통째로 잃는다.
 */
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { reportViaAgy } from './report-backend.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const mk = (specs) => {
  const d = mkdtempSync(join(tmpdir(), 'plists-'));
  for (const [s, on] of Object.entries(specs)) {
    writeFileSync(join(d, `com.spinai.flowvium-report-${s}.plist`),
      `<plist><dict><key>EnvironmentVariables</key><dict>${on ? '<key>REPORT_VIA_AGY</key><string>1</string>' : ''}</dict></dict></plist>`);
  }
  return d;
};
const E = {};

// [1] 전부 켜져 있으면 true
{ const d = mk({ morning: 1, noon: 1 }); reportViaAgy({ dir: d, env: E }) === true ? ok('[1] 전부 켜짐 → true') : bad('[1]'); rmSync(d, { recursive: true, force: true }); }

// [2] 전부 꺼져 있으면 false
{ const d = mk({ morning: 0, noon: 0 }); reportViaAgy({ dir: d, env: E }) === false ? ok('[2] 전부 꺼짐 → false') : bad('[2]'); rmSync(d, { recursive: true, force: true }); }

// [3] ★ 섞여 있으면 **단정하지 않는다** — 한쪽만 보고 27B 를 내리면 나머지 회차가 죽는다
{ const d = mk({ morning: 1, noon: 0 }); reportViaAgy({ dir: d, env: E }) === null ? ok('[3] 섞임 → null(판단 보류)') : bad('[3] 섞였는데 단정했다'); rmSync(d, { recursive: true, force: true }); }

// [4] ★ plist 를 못 읽으면 null — 모르면서 "agy 쓴다" 고 하면 보고서를 잃는다
{
  reportViaAgy({ dir: '/no/such/dir/xyz', env: E }) === null ? ok('[4] 폴더 없음 → null') : bad('[4]');
  const d = mkdtempSync(join(tmpdir(), 'empty-'));
  reportViaAgy({ dir: d, env: E }) === null ? ok('[4b] plist 0개 → null') : bad('[4b]');
  rmSync(d, { recursive: true, force: true });
}

// [5] 환경변수 지정이 우선 — 회차 프로세스 안에서는 이미 정해져 있다
{
  const d = mk({ morning: 0 });
  reportViaAgy({ dir: d, env: { REPORT_VIA_AGY: '1' } }) === true ? ok('[5] env=1 우선') : bad('[5]');
  reportViaAgy({ dir: d, env: { REPORT_VIA_AGY: '0' } }) === false ? ok('[5b] env=0 우선') : bad('[5b]');
  rmSync(d, { recursive: true, force: true });
}

// [6] 실제 이 기계에서 지금 무엇으로 도는가 — 값을 단정하지 않고 **판단이 서는지**만 본다.
//     2026-09-23: 이 단언은 **launchd plist 가 있는 기계에서만** 뜻이 있다. 처음엔 그걸 안 적어
//       CI(우분투)에서 빨간불이 났다 — 바로 앞 커밋에서 다른 테스트 10개에 고쳐 놓고
//       새 테스트에서 같은 실수를 했다. 파일 전체를 스킵하지 않고 **이 단언만** 건너뛴다:
//       위 [1]~[5] 는 순수 로직이라 CI 에서도 돌아야 한다.
{
  const hasAgents = existsSync(join(homedir(), 'Library/LaunchAgents'));
  if (!hasAgents || process.env.LIB_TEST_AS_CI === '1') {
    console.log('  SKIP  [6] launchd plist 가 없는 환경 — 이 기계 설정 판정은 건너뛴다');
  } else {
    const v = reportViaAgy();
    v === null ? bad('[6] 이 기계의 설정을 못 읽는다 — 그러면 아무도 27B 를 내릴 판단을 못 한다')
      : ok(`[6] 이 기계: 보고서 ${v ? 'agy' : '로컬'}`);
  }
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);

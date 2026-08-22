#!/usr/bin/env node
/**
 * log-defect-harvest.test.mjs — 탐지한 LLM 결함이 학습 이력까지 도달하는가.
 *
 * 배경(2026-08-22): news-cascade 의 asset 검증기가 실제 환각을 잡고 있었다 —
 *   최근 로그 500건에 asset_defect 24건. 예: `unknown_kr_code:035550`.
 *   035550 은 소스 4곳(DART·kr-major-indexes·candidate-tickers·universe-search)
 *   어디에도 없다(신한지주는 055550). 검증기가 없었다면 발간될 값이었다.
 *
 *   그런데 그 발견이 logger.warn 에서 끝났다. CLAUDE.md 규칙 2의
 *   "probe → defect → hallucination_history 적재" 마지막 칸이 비어 있었다.
 *
 * 그리고 적재하자마자 두 번째 문제가 드러났다 — 20건이 한꺼번에 들어오니
 *   보고서 프롬프트의 15슬롯 예산을 최신순으로 통째로 먹는다. cascade 결함은
 *   *다른 표면* 의 것이라 보고서 모델에게 가르칠 내용도 아니다.
 *   "적재하면 끝" 이 아니라 "어느 프롬프트에 주입되는가" 까지 봐야 한다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { toDefectRows, severityOf, detectLogGap } = await import('./log-defect-harvest.mjs');

// 실제 로그에서 관측된 엔트리 그대로
const entries = [
  { t: '2026-08-22T00:00:11.617Z', level: 'warn', source: 'news-cascade', event: 'asset_defect',
    data: { link: 'https://x/1', raw: '035550.KS', defect: 'unknown_kr_code:035550' } },
  { t: '2026-08-22T00:00:11.617Z', level: 'warn', source: 'news-cascade', event: 'asset_defect',
    data: { link: 'https://x/1', raw: '035550.KS', defect: 'unknown_kr_code:035550' } },   // 중복
  { t: '2026-08-22T00:01:00.000Z', level: 'warn', source: 'news-cascade', event: 'asset_defect',
    data: { link: 'https://x/2', raw: 'DQ (Dongwon Electric Wire & Cable)', defect: 'dropped_name_claim:Dongwon' } },
  { t: '2026-08-22T00:02:00.000Z', level: 'warn', source: 'news-cascade', event: 'dropped_bleeding_titles', data: {} },
  { t: '2026-08-22T00:03:00.000Z', level: 'error', source: 'yahoo', event: 'yahoo_failed', data: {} },
];
const rows = toDefectRows(entries);

rows.length === 2
  ? ok(`asset_defect 만 추출하고 중복 제거 (${rows.length}건)`)
  : bad(`추출 ${rows.length}건 — 기대 2 (asset_defect 아닌 이벤트나 중복이 섞였다)`);

rows[0]?.defect_type === 'cascade_asset_unknown_kr_code'
  ? ok(`표면이 defect_type 에 드러난다: ${rows[0].defect_type}`)
  : bad(`defect_type 이 ${rows[0]?.defect_type} — 표면(cascade)을 알 수 없으면 프롬프트 분리가 불가능하다`);

rows[0]?.correct_value === null
  ? ok('정답을 모르면 null 로 둔다 (권위 소스에 없는 코드다)')
  : bad('모르는 정답을 지어냈다');

severityOf('unknown_kr_code:035550') === 'high' && severityOf('dropped_ticker_hint:IBB') === 'low'
  ? ok('심각도 구분: 존재하지 않는 코드=high · 근거 없는 힌트 제거=low')
  : bad('심각도가 구분되지 않는다 — 전부 같은 무게면 우선순위가 사라진다');

// 유실 감지 — 조용한 유실은 '결함 없음' 과 구분되지 않는다.
//   실측(2026-08-22): 로그 500건이 덮는 시간이 41.8분(12건/분)이었다. 매시간 수확은 부족하다.
//   "주기가 충분하다" 는 내 가정이 틀렸고, 재 보고 나서야 알았다.
{
  const now = Date.now();
  const logs = [{ t: new Date(now - 40 * 60000).toISOString(), event: 'x' }];
  detectLogGap(logs, now - 10 * 60000) === null
    ? ok('마지막 수확 이후가 로그에 다 남아 있으면 유실 없음')
    : bad('유실이 없는데 있다고 본다');
  const g = detectLogGap(logs, now - 60 * 60000);
  g && g.gapMinutes === 20
    ? ok(`캡에 밀려 사라진 구간을 분 단위로 알린다 (${g.gapMinutes}분)`)
    : bad(`유실 구간 계산이 틀렸다: ${JSON.stringify(g)}`);
  detectLogGap([], now - 60 * 60000) === null && detectLogGap(logs, null) === null
    ? ok('로그가 비었거나 마커가 없으면 판정하지 않는다 (모르는 걸 아는 척하지 않는다)')
    : bad('근거 없이 유실을 단정한다');
}

// 표면 분리: 보고서 프롬프트 주입에서 cascade_* 가 빠져야 한다
const db = readFileSync(resolve(ROOT, 'scripts/lib/db.mjs'), 'utf8');
/getRecentHallucinationsForPromptInject[\s\S]{0,1600}?NOT LIKE 'cascade_%'/.test(db)
  ? ok("보고서 프롬프트 주입에서 cascade_* 제외 (15슬롯 예산을 안 먹는다)")
  : bad('cascade 결함이 보고서 프롬프트로 들어간다 — 표면이 다르고 예산을 통째로 먹는다');

// 수확기가 실제로 주기 실행에 등록돼 있는가
const cron = readFileSync(resolve(ROOT, 'scripts/cron-runner.mjs'), 'utf8');
/harvest-log-defects/.test(cron)
  ? ok('수확기가 cron-runner 에 등록돼 있다')
  : bad('수확기를 만들었는데 아무도 안 부른다 — 손으로 돌릴 때만 도는 dead-end');
// 주기가 실측 회전(41.8분)보다 짧아야 한다 — 매시간이면 매 주기 18분치를 잃는다.
{
  const m = cron.match(/harvest-log-defects[^\n]*schedules:\s*\['([^']+)'\]/);
  const spec = m?.[1] ?? '';
  const mins = (spec.split(' ')[0] ?? '').split(',').filter(Boolean).length;
  mins >= 3
    ? ok(`수확 주기가 시간당 ${mins}회 (실측 로그 회전 41.8분보다 촘촘)`)
    : bad(`수확 주기가 시간당 ${mins}회 — 로그 회전(41.8분)보다 성기면 매 주기 유실된다: '${spec}'`);
}

console.log(fail === 0 ? '\n✅ log-defect-harvest 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

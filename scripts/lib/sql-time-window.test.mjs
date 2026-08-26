#!/usr/bin/env node
/**
 * sql-time-window.test.mjs — 시간창 SQL 비교가 저장 형식과 맞는가.
 *
 * 사건(2026-08-27): audit-coverage 가 /api/company-financials/XLF 를 "라우트 죽음"으로 계속
 *   err 처리해 push 를 막았다. 우리 쪽 버그(ETF 에 기업재무 호출)를 고쳐 **호출을 멈춘 뒤에도** 그랬다.
 *   원인을 파니 "최근 24h" 판정 자체가 틀려 있었다:
 *     captured_at        = '2026-08-26T15:04:52.042Z'   (ISO — T 구분자, Z)
 *     datetime('now','-1 day') = '2026-08-25 20:09:36'   (SQLite — 공백 구분자)
 *   문자열 비교에서 'T'(0x54) > ' '(0x20) 이라, **같은 날짜면 시각과 무관하게 항상 크다.**
 *   실측: XLF 의 24h 내 건수가 2건으로 집계됐지만 정답은 0건이었다(최신 기록이 32시간 전).
 *
 * 방향이 한쪽으로 치우친 버그다 — 창이 **항상 과하게 넓어진다**. 오래된 기록이 '최근'으로 샌다.
 *   저장소 전체에서 이 패턴이 17곳이고, hallucination_history.detected_at 도 같은 ISO 형식이라
 *   내가 만든 check-stall [12] 교정기 드리프트 검사도 같은 버그를 갖고 있었다.
 *
 * 고치는 법: 컬럼을 datetime() 으로 감싼다. SQLite 의 datetime() 은 ISO(T/Z)와 공백 형식을
 *   **둘 다** 파싱하므로, 형식이 섞여 있어도 안전하고 과잉수정이 아니다.
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 형식 혼재를 datetime() 이 흡수하는가 (수정 방법의 전제)
{
  const db = new Database(':memory:');
  const iso = "2026-08-26T15:04:52.042Z", spc = "2026-08-26 15:04:52";
  const a = db.prepare("SELECT datetime(?) d").get(iso).d;
  const b = db.prepare("SELECT datetime(?) d").get(spc).d;
  a === b ? ok(`datetime() 이 두 형식을 같게 정규화: ${a}`) : bad(`정규화 실패: ${a} vs ${b}`);
  db.close();
}
// [2] 감싸지 않은 비교가 실제로 틀리는가 (버그 재현)
{
  const db = new Database(':memory:');
  db.exec("CREATE TABLE t(ts TEXT)");
  // '지금'보다 30시간 전 = 24h 창 밖. ISO 형식으로 저장.
  const old = db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now', '-30 hours') v").get().v;
  db.prepare("INSERT INTO t VALUES (?)").run(old);
  const naive = db.prepare("SELECT COUNT(*) c FROM t WHERE ts >= datetime('now','-1 day')").get().c;
  const fixed = db.prepare("SELECT COUNT(*) c FROM t WHERE datetime(ts) >= datetime('now','-1 day')").get().c;
  naive === 1 ? ok('감싸지 않으면 30시간 전 기록이 24h 창에 샌다(버그 재현)') : bad(`버그 재현 실패: naive=${naive}`);
  fixed === 0 ? ok('datetime() 으로 감싸면 정확히 제외된다') : bad(`수정본이 틀리다: fixed=${fixed}`);
  db.close();
}
// [3] 저장소에 감싸지 않은 비교가 남아 있지 않은가
{
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|ts)$/.test(e.name) && !/\.bak|\.test\./.test(e.name)) files.push(p);
  } };
  walk(resolve(ROOT, 'scripts')); walk(resolve(ROOT, 'src'));
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?<!datetime\()\b([a-z_]*(?:_at|_date))\s*>=\s*datetime\('now'/g)) {
      offenders.push(`${f.replace(ROOT + '/', '')}: ${m[1]}`);
    }
  }
  offenders.length === 0
    ? ok('시간창 비교가 전부 datetime() 으로 감싸져 있다')
    : bad(`감싸지 않은 비교 ${offenders.length}곳: ${[...new Set(offenders)].slice(0, 5).join(' | ')}`);
}

console.log(fail === 0 ? '\n✅ sql-time-window 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * harvest-log-defects.mjs — 런타임 로그의 LLM 결함을 hallucination_history 로 옮긴다.
 *
 * 왜(2026-08-22): news-cascade 의 asset 검증기가 실제 환각을 잡고 있는데
 *   (`unknown_kr_code:035550` — 035550 은 소스 4곳 어디에도 없다, 신한지주는 055550)
 *   그 발견이 logger.warn 에서 끝났다. CLAUDE.md 규칙 2가 요구하는
 *   "probe → defect → hallucination_history 적재" 의 마지막 한 칸이 비어 있었다.
 *   적재가 없으면 추세도 없고 다음 프롬프트에 주입되지도 않는다.
 *
 * 사용: node scripts/harvest-log-defects.mjs
 * 종료코드: 0(수확 성공 또는 수확할 것 없음) · 1(DB 오류). Redis 미접속은 0 + 사유 출력.
 */
import { openDb } from './lib/db.mjs';
import { readRecentLogs, toDefectRows } from './lib/log-defect-harvest.mjs';

const log = (...a) => console.log('[harvest]', ...a);

const entries = await readRecentLogs(500);
if (entries === null) { log('Redis 접속 정보 없음 — 수확 건너뜀'); process.exit(0); }

const rows = toDefectRows(entries);
if (!rows.length) { log(`로그 ${entries.length}건 · 새 결함 0건`); process.exit(0); }

const db = openDb();
try {
  const reportId = db.prepare('SELECT id FROM reports ORDER BY created_at DESC LIMIT 1').get()?.id;
  if (!reportId) { log('reports 가 비어 있어 앵커할 보고서가 없다 — 건너뜀'); process.exit(0); }

  const exists = db.prepare(
    'SELECT 1 FROM hallucination_history WHERE defect_type = ? AND IFNULL(llm_value, \'\') = IFNULL(?, \'\') LIMIT 1');
  const ins = db.prepare(`
    INSERT INTO hallucination_history
      (report_id, detected_at, ticker, defect_type, llm_value, correct_value, severity, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();
  let added = 0, dup = 0;
  const txn = db.transaction(() => {
    for (const r of rows) {
      if (exists.get(r.defect_type, r.llm_value)) { dup++; continue; }
      ins.run(reportId, now, r.ticker, r.defect_type, r.llm_value, r.correct_value, r.severity,
              JSON.stringify(r.details));
      added++;
    }
  });
  txn();
  log(`로그 ${entries.length}건 · 고유 결함 ${rows.length}건 · 신규 적재 ${added} · 중복 ${dup} · 앵커 ${reportId}`);
  for (const r of rows.slice(0, 5)) log(`   ${r.severity.padEnd(6)} ${r.defect_type} ${r.llm_value ?? ''}`);
} catch (e) {
  console.error('[harvest] 실패:', e?.message ?? e);
  process.exit(1);
} finally { db.close(); }

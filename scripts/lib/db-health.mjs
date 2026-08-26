/**
 * db-health.mjs — 라이브 DB 가 뒤로 갔는지 본다.
 *
 * 왜(2026-08-22, 내가 낸 사고): `git reset --hard <이전커밋>` 으로 추적 중이던
 *   data/flowvium.db 가 커밋본으로 되돌아갔다.
 *     reports 205→48 · recommendations 1481→254 · outcomes 1340→214 · buy_candidates 4382→0
 *   검사 10종 중 어느 것도 이걸 못 봤다. check-stall 은 DB 를 열지만(73행) 최신 보고서
 *   한 줄만 읽는다. 백업의 *복원가능성*([9])은 보면서 정작 *라이브 DB 자체* 는 아무도
 *   안 보고 있었다. 내가 우연히 테스트를 돌려서 알았을 뿐이다.
 *
 * 판정 근거를 어디서 얻나 — 임계값을 손으로 정하지 않는다:
 *   ① `PRAGMA quick_check` (실측 51ms · 154MB)
 *   ② **백업과 대조.** ~/flowvium_backups 는 git 이 건드릴 수 없는 독립 사본이고
 *      라이브에서 떠간 것이라 정상 상태에서는 언제나 live ≥ backup 이다.
 *      live < backup 은 '라이브가 뒤로 갔다' 는 뜻이고 오늘 사고의 signature 그대로다.
 *      백업이 없으면 판정하지 않는다(모르는 걸 아는 척하지 않는다).
 *   ③ 감소가 정상인 테이블은 **소스에서 유도**한다 — 저장소에 `DELETE FROM <t>` 가 있는
 *      테이블만 제외. 목록을 손으로 적으면 새 삭제 경로가 생길 때 오경보가 난다.
 *      실측 3개(recommendations·recommendation_outcomes·translation_backlog)이고,
 *      오늘 피해가 드러난 reports·buy_candidates·hallucination_history 는 삭제 경로가 없다.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join } from 'path';
import Database from 'better-sqlite3';

const DB_RE = /^flowvium-\d{4}-\d{2}-\d{2}\.db$/;
const LOCAL_BACKUP_DIR = () =>
  process.env.FLOWVIUM_BACKUP_LOCAL_DIR || resolve(process.env.HOME ?? '.', 'flowvium_backups');

/** 저장소 소스를 훑어 `DELETE FROM <table>` 대상 테이블 집합을 만든다. */
export function shrinkableTables(root) {
  const out = new Set();
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!/\.(mjs|ts|js)$/.test(e.name)) continue;
      let src = '';
      try { src = readFileSync(p, 'utf8'); } catch { continue; }
      for (const m of src.matchAll(/DELETE\s+FROM\s+`?([a-zA-Z_][\w]*)`?/g)) out.add(m[1]);
    }
  };
  walk(resolve(root, 'scripts'));
  walk(resolve(root, 'src'));
  return out;
}

/** 순수 비교: 백업보다 줄어든 테이블. 감소 허용 테이블은 뺀다. */
export function findRegressions(live, backup, shrinkable) {
  const out = [];
  for (const [table, b] of Object.entries(backup ?? {})) {
    // 2026-08-27: SQLite FTS 그림자 테이블은 회귀 대상이 아니다.
    //   실측: news_archive_fts_data 783<789 · _fts_idx 769<775 로 줄어 회귀로 잡혔는데,
    //   FTS 내부 세그먼트 병합 결과지 데이터 유실이 아니다(본체 news_archive 는 그대로).
    //   audit-coverage 도 같은 패턴을 스캔에서 제외한다 — 두 곳이 같은 규칙을 쓴다.
    if (/_fts(_data|_idx|_docs|_content|_config)?$/.test(String(table))) continue;
    if (shrinkable?.has(table)) continue;
    const l = live?.[table];
    if (typeof l !== 'number' || typeof b !== 'number') continue;
    if (l < b) out.push({ table, live: l, backup: b, lost: b - l });
  }
  return out.sort((a, b) => b.lost - a.lost);
}

function rowCounts(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    const counts = {};
    for (const t of tables) { try { counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { /* 뷰/가상테이블 */ } }
    return counts;
  } finally { db.close(); }
}

/** 최신 로컬 백업 경로. 없으면 null. */
export function newestBackup() {
  const dir = LOCAL_BACKUP_DIR();
  if (!existsSync(dir)) return null;
  let files = [];
  try { files = readdirSync(dir).filter((f) => DB_RE.test(f)).sort(); } catch { return null; }
  return files.length ? join(dir, files[files.length - 1]) : null;
}

/**
 * @returns {{quickCheck:string, ms:number, liveBytes:number|null, backupPath:string|null,
 *            backupBytes:number|null, regressions:{table:string,live:number,backup:number,lost:number}[],
 *            note:string|null}}
 */
export async function dbHealth(root) {
  const t0 = Date.now();
  const livePath = resolve(root, 'data/flowvium.db');
  let quickCheck = 'unreadable';
  let live = {};
  try {
    const db = new Database(livePath, { readonly: true, fileMustExist: true });
    quickCheck = String(db.prepare('PRAGMA quick_check').get()?.quick_check ?? 'unknown');
    db.close();
    live = rowCounts(livePath);
  } catch (e) {
    return { quickCheck: `열기실패(${String(e.message).slice(0, 40)})`, ms: Date.now() - t0,
             liveBytes: null, backupPath: null, backupBytes: null, regressions: [], note: null };
  }

  const backupPath = newestBackup();
  if (!backupPath) {
    return { quickCheck, ms: Date.now() - t0, liveBytes: statSync(livePath).size,
             backupPath: null, backupBytes: null, regressions: [],
             note: '대조할 로컬 백업이 없어 회귀 판정 불가' };
  }
  let backup = {};
  try { backup = rowCounts(backupPath); }
  catch (e) {
    return { quickCheck, ms: Date.now() - t0, liveBytes: statSync(livePath).size,
             backupPath, backupBytes: null, regressions: [],
             note: `백업 판독 실패(${String(e.message).slice(0, 40)}) — 회귀 판정 불가` };
  }

  return {
    quickCheck, ms: Date.now() - t0,
    liveBytes: statSync(livePath).size,
    backupPath, backupBytes: statSync(backupPath).size,
    regressions: findRegressions(live, backup, shrinkableTables(root)),
    note: null,
  };
}

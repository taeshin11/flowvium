#!/usr/bin/env node
/**
 * reap-zombies.mjs — 주인 없는 자동화 브라우저·드라이버를 거둔다.
 *
 * 왜 필요한가 (2026-09-03, 사용자 "좀비 프로세스 … 끄고. 컴퓨터 다운되지 않게 조치하고"):
 *   youtube-studio.mjs / flow-clip.mjs 가 띄우는 크롬은 스크립트가 끝나도 살아남는다.
 *   실측: .pni-chrome-yt 가 46분째 프로세스 9개 · 0.88GB 를 물고 있었고 붙어 있는 클라이언트는 0.
 *   48GB 기계인데 여유 메모리가 0.19GB 까지 떨어져 스왑을 2GB 쓰고 있었다.
 *
 * 판정 기준은 "오래됐다" 가 아니라 **아무도 안 쓰고 있다** 이다:
 *   자동화 크롬은 --remote-debugging-port 로 조종당한다. 그 포트에 ESTABLISHED 연결이 없으면
 *   조종하는 쪽이 없다는 뜻이다. 나이만 보고 죽이면 오래 걸리는 작업을 중간에 끊는다.
 *   유예(--min-age)를 함께 두는 이유: 막 띄우고 아직 붙기 전인 순간을 죽이지 않기 위해서다.
 *
 * **다른 세션의 브라우저는 건드리지 않는다.** 같은 기계에서 다른 작업이 돌 수 있다
 *   (실측: ~/history 의 별도 세션이 flow.google.com 을 조종 중이었다).
 *   접속자가 있으면 그게 누구든 그대로 둔다.
 *
 * 사용:
 *   node scripts/reap-zombies.mjs              # 미리보기
 *   node scripts/reap-zombies.mjs --confirm    # 실제 종료
 */
import { execFileSync } from 'child_process';

const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const CONFIRM = a.includes('--confirm');
const MIN_AGE_S = Number(arg('--min-age', 300));   // 5분. 이보다 어린 것은 건드리지 않는다.

const sh = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
};

/** etime(예: "03-01:18:28", "46:37", "01:29")을 초로. */
export function etimeToSeconds(s) {
  const t = String(s ?? '').trim();
  const m = t.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  const [, d, h, mi, sec] = m;
  return (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(mi) * 60) + Number(sec);
}

/** 포트에 ESTABLISHED 연결이 몇 개인가. lsof 가 없으면 -1(모름)을 준다 — 모르면 죽이지 않는다. */
function establishedOn(port) {
  const out = sh('lsof', ['-nP', `-iTCP:${port}`]);
  if (!out) return -1;
  return out.split('\n').filter((l) => l.includes('ESTABLISHED')).length;
}

// import 만 해도 프로세스를 죽이면 안 된다(테스트가 이 모듈을 불러온다).
//   직접 실행했을 때만 돈다.
function main() {
  const psOut = sh('/bin/ps', ['-Ao', 'pid,ppid,etime,rss,args']);
  const rows = psOut.split('\n').slice(1).map((l) => {
    const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    return m ? { pid: +m[1], ppid: +m[2], age: etimeToSeconds(m[3]), rss: +m[4], args: m[5] } : null;
  }).filter(Boolean);

  const targets = [];

  // ── 자동화 크롬: --user-data-dir 이 .pni-chrome-* 인 최상위 인스턴스 ────────────
  for (const r of rows) {
    const m = r.args.match(/--user-data-dir=(\S*\.pni-chrome-[\w-]+)/);
    if (!m || !/Google Chrome\.app\/Contents\/MacOS\/Google Chrome/.test(r.args)) continue;
    const port = (r.args.match(/--remote-debugging-port=(\d+)/) || [])[1];
    const kids = rows.filter((x) => x.ppid === r.pid);
    const mem = ([r, ...kids].reduce((s, x) => s + x.rss, 0) / 1048576);
    const est = port ? establishedOn(port) : -1;

    let verdict;
    if (r.age < MIN_AGE_S) verdict = `유예 (${r.age}s < ${MIN_AGE_S}s)`;
    else if (est < 0) verdict = '판정 불가 — lsof 없음, 그대로 둔다';
    else if (est > 0) verdict = `사용 중 (접속 ${est}) — 다른 작업일 수 있다, 그대로 둔다`;
    else verdict = 'KILL';

    targets.push({ kind: '자동화 크롬', label: m[1].split('/').pop(), pid: r.pid, kids: kids.map((k) => k.pid), mem, age: r.age, verdict });
  }

  // ── 부모 잃은 playwright 드라이버 (ppid=1) ──────────────────────────────────────
  for (const r of rows) {
    if (!/playwright\/driver\/(node|package)/.test(r.args)) continue;
    const verdict = r.ppid !== 1 ? '부모 있음 — 그대로 둔다'
      : r.age < MIN_AGE_S ? `유예 (${r.age}s)` : 'KILL';
    targets.push({ kind: 'playwright 드라이버', label: `pid ${r.pid}`, pid: r.pid, kids: [], mem: r.rss / 1048576, age: r.age, verdict });
  }

  if (!targets.length) { console.log('거둘 것 없음 ✓'); process.exit(0); }

  let freed = 0;
  console.log(CONFIRM ? '수거 실행' : '미리보기 (실제로 끄려면 --confirm)');
  for (const t of targets) {
    const mark = t.verdict === 'KILL' ? (CONFIRM ? '✂' : '·') : ' ';
    console.log(`  ${mark} ${t.kind} ${t.label} · ${t.mem.toFixed(2)}GB · ${Math.round(t.age / 60)}분 → ${t.verdict}`);
    if (t.verdict !== 'KILL' || !CONFIRM) continue;
    const pids = [t.pid, ...t.kids].map(String);
    sh('kill', ['-TERM', ...pids]);
    execFileSync('sleep', ['3']);
    sh('kill', ['-9', ...pids]);
    freed += t.mem;
  }
  if (CONFIRM) console.log(`\n✅ 약 ${freed.toFixed(2)}GB 회수`);

}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();

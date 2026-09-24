#!/usr/bin/env node
/**
 * check-report-gate.mjs — 회원 잠금이 **정책대로** 걸리는가. 서버 응답을 직접 본다. (2026-09-24 신설)
 *
 * 정책(2026-09-24 사장님 "아침 다시 무료로 풀어"):
 *   · 아침(morning) 보고서는 **누구나** 전부 본다.
 *   · 나머지 회차는 비회원에게 portfolio 등이 **서버에서** 빠진다(화면에서 가리는 게 아니라).
 *   · 회원(또는 내부 호출)은 언제나 전부 본다.
 *
 * 왜 서버 응답을 보나: 9/18 에 "잠금이 겉모습뿐이었다 — 서버에서 막는다" 로 고쳤는데,
 *   과거 회차를 부르는 /history 라우트는 **잠금이 아예 없었다.** 화면은 가입 안내를 띄웠지만
 *   데이터는 전부 내려갔다 — 개발자 도구만 열면 전 회차 포트폴리오가 보였다.
 *   화면만 보는 검사로는 이걸 못 잡는다. 그래서 응답 본문을 본다.
 */
const BASE = process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

try { const r = await fetch(`${BASE}/api/investment-strategy/history`, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(r.status); }
catch (e) { console.log(`  SKIP  ${BASE} 에 서버가 없다 — 돌아가는 서버에서만 뜻이 있다`); process.exit(0); }

const items = (await (await fetch(`${BASE}/api/investment-strategy/history`)).json()).items ?? [];
const pick = (s) => items.find((x) => x.session === s);
const bySession = ['morning', 'noon', 'evening'].map((s) => [s, pick(s)]).filter(([, x]) => x);
if (!bySession.length) { console.log('  SKIP  과거 회차 목록이 비었다'); process.exit(0); }

const hasPaid = (rep) => Array.isArray(rep?.portfolio) && rep.portfolio.length > 0;

for (const [s, it] of bySession) {
  const j = await (await fetch(`${BASE}/api/investment-strategy/history?key=${encodeURIComponent(it.key)}`, { cache: 'no-store' })).json();
  const rep = j.report;
  if (!rep) { console.log(`  SKIP  ${s} 본문 만료`); continue; }
  if (s === 'morning') {
    hasPaid(rep) && !rep.gated
      ? ok(`[history] 아침은 비회원도 전부 본다 (portfolio ${rep.portfolio.length})`)
      : bad(`[history] 아침인데 비회원에게 잠겼다 (portfolio ${rep.portfolio?.length ?? '없음'} · gated ${rep.gated})`);
  } else {
    !hasPaid(rep) && rep.gated === true
      ? ok(`[history] ${s} 는 비회원에게 잠긴다 (gated)`)
      : bad(`[history] ${s} 가 비회원에게 **새고 있다** (portfolio ${rep.portfolio?.length ?? 0}건 내려감 · gated ${rep.gated})`);
  }
}

// 최신 회차(메인 라우트)도 같은 정책을 따르는가
{
  const j = await (await fetch(`${BASE}/api/investment-strategy?locale=ko`, { cache: 'no-store' })).json();
  const s = j.session;
  if (s === 'morning') {
    hasPaid(j) && !j.gated ? ok(`[main] 최신이 아침 — 비회원도 전부 본다`) : bad(`[main] 최신이 아침인데 잠겼다`);
  } else {
    !hasPaid(j) && j.gated === true ? ok(`[main] 최신 ${s} 는 비회원에게 잠긴다`) : bad(`[main] 최신 ${s} 가 비회원에게 새고 있다`);
  }
}

console.log(fail ? `\n❌ ${fail}건 — 잠금 정책과 서버 응답이 다르다` : '\n✅ 잠금 정책대로');
process.exit(fail ? 1 : 0);

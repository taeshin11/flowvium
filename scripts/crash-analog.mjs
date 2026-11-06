#!/usr/bin/env node
/**
 * crash-analog.mjs — 급락장 전향 기록(data/crash-study-2026-11.json)의 예측 확률을 다시 계산한다. 2026-11-07 신설.
 *
 * 왜(사장님 11/07 "이번 급락장 기반으로 전향적연구 해"): KOSPI 가 10/28 6,012 → 11/06 5,059.69(-15.8%, 7거래일, 마지막 이틀 -5.28%·-6.02%).
 *   과거 같은 상태 뒤에 무엇이 일어났는지로 확률을 **개장 전에** 고정해 두고, 결과가 나오면 채점한다.
 * 조건: 종가가 직전 20거래일(당일 포함) 최고 종가 대비 -15% 이하. 현재 에피소드(--exclude-from 부터)는 뺀다.
 * 예측 셋을 같이 적는다 — 어느 쪽이 맞는지가 연구다:
 *   allDays  조건 맞은 모든 날(우리는 에피소드 한가운데라 이쪽이 가깝다. 날끼리 겹쳐 실효 표본은 사건 수에 가깝다)
 *   firstDay 사건 첫날만(20거래일 안 재발은 같은 사건) — 첫날 기준은 반등을 크게 본다(KOSPI 20일↑ 71% vs 모든 날 52%)
 *   clim     1997~ 아무 날
 *
 *   node scripts/crash-analog.mjs --index KS11 --base 2026-11-06:5059.69 [--exclude-from 2026-10-14]
 * 가격: 야후 일봉(1997~). 야후에 아직 없는 마지막 날은 --base 로 넣는다(네이버 종가).
 */
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const index = arg('--index', 'KS11');
const [baseDate, baseClose] = arg('--base', '').split(':');
const excludeFrom = arg('--exclude-from', '2026-10-14');
const DROP = -0.15, LOOK = 20, FURTHER = -0.10;

const p2 = Math.floor(Date.parse(`${baseDate || new Date().toISOString().slice(0, 10)}T23:59:59Z`) / 1000) + 86400;
const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5E${index}?period1=852076800&period2=${p2}&interval=1d`;
const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) { console.error(`가격을 못 받았다: ${res.status} ${res.headers.get('content-type')}`); process.exit(1); }
const r = (await res.json()).chart?.result?.[0];
const q = r?.indicators?.quote?.[0] ?? {};
const b = (r?.timestamp ?? []).map((s, i) => ({ d: new Date(s * 1000 + 9 * 3600e3).toISOString().slice(0, 10), c: q.close?.[i] })).filter((x) => x.c > 0);
if (baseDate && b.at(-1).d < baseDate) b.push({ d: baseDate, c: Number(baseClose) });
const L = b.length - 1;

const hit = (i) => b[i].c / Math.max(...b.slice(Math.max(0, i - LOOK + 1), i + 1).map((x) => x.c)) - 1 <= DROP;
const allDays = [], firstDay = [];
let last = -999;
for (let i = LOOK; i < L; i++) {
  if (!hit(i)) continue;
  if (b[i].d < excludeFrom) { allDays.push(i); if (i - last > LOOK) firstDay.push(i); }
  last = i;
}
const clim = []; for (let i = 0; i < L; i++) clim.push(i);
const up = (ev, h) => { const e = ev.filter((i) => i + h <= L); return [e.filter((i) => b[i + h].c > b[i].c).length, e.length]; };
const further = (ev) => { const e = ev.filter((i) => i + 60 <= L); return [e.filter((i) => Math.min(...b.slice(i + 1, i + 61).map((x) => x.c)) / b[i].c - 1 <= FURTHER).length, e.length]; };
const fmt = ([a, n]) => `${(a / n).toFixed(3)} (${a}/${n})`;

console.log(`^${index} ${b[0].d}~${b[L].d} · 기준 ${b[L].d} ${b[L].c} · 지금 조건 해당 ${hit(L)} · 제외 ${excludeFrom}~`);
for (const [name, ev] of [['allDays', allDays], ['firstDay', firstDay], ['clim', clim]]) {
  console.log(`${name.padEnd(8)} n=${ev.length}  5일↑ ${fmt(up(ev, 5))}  20일↑ ${fmt(up(ev, 20))}  60일 안 -10% 더 ${fmt(further(ev))}`);
}

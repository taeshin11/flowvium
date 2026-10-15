/**
 * forecast-ledger.mjs — 전향적 예측 장부의 계산(순수 함수). 근거·규칙은 forecast-ledger.test.mjs 머리말.
 * 기록은 scripts/forecast-record.mjs, 채점·집계는 scripts/forecast-score.mjs.
 */

/** 전날 밤 SOX 등락 칸. 경계는 'x ≤ 경계' 쪽에 넣는다. */
export function bucketOf(x) {
  if (x == null || !Number.isFinite(x)) return null;
  if (x <= -0.04) return 'le-4';
  if (x <= -0.02) return '-4to-2';
  if (x <= 0) return '-2to0';
  if (x <= 0.02) return '0to2';
  return 'gt2';
}

/**
 * 과거 [{x: 전날 밤 SOX 등락, y: 다음 날 지수 등락}] 에서 x 가 속한 칸의 하락·-2% 이하 비율.
 * 칸 표본이 minN 미만이거나 x 가 없으면 전체(기후값)를 쓴다 — bucket 'all'.
 */
export function condProb(pairs, x, { minN = 30 } = {}) {
  const all = (pairs ?? []).filter((p) => Number.isFinite(p?.y));
  const b = bucketOf(x);
  const inB = b ? all.filter((p) => bucketOf(p.x) === b) : [];
  const use = inB.length >= minN ? inB : all;
  const n = use.length;
  return {
    bucket: inB.length >= minN ? b : 'all',
    n,
    pDown: n ? use.filter((p) => p.y < 0).length / n : null,
    pBigDown: n ? use.filter((p) => p.y <= -0.02).length / n : null,
  };
}

const STANCE_DIR = { bullish: 'up', bearish: 'down' };

/** 보고서의 시장별 방향. 지역 판단(regionStances) 을 방향으로 채점하고, 판정(verdict)은 함께 남긴다. */
export function reportCall(report, market) {
  const region = market === 'kr' ? 'korea' : 'us';
  const stance = report?.regionStances?.[region]?.stance ?? null;
  const v = market === 'kr' ? report?.marketVerdict?.krVerdict : report?.marketVerdict;
  // 판정 근거 글에 적힌 유사국면 3개월 상승확률(보고서가 숫자 필드로 따로 내지 않는다).
  const m = (v?.reasons ?? []).map((r) => /유사국면[^]*?상승확률\s*(\d+(?:\.\d+)?)%/.exec(String(r))).find(Boolean);
  return {
    dir: STANCE_DIR[stance] ?? null, stance, verdict: v?.verdict ?? null,
    warnScore: report?.earlyWarning?.score ?? null, warnLevel: report?.earlyWarning?.level ?? null,
    analogUp3m: m ? Number(m[1]) / 100 : null,
  };
}

/** 장이 선 날 중 기록이 없는 날. 급락일에 회차가 접혀 빠진 날을 조용히 지우지 않게. */
export function coverage({ sessions, recorded }) {
  const rec = new Set(recorded ?? []);
  const missing = (sessions ?? []).filter((d) => !rec.has(d));
  return { sessions: (sessions ?? []).length, recorded: (sessions ?? []).length - missing.length, missing };
}

/** 실제 등락 ret 로 채점. 방향 예측은 hit, 확률 예측(pDown)은 Brier. 기록 줄은 건드리지 않고 새 객체를 돌려준다. */
export function scoreRecord(rec, ret) {
  const down = ret < 0 ? 1 : 0;
  const forecasts = {};
  for (const [name, f] of Object.entries(rec?.forecasts ?? {})) {
    if (f && 'dir' in f) forecasts[name] = { hit: f.dir == null ? null : (f.dir === 'down') === (down === 1) };
    if (f && Number.isFinite(f.pDown)) forecasts[name] = { ...(forecasts[name] ?? {}), p: f.pDown, brier: (f.pDown - down) ** 2 };
  }
  return { ret, down, forecasts };
}

const binOf = (p) => { const lo = Math.min(9, Math.floor(p * 10)); return `${(lo / 10).toFixed(1)}-${((lo + 1) / 10).toFixed(1)}`; };

/** 시장별 집계: 방향 적중률(기권 제외)·확률 예측 Brier·기후값 대비 skill·보정표. 채점 안 된 줄은 뺀다. */
export function aggregate(records) {
  const out = {};
  const by = new Map();
  for (const r of records ?? []) if (r?.scored) (by.get(r.market) ?? by.set(r.market, []).get(r.market)).push(r);
  for (const [market, rs] of by) {
    const m = { n: rs.length };
    const names = new Set(rs.flatMap((r) => Object.keys(r.scored.forecasts ?? {})));
    for (const name of names) {
      const fs = rs.map((r) => ({ f: r.scored.forecasts?.[name], down: r.scored.ret < 0 ? 1 : 0 })).filter((x) => x.f);
      const a = {};
      const calls = fs.filter((x) => x.f.hit === true || x.f.hit === false);
      if (fs.some((x) => 'hit' in x.f)) {
        a.calls = calls.length; a.hits = calls.filter((x) => x.f.hit).length;
        a.abstain = fs.filter((x) => x.f.hit === null).length;
        a.hitRate = calls.length ? a.hits / calls.length : null;
      }
      const ps = fs.filter((x) => Number.isFinite(x.f.brier));
      if (ps.length) {
        a.brier = ps.reduce((s, x) => s + x.f.brier, 0) / ps.length;
        const bins = new Map();
        for (const x of ps) { const k = binOf(x.f.p); const o = bins.get(k) ?? bins.set(k, { bin: k, n: 0, sumP: 0, downs: 0 }).get(k); o.n++; o.sumP += x.f.p; o.downs += x.down; }
        a.calibration = [...bins.values()].sort((u, v) => u.bin.localeCompare(v.bin)).map((o) => ({ bin: o.bin, n: o.n, meanP: o.sumP / o.n, observed: o.downs / o.n }));
      }
      m[name] = a;
    }
    const clim = m.clim?.brier;
    for (const name of names) if (m[name].brier != null && clim) m[name].skill = 1 - m[name].brier / clim;
    out[market] = m;
  }
  return out;
}

/** 크게 움직인 날 무엇과 함께 왔나. 아는 신호가 없으면 '미분류' — 뉴스로 사람이 붙인다. */
export function missType({ ret, sox, fx, vix } = {}) {
  const t = [];
  if (Number.isFinite(sox) && Math.abs(sox) >= 0.04 && Math.sign(sox) === Math.sign(ret)) t.push(sox < 0 ? '반도체 야간 충격' : '반도체 야간 급등');
  if (Number.isFinite(fx) && Math.abs(fx) >= 0.02) t.push('환율 급변');
  if (Number.isFinite(vix) && vix >= 0.2) t.push('변동성 급등');
  return t.length ? t : ['미분류'];
}

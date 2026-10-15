/**
 * kr-verdict.mjs — KR 결정론 판정과 '전날 밤 반도체 충격' 거부권. 근거·규칙은 kr-verdict.test.mjs 머리말.
 * computeKrVerdict 는 generate-report-local 에서 옮겨 왔다(2026-10-15, 시험할 수 있게) — 거부권 외 규칙은 그대로.
 */
import { condProb } from './forecast-ledger.mjs';

/**
 * 마지막 SOX 장이 아직 KR 에 반영 안 된 밤이면, 그 칸의 과거 다음 날 KOSPI -2% 이하 비율과 평소 비율.
 * @param {{d:string,c:number}[]} sox  ^SOX 일봉(날짜 오름차순)
 * @param {{d:string,c:number}[]} kospi ^KS11 일봉
 * @returns {null | {sox:number, soxDate:string, bucket:string, n:number, pBigDown:number, base:number, z:number, elevated:boolean}}
 */
export function overnightTailRisk(sox, kospi, { minN = 30, z = 1.645 } = {}) {
  if (!(sox?.length > 2) || !(kospi?.length > 2)) return null;
  const lastS = sox.at(-1), prevS = sox.at(-2), lastK = kospi.at(-1);
  // 같은 날짜면 미국 장이 한국 장 뒤다 → 아직 반영 안 된 밤. 한국 봉이 더 뒤면 이미 반영됐다.
  if (lastS.d < lastK.d) return null;
  const sr = sox.slice(1).map((b, i) => ({ d: b.d, r: b.c / sox[i].c - 1 }));
  const pairs = [];
  let j = 0;
  for (let i = 1; i < kospi.length; i++) {
    const d = kospi[i].d;
    while (j + 1 < sr.length && sr[j + 1].d < d) j++;
    if (sr[j].d < d) pairs.push({ x: sr[j].r, y: kospi[i].c / kospi[i - 1].c - 1 });
  }
  const x = lastS.c / prevS.c - 1;
  const cp = condProb(pairs, x, { minN });
  const base = condProb(pairs, null).pBigDown;
  if (cp.bucket === 'all' || base == null || !(base > 0 && base < 1)) return { sox: x, soxDate: lastS.d, bucket: cp.bucket, n: cp.n, pBigDown: cp.pBigDown, base, z: 0, elevated: false };
  const zz = (cp.pBigDown * cp.n - cp.n * base) / Math.sqrt(cp.n * base * (1 - base));
  return { sox: x, soxDate: lastS.d, bucket: cp.bucket, n: cp.n, pBigDown: cp.pBigDown, base, z: zz, elevated: zz > z };
}

export function computeKrVerdict(k, earlyWarning) {
  if (!k) return null;
  const reasons = [];
  let verdict;
  if (earlyWarning.level === 'severe') { verdict = 'defensive'; reasons.push('글로벌 하락 전조 심각 — KR 포함 방어적 포지션'); }
  else if (earlyWarning.level === 'high') { verdict = 'wait'; reasons.push('글로벌 경보 고조 — KR 신규 진입 보류'); }
  else if (k.r20 >= 12) { verdict = 'neutral'; reasons.push(`KR 단기 과열(20일 +${k.r20}%) — 분할·보수적, 추격 자제`); }
  else if (k.dd <= -8 && earlyWarning.level === 'low') { verdict = 'accumulate'; reasons.push(`KR 낙폭 과대(고점대비 ${k.dd}%) + 경보 낮음 — 분할 매수 관찰`); }
  else if (k.analog?.matches >= 5 && k.analog.med3m >= 3 && k.analog.posRate3m >= 60 && k.above200) { verdict = 'neutral_ready'; reasons.push(`KR 유사국면 우호(3개월 +${k.analog.med3m}%, 상승확률 ${k.analog.posRate3m}%) + 200일선 위 — 조정 시 매수 준비`); }
  else if (k.analog?.matches >= 5 && k.analog.med3m <= -2) { verdict = 'wait'; reasons.push('KR 과거 유사국면 3개월 기대 음수 — 보수적 접근'); }
  else { verdict = 'neutral'; reasons.push('KR 뚜렷한 전조 없음 — 기존 포지션 유지'); }
  // 근거 디테일 (US 박스와 동일 깊이)
  reasons.push(`KOSPI 추세: 200일선 ${k.above200 ? '위' : '아래'}(${k.distPct > 0 ? '+' : ''}${k.distPct}%) · 고점대비 ${k.dd}% · 20일 ${k.r20 > 0 ? '+' : ''}${k.r20}%`);
  if (k.breadth?.divergencePp != null) {
    if (k.breadth.divergencePp >= 1.5) reasons.push(`KR 시장 폭 양호: KOSDAQ이 KOSPI 대비 20일 +${k.breadth.divergencePp}%p 우위 — 광범위 참여`);
    else if (k.breadth.divergencePp <= -1.5) reasons.push(`KR 시장 폭 취약: KOSDAQ이 KOSPI 대비 20일 ${k.breadth.divergencePp}%p 열위 — 대형주 편중`);
  }
  if (k.analog?.matches >= 5) reasons.push(`KR 과거 유사국면 ${k.analog.matches}회 — 현재 지문(KOSPI 고점대비 ${k.dd}%·20일 ${k.r20 > 0 ? '+' : ''}${k.r20}%)을 KOSPI 전 역사와 거리매칭한 가장 가까운 국면들: 3개월 후 중앙값 ${k.analog.med3m > 0 ? '+' : ''}${k.analog.med3m}% · 상승확률 ${k.analog.posRate3m}%`);
  if (k.seasonality) reasons.push(`KOSPI 계절성(${k.seasonality.month}월, ${k.seasonality.n}표본): 1개월 forward 중앙값 ${k.seasonality.med1m > 0 ? '+' : ''}${k.seasonality.med1m}%`);
  // 2026-10-15 사장님 결정 (b): 낙폭 과대 매수 관찰인데 같은 판정의 유사국면 3개월 상승확률이 50% 미만이면 'wait'.
  //   (a)(이 규칙 전) 판정은 verdictA 로 남겨 장부에서 (a) 대비 성적을 계속 비교한다(kr-verdict.test [8~10]).
  const analogVeto = verdict === 'accumulate' && k.analog?.matches >= 5 && k.analog.posRate3m < 50;
  if (analogVeto) reasons.unshift(`KR 과거 유사국면 ${k.analog.matches}회의 3개월 상승확률 ${k.analog.posRate3m}%(50% 미만) — 낙폭 과대여도 매수 관찰 보류`);
  // 2026-10-15: 전날 밤 반도체 충격 거부권 — 매수 쪽 판정만 'wait' 로 내린다(kr-verdict.test 머리말).
  const overnightVeto = (verdict === 'accumulate' || verdict === 'neutral_ready') && k.overnight?.elevated;
  if (overnightVeto) {
    const o = k.overnight;
    reasons.unshift(`전날 밤 SOX ${(o.sox * 100).toFixed(1)}% — 과거 같은 밤 ${o.n}일 중 다음 날 KOSPI -2% 이하 ${(o.pBigDown * 100).toFixed(0)}%(평소 ${(o.base * 100).toFixed(1)}%) — 매수 관찰 보류`);
  }
  if (!overnightVeto && !analogVeto) return { verdict, reasons };
  return { verdict: 'wait', vetoedFrom: verdict, ...(analogVeto ? { verdictA: overnightVeto ? 'wait' : verdict } : {}), reasons };
}

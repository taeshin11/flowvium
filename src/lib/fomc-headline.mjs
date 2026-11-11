// fomc-headline.mjs — 다음 FOMC 회의에서 가장 유력한 결과(인상·동결·인하)와 그 확률.
// 왜(11/11): 보고서 배지가 인하 확률만 보여 "Dec 10 0%" 로 찍혔다. 시장은 인상 100% 였고 본문도 그렇게 썼는데,
//   배지만 보면 본문과 반대로 읽혔다(agy 검수). 한쪽 방향만 보여주지 않고 셋 중 가장 큰 것을 보인다.
// 인하는 25·50·75bp 가 각각 따로라(fedwatch-calc at(-1)·at(-2)·cut75) 합쳐서 비교한다. 같으면 동결이 우선.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** @returns {{ label: string, kind: 'hike' | 'hold' | 'cut', prob: number } | null} */
export function fomcHeadline(m) {
  if (!m || typeof m.label !== 'string' || !m.label) return null;
  const hike = num(m.probHike);
  const hold = num(m.probHold);
  const cuts = [m.probCut25, m.probCut50, m.probCut75].map(num).filter((v) => v != null);
  const cut = cuts.length ? cuts.reduce((s, v) => s + v, 0) : null;
  if (hike == null && hold == null && cut == null) return null;
  const options = [['hold', hold], ['hike', hike], ['cut', cut]].filter(([, v]) => v != null);
  const [kind, prob] = options.reduce((best, o) => (o[1] > best[1] ? o : best));
  return { label: m.label, kind, prob: Math.round(prob) };
}

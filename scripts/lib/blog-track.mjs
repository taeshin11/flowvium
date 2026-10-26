/**
 * blog-track.mjs — 블로그 '지난 추천은 어땠나' 문단을 성적표(data/scorecard.json)에서. 근거는 blog-track.test.mjs 머리말.
 * @param {object|null} sc  scripts/scorecard.mjs 가 쓴 성적표
 * @returns {string|null}  성적표가 없거나 48시간 넘으면 null(문단을 뺀다)
 */
export function trackRecordParagraph(sc, { now = Date.now(), maxAgeH = 48, site = 'https://flowvium.net' } = {}) {
  if (!sc?.markets || !(Date.parse(sc.generatedAt) > now - maxAgeH * 3600e3)) return null;
  const pct = (v) => `${v > 0 ? '+' : ''}${v}%`;
  const vs = (v, idx) => (v == null ? '' : v === 0 ? `, ${idx}와 같았습니다` : `, ${idx}보다 ${Math.abs(v)}%p ${v > 0 ? '높았' : '낮았'}습니다`);
  const line = (m, label, idx) => { const s = sc.markets[m]; if (!s?.finished) return null;
    return `${label}은 결과가 나온 ${s.finished}건 중 돈을 번 추천이 ${s.profitShare}%, 한 건당 평균 ${pct(s.meanPct)}, 손절로 끝난 비율 ${s.stopShare}%였고${vs(s.vsIndexMedian, idx).replace(/^, /, ', 수익 순으로 가운데 값은 ')}.`; };
  const parts = [line('us', '미국 종목', 'S&P 500 '), line('kr', '한국 종목', '코스피')].filter(Boolean);
  if (!parts.length) return null;
  const cut = sc.gate?.kr?.reduce ? ' 한국 성적이 기준에 못 미쳐 지금은 한국 매수 추천 수를 절반으로 줄여 두었습니다.' : '';
  return `좋은 얘기만 적으면 읽을 값어치가 없으니 성적표도 같이 둡니다. 추천 뒤 14일 동안, 손절가·목표가에 실제로 닿았을 때만 세는 방식으로 매일 다시 계산합니다. ${parts.join(' ')}${cut} 종목별 기록은 ${site}/ko/track-record 에서 전부 볼 수 있습니다.`;
}

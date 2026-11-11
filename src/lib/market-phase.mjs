// market-phase.mjs — 지금 이 시각 한국장·미국장이 어떤 상태인가. 보고서 프롬프트의 '장 phase' 단일 경로.
// 왜(11/11): generate-report-local 의 getSessionFocus 가 회차 이름마다 장 상황을 상수로 박아 두었다(5/29, 회차 15:50 기준).
//   회차가 14:30·05:30·20:00·22:30 으로 옮겨지고 미국 서머타임이 끝나자 다섯 회차 중 넷이 틀렸다 —
//   14:35 보고서가 장중 숫자를 "당일 종가 확정"이라 썼다. 회차가 아니라 시각에서 계산한다.
// 거래소 휴일은 모른다(평일이면 연다고 본다). 휴일 장중 시각엔 "확정 종가 아님"으로 나와 보수 쪽으로 틀린다.
const KR = {
  pre: '개장 전 (전일 종가 기준)',
  open: '장중 (숫자는 확정 종가 아님)',
  closed: '마감 (당일 종가 확정)',
  weekend: '휴장 (직전 거래일 종가)',
};
const US = {
  pre: '개장 전 (전일 종가 기준)',
  premarket: '프리마켓 (정규장 개장 전, 전일 종가 기준)',
  open: '장중 (숫자는 확정 종가 아님)',
  closed: '마감 (당일 종가 확정)',
  weekend: '휴장 (직전 거래일 종가)',
};

// 그 시간대의 요일(0=일)과 하루 중 분. 미국 서머타임은 Intl 이 안다.
function local(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { dow, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

function phase(now, timeZone, steps, labels) {
  const { dow, min } = local(now, timeZone);
  if (dow === 0 || dow === 6) return { code: 'weekend', label: labels.weekend };
  let code = steps[0][1];
  for (const [start, c] of steps) if (min >= start) code = c;
  return { code, label: labels[code] };
}

/** @returns {{ kr: { code: string, label: string }, us: { code: string, label: string } }} */
export function marketPhases(now = new Date()) {
  return {
    // KRX 정규장 09:00~15:30 KST
    kr: phase(now, 'Asia/Seoul', [[0, 'pre'], [9 * 60, 'open'], [15 * 60 + 30, 'closed']], KR),
    // NYSE 정규장 09:30~16:00 ET, 프리마켓 04:00~
    us: phase(now, 'America/New_York', [[0, 'pre'], [4 * 60, 'premarket'], [9 * 60 + 30, 'open'], [16 * 60, 'closed']], US),
  };
}

// 지난 회차 탭 이름표. 11/11 눈검증: 회차별 상수 "오후 (아시아장 마감 후)" 가 14:35 회차(한국장 장중)에 붙어 있었다.
//   회차 이름은 두고, 괄호 안은 만든 시각의 주력 시장 상황(회차의 주력 = generate-report-local getSessionFocus.primary).
const SESSION_WORD = { morning: '오전', noon: '점심', afternoon: '오후', evening: '저녁', midnight: '밤' };
const SESSION_PRIMARY = { morning: 'us', noon: 'kr', afternoon: 'kr', evening: 'us', midnight: 'us' };
const MARKET_KO = { kr: '한국장', us: '미국장' };

/** @param {string} session @param {string} generatedAt ISO @returns {string} */
export function sessionTabLabel(session, generatedAt) {
  const word = SESSION_WORD[session];
  const at = new Date(generatedAt);
  if (!word || Number.isNaN(at.getTime())) return word ?? String(session);
  const m = SESSION_PRIMARY[session];
  return `${word} (${MARKET_KO[m]} ${marketPhases(at)[m].label.split(' (')[0]})`;
}

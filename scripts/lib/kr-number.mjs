/**
 * kr-number.mjs — 숫자를 소리 나는 대로 한글로. TTS 에 먹이기 전에 쓴다. (2026-09-14 신설)
 *
 * 왜 (사용자 "숏폼보니까 숫자읽을때 이상하게 읽네" · 실측 되들음):
 *     6800억 원   → "6% 영억 원"
 *     4억 3520만  → "사악 사모의 영만"
 *     12조 원     → "1위조 원"
 *     270.1%      → "2체려 1%"
 *     13% 급등    → "1,3% 급등"
 *     100억 달러  → "이천 영업 달러"
 *     2026년      → "2016년"        ← 연도가 바뀐다. 오독이 아니라 거짓이다.
 *   MeloTTS 의 한국어 g2p 가 여러 자리 숫자를 제대로 못 읽는다. 열 개 중 여덟이 깨졌다.
 *
 * 대본 프롬프트는 이미 "숫자는 한글로 풀어 쓴다(TTS 오독 방지)" 를 시키지만 4B 가 안 지킨다.
 *   이 저장소가 같은 자리에서 이미 적어 둔 원칙을 따른다 — **지시하되 코드가 보장한다.**
 *
 * 한국어 수사는 둘이다(한자어 일·이·삼 / 고유어 하나·둘·셋). 여기 나오는 말(조·억·만·년·
 *   퍼센트·달러·건·문)은 전부 한자어를 쓴다. 고유어가 필요한 자리(세 명, 두 시)는
 *   이 도메인에 거의 없고, 억지로 넣으면 틀릴 자리만 늘어난다 — 넣지 않는다.
 */

/** 숫자 바로 뒤에 와도 띄우지 않는 글자 — 수의 일부다. */
const UNIT_AFTER = new Set('십백천만억조경');

const DIGIT = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL_UNIT = ['', '십', '백', '천'];
const BIG_UNIT = ['', '만', '억', '조', '경'];

/** 네 자리 덩어리 하나를 읽는다. 1은 십·백·천 앞에서 떨어뜨린다(십이지 일십이가 아니다). */
function readGroup(n) {
  let out = '';
  for (let i = 3; i >= 0; i--) {
    const d = Math.floor(n / 10 ** i) % 10;
    if (!d) continue;
    out += (d === 1 && i > 0) ? SMALL_UNIT[i] : DIGIT[d] + SMALL_UNIT[i];
  }
  return out;
}

/** 정수를 한자어로. 0 은 '영'. */
export function readInteger(num) {
  const n = BigInt(String(num).replace(/[^0-9]/g, '') || '0');
  if (n === 0n) return '영';
  const groups = [];
  let rest = n;
  while (rest > 0n) { groups.push(Number(rest % 10000n)); rest /= 10000n; }
  let out = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    out += readGroup(groups[i]) + BIG_UNIT[i];
  }
  return liaisonSix(out);
}

/**
 * 받침 뒤의 '육' 을 '륙' 으로. **소리 때문이다.**
 *
 * 실측(2026-09-14, Melo + whisper 되들음):
 *     이십육 → "20View"   ·  십육 → "새벽"      ← 깨진다
 *     이십륙 → "26"       ·  심뉵 → "16"       ← 제대로 읽는다
 *   한국어에서 26 은 [이심뉵] 으로 소리 난다(ㄴ 첨가). Melo 의 g2p 가 '육' 표기에서는
 *   그 변동을 못 잡고 '륙' 표기에서는 잡는다. 화면에 나가는 글이 아니라 **소리용 표기**라
 *   여기서 바꿔 준다 — 자막에는 원래 숫자가 그대로 남는다.
 */
function liaisonSix(s) {
  return s.replace(/([십백천만억조])육/g, '$1륙');
}

/** 소수. 점 뒤는 자리마다 한 글자씩 읽는다 — 실제로 그렇게 말한다("삼 점 일사"). */
function readDecimal(intPart, fracPart) {
  const frac = [...fracPart].map((c) => DIGIT[Number(c)] ?? c).join('');
  return `${readInteger(intPart)} 점 ${frac}`;
}

/**
 * 문장 안의 숫자를 한글 읽기로 바꾼다. **소리용이다 — 화면 글자에는 쓰지 않는다.**
 *
 * 건드리지 않는 것:
 *   · 영문/숫자가 붙은 고유명사(K2, G7, AI2) — 이름이지 수가 아니다
 *   · 도메인·URL 안의 숫자
 */
export function speakNumbers(text) {
  let s = String(text ?? '');
  // 1) 자릿수 쉼표 제거 (1,167 → 1167). 뒤 세 자리가 숫자일 때만 — 나열 쉼표를 건드리지 않는다.
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');
  // 2) % 는 말로. 숫자 뒤에 붙은 것만.
  s = s.replace(/(\d)\s*%/g, '$1 퍼센트');
  // 3) 숫자를 읽는다. 앞뒤에 영문자가 붙은 것(K2·G7·MP3)은 건드리지 않는다.
  //    바꾼 자리 **바로 뒤**가 한글이면 한 칸 띄운다. "18문" → "십팔 문" —
  //    붙여 두면 [천무시팔문] 으로 뭉개진다(실측). 띄어쓰기는 여기서만 손댄다:
  //    이미 있던 글자를 훑어 띄우면 '천무'(무기 이름) 같은 말이 '천 무' 로 쪼개진다(실제로 그랬다).
  s = s.replace(/(^|[^A-Za-z0-9.])(\d+)(?:\.(\d+))?(?=([\s\S]?))/g, (m, pre, int, frac, next) => {
    const read = frac != null ? readDecimal(int, frac) : readInteger(int);
    // 단위(만·억·조·십·백·천)는 수의 일부다 — 띄우면 따로 읽는다("십이 조"). 붙여 둔다.
    const gap = (/[가-힣]/.test(next ?? '') && !UNIT_AFTER.has(next)) ? ' ' : '';
    return pre + read + gap;
  });
  return s.replace(/ {2,}/g, ' ');
}

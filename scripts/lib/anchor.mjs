/**
 * anchor.mjs — 화면 오른쪽 앵커 박스.
 *
 * 요청(2026-08-28): "오른쪽에 AI 아나운서가 나와서 말하도록 하자."
 *
 * ⚠ 립싱크는 지금 수단으로 안 된다. 우리 나레이션(ElevenLabs)에 입을 맞추려면
 *   talking-avatar 서비스(HeyGen·D-ID 등, 유료 API)가 필요하다. Veo 로 "말하는 사람" 을
 *   만들 수는 있지만 입이 우리 음성과 안 맞고, 어긋난 입은 보는 사람이 즉시 알아챈다.
 *   → 입이 안 보이는 앵커(측면·뒷모습·실루엣)를 쓰거나, 립싱크 서비스를 붙여야 한다.
 *   이 모듈은 **어느 쪽이든 들어갈 자리**를 만든다.
 *
 * 소스는 assets/anchor 에 사람이 넣는다. 없으면 박스 없이 종전 구성으로 간다 —
 *   조용히 빈 박스가 뜨는 것보다 낫다.
 */

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;

/**
 * 앵커 박스 기하.
 * 두 가지를 침범하면 안 된다: **하단 자막 밴드**(글자가 가려진다)와 **우상단 로고**.
 */
export function anchorBox(opts = {}) {
  const {
    width = 1920, height = 1080, bandTop = 866,
    topSafe = 150,          // 우상단 로고 아래
    margin = 56,            // 화면 오른쪽 여백
    gap = 24,               // 밴드와의 간격
  } = opts;
  const bottom = bandTop - gap;
  const h = bottom - topSafe;
  // 사람이 서 있는 화면이라 세로가 길어야 한다. 3:4 로 잡되 화면 폭의 30% 를 넘지 않는다.
  const w = Math.min(Math.round(h * 0.75), Math.round(width * 0.30));
  return { x: width - margin - w, y: topSafe, w, h: Math.round(w / 0.75) <= h ? Math.round(w / 0.75) : h };
}

/**
 * assets/anchor 에서 이 로케일에 쓸 파일.
 * `anchor-<locale>.mp4` 를 먼저 보고, 없으면 로케일 없는 `anchor.mp4` 를 쓴다.
 * **다른 로케일 전용 파일은 쓰지 않는다** — 영어 앵커가 한국어를 말하는 화면이 된다.
 */
export function anchorSource(files, locale) {
  const list = (files ?? []).filter((f) => VIDEO_EXT.test(f));
  // 성별이 파일명에 붙어도 같은 파일로 본다 — anchor-en-male.mp4 / anchor-en.mp4 둘 다.
  const exact = list.find((f) => new RegExp(`anchor[-_]${locale}([-_](male|female))?\\.`, 'i').test(f));
  if (exact) return exact;
  // 공용 폴백은 **성별 접미사만** 허용한다. [a-z]+ 로 열어 두면 anchor-en.mp4 가
  //   한국어 편의 '공용 파일' 로 잡혀 영어 앵커가 한국어를 말한다(방금 이 회귀를 냈다).
  const generic = list.find((f) => /^anchor([-_](male|female))?\.[a-z0-9]+$/i.test(f));
  return generic ?? null;
}

/**
 * 앵커 파일명이 밝히는 성별. `anchor-en-male.mp4` → 'male'.
 *
 * 실측 사고(2026-08-28): 내레이션은 남성(Mark)인데 화면의 앵커는 여성이었다.
 *   영상 전체가 그 상태로 유튜브에 올라갔고, 사람이 보고서야 알았다.
 *   앵커 클립은 목소리와 따로 만들어지므로 **어긋나도 아무 데서도 안 걸린다.**
 *   파일명에 적어 두고 렌더 때 목소리와 맞춰 본다 — 이름이 곧 계약이다.
 *
 * 안 적혀 있으면 null 이다. 모르는 것과 어긋난 것은 다르므로, 모르면 막지 않는다.
 */
export function anchorGender(file) {
  const m = /anchor[-_][a-z]{2}[-_](male|female)\.|anchor[-_](male|female)\./i.exec(String(file ?? ''));
  return m ? (m[1] ?? m[2]).toLowerCase() : null;
}

/**
 * 목소리 성별과 앵커 성별이 어긋나는가. 어느 한쪽을 모르면 판단하지 않는다(null).
 * @returns {string|null} 어긋나면 사람이 읽을 사유, 아니면 null
 */
export function genderMismatch(anchorFile, voiceGender) {
  const a = anchorGender(anchorFile);
  const v = String(voiceGender ?? '').toLowerCase();
  if (!a || (v !== 'male' && v !== 'female')) return null;
  if (a === v) return null;
  return `앵커(${a})와 목소리(${v})의 성별이 다르다 — ${anchorFile}.`
    + ' 앵커를 다시 생성하거나 목소리를 바꿀 것.'
    + ' 이대로 두면 남자 목소리에 여자 앵커가 나온다(2026-08-28 실제로 그렇게 나갔다).';
}

/**
 * 박스 테두리·그림자 HTML. 배경 영상 위에 얹히는 액자다.
 * 영상 자체는 ffmpeg 이 overlay 로 넣고, 이 그래픽은 그 위에 한 겹 더 올린다.
 */
export function anchorFrameCss(box, opts = {}) {
  const { radius = 10, accent = '#ff4d5e' } = opts;
  return `.anchor{position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;
  border-radius:${radius}px;box-shadow:0 18px 60px rgba(0,0,0,.65);
  border:3px solid rgba(255,255,255,.14);pointer-events:none}
.anchor:after{content:'';position:absolute;left:0;right:0;bottom:0;height:5px;
  background:linear-gradient(90deg,${accent},#c81e3a);border-radius:0 0 ${radius}px ${radius}px}`;
}

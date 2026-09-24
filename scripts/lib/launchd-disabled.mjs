/**
 * launchd-disabled.mjs — 운영자가 `launchctl disable` 한 잡인가. (2026-09-24 신설)
 *
 * 왜: disable 은 사람이 "이건 올리지 마라" 라고 남긴 표시다. 그런데 이 저장소의 복구 코드는
 *   `launchctl load -w` 로 그 표시를 **조용히 지우고** 28GB 모델을 올렸다. 오늘 그렇게
 *   네 번 떴고, 한 번은 영상 렌더와 겹쳐 맥이 멈췄다(10:47 → 11:00 강제 재부팅).
 *   복구가 운영자의 결정을 이기면 안 된다. 먼저 묻는다.
 *
 * @param {string} printDisabledOutput `launchctl print-disabled gui/<uid>` 의 출력
 * @param {string} label
 * @returns {true|false|null} null = 읽지 못함(모름). 모르면 올리지 않는 쪽으로 부르는 쪽이 판단한다.
 */
export function isLabelDisabled(printDisabledOutput, label) {
  const text = String(printDisabledOutput ?? '');
  if (!text.trim()) return null;
  // 라벨을 따옴표로 감싸 **정확히** 맞춘다 — "…-llm" 이 "…-llm-web" 의 앞부분이라 부분 일치는 틀린다.
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`"${esc}"\\s*=>\\s*(\\w+)`));
  if (!m) return false;              // 목록에 없으면 기본값(enabled)
  return /^(disabled|true)$/i.test(m[1]);
}

/** 실제 launchctl 을 불러 판정한다. 부르다 실패하면 null. */
export async function labelDisabledNow(label) {
  try {
    const { execFileSync } = await import('child_process');
    const out = execFileSync('/bin/launchctl', ['print-disabled', `gui/${process.getuid()}`],
      { encoding: 'utf8', timeout: 15_000 });
    return isLabelDisabled(out, label);
  } catch { return null; }
}

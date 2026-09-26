/**
 * slots.mjs — launchd StartCalendarInterval → ['HH:MM', …](시각순). 2026-09-27.
 * 편성표는 plist 한 곳에만 둔다 — 코드에 따로 적은 목록은 plist 를 바꿀 때 어긋난다(백필이 옛 8슬롯으로 셌다).
 */
export function slotsFromCalendar(cal) {
  const list = Array.isArray(cal) ? cal : cal ? [cal] : [];
  return list.map((x) => `${String(x.Hour ?? 0).padStart(2, '0')}:${String(x.Minute ?? 0).padStart(2, '0')}`).sort();
}

/**
 * cron-slot.mjs — "몇 시간 지났나" 가 아니라 **"그 슬롯이 지났는데 안 돌았나"** 를 본다. (2026-09-20 신설)
 *
 * 왜 (2026-09-20 실측):
 *   blog-post 가 예정 시각(22:10 UTC = 07:10 KST)에 불린 기록이 **한 번도 없다.**
 *   유일한 실행은 30시간이 지나 staleness self-heal 이 끌어낸 것이었다. shorts-health 도 같다
 *   (완료 9회 · 그중 소급 20회). 반면 20분마다 도는 잡은 멀쩡하다(harvest-log-defects 1215회).
 *
 *   원인은 node-cron 이 단일 프로세스라 이벤트 루프가 막히면 틱을 흘리는 것이다 —
 *   로그에 "missed execution" 이 **1,055건** 쌓여 있다(cron-runner 주석이 2026-09-12 에
 *   827건으로 이미 적어 둔 문제가 더 나빠졌다). 하루 72번 도는 잡은 몇 번 흘려도 티가 안 나지만
 *   하루 한 번짜리는 그 한 번이 전부다.
 *
 *   그물은 있었다 — maxAgeH 가 넘으면 self-heal 이 끌어온다. 그런데 blog-post 의 maxAgeH 는
 *   30시간이라 **아침 07:10 글이 다음 날 오후에 나온다.** 그물이 너무 성겼다.
 *
 * 그래서 슬롯 기준으로 본다. 07:10 을 흘려도 다음 모니터 사이클(20분)에 잡힌다.
 *
 * 모르는 스케줄 형태는 **추측하지 않고 null** 을 돌려준다 — 부르는 쪽이 옛 방식(maxAgeH)으로
 *   떨어진다. 크론 표현식을 반쯤 아는 파서가 제멋대로 판단하는 것보다 낫다.
 */

/** 크론 필드 하나를 숫자 배열로. 지원하지 않는 형태면 null. */
export function parseField(f, min, max) {
  const s = String(f ?? '').trim();
  if (!s) return null;
  if (s === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const out = new Set();
  for (const part of s.split(',')) {
    let m;
    if ((m = part.match(/^\*\/(\d+)$/))) {
      const step = Number(m[1]);
      if (!step) return null;
      for (let v = min; v <= max; v += step) out.add(v);
    } else if ((m = part.match(/^(\d+)-(\d+)$/))) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (a < min || b > max || a > b) return null;
      for (let v = a; v <= b; v++) out.add(v);
    } else if (/^\d+$/.test(part)) {
      const v = Number(part);
      if (v < min || v > max) return null;
      out.add(v);
    } else return null;
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * `now`(ms, UTC) 이전의 **가장 최근 예정 시각**(ms). 읽을 수 없는 형태면 null.
 * 일/월 지정(`* * 1 * *` 같은)은 지원하지 않는다 — 이 저장소가 쓰지 않고, 반쯤 아는 채로
 *   다루면 틀린 시각을 자신 있게 내놓는다.
 */
export function lastSlotBefore(expr, now) {
  const f = String(expr ?? '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dom, mon, dow] = f;
  if (dom !== '*' || mon !== '*') return null;
  const minutes = parseField(mi, 0, 59);
  const hours = parseField(ho, 0, 23);
  const dows = parseField(dow, 0, 6);
  if (!minutes || !hours || !dows) return null;
  const dowSet = new Set(dows.map((d) => d % 7));   // 7 도 일요일로 쓰는 표기가 있다

  // 최근 8일만 본다. 주 1회 잡도 이 안에 반드시 슬롯이 하나 있다.
  let best = null;
  const base = new Date(now);
  for (let back = 0; back <= 8; back++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - back));
    if (!dowSet.has(d.getUTCDay())) continue;
    for (const h of hours) {
      for (const m of minutes) {
        const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m);
        if (t <= now && (best === null || t > best)) best = t;
      }
    }
    if (best !== null && back > 0) break;   // 더 과거로 갈 이유가 없다
  }
  return best;
}

/**
 * 그 잡이 밀렸는가.
 * @param {{schedules:string[], lastRunAt:number, now?:number, graceMin?:number}} o
 * @returns {{overdue:boolean|null, lateMin:number, slot:number|null}}
 *   overdue === null 이면 **판단하지 않았다**(스케줄을 못 읽음). 부르는 쪽이 옛 방식으로 갈 것.
 */
export function isOverdue({ schedules, lastRunAt, now = Date.now(), graceMin = 25 }) {
  let slot = null;
  for (const s of schedules ?? []) {
    const t = lastSlotBefore(s, now);
    if (t !== null && (slot === null || t > slot)) slot = t;
  }
  if (slot === null) return { overdue: null, lateMin: 0, slot: null };
  const lateMin = (now - slot) / 60000;
  // 슬롯 직후 몇 분은 봐준다 — 잡이 지금 도는 중일 수 있고, 그 사이에 또 부르면 두 번 돈다.
  if (lateMin < graceMin) return { overdue: false, lateMin, slot };
  return { overdue: (lastRunAt ?? 0) < slot, lateMin, slot };
}

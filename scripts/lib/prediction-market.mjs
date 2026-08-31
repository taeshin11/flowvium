/**
 * prediction-market.mjs — 예측시장에서 "지금 눈여겨볼 것" 을 뽑는다.
 *
 * 왜 벤더를 갈아끼울 수 있게 짰나 (2026-08-31 실측):
 *   폴리마켓 자체 API 는 한국에서 HTTP 451 이다. 2026-08-18 방송통신심의위원회가 형법(도박)·
 *   국민체육진흥법 위반으로 ISP 접속차단을 지시했고, 폴리마켓도 자체 지역차단을 건다.
 *     gamma-api / clob / data-api / polymarket.com  → 451
 *     docs.polymarket.com                            → 200 (문서만 열림)
 *   우회(VPN·프록시·DNS 조작)는 하지 않는다. 정부 차단 명령을 상용 파이프라인이 조직적으로
 *   뚫는 설비가 되기 때문이다.
 *
 *   온체인도 끝까지 파봤고 **가격은 되지만 시장 이름이 안 된다**:
 *     V2 거래소 0x127ad3a6… 의 OrderFilled 로 체결가는 완전히 복원된다
 *       (검증: 체결 108/108 이 0~1 구간, YES 0.6489 + NO 0.3511 = 1.0000)
 *     그러나 시장 생성 tx 의 input 이 36바이트(셀렉터4+questionId32)뿐이고 메타데이터
 *     컨트랙트가 없다. 생성자 주변 25블록을 다 열어봐도 200B 넘는 calldata 가 0건.
 *     원문이 체인에 닿는 유일한 경로인 UMA 오라클은 *해결 시점* 에만 찍힌다 —
 *     같은 창(9,500블록)에서 거래 토큰 154개 vs 질문원문 1건, 거래중 조건 30개의 어댑터가
 *     28개 0x38c0e682…(원문 없는 V2 어댑터), UMA 어댑터 0개.
 *   즉 V2 는 시장 메타데이터를 전부 오프체인으로 옮겼다. 이름은 재배포 벤더에서만 온다.
 *
 *   그 벤더가 오래갈 거라고 가정하지 않는다. 첫 벤더 Dome 은 2026-02-19 폴리마켓에 인수됐고
 *   지원 종료 2026-03-31, 공식 EOL 2026-04-28 인데 오늘(08-31)까지 살아 있는 상태다.
 *   그래서 fetch 와 선별을 분리했다 — 벤더가 죽어도 normalize* 하나만 새로 쓰면 된다.
 */

/** 벤더 응답을 이 모양으로 맞춘다. 이 계약만 지키면 선별 로직은 벤더를 모른다. */
/** @typedef {{id:string,title:string,prob:number,probPrev:number|null,volume24h:number,liquidity:number,closeAt:string,url:string,vendor:string}} Market */

/** 유동성이 이보다 작으면 확률이 크게 움직여도 신호가 아니다(호가 한두 개로 흔들린다). */
export const DEFAULT_MIN_LIQUIDITY_USD = 5_000;
/** 이 범위 밖은 사실상 결판난 시장이다. 99%→97% 는 2%p 지만 아무것도 말해주지 않는다. */
export const SETTLED_LOW = 0.02;
export const SETTLED_HIGH = 0.98;
/** 이만큼도 안 움직였으면 "눈여겨볼 것" 이 아니다. */
export const DEFAULT_MIN_MOVE_PP = 1;

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * 움직인 순으로 세운다. 순수 함수 — 네트워크도 벤더도 모른다(그래서 키 없이 검증된다).
 *
 * 제외 규칙과 그 이유:
 *   ① 직전 확률이 없으면 뺀다. 0 으로 뭉개면 "안 움직인 시장" 으로 위장돼 순위에 섞인다.
 *   ② 마감이 지났으면 뺀다. 정산 중인 시장의 가격 이동은 결과 확정이지 전망이 아니다.
 *   ③ 결판난 구간(≤2% / ≥98%)은 뺀다. 잔떨림이 큰 변동으로 잡히는 것을 막는다.
 *   ④ 유동성 하한 미만은 뺀다. $12 시장의 80%p 이동은 누군가 한 번 사면 생긴다.
 *   ⑤ 변동이 하한 미만이면 뺀다.
 *
 * @param {Market[]} markets
 * @param {{now?:number, minLiquidity?:number, minMovePp?:number, limit?:number}} [opt]
 * @returns {(Market & {deltaPp:number, direction:'up'|'down'})[]} 비면 빈 배열 — 예외를 던지지 않는다.
 *   호출부는 이 빈 배열을 "섹션 생략" 으로 처리해야 한다(빈 문자열이나 0 으로 채우면 안 된다).
 */
export function rankByMovement(markets, opt = {}) {
  const {
    now = Date.now(),
    minLiquidity = DEFAULT_MIN_LIQUIDITY_USD,
    minMovePp = DEFAULT_MIN_MOVE_PP,
    limit = 6,
  } = opt;

  const out = [];
  for (const m of Array.isArray(markets) ? markets : []) {
    const prob = num(m?.prob);
    const prev = num(m?.probPrev);
    if (prob === null || prev === null) continue;                       // ①
    const closeAt = Date.parse(m?.closeAt ?? '');
    if (Number.isFinite(closeAt) && closeAt <= now) continue;           // ②
    if (prob <= SETTLED_LOW || prob >= SETTLED_HIGH) continue;          // ③
    if ((num(m?.liquidity) ?? 0) < minLiquidity) continue;              // ④
    const deltaPp = Math.round((prob - prev) * 1000) / 10;
    if (Math.abs(deltaPp) < minMovePp) continue;                        // ⑤
    out.push({ ...m, prob, probPrev: prev, deltaPp, direction: deltaPp >= 0 ? 'up' : 'down' });
  }
  out.sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
  return out.slice(0, limit);
}

/**
 * Dome 벤더 정규화 — **두 단계다.** 공개 OpenAPI(docs.domeapi.io)를 읽고 확인한 계약:
 *
 *   GET /v1/polymarket/markets            ← 메타데이터만. **가격을 주지 않는다.**
 *     { markets: [{ market_slug, event_slug, condition_id, title, start_time, end_time,
 *                   close_time, tags, volume_total, side_a:{id,label}, side_b:{id,label},
 *                   status:'open'|'closed' }], pagination:{limit,total,has_more,pagination_key} }
 *     쿼리: status, min_volume, limit(1~100), search, tags, condition_id, token_id, …
 *
 *   GET /v1/polymarket/candlesticks/{condition_id}?start_time&end_time&interval  ← 가격
 *     interval: 1=1분(최대 1주), 60=1시간(최대 1달), 1440=1일(최대 1년)
 *     { candlesticks: [{ token_id, side, open_interest, volume,
 *                        price:{ open_dollars, high_dollars, low_dollars, close_dollars, … } }] }
 *
 * 처음엔 필드명을 짐작해서(question/price/volume_24hr) 한 단계로 짰다. 스펙을 읽고 고쳤다 —
 * 그대로 뒀으면 런타임에 전 필드가 null 이 되고, 그건 "시장이 안 움직였다" 로 위장됐을 것이다.
 */
export function normalizeDomeMarket(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.condition_id ?? null;
  const title = raw.title ?? null;
  if (!id || !title) return null;                      // 이름 없는 시장은 보고서에 쓸 수 없다
  const slug = raw.event_slug ?? raw.market_slug ?? null;
  return {
    id: String(id),
    title: String(title),
    // side_a / side_b 의 어느 쪽이 Yes 인지는 label 로 판정한다. 순서로 가정하지 않는다.
    yesTokenId: pickYesTokenId(raw),
    prob: null,        // markets 응답엔 가격이 없다 — applyDomeCandles 가 채운다
    probPrev: null,
    volume24h: 0,
    // 유동성 전용 필드가 없어 누적 거래량을 대용으로 쓴다. 잡시장 배제가 목적이므로 이 대용으로 충분하다.
    liquidity: num(raw.volume_total) ?? 0,
    closeAt: raw.end_time ?? raw.close_time ?? null,
    status: raw.status ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    // 한국에서 이 링크는 451 이다. UI 가 그 사실을 함께 알려야 한다(모르고 눌러도 안 열린다).
    url: slug ? `https://polymarket.com/event/${slug}` : null,
    vendor: 'dome',
  };
}

/** Yes 쪽 토큰 ID. label 을 보고 고르고, 못 고르면 null (순서로 찍지 않는다). */
function pickYesTokenId(raw) {
  for (const side of [raw.side_a, raw.side_b]) {
    if (side?.id && /^\s*yes\s*$/i.test(String(side.label ?? ''))) return String(side.id);
  }
  return raw.side_a?.id ? String(raw.side_a.id) : null;
}

/**
 * 캔들 응답에서 Yes 토큰의 open→close 를 가져와 확률과 직전 확률을 채운다.
 *
 * Yes 캔들이 없으면 **채우지 않는다.** No 쪽에서 1-p 로 뒤집고 싶은 유혹이 있지만,
 * side 라벨 규약을 실측으로 확인하지 않은 채 뒤집으면 확률이 통째로 반대가 된다 —
 * 보고서에 "연준 인하 확률 38%" 를 62% 로 싣는 종류의 사고다. 모르면 비운다.
 */
export function applyDomeCandles(market, candleResponse) {
  if (!market) return null;
  const rows = Array.isArray(candleResponse?.candlesticks) ? candleResponse.candlesticks : [];
  const yes = rows.find((c) => String(c?.token_id ?? '') === String(market.yesTokenId ?? ''));
  if (!yes) return { ...market, prob: null, probPrev: null };
  const close = num(yes.price?.close_dollars);
  const open = num(yes.price?.open_dollars);
  return {
    ...market,
    prob: close,
    probPrev: open,
    volume24h: num(yes.volume) ?? market.volume24h ?? 0,
  };
}

// ── 수집 계층 ─────────────────────────────────────────────────────────────────
// 선별(rankByMovement)과 분리해 둔다. 벤더가 바뀌면 여기만 새로 쓴다.

const DOME_BASE = process.env.DOME_API_BASE || 'https://api.domeapi.io/v1';

/** 실패를 조용히 빈 배열로 뭉개지 않는다 — 왜 비었는지가 호출부에 전달돼야 한다. */
const fail = (reason, detail) => ({ ok: false, reason, detail, markets: [], asOf: new Date().toISOString() });

async function domeGet(path, apiKey, timeoutMs) {
  const res = await fetch(`${DOME_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'flowvium/1.0 (contact@flowvium.net)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
  return res.json();
}

/**
 * 지금 눈여겨볼 예측시장을 가져온다.
 *
 * 흐름(공개 OpenAPI 대로):
 *   ① GET /polymarket/markets?status=open&min_volume&limit   → 이름·조건ID·Yes토큰·누적거래량
 *   ② 각 시장마다 GET /polymarket/candlesticks/{condition_id} → 창의 open/close = 확률 변동
 *   ③ rankByMovement 로 "움직인 것" 만 남긴다
 *
 * 키가 없으면 **그 사실을 이유로 돌려준다.** 조용히 빈 배열을 주면 "오늘은 움직임이 없었다" 와
 * 구분되지 않고, 그건 오늘 하루 종일 고친 그 실패 유형이다(200 을 주는데 실제로는 죽어 있는 것).
 *
 * @param {{apiKey?:string, windowHours?:number, scan?:number, limit?:number,
 *          minVolumeUsd?:number, minLiquidity?:number, minMovePp?:number,
 *          timeoutMs?:number, now?:number, fetchImpl?:Function}} [opt]
 * @returns {Promise<{ok:boolean, reason?:string, detail?:string, markets:object[], asOf:string,
 *                     vendor?:string, scanned?:number}>}
 */
export async function fetchNoteworthyMarkets(opt = {}) {
  const {
    apiKey = process.env.DOME_API_KEY,
    windowHours = 24,
    scan = 40,
    limit = 6,
    minVolumeUsd = 20_000,
    minLiquidity = DEFAULT_MIN_LIQUIDITY_USD,
    minMovePp = DEFAULT_MIN_MOVE_PP,
    timeoutMs = 20_000,
    now = Date.now(),
  } = opt;

  if (!apiKey) return fail('no-key', 'DOME_API_KEY 미설정 — dashboard.domeapi.io 에서 발급');

  let list;
  try {
    const qs = new URLSearchParams({ status: 'open', min_volume: String(minVolumeUsd), limit: String(Math.min(100, scan)) });
    list = await domeGet(`/polymarket/markets?${qs}`, apiKey, timeoutMs);
  } catch (e) {
    return fail('markets-fetch', String(e?.message ?? e).slice(0, 200));
  }

  const metas = (Array.isArray(list?.markets) ? list.markets : []).map(normalizeDomeMarket).filter(Boolean);
  if (!metas.length) return { ...fail('empty-market-list', `벤더가 시장을 0건 반환 (min_volume=${minVolumeUsd})`), vendor: 'dome' };

  // ② 캔들. 무료 티어가 10 QPS 라 소량 동시성으로 나눠 던진다.
  const end = Math.floor(now / 1000);
  const start = end - windowHours * 3600;
  const withPx = [];
  const errs = [];
  const CONC = 5;
  for (let i = 0; i < metas.length; i += CONC) {
    const batch = metas.slice(i, i + CONC);
    const res = await Promise.all(batch.map(async (m) => {
      try {
        const qs = new URLSearchParams({ start_time: String(start), end_time: String(end), interval: '60' });
        return applyDomeCandles(m, await domeGet(`/polymarket/candlesticks/${encodeURIComponent(m.id)}?${qs}`, apiKey, timeoutMs));
      } catch (e) { errs.push(`${m.id.slice(0, 12)}: ${String(e?.message ?? e).slice(0, 60)}`); return { ...m, prob: null, probPrev: null }; }
    }));
    withPx.push(...res);
  }

  const markets = rankByMovement(withPx, { now, minLiquidity, minMovePp, limit });
  return {
    ok: true,
    markets,
    vendor: 'dome',
    scanned: metas.length,
    windowHours,
    asOf: new Date(now).toISOString(),
    // 비었으면 그 이유를 남긴다. "움직임 없음" 과 "캔들을 못 받음" 은 다른 사건이다.
    ...(markets.length ? {} : {
      reason: errs.length >= metas.length ? 'no-candles' : 'no-movement',
      detail: errs.length
        ? `캔들 실패 ${errs.length}/${metas.length} — ${errs.slice(0, 3).join(' | ')}`
        : `${metas.length}개 조회했으나 ${minMovePp}%p 이상 움직인 시장 없음`,
    }),
  };
}

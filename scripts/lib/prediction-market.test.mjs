#!/usr/bin/env node
/**
 * prediction-market.test.mjs — 예측시장 "눈여겨볼 것" 선별이 실제로 눈여겨볼 것을 고르는가.
 *
 * 배경(2026-08-31, 사용자 "폴리마켓에서 눈여겨볼만한거 섹션도 넣을수없나"):
 *   폴리마켓 자체 API 는 한국에서 HTTP 451 이다(2026-08-18 방통심의위 접속차단 + 폴리마켓 자체
 *   지역차단). 우회는 하지 않기로 했다. 온체인도 파봤으나 V2 가 시장 메타데이터를 전부 오프체인으로
 *   옮겨서 **가격은 얻지만 시장 이름을 못 얻는다**(생성 tx input 36B = 셀렉터+해시, 메타데이터
 *   컨트랙트 없음. 같은 창 9500블록에서 거래 토큰 154개 vs UMA 질문원문 1건, 거래중 조건 30개의
 *   어댑터가 전부 0x38c0e682… = 원문 없는 V2 어댑터).
 *   그래서 재배포 벤더를 쓴다. 벤더는 바뀔 수 있다(Dome 은 폴리마켓에 인수돼 EOL 4개월 경과) —
 *   그래서 이 파일이 검증하는 것은 *벤더* 가 아니라 **정규화된 모양과 선별 규칙** 이다.
 *
 * 선별 규칙이 왜 이 모양인가: 사용자가 "움직인 것 위주" 를 골랐다.
 *   고정 지표판은 변화 없는 날 죽은 섹션이 된다. 확률이 움직인 순으로 세우되,
 *   유동성 없는 시장과 이미 끝난 시장은 움직여도 신호가 아니므로 뺀다.
 */
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };

let M;
try { M = await import('./prediction-market.mjs'); }
catch (e) { console.log(`  ✗ 모듈 없음: ${e.message}`); process.exit(1); }

const now = Date.parse('2026-08-31T12:00:00Z');
const future = new Date(now + 30 * 864e5).toISOString();
const past = new Date(now - 1 * 864e5).toISOString();

const mk = (o) => ({
  id: o.id, title: o.title ?? `시장 ${o.id}`, prob: o.prob, probPrev: o.probPrev ?? null,
  volume24h: o.volume24h ?? 50_000, liquidity: o.liquidity ?? 50_000,
  closeAt: o.closeAt ?? future, url: `https://x/${o.id}`, vendor: 'test',
});

// ── 정규화: 델타는 계산되어야 한다(퍼센트포인트) ────────────────────────────────
{
  const [r] = M.rankByMovement([mk({ id: 'a', prob: 0.41, probPrev: 0.29 })], { now });
  r?.deltaPp === 12 ? ok(`델타 계산 (0.29→0.41 = ${r.deltaPp}%p)`) : bad(`델타 ${r?.deltaPp} (12 기대)`);
  r?.direction === 'up' ? ok('방향 표기 up') : bad(`방향 ${r?.direction}`);
}
{
  const [r] = M.rankByMovement([mk({ id: 'a', prob: 0.29, probPrev: 0.41 })], { now });
  r?.deltaPp === -12 ? ok(`하락도 부호 유지 (${r.deltaPp}%p)`) : bad(`델타 ${r?.deltaPp} (-12 기대)`);
}

// ── 핵심: 많이 움직인 순 ────────────────────────────────────────────────────────
{
  const rows = M.rankByMovement([
    mk({ id: 'small', prob: 0.50, probPrev: 0.49 }),   //  +1%p
    mk({ id: 'big', prob: 0.18, probPrev: 0.31 }),     // -13%p
    mk({ id: 'mid', prob: 0.62, probPrev: 0.57 }),     //  +5%p
  ], { now });
  rows.map((r) => r.id).join(',') === 'big,mid,small'
    ? ok('절대 변동 큰 순 정렬 (하락도 크면 앞으로)')
    : bad(`정렬이 틀렸다: ${rows.map((r) => `${r.id}(${r.deltaPp})`).join(', ')}`);
}

// ── 유동성 없는 시장은 움직여도 신호가 아니다 ──────────────────────────────────
{
  const rows = M.rankByMovement([
    mk({ id: 'junk', prob: 0.9, probPrev: 0.1, liquidity: 12, volume24h: 3 }),  // +80%p 지만 $12 시장
    mk({ id: 'real', prob: 0.44, probPrev: 0.40 }),
  ], { now, minLiquidity: 1000 });
  rows[0]?.id === 'real' && !rows.some((r) => r.id === 'junk')
    ? ok('유동성 하한 미만 제외 ($12 시장의 80%p 이동은 신호가 아니다)')
    : bad(`정크가 남았다: ${rows.map((r) => r.id).join(', ')}`);
}

// ── 이미 끝난 시장 제외 ────────────────────────────────────────────────────────
{
  const rows = M.rankByMovement([
    mk({ id: 'closed', prob: 0.99, probPrev: 0.60, closeAt: past }),
    mk({ id: 'open', prob: 0.44, probPrev: 0.40 }),
  ], { now });
  rows.every((r) => r.id !== 'closed') ? ok('마감 지난 시장 제외') : bad('마감된 시장이 남았다');
}

// ── 사실상 결판난 시장의 잔떨림은 뺀다 ─────────────────────────────────────────
//   99%→97% 는 2%p 지만 정보가 없다. 40%→50% 가 신호다.
{
  const rows = M.rankByMovement([
    mk({ id: 'settled', prob: 0.985, probPrev: 0.995 }),
    mk({ id: 'live', prob: 0.50, probPrev: 0.46 }),
  ], { now });
  rows[0]?.id === 'live' && !rows.some((r) => r.id === 'settled')
    ? ok('결판난 구간(≥98%/≤2%)의 잔떨림 제외')
    : bad(`결판난 시장이 남았다: ${rows.map((r) => r.id).join(', ')}`);
}

// ── 비교 시점이 없으면 순위에 못 넣는다(0 으로 뭉개지 않는다) ───────────────────
{
  const rows = M.rankByMovement([
    mk({ id: 'noprev', prob: 0.5, probPrev: null }),
    mk({ id: 'has', prob: 0.5, probPrev: 0.45 }),
  ], { now });
  rows.length === 1 && rows[0].id === 'has'
    ? ok('직전 확률 없는 시장은 제외 (델타를 0 으로 가정하지 않는다)')
    : bad(`직전값 없는 것을 포함했다: ${rows.map((r) => r.id).join(', ')}`);
}

// ── 빈 결과 경로가 명시적이어야 한다 ───────────────────────────────────────────
//   사용자 규칙: "검색 결과가 비었을 때 처리 경로도 밝혀줘. 없으면 그게 버그야."
{
  const rows = M.rankByMovement([], { now });
  Array.isArray(rows) && rows.length === 0 ? ok('입력이 비면 빈 배열 (예외 아님)') : bad('빈 입력 처리 실패');
  const only = M.rankByMovement([mk({ id: 'j', prob: 0.5, probPrev: 0.4, liquidity: 1 })], { now, minLiquidity: 1e9 });
  only.length === 0 ? ok('전부 걸러지면 빈 배열') : bad('필터를 통과하면 안 되는 것이 남았다');
}

// ── 개수 상한 ──────────────────────────────────────────────────────────────────
{
  const many = Array.from({ length: 20 }, (_, i) => mk({ id: `m${i}`, prob: 0.5, probPrev: 0.5 - (i + 1) / 100 }));
  M.rankByMovement(many, { now, limit: 5 }).length === 5 ? ok('limit 준수') : bad('limit 무시');
}

// ── 벤더 정규화: 공개 OpenAPI 스펙(docs.domeapi.io) 에 맞춘다 ─────────────────
//   처음엔 필드명을 짐작해서 짰다가(question/price/volume_24hr) 스펙을 읽고 고쳤다.
//   실제 계약: GET /v1/polymarket/markets 는 **가격을 주지 않는다.** 메타데이터만 준다.
//     { markets: [{ market_slug, event_slug, condition_id, title, start_time, end_time,
//                   close_time, tags, volume_total, side_a:{id,label}, side_b:{id,label},
//                   status:'open'|'closed' }], pagination: {...} }
//   가격은 GET /v1/polymarket/candlesticks/{condition_id} 가 준다:
//     { candlesticks: [{ token_id, side, open_interest, volume,
//                        price: { open_dollars, high_dollars, low_dollars, close_dollars, ... } }] }
//   그래서 정규화가 두 단계다. 짐작으로 한 단계에 뭉쳤으면 런타임에 전부 null 이 됐을 것이다.
{
  typeof M.normalizeDomeMarket === 'function' && typeof M.applyDomeCandles === 'function'
    ? ok('벤더 정규화가 메타데이터/가격 두 단계로 분리됨')
    : bad('정규화 단계가 스펙과 안 맞는다 (markets 는 가격을 주지 않는다)');

  const raw = {
    market_slug: 'fed-cut-sept', event_slug: 'fed-2026', condition_id: '0xabc',
    title: 'Will the Fed cut rates in September?',
    end_time: future, close_time: null, status: 'open',
    volume_total: 250000, tags: ['economy'],
    side_a: { id: '111', label: 'Yes' }, side_b: { id: '222', label: 'No' },
  };
  const n = M.normalizeDomeMarket(raw);
  n?.id === '0xabc' ? ok('condition_id → id') : bad(`id ${n?.id}`);
  n?.title === 'Will the Fed cut rates in September?' ? ok('title 정규화') : bad(`title ${n?.title}`);
  n?.yesTokenId === '111' ? ok('side_a(Yes) 토큰ID 보존') : bad(`yesTokenId ${n?.yesTokenId}`);
  n?.liquidity === 250000 ? ok('volume_total → 유동성 대용') : bad(`liquidity ${n?.liquidity}`);
  n?.url === 'https://polymarket.com/event/fed-2026' ? ok('event_slug 로 원문 링크') : bad(`url ${n?.url}`);
  n?.vendor === 'dome' ? ok('벤더 표기') : bad(`vendor ${n?.vendor}`);
  n?.prob === null && n?.probPrev === null
    ? ok('가격은 아직 null — markets 응답엔 없다(추측해 채우지 않는다)')
    : bad(`가격을 지어냈다: prob=${n?.prob}`);

  // 캔들 적용 — Yes 쪽 캔들의 open→close 가 곧 변동이다
  const candles = { candlesticks: [
    { token_id: '111', side: 'a', volume: 90000, open_interest: 40000,
      price: { open_dollars: '0.5100', close_dollars: '0.6200', high_dollars: '0.63', low_dollars: '0.50' } },
    { token_id: '222', side: 'b', volume: 88000, open_interest: 40000,
      price: { open_dollars: '0.4900', close_dollars: '0.3800' } },
  ] };
  const withPx = M.applyDomeCandles(n, candles);
  withPx?.prob === 0.62 ? ok('close_dollars → 현재 확률') : bad(`prob ${withPx?.prob}`);
  withPx?.probPrev === 0.51 ? ok('open_dollars → 직전 확률') : bad(`probPrev ${withPx?.probPrev}`);
  withPx?.volume24h === 90000 ? ok('Yes 캔들 거래량') : bad(`volume24h ${withPx?.volume24h}`);

  // Yes 캔들이 없으면 가격을 지어내면 안 된다 — No 쪽으로 1-p 를 계산하는 유혹이 있으나
  // side 라벨 규약을 확인하지 않은 채 뒤집으면 확률이 통째로 반대가 된다.
  const noYes = M.applyDomeCandles(n, { candlesticks: [{ token_id: '999', side: 'b', price: { open_dollars: '0.1', close_dollars: '0.2' } }] });
  noYes?.prob === null ? ok('Yes 캔들 없으면 null (No 를 뒤집어 추정하지 않는다)') : bad(`추정해버렸다: ${noYes?.prob}`);

  // 그리고 그 시장은 선별에서 자동으로 빠져야 한다
  M.rankByMovement([noYes], { now }).length === 0 ? ok('가격 없는 시장은 순위에서 제외') : bad('가격 없는 시장이 순위에 올랐다');
}

console.log(fail === 0 ? '\n✅ prediction-market 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);

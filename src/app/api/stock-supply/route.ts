import { logger, loggedRedisSet} from '@/lib/logger';
import { NextResponse } from 'next/server';
import { newsGapData, type OwnershipRecord } from '@/data/news-gap';
import { createRedis } from '@/lib/redis';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL = 60 * 60; // 1h — 가격/거래량 포함이므로 3h 는 너무 김
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' };
const EDGAR_UA = 'FlowVium/1.0 taeshinkim11@gmail.com';

// ── Fetch recent Form 4 filings from EDGAR ─────────────────────────────────
interface InsiderTx {
  name: string;
  relation: string;
  date: string;
  shares: number;
  value: number;
  price: number;
  transactionCode: string;
  isBuy: boolean;
  text: string;
}

async function fetchInsiderTransactions(ticker: string): Promise<InsiderTx[]> {
  try {
    // Map common tickers directly to avoid CIK lookup latency
    const CIK_MAP: Record<string, string> = {
      // Semiconductors / Tech Hardware
      NVDA: '0001045810', AAPL: '0000320193', MSFT: '0000789019',
      TSM: '0000803649', ASML: '0000937556', AMD: '0000002488',
      INTC: '0000050863', MU: '0000723125', AVGO: '0001730168',
      ARM: '0001477294', QCOM: '0000804328', TXN: '0000097476',
      AMAT: '0000006951', KLAC: '0000319201', LRCX: '0000707549',
      MRVL: '0001058057', ON: '0001097864',
      // Mega-cap Tech / Internet
      AMZN: '0001018724', GOOGL: '0001652044', GOOG: '0001652044',
      META: '0001326801', TSLA: '0001318605', NFLX: '0001065280',
      ORCL: '0001341439', CRM: '0001108524', ADBE: '0000796343',
      NOW: '0001373715', INTU: '0000896878', UBER: '0001543151',
      PLTR: '0001321732', SNOW: '0001517396', SHOP: '0001594805',
      COIN: '0001679788',
      // Financials
      JPM: '0000019617', GS: '0000886982', BLK: '0001364742',
      MS: '0000895421', BAC: '0000070858', WFC: '0000072971',
      C: '0000831001', SCHW: '0000316888', V: '0001403161',
      MA: '0001141391', PYPL: '0001633917', AXP: '0000004962',
      SPGI: '0000064040', MCO: '0001059556',
      // Defense / Industrials
      LMT: '0000936468', RTX: '0000101829', NOC: '0001133421',
      BA: '0000012927', GE: '0000040987', CAT: '0000018230',
      DE: '0000315189', HON: '0000773840', UPS: '0001090727',
      FDX: '0001048911', MMM: '0000066740',
      // Healthcare / Pharma
      LLY: '0000059478', JNJ: '0000200406', PFE: '0000078003',
      MRK: '0000310158', ABBV: '0001551152', AMGN: '0000835887',
      GILD: '0000882184', REGN: '0000872589', BIIB: '0000875320',
      UNH: '0000731766', CVS: '0000064803',
      // Energy
      XOM: '0000034088', CVX: '0000093410', COP: '0001163165',
      SLB: '0000087347',
      // Consumer
      WMT: '0000104169', COST: '0000909832', HD: '0000354950',
      TGT: '0000027419', KO: '0000021344', PEP: '0000077476',
      PG: '0000080424', MCD: '0000063754', SBUX: '0000829224',
      NKE: '0000320187',
      // Telecom / Media
      T: '0000732717', VZ: '0000732712', CMCSA: '0001166691',
      DIS: '0001001039',
    };

    const cik = CIK_MAP[ticker];
    if (!cik) return [];

    const cikFormatted = cik.replace(/^0+/, '').padStart(10, '0');
    const subRes = await fetch(
      `https://data.sec.gov/submissions/CIK${cikFormatted}.json`,
      { headers: { 'User-Agent': EDGAR_UA }, signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    if (!subRes.ok) return [];
    const subData = await subRes.json();

    const recent = subData?.filings?.recent ?? {};
    const forms: string[] = recent.form ?? [];
    const dates: string[] = recent.filingDate ?? [];
    const accNums: string[] = recent.accessionNumber ?? [];
    const docs: string[] = recent.primaryDocument ?? [];

    // Get last 10 Form 4 filings
    const form4s: Array<{ date: string; accNum: string; doc: string }> = [];
    for (let i = 0; i < forms.length && form4s.length < 10; i++) {
      if (forms[i] === '4') {
        form4s.push({ date: dates[i], accNum: accNums[i], doc: docs[i] });
      }
    }

    // Fetch all 6 Form 4 XMLs in parallel (sequential was ~5-8s; parallel ~1s)
    const cikNum = cik.replace(/^0+/, '');
    const xmlResults = await Promise.allSettled(
      form4s.slice(0, 6).map(async (f) => {
        const folder = f.accNum.replace(/-/g, '');
        const xmlDoc = f.doc.replace(/^xslF345X06\//, '');
        const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${folder}/${xmlDoc}`;
        const xmlRes = await fetch(xmlUrl, {
          headers: { 'User-Agent': EDGAR_UA },
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });
        if (!xmlRes.ok) throw new Error(`HTTP ${xmlRes.status}`);
        const xml = await xmlRes.text();

        const ownerMatch = xml.match(/<rptOwnerName>(.*?)<\/rptOwnerName>/);
        const ownerName = ownerMatch?.[1] ?? '';

        const isDirector = xml.includes('<isDirector>1</isDirector>');
        const isOfficer = xml.includes('<isOfficer>1</isOfficer>');
        const officerTitleMatch = xml.match(/<officerTitle>(.*?)<\/officerTitle>/);
        const relation = officerTitleMatch?.[1] || (isDirector ? 'Director' : isOfficer ? 'Officer' : 'Owner');

        const txBlocks = xml.match(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g) ?? [];
        const fileTxns: InsiderTx[] = [];
        for (const block of txBlocks) {
          const dateMatch = block.match(/<transactionDate>[\s\S]*?<value>(.*?)<\/value>/);
          const sharesMatch = block.match(/<transactionShares>[\s\S]*?<value>(.*?)<\/value>/);
          const priceMatch = block.match(/<transactionPricePerShare>[\s\S]*?<value>(.*?)<\/value>/);
          const codeMatch = block.match(/<transactionCode>(.*?)<\/transactionCode>/);

          const shares = parseFloat(sharesMatch?.[1] ?? '0');
          const price = parseFloat(priceMatch?.[1] ?? '0');
          const code = codeMatch?.[1] ?? '';
          const isBuy = code === 'P' || code === 'A';
          const isSell = code === 'S' || code === 'F';
          if (!isBuy && !isSell) continue;

          fileTxns.push({
            name: ownerName,
            relation,
            date: dateMatch?.[1] ?? f.date,
            shares,
            value: shares * price,
            price,
            transactionCode: code,
            isBuy,
            text: isBuy
              ? `Purchase of ${shares.toLocaleString()} shares at $${price.toFixed(2)}`
              : `Sale of ${shares.toLocaleString()} shares at $${price.toFixed(2)}`,
          });
        }
        return fileTxns;
      })
    );

    const txns = xmlResults
      .filter((r): r is PromiseFulfilledResult<InsiderTx[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);

    return txns.sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

// ── Yahoo Finance quote stats (institutional/short data) ─────────────────────
interface QuoteStats {
  instHeld: number | null;
  insiderHeld: number | null;
  shortPct: number | null;
  shortRatio: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
}

async function fetchQuoteStats(ticker: string): Promise<QuoteStats> {
  const empty: QuoteStats = { instHeld: null, insiderHeld: null, shortPct: null, shortRatio: null, marketCap: null, sharesOutstanding: null };
  try {
    // 2026-06-13: v7 quote 는 이제 crumb 필수(미인증 401 → marketCap/sharesOutstanding 전부 null →
    //   지분율 0% 사건). fc.yahoo.com 쿠키+crumb 획득 후 호출 (ishares-holdings 와 동일 패턴).
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    const cr = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(6000) });
    const cookie = (cr.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
    const crumb = await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': ua, Cookie: cookie }, signal: AbortSignal.timeout(6000) })).text();
    const fields = 'marketCap,shortRatio,shortPercentOfFloat,heldPercentInstitutions,heldPercentInsiders,sharesOutstanding';
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=${fields}${crumb && !crumb.includes('<') ? `&crumb=${encodeURIComponent(crumb)}` : ''}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': ua, Cookie: cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return empty;
    const data = await res.json();
    const q = data?.quoteResponse?.result?.[0];
    if (!q) return empty;
    return {
      instHeld: typeof q.heldPercentInstitutions === 'number' ? parseFloat((q.heldPercentInstitutions * 100).toFixed(1)) : null,
      insiderHeld: typeof q.heldPercentInsiders === 'number' ? parseFloat((q.heldPercentInsiders * 100).toFixed(1)) : null,
      shortPct: typeof q.shortPercentOfFloat === 'number' ? parseFloat((q.shortPercentOfFloat * 100).toFixed(1)) : null,
      shortRatio: typeof q.shortRatio === 'number' ? parseFloat(q.shortRatio.toFixed(1)) : null,
      marketCap: typeof q.marketCap === 'number' ? q.marketCap : null,
      sharesOutstanding: typeof q.sharesOutstanding === 'number' ? q.sharesOutstanding : null,
    };
  } catch { return empty; }
}

// ── Yahoo Finance price history (volume + stats) ─────────────────────────────
async function fetchVolumeData(ticker: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=90d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp ?? [];
    const volumes: number[] = result.indicators?.quote?.[0]?.volume ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const highs: number[] = result.indicators?.quote?.[0]?.high ?? [];
    const lows: number[] = result.indicators?.quote?.[0]?.low ?? [];

    const validCloses = closes.filter(Boolean);
    const validVolumes = volumes.filter(Boolean);

    const current = validCloses[validCloses.length - 1];
    const w1Price = validCloses[validCloses.length - 6] ?? current;
    const m1Price = validCloses[validCloses.length - 22] ?? validCloses[0] ?? current;
    const m3Price = validCloses[0] ?? current;

    const ret1w = current && w1Price && w1Price !== current ? ((current - w1Price) / w1Price) * 100 : null;
    const ret1m = current && m1Price && m1Price !== current ? ((current - m1Price) / m1Price) * 100 : null;
    const ret3m = current && m3Price && m3Price !== current ? ((current - m3Price) / m3Price) * 100 : null;

    // True 52-week high/low from Yahoo meta; fallback to 90d data if absent
    const high52 = (result.meta?.fiftyTwoWeekHigh as number | undefined)
      ?? (highs.filter(Boolean).length > 0 ? Math.max(...highs.filter(Boolean)) : null);
    const low52 = (result.meta?.fiftyTwoWeekLow as number | undefined)
      ?? (lows.filter(Boolean).length > 0 ? Math.min(...lows.filter(Boolean)) : null);

    // Volume ratios
    const recent5 = validVolumes.slice(-5);
    const recent10 = validVolumes.slice(-10);
    const prev20 = validVolumes.slice(-25, -5);
    const avgRecent = recent5.reduce((a, b) => a + b, 0) / (recent5.length || 1);
    const avgVol10d = recent10.reduce((a, b) => a + b, 0) / (recent10.length || 1);
    const avgPrev = prev20.reduce((a, b) => a + b, 0) / (prev20.length || 1);
    const volumeRatio = avgPrev > 0 ? avgRecent / avgPrev : 1;
    const avgVol3m = validVolumes.reduce((a, b) => a + b, 0) / (validVolumes.length || 1);

    // Daily change: compare regularMarketPrice vs second-to-last close
    const prevDayClose = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
    const price = (result.meta?.regularMarketPrice as number | undefined) ?? current;
    const changePct = price != null && prevDayClose && prevDayClose > 0
      ? parseFloat(((price - prevDayClose) / prevDayClose * 100).toFixed(2))
      : null;

    // Daily volume (last 20 days)
    const dailyVolume = timestamps.slice(-20).map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      volume: volumes[volumes.length - 20 + i] ?? 0,
      close: closes[closes.length - 20 + i] ?? 0,
    })).filter(d => d.volume > 0);

    const marketCap = (result.meta?.marketCap as number | undefined) ?? null;

    return {
      volumeRatio, avgRecent, avgVol10d, avgVol3m,
      ret1w, ret1m, ret3m, current, price, changePct,
      high52, low52, dailyVolume, marketCap,
    };
  } catch { return null; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawTicker = searchParams.get('ticker')?.toUpperCase() ?? '';
  const ticker = rawTicker.replace(/[^A-Z0-9.\-^]/g, '');
  if (!ticker || ticker.length > 10) return NextResponse.json({ error: 'Invalid or missing ticker' }, { status: 400 });

  const redis = createRedis();
  const cacheKey = `flowvium:stock-supply:v6:${ticker}`;  // v6: 13F 기관 합산 + pctOfShares 계산 + crumb

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  // company name lookup (static scaffold — used for companyName fallback only)
  const staticEntry = newsGapData.find(n => n.ticker === ticker);

  // 2026-06-13: 13F ownership 은 시계열 기관 데이터 → CLAUDE.md "정적 폴백 금지" 적용 (사용자
  //   "동적소스로, 하드코딩하지마"). 종전 staticEntry.ownershipData(news-gap.ts 하드코딩) 폴백 제거.
  //   라이브(EDGAR Redis) 있으면 사용, 없으면 빈 배열(투명한 미보유).
  let ownership13F: OwnershipRecord[] = [];
  let ownership13FSource = 'none';
  if (redis) {
    try {
      const liveOwnership = await redis.get<Record<string, OwnershipRecord[]>>('flowvium:13f-ownership:v1');
      if (liveOwnership?.[ticker]?.length) {
        ownership13F = liveOwnership[ticker];
        ownership13FSource = 'live';
      }
    } catch { /* non-fatal */ }
  }

  // Fetch data in parallel
  const [volResult, insidersResult, quoteResult] = await Promise.allSettled([
    fetchVolumeData(ticker),
    fetchInsiderTransactions(ticker),
    fetchQuoteStats(ticker),
  ]);

  const volData = volResult.status === 'fulfilled' ? volResult.value : null;
  const insiderTransactions = insidersResult.status === 'fulfilled' ? insidersResult.value : [];
  const quoteStats = quoteResult.status === 'fulfilled' ? quoteResult.value : { instHeld: null, insiderHeld: null, shortPct: null, shortRatio: null, marketCap: null, sharesOutstanding: null };

  // Supply pressure score (0=sell pressure, 100=buy pressure)
  let supplyScore = 50;
  const factors: string[] = [];

  if (volData?.volumeRatio) {
    const vr = volData.volumeRatio;
    if (vr > 1.5) { supplyScore += 10; factors.push(`거래량 ${vr.toFixed(1)}× 급등`); }
    else if (vr < 0.7) { supplyScore -= 10; factors.push(`거래량 ${vr.toFixed(1)}× 위축`); }
  }
  if (volData?.ret1w != null) {
    if (volData.ret1w > 5) { supplyScore += 8; factors.push(`1주 +${volData.ret1w.toFixed(1)}% 강세`); }
    else if (volData.ret1w < -5) { supplyScore -= 8; factors.push(`1주 ${volData.ret1w.toFixed(1)}% 약세`); }
  }

  // 2026-06-13: pctOfShares 표시단 계산 (사용자 "지분율 0.00% 안 맞음"). 적재 cron 은 발행주식수가
  //   없어 0 으로 저장 — 여기선 quoteStats.sharesOutstanding 으로 실제 % 계산. 또 같은 기관 중복행을
  //   (institution) 기준 합산(파서 CUSIP 합산의 2차 방어). prevPct 0(미지) 은 undefined 로 — UI 가
  //   "전분기 0.00%/+0.00%p" 가짜 표시 안 하도록.
  {
    const so = quoteStats.sharesOutstanding ?? null;
    const merged = new Map<string, OwnershipRecord>();
    for (const o of ownership13F) {
      const e = merged.get(o.institution);
      if (e) { e.sharesM = +(((e.sharesM ?? 0) + (o.sharesM ?? 0)).toFixed(2)); e.valueM += o.valueM; }
      else merged.set(o.institution, { ...o });
    }
    ownership13F = Array.from(merged.values())
      .map(o => ({
        ...o,
        pctOfShares: so && so > 0 ? +(((o.sharesM ?? 0) * 1_000_000) / so * 100).toFixed(2) : 0,
        prevPct: undefined,  // 전분기 비교 데이터 미적재 — 가짜 0 표시 차단 (차기: prior-quarter 적재)
      }))
      .sort((a, b) => b.valueM - a.valueM);
  }

  // 13F accumulation from static data
  const accumCount = ownership13F.filter(o => o.action === 'new' || o.action === 'increased').length;
  const reduceCount = ownership13F.filter(o => o.action === 'reduced').length;
  if (accumCount > reduceCount) { supplyScore += 10; factors.push(`13F 매집 ${accumCount}건 > 감소 ${reduceCount}건`); }
  else if (reduceCount > accumCount) { supplyScore -= 8; factors.push(`13F 감소 ${reduceCount}건 > 매집 ${accumCount}건`); }

  // Insider buy/sell from Form 4
  const recentInsiders = insiderTransactions.slice(0, 10);
  const insiderBuys = recentInsiders.filter(t => t.isBuy && t.transactionCode === 'P').length;
  const insiderSells = recentInsiders.filter(t => !t.isBuy && t.transactionCode === 'S').length;
  if (insiderBuys > 0) { supplyScore += 8; factors.push(`내부자 매수 ${insiderBuys}건 (Form 4)`); }
  if (insiderSells > insiderBuys * 2) { supplyScore -= 8; factors.push(`내부자 매도 ${insiderSells}건`); }

  supplyScore = Math.min(100, Math.max(0, supplyScore));
  const supplyLabel = supplyScore >= 75 ? '강한 매집' : supplyScore >= 60 ? '매집 우위' : supplyScore >= 40 ? '중립' : supplyScore >= 25 ? '매도 우위' : '강한 매도';

  const result = {
    ticker,
    companyName: staticEntry?.companyName ?? ticker,
    price: volData?.price ?? volData?.current ?? null,
    changePct: volData?.changePct ?? null,
    ret1w: volData?.ret1w ?? null,
    ret1m: volData?.ret1m ?? null,
    ret3m: volData?.ret3m ?? null,
    high52: volData?.high52 ?? null,
    low52: volData?.low52 ?? null,
    volumeRatio: volData?.volumeRatio ?? null,
    avgVol10d: volData?.avgVol10d ?? null,
    avgVol3m: volData?.avgVol3m ?? null,
    dailyVolume: volData?.dailyVolume ?? [],
    marketCap: quoteStats.marketCap ?? volData?.marketCap ?? null,
    sharesOutstanding: quoteStats.sharesOutstanding ?? null,
    instHeld: quoteStats.instHeld,
    insiderHeld: quoteStats.insiderHeld,
    shortPct: quoteStats.shortPct,
    shortRatio: quoteStats.shortRatio,
    ownership13F,
    ownership13FSource,
    liveInstitutions: [],
    insiderTransactions,
    supplyScore,
    supplyFactors: factors,
    supplyLabel,
    updatedAt: new Date().toISOString(),
    cached: false,
    // top-level source: 가격/거래량 fetch 성공 + 13F live 면 'live', 가격만 live 면 'price-only', 모두 실패면 'static'
    source:
      volData == null ? (ownership13FSource === 'live' ? 'ownership-only' : 'static')
      : ownership13FSource === 'live' ? 'live'
      : 'price-only',
  };

  if (redis) {
    const t0 = Date.now();
    try {
      logger.info('stock-supply', 'save_start', { key: cacheKey, ttl: CACHE_TTL });
      await loggedRedisSet(redis, 'api.stock-supply', cacheKey, result, { ex: CACHE_TTL });
      logger.info('stock-supply', 'save_ok', { key: cacheKey, durationMs: Date.now() - t0 });
    } catch (err) {
      logger.error('stock-supply', 'save_failed', { key: cacheKey, error: err });
    }
  }

  return NextResponse.json(result, { headers: CDN_HEADERS });
}

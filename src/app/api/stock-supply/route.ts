import { logger, loggedRedisSet} from '@/lib/logger';
import { NextResponse } from 'next/server';
import { newsGapData } from '@/data/news-gap';
import { Redis } from '@upstash/redis';

const CACHE_TTL = 3 * 60 * 60; // 3h
const CDN_HEADERS = { 'Cache-Control': 'public, s-maxage=10800, stale-while-revalidate=300' };
const EDGAR_UA = 'FlowVium/1.0 taeshinkim11@gmail.com';

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// ── Ticker → CIK lookup via EDGAR ──────────────────────────────────────────
async function getCompanyCik(ticker: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=10-K&hits.hits.total=1`,
      { headers: { 'User-Agent': EDGAR_UA }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.hits?.hits?.[0]?._source;
    const cikEntry = (hit?.ciks as string[] | undefined)?.find((c: string) => c.length <= 10);
    return cikEntry ?? null;
  } catch { return null; }
}

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
      NVDA: '0001045810', AAPL: '0000320193', MSFT: '0000789019',
      TSMC: '0000803649', AMZN: '0001018724', GOOGL: '0001652044',
      META: '0001326801', TSLA: '0001318605', ASML: '0000937556',
      MU: '0000723125', AMD: '0000002488', INTC: '0000050863',
      LMT: '0000936468', RTX: '0000101829', NOC: '0001133421',
      JPM: '0000019617', GS: '0000886982', BLK: '0001364742',
      AVGO: '0001730168', ARM: '0001477294',
    };

    const cik = CIK_MAP[ticker];
    if (!cik) return [];

    const cikFormatted = cik.replace('0', '').padStart(10, '0');
    const subRes = await fetch(
      `https://data.sec.gov/submissions/CIK${cikFormatted}.json`,
      { headers: { 'User-Agent': EDGAR_UA }, signal: AbortSignal.timeout(8000) }
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

    // Parse XML for each filing (limit to 6 to stay within timeout)
    const txns: InsiderTx[] = [];
    const cikNum = cik.replace(/^0+/, '');
    for (const f of form4s.slice(0, 6)) {
      try {
        const folder = f.accNum.replace(/-/g, '');
        // Get the actual XML doc name (strip xslF345X06/ prefix)
        const xmlDoc = f.doc.replace(/^xslF345X06\//, '');
        const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${folder}/${xmlDoc}`;
        const xmlRes = await fetch(xmlUrl, {
          headers: { 'User-Agent': EDGAR_UA },
          signal: AbortSignal.timeout(5000),
        });
        if (!xmlRes.ok) continue;
        const xml = await xmlRes.text();

        // Parse reporting owner name
        const ownerMatch = xml.match(/<rptOwnerName>(.*?)<\/rptOwnerName>/);
        const ownerName = ownerMatch?.[1] ?? '';

        // Parse relationship
        const isDirector = xml.includes('<isDirector>1</isDirector>');
        const isOfficer = xml.includes('<isOfficer>1</isOfficer>');
        const officerTitleMatch = xml.match(/<officerTitle>(.*?)<\/officerTitle>/);
        const relation = officerTitleMatch?.[1] || (isDirector ? 'Director' : isOfficer ? 'Officer' : 'Owner');

        // Parse transactions
        const txBlocks = xml.match(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g) ?? [];
        for (const block of txBlocks) {
          const dateMatch = block.match(/<transactionDate>[\s\S]*?<value>(.*?)<\/value>/);
          const sharesMatch = block.match(/<transactionShares>[\s\S]*?<value>(.*?)<\/value>/);
          const priceMatch = block.match(/<transactionPricePerShare>[\s\S]*?<value>(.*?)<\/value>/);
          const codeMatch = block.match(/<transactionCode>(.*?)<\/transactionCode>/);

          const shares = parseFloat(sharesMatch?.[1] ?? '0');
          const price = parseFloat(priceMatch?.[1] ?? '0');
          const code = codeMatch?.[1] ?? '';
          // S = sale, P = purchase, F = tax withholding (sell), A = award
          const isBuy = code === 'P' || code === 'A';
          const isSell = code === 'S' || code === 'F';
          if (!isBuy && !isSell) continue;

          txns.push({
            name: ownerName,
            relation,
            date: dateMatch?.[1] ?? f.date,
            shares,
            value: shares * price,
            price,
            transactionCode: code,
            isBuy,
            text: isBuy ? `Purchase of ${shares.toLocaleString()} shares at $${price.toFixed(2)}` : `Sale of ${shares.toLocaleString()} shares at $${price.toFixed(2)}`,
          });
        }
      } catch { continue; }
    }

    return txns.sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

// ── Yahoo Finance price history (volume + stats) ─────────────────────────────
async function fetchVolumeData(ticker: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=90d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)' },
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

    const ret1w = current && w1Price ? ((current - w1Price) / w1Price) * 100 : 0;
    const ret1m = current && m1Price ? ((current - m1Price) / m1Price) * 100 : 0;
    const ret3m = current && m3Price ? ((current - m3Price) / m3Price) * 100 : 0;

    // 52-week high/low from 90d data (best we have)
    const high52 = Math.max(...highs.filter(Boolean));
    const low52 = Math.min(...lows.filter(Boolean));

    // Volume ratios
    const recent5 = validVolumes.slice(-5);
    const prev20 = validVolumes.slice(-25, -5);
    const avgRecent = recent5.reduce((a, b) => a + b, 0) / (recent5.length || 1);
    const avgPrev = prev20.reduce((a, b) => a + b, 0) / (prev20.length || 1);
    const volumeRatio = avgPrev > 0 ? avgRecent / avgPrev : 1;
    const avgVol3m = validVolumes.reduce((a, b) => a + b, 0) / (validVolumes.length || 1);

    // Daily volume (last 20 days)
    const dailyVolume = timestamps.slice(-20).map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      volume: volumes[volumes.length - 20 + i] ?? 0,
      close: closes[closes.length - 20 + i] ?? 0,
    })).filter(d => d.volume > 0);

    // Market cap from Yahoo meta
    const marketCap = result.meta?.regularMarketPrice
      ? null  // would need shares outstanding
      : null;

    return {
      volumeRatio, avgRecent, avgVol3m,
      ret1w, ret1m, ret3m, current,
      high52, low52, dailyVolume, marketCap,
    };
  } catch { return null; }
}

// ── Yahoo Finance key stats (free v7 endpoint) ─────────────────────────────
async function fetchKeyStats(ticker: string) {
  try {
    // v7 quote endpoint - doesn't require crumb
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const q = data?.quoteResponse?.result?.[0];
    if (!q) return null;
    return {
      marketCap: q.marketCap ?? null,
      sharesOutstanding: q.sharesOutstanding ?? null,
      shortRatio: q.shortRatio ?? null,
      avgVol10d: q.averageDailyVolume10Day ?? null,
      avgVol3m: q.averageDailyVolume3Month ?? null,
    };
  } catch { return null; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });

  const redis = createRedis();
  const cacheKey = `flowvium:stock-supply:v2:${ticker}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return NextResponse.json({ ...(cached as object), cached: true }, { headers: CDN_HEADERS });
    } catch { /* non-fatal */ }
  }

  // Static 13F data from our data files
  const staticEntry = newsGapData.find(n => n.ticker === ticker);
  const ownership13F = staticEntry?.ownershipData ?? [];

  // Fetch data in parallel (volume + insiders can run simultaneously)
  const [volResult, statsResult, insidersResult] = await Promise.allSettled([
    fetchVolumeData(ticker),
    fetchKeyStats(ticker),
    fetchInsiderTransactions(ticker),
  ]);

  const volData = volResult.status === 'fulfilled' ? volResult.value : null;
  const statsData = statsResult.status === 'fulfilled' ? statsResult.value : null;
  const insiderTransactions = insidersResult.status === 'fulfilled' ? insidersResult.value : [];

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
    price: volData?.current ?? null,
    ret1w: volData?.ret1w ?? null,
    ret1m: volData?.ret1m ?? null,
    ret3m: volData?.ret3m ?? null,
    high52: volData?.high52 ?? null,
    low52: volData?.low52 ?? null,
    volumeRatio: volData?.volumeRatio ?? null,
    avgVol10d: statsData?.avgVol10d ?? null,
    avgVol3m: statsData?.avgVol3m ?? volData?.avgVol3m ?? null,
    dailyVolume: volData?.dailyVolume ?? [],
    marketCap: statsData?.marketCap ?? null,
    sharesOutstanding: statsData?.sharesOutstanding ?? null,
    instHeld: null as null,         // not available without crumb
    insiderHeld: null as null,      // not available without crumb
    shortPct: null as null,         // not available without crumb
    shortRatio: statsData?.shortRatio ?? null,
    ownership13F,
    liveInstitutions: [],
    insiderTransactions,
    supplyScore,
    supplyFactors: factors,
    supplyLabel,
    updatedAt: new Date().toISOString(),
    cached: false,
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

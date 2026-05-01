/**
 * paper-trading.ts — AI 리포트 가상 매매 시스템
 *
 * 리포트 생성 시 추천 포트폴리오대로 가상 매수/매도 실행.
 * 실제 체결가 기준 P&L 추적 → retrospective 정확도 향상.
 *
 * Redis keys:
 *   flowvium:paper:account:v1   — 계좌 현황 (현금 + 포지션)
 *   flowvium:paper:trades:v1    — 거래 내역 (최근 200건)
 *   flowvium:paper:snapshots:v1 — 일별 자산 스냅샷 (포트폴리오 가치 추이)
 */

import type { Redis } from '@upstash/redis';
import { loggedRedisSet } from '@/lib/logger';

const ACCOUNT_KEY   = 'flowvium:paper:account:v1';
const TRADES_KEY    = 'flowvium:paper:trades:v1';
const SNAPSHOTS_KEY = 'flowvium:paper:snapshots:v1';

export const INITIAL_CASH = 100_000; // 가상 시드 $100,000
const TRADE_FEE_PCT = 0.001;         // 0.1% 거래 수수료

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Position {
  ticker: string;
  name: string;
  shares: number;         // 보유 수량
  avgCost: number;        // 평균 매입가
  currentPrice: number;   // 최근 시세
  marketValue: number;    // 시장가치
  unrealizedPnl: number;  // 미실현 손익
  unrealizedPct: number;  // 미실현 수익률 %
  sector: string;
  action: string;         // 리포트 추천 액션
  reportDate: string;     // 매수 리포트 날짜
  allocation: number;     // 리포트 추천 비중
  stopLoss: number | null;
  target: number | null;
}

export interface Trade {
  id: string;
  timestamp: string;
  ticker: string;
  name: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;           // 체결가
  amount: number;          // 거래금액
  fee: number;
  pnl: number | null;      // 실현 손익 (매도 시)
  pnlPct: number | null;
  reason: string;          // 매매 이유 (리포트 기준)
  reportDate: string;
}

export interface Account {
  cash: number;
  positions: Position[];
  totalValue: number;      // 현금 + 포지션 시장가치
  totalPnl: number;        // 총 손익 (vs 시드)
  totalPnlPct: number;
  lastUpdated: string;
  reportCount: number;     // 처리한 리포트 수
}

export interface DailySnapshot {
  date: string;            // YYYY-MM-DD (KST)
  totalValue: number;
  cash: number;
  positionValue: number;
  pnlPct: number;
}

// ── Yahoo price fetch ─────────────────────────────────────────────────────────

async function fetchPrice(ticker: string): Promise<number | null> {
  // query1 → query2 폴백 (Vercel IP 차단 대응)
  for (const host of ['query1', 'query2'] as const) {
    try {
      const res = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, cache: 'no-store', signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) continue;
      const d = await res.json();
      const closes: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const valid = closes.filter(Boolean);
      if (valid.length) return valid[valid.length - 1];
    } catch { /* try next host */ }
  }
  return null;
}

// ── Account CRUD ──────────────────────────────────────────────────────────────

async function getAccount(redis: Redis): Promise<Account> {
  const raw = await redis.get<Account>(ACCOUNT_KEY).catch(() => null);
  if (raw && typeof raw.cash === 'number') return raw;
  return {
    cash: INITIAL_CASH,
    positions: [],
    totalValue: INITIAL_CASH,
    totalPnl: 0,
    totalPnlPct: 0,
    lastUpdated: new Date().toISOString(),
    reportCount: 0,
  };
}

async function saveAccount(redis: Redis, account: Account): Promise<void> {
  account.lastUpdated = new Date().toISOString();
  account.totalValue = account.cash + account.positions.reduce((s, p) => s + p.marketValue, 0);
  account.totalPnl = account.totalValue - INITIAL_CASH;
  account.totalPnlPct = parseFloat(((account.totalPnl / INITIAL_CASH) * 100).toFixed(2));
  await loggedRedisSet(redis, 'paper-trading', ACCOUNT_KEY, account, { ex: 365 * 86400 });
}

async function addTrade(redis: Redis, trade: Trade): Promise<void> {
  const raw = await redis.get<Trade[]>(TRADES_KEY).catch(() => null);
  const existing = Array.isArray(raw) ? raw : [];
  const updated = [trade, ...existing].slice(0, 200);
  await loggedRedisSet(redis, 'paper-trading', TRADES_KEY, updated, { ex: 365 * 86400 });
}

// ── Core trading logic ────────────────────────────────────────────────────────

/**
 * 리포트 포트폴리오 기준으로 가상 매매 실행.
 * - 리포트에 없는 포지션은 청산
 * - 리포트 비중대로 목표 포지션 계산 후 매수/매도
 */
export async function executeReportTrades(
  redis: Redis,
  portfolio: Array<{
    ticker: string; name?: string; allocation: number; action?: string;
    sector?: string; stopLoss?: string; target?: string;
    entryZone?: string; rationale?: string; currentPrice?: number;
  }>,
  reportDate: string,
): Promise<{ bought: string[]; sold: string[]; skipped: string[]; totalValue: number }> {
  const account = await getAccount(redis);
  const now = new Date().toISOString();
  const kstDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  // 현재 포지션 가격 업데이트
  const priceResults = await Promise.allSettled(
    account.positions.map(p => fetchPrice(p.ticker))
  );
  for (let i = 0; i < account.positions.length; i++) {
    const pr = priceResults[i];
    if (pr.status === 'fulfilled' && pr.value) {
      account.positions[i].currentPrice = pr.value;
      account.positions[i].marketValue = account.positions[i].shares * pr.value;
      account.positions[i].unrealizedPnl = account.positions[i].marketValue - account.positions[i].shares * account.positions[i].avgCost;
      account.positions[i].unrealizedPct = parseFloat(((account.positions[i].unrealizedPnl / (account.positions[i].shares * account.positions[i].avgCost)) * 100).toFixed(2));
    }
  }

  // 리포트 watch 종목 제외 (buy만 포지션 진입)
  const buyItems = portfolio.filter(p => p.action !== 'watch' && p.allocation > 0);
  const targetTickers = new Set(buyItems.map(p => p.ticker.toUpperCase()));

  const bought: string[] = [];
  const sold: string[] = [];
  const skipped: string[] = [];
  const trades: Trade[] = [];

  // 1. 리포트에 없는 포지션 청산
  const toSell = account.positions.filter(p => !targetTickers.has(p.ticker.toUpperCase()));
  for (const pos of toSell) {
    const price = pos.currentPrice;
    if (!price || pos.shares <= 0) continue;
    const amount = pos.shares * price;
    const fee = amount * TRADE_FEE_PCT;
    const realizedPnl = amount - fee - pos.shares * pos.avgCost;
    const realizedPct = parseFloat(((realizedPnl / (pos.shares * pos.avgCost)) * 100).toFixed(2));
    account.cash += amount - fee;
    trades.push({
      id: `${now}-sell-${pos.ticker}`,
      timestamp: now, ticker: pos.ticker, name: pos.name,
      type: 'sell', shares: pos.shares, price, amount, fee,
      pnl: parseFloat(realizedPnl.toFixed(2)), pnlPct: realizedPct,
      reason: '리포트에서 제외 → 청산', reportDate,
    });
    sold.push(pos.ticker);
  }
  account.positions = account.positions.filter(p => targetTickers.has(p.ticker.toUpperCase()));

  // 2. 총 자산 재계산 (매도 후)
  const currentTotal = account.cash + account.positions.reduce((s, p) => s + p.marketValue, 0);

  // 3. 목표 비중대로 매수
  // currentPrice (리포트가 제공한 live 가격)을 우선 사용 — Yahoo IP 차단 대응
  const priceMap = new Map<string, number>();
  for (const item of buyItems) {
    if (item.currentPrice && item.currentPrice > 0) {
      priceMap.set(item.ticker.toUpperCase(), item.currentPrice);
    }
  }
  // currentPrice 없는 종목만 Yahoo에서 조회
  const missingTickers = buyItems.filter(p => !priceMap.has(p.ticker.toUpperCase()));
  if (missingTickers.length > 0) {
    const fetched = await Promise.allSettled(missingTickers.map(p => fetchPrice(p.ticker)));
    for (let i = 0; i < missingTickers.length; i++) {
      const pr = fetched[i];
      if (pr.status === 'fulfilled' && pr.value) priceMap.set(missingTickers[i].ticker.toUpperCase(), pr.value);
    }
  }

  for (const item of buyItems) {
    const ticker = item.ticker.toUpperCase();
    const price = priceMap.get(ticker);
    if (!price) { skipped.push(item.ticker); continue; }

    const targetValue = currentTotal * (item.allocation / 100);
    const existing = account.positions.find(p => p.ticker.toUpperCase() === ticker);
    const currentValue = existing ? existing.marketValue : 0;
    const diff = targetValue - currentValue;

    if (Math.abs(diff) < 50) continue; // $50 이하 리밸런싱 스킵

    const parseP = (s?: string) => { if (!s||s==='-') return null; const n=parseFloat(s.replace(/[$₩,%]/g,'')); return isNaN(n)?null:n; };

    if (diff > 0) {
      // 매수
      const sharesToBuy = Math.floor(diff / price);
      if (sharesToBuy < 1) { skipped.push(item.ticker); continue; }
      const amount = sharesToBuy * price;
      const fee = amount * TRADE_FEE_PCT;
      if (amount + fee > account.cash) { skipped.push(item.ticker); continue; }
      account.cash -= amount + fee;

      if (existing) {
        // 평균 단가 업데이트
        const totalShares = existing.shares + sharesToBuy;
        existing.avgCost = (existing.shares * existing.avgCost + sharesToBuy * price) / totalShares;
        existing.shares = totalShares;
        existing.currentPrice = price;
        existing.marketValue = totalShares * price;
        existing.unrealizedPnl = existing.marketValue - totalShares * existing.avgCost;
        existing.unrealizedPct = parseFloat(((existing.unrealizedPnl / (totalShares * existing.avgCost)) * 100).toFixed(2));
        existing.allocation = item.allocation;
        existing.stopLoss = parseP(item.stopLoss);
        existing.target = parseP(item.target);
      } else {
        account.positions.push({
          ticker: item.ticker, name: item.name ?? item.ticker,
          shares: sharesToBuy, avgCost: price, currentPrice: price,
          marketValue: sharesToBuy * price, unrealizedPnl: 0, unrealizedPct: 0,
          sector: item.sector ?? '', action: item.action ?? 'buy',
          reportDate, allocation: item.allocation,
          stopLoss: parseP(item.stopLoss), target: parseP(item.target),
        });
      }
      trades.push({
        id: `${now}-buy-${item.ticker}`, timestamp: now,
        ticker: item.ticker, name: item.name ?? item.ticker,
        type: 'buy', shares: sharesToBuy, price, amount, fee,
        pnl: null, pnlPct: null,
        reason: (item.rationale ?? '').slice(0, 80), reportDate,
      });
      bought.push(item.ticker);
    } else if (diff < -100) {
      // 일부 매도 (리밸런싱)
      if (!existing) continue;
      const sharesToSell = Math.min(existing.shares, Math.floor(-diff / price));
      if (sharesToSell < 1) continue;
      const amount = sharesToSell * price;
      const fee = amount * TRADE_FEE_PCT;
      const pnl = (price - existing.avgCost) * sharesToSell - fee;
      const pnlPct = parseFloat(((pnl / (existing.avgCost * sharesToSell)) * 100).toFixed(2));
      account.cash += amount - fee;
      existing.shares -= sharesToSell;
      existing.marketValue = existing.shares * price;
      existing.unrealizedPnl = existing.marketValue - existing.shares * existing.avgCost;
      existing.unrealizedPct = existing.shares > 0 ? parseFloat(((existing.unrealizedPnl / (existing.shares * existing.avgCost)) * 100).toFixed(2)) : 0;
      trades.push({
        id: `${now}-sell-trim-${item.ticker}`, timestamp: now,
        ticker: item.ticker, name: item.name ?? item.ticker,
        type: 'sell', shares: sharesToSell, price, amount, fee,
        pnl: parseFloat(pnl.toFixed(2)), pnlPct,
        reason: '비중 축소 (리밸런싱)', reportDate,
      });
    }
  }

  account.positions = account.positions.filter(p => p.shares > 0);
  account.reportCount++;

  // 저장
  await Promise.allSettled([
    saveAccount(redis, account),
    ...trades.map(t => addTrade(redis, t)),
    // 일별 스냅샷 저장
    (async () => {
      const raw = await redis.get<DailySnapshot[]>(SNAPSHOTS_KEY).catch(() => null);
      const snaps = Array.isArray(raw) ? raw : [];
      const totalVal = account.cash + account.positions.reduce((s,p) => s + p.marketValue, 0);
      const snap: DailySnapshot = {
        date: kstDate, totalValue: parseFloat(totalVal.toFixed(2)),
        cash: parseFloat(account.cash.toFixed(2)),
        positionValue: parseFloat((totalVal - account.cash).toFixed(2)),
        pnlPct: parseFloat(((totalVal - INITIAL_CASH) / INITIAL_CASH * 100).toFixed(2)),
      };
      const updated = [snap, ...snaps.filter(s => s.date !== kstDate)].slice(0, 365);
      await loggedRedisSet(redis, 'paper-trading', SNAPSHOTS_KEY, updated, { ex: 365 * 86400 });
    })(),
  ]);

  return { bought, sold, skipped, totalValue: account.totalValue };
}

/** stop-loss / target 자동 청산 체크 (크론에서 호출) */
export async function checkStopLossAndTarget(redis: Redis): Promise<{ triggered: Trade[] }> {
  const account = await getAccount(redis);
  if (!account.positions.length) return { triggered: [] };
  const triggered: Trade[] = [];
  const now = new Date().toISOString();

  const priceResults = await Promise.allSettled(account.positions.map(p => fetchPrice(p.ticker)));
  const toKeep: Position[] = [];

  for (let i = 0; i < account.positions.length; i++) {
    const pos = account.positions[i];
    const pr = priceResults[i];
    const price = pr.status === 'fulfilled' ? pr.value : null;
    if (!price) { toKeep.push(pos); continue; }

    pos.currentPrice = price;
    pos.marketValue = pos.shares * price;
    pos.unrealizedPnl = pos.marketValue - pos.shares * pos.avgCost;
    pos.unrealizedPct = parseFloat(((pos.unrealizedPnl / (pos.shares * pos.avgCost)) * 100).toFixed(2));

    let reason = '';
    if (pos.stopLoss && price <= pos.stopLoss) reason = `손절 (${price.toFixed(2)} ≤ SL ${pos.stopLoss})`;
    else if (pos.target && price >= pos.target) reason = `목표가 도달 (${price.toFixed(2)} ≥ TG ${pos.target})`;

    if (reason) {
      const amount = pos.shares * price;
      const fee = amount * TRADE_FEE_PCT;
      const pnl = (price - pos.avgCost) * pos.shares - fee;
      account.cash += amount - fee;
      const trade: Trade = {
        id: `${now}-auto-${pos.ticker}`, timestamp: now,
        ticker: pos.ticker, name: pos.name,
        type: 'sell', shares: pos.shares, price, amount, fee,
        pnl: parseFloat(pnl.toFixed(2)), pnlPct: parseFloat(((pnl / (pos.avgCost * pos.shares)) * 100).toFixed(2)),
        reason, reportDate: pos.reportDate,
      };
      triggered.push(trade);
      await addTrade(redis, trade);
    } else {
      toKeep.push(pos);
    }
  }

  account.positions = toKeep;
  await saveAccount(redis, account);
  return { triggered };
}

/** 계좌 현황 조회 */
export async function getAccountSummary(redis: Redis): Promise<Account> {
  return getAccount(redis);
}

/** 거래 내역 조회 */
export async function getTradeHistory(redis: Redis, limit = 50): Promise<Trade[]> {
  const raw = await redis.get<Trade[]>(TRADES_KEY).catch(() => null);
  return Array.isArray(raw) ? raw.slice(0, limit) : [];
}

/** 포트폴리오 가치 추이 */
export async function getSnapshots(redis: Redis, days = 30): Promise<DailySnapshot[]> {
  const raw = await redis.get<DailySnapshot[]>(SNAPSHOTS_KEY).catch(() => null);
  return Array.isArray(raw) ? raw.slice(0, days) : [];
}

/** 계좌 초기화 */
export async function resetAccount(redis: Redis): Promise<void> {
  const fresh: Account = {
    cash: INITIAL_CASH, positions: [], totalValue: INITIAL_CASH,
    totalPnl: 0, totalPnlPct: 0, lastUpdated: new Date().toISOString(), reportCount: 0,
  };
  await Promise.allSettled([
    loggedRedisSet(redis, 'paper-trading', ACCOUNT_KEY, fresh, { ex: 365 * 86400 }),
    loggedRedisSet(redis, 'paper-trading', TRADES_KEY, [], { ex: 365 * 86400 }),
  ]);
}

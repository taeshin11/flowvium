import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 30 * 60; // 30 minutes

// ── Address format detection ───────────────────────────────────────────────────
function detectChain(address: string): 'eth' | 'btc' | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return 'eth';
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return 'btc';
  if (/^bc1[a-z0-9]{6,87}$/.test(address)) return 'btc';
  return null;
}

// ── BTC fetch via blockchain.info ──────────────────────────────────────────────
interface BtcTx {
  hash: string;
  time: number;
  result: number;
}

interface BtcRawAddr {
  final_balance: number;
  total_received: number;
  total_sent: number;
  n_tx: number;
  txs: BtcTx[];
}

async function fetchBtc(address: string) {
  const res = await fetch(
    `https://blockchain.info/rawaddr/${address}?limit=10`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    }
  );
  if (!res.ok) throw new Error(`blockchain.info HTTP ${res.status}`);
  const data: BtcRawAddr = await res.json();

  const satToBtc = (sat: number) => sat / 1e8;
  const balance = satToBtc(data.final_balance);
  const totalReceived = satToBtc(data.total_received);
  const totalSent = satToBtc(data.total_sent);
  const txCount = data.n_tx;

  const recentTxs = (data.txs ?? []).slice(0, 5).map((tx) => ({
    hash: tx.hash,
    time: new Date(tx.time * 1000).toISOString(),
    value: Math.abs(satToBtc(tx.result)),
    direction: tx.result >= 0 ? 'in' : 'out',
  }));

  const riskFlags: string[] = [];
  if (txCount > 1000) riskFlags.push('고빈도 거래');
  if (balance > 1000) riskFlags.push('대규모 잔고');

  // Smurfing heuristic: more than 5 recent txs with value < 0.01 BTC each
  const smallTxs = recentTxs.filter((tx) => tx.value < 0.01);
  if (smallTxs.length >= 4) riskFlags.push('스머핑 의심');

  return {
    chain: 'btc',
    address,
    balance,
    balanceUsd: null,
    totalReceived,
    totalSent,
    txCount,
    recentTxs,
    riskFlags,
  };
}

// ── ETH fetch via Ethplorer (free, no rate-limit issues on shared IPs) ────────
interface EthplorerTransfer {
  transactionHash: string;
  timestamp: number;
  from: string;
  to: string;
  value: number;
  type: string;
}

interface EthplorerResponse {
  address: {
    balance: number;      // in ETH (not Wei)
    countTxs?: number;
    receivedEth?: number;
    sentEth?: number;
  };
  ETH?: {
    balance: number;
    price?: { rate: number };
  };
  transfers?: EthplorerTransfer[];
  error?: { code: number; message: string };
}

// 2026-06-04: Ethplorer freekey 는 countTxs 를 안 줌(data.address 가 객체 아닌 주소 문자열) →
//   txCount 가 항상 0 으로 표시되던 버그. 키리스 공개 RPC 의 eth_getTransactionCount(nonce=발신 거래수)
//   로 대체. publicnode 우선, 실패 시 cloudflare 폴백.
async function fetchEthTxCount(address: string): Promise<number | null> {
  const RPCS = ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com'];
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [address, 'latest'] }),
        signal: AbortSignal.timeout(8000), cache: 'no-store',
      });
      if (!r.ok) continue;
      const j = await r.json() as { result?: string };
      if (typeof j.result === 'string' && /^0x[0-9a-f]+$/i.test(j.result)) {
        const n = parseInt(j.result, 16);
        if (Number.isFinite(n)) return n;
      }
    } catch { /* try next RPC */ }
  }
  return null;
}

async function fetchEth(address: string) {
  // Ethplorer provides a free 'freekey' for public use (10 req/min limit)
  const apiKey = process.env.ETHPLORER_API_KEY?.trim() || 'freekey';
  const res = await fetch(
    `https://api.ethplorer.io/getAddressInfo/${address}?apiKey=${apiKey}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    }
  );
  if (!res.ok) throw new Error(`Ethplorer HTTP ${res.status}`);
  const data: EthplorerResponse = await res.json();

  if (data.error) throw new Error(`Ethplorer: ${data.error.message}`);

  // data.address 는 freekey 에서 주소 문자열 → 객체 필드(balance/countTxs/receivedEth)는 없음.
  const addrObj = (typeof data.address === 'object' && data.address) ? data.address : undefined;
  const balance = data.ETH?.balance ?? addrObj?.balance ?? 0;
  const totalReceived = addrObj?.receivedEth ?? null;  // freekey 미제공 → null(0 위장 금지)
  const totalSent = addrObj?.sentEth ?? null;
  // txCount: Ethplorer countTxs 없으면 공개 RPC nonce(발신 거래수)로 대체.
  //   2026-06-05 fix: ?? 는 countTxs=0(ethplorer 가 null→0 으로 동작 변경)을 nullish 로 안 봐서
  //   RPC 폴백(5896)을 안 탔음 → txCount=0 결함. || 로 0 도 폴백 트리거.
  const txCount = (addrObj?.countTxs || (await fetchEthTxCount(address)) || 0);
  const usdRate = data.ETH?.price?.rate ?? null;
  const balanceUsd = usdRate ? Math.round(balance * usdRate) : null;

  const recentTxs = (data.transfers ?? []).slice(0, 5).map((tx) => ({
    hash: tx.transactionHash,
    time: new Date(tx.timestamp * 1000).toISOString(),
    value: Math.abs(tx.value ?? 0),
    direction: tx.to?.toLowerCase() === address.toLowerCase() ? 'in' : 'out',
  }));

  const riskFlags: string[] = [];
  if (txCount > 1000) riskFlags.push('고빈도 거래');
  if (balance > 10000) riskFlags.push('대규모 잔고');
  const smallTxs = recentTxs.filter((tx) => tx.value < 0.01);
  if (smallTxs.length >= 4) riskFlags.push('스머핑 의심');

  return {
    chain: 'eth',
    address,
    balance,
    balanceUsd,
    totalReceived,
    totalSent,
    txCount,
    recentTxs,
    riskFlags,
  };
}

// ── Route handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address')?.trim() ?? '';
  const chainParam = searchParams.get('chain') ?? 'auto';

  if (!address) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 });
  }

  let chain: 'eth' | 'btc';

  if (chainParam === 'eth') {
    chain = 'eth';
  } else if (chainParam === 'btc') {
    chain = 'btc';
  } else {
    // auto-detect
    const detected = detectChain(address);
    if (!detected) {
      return NextResponse.json(
        { error: 'Unrecognized address format (ETH: 0x..., BTC: 1.../3.../bc1...)' },
        { status: 400 }
      );
    }
    chain = detected;
  }

  // Validate address format
  if (chain === 'eth' && !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid ETH address' }, { status: 400 });
  }
  if (
    chain === 'btc' &&
    !/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) &&
    !/^bc1[a-z0-9]{6,87}$/.test(address)
  ) {
    return NextResponse.json({ error: 'Invalid BTC address' }, { status: 400 });
  }

  const cacheKey = `flowvium:osint:crypto:v1:${chain}:${address}`;
  const redis = createRedis();

  if (redis) {
    try {
      const cached = await redis.get<object>(cacheKey);
      if (cached) return NextResponse.json(cached);
    } catch { /* non-fatal */ }
  }

  try {
    const result = chain === 'btc' ? await fetchBtc(address) : await fetchEth(address);

    if (redis) {
      await loggedRedisSet(redis, 'api.osint.crypto', cacheKey, result, { ex: CACHE_TTL });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to load data: ${message}` }, { status: 500 });
  }
}

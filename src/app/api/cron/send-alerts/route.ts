import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';
export const dynamic = 'force-dynamic';

export const maxDuration = 30;

// ── Types (mirrors fear-greed/route.ts entry shape) ─────────────────────────
interface FGEntry { score: number; level: string; trend: string; label: string; flag: string; }
interface VolData { vix: number | null; regime: string; }
interface MacroIndicator { id: string; actual: number | null; }
interface MacroData { indicators: MacroIndicator[] }
interface YCData { spread2s10sCurrent: number | null; inverted: boolean; }

interface AlertResult {
  type: string;
  sent: boolean;
  cooldown?: boolean;
  detail?: string;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// ── Discord webhook ──────────────────────────────────────────────────────────
async function sendDiscord(webhookUrl: string, embeds: object[]): Promise<boolean> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

// Cooldown key format: flowvium:discord-alert:{type}:{YYYY-MM-DD}
function cooldownKey(type: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `flowvium:discord-alert:${type}:${d}`;
}

async function isCooledDown(redis: Redis, type: string): Promise<boolean> {
  const val = await redis.get(cooldownKey(type));
  return val !== null;
}

async function markSent(redis: Redis, type: string): Promise<void> {
  await redis.set(cooldownKey(type), '1', { ex: 24 * 60 * 60 });
}

// ── Alert conditions ─────────────────────────────────────────────────────────

async function checkFGAlert(
  redis: Redis, webhookUrl: string
): Promise<AlertResult[]> {
  const entry = await redis.get<FGEntry>('flowvium:fg:v6:SPY');
  if (!entry) return [];

  const results: AlertResult[] = [];

  if (entry.score <= 25) {
    const type = 'fg-extreme-fear';
    const cooled = await isCooledDown(redis, type);
    if (!cooled) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '🚨 극단적 공포 경보 — Fear & Greed',
        description: `미국 시장 F&G 지수가 **극단적 공포** 구간에 진입했습니다.`,
        color: 0xE74C3C,
        fields: [
          { name: '현재 점수', value: `**${entry.score}** / 100`, inline: true },
          { name: '레벨', value: '🔴 Extreme Fear', inline: true },
          { name: '트렌드', value: entry.trend === 'down' ? '↓ 하락' : entry.trend === 'up' ? '↑ 상승' : '→ 중립', inline: true },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) await markSent(redis, type);
      results.push({ type, sent, detail: `score=${entry.score}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  }

  if (entry.score >= 75) {
    const type = 'fg-extreme-greed';
    const cooled = await isCooledDown(redis, type);
    if (!cooled) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '🚀 극단적 탐욕 경보 — Fear & Greed',
        description: `미국 시장 F&G 지수가 **극단적 탐욕** 구간에 진입했습니다.`,
        color: 0xF39C12,
        fields: [
          { name: '현재 점수', value: `**${entry.score}** / 100`, inline: true },
          { name: '레벨', value: '🟠 Extreme Greed', inline: true },
          { name: '트렌드', value: entry.trend === 'up' ? '↑ 상승' : entry.trend === 'down' ? '↓ 하락' : '→ 중립', inline: true },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) await markSent(redis, type);
      results.push({ type, sent, detail: `score=${entry.score}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  }

  return results;
}

async function checkVIXAlert(
  redis: Redis, webhookUrl: string
): Promise<AlertResult[]> {
  const vol = await redis.get<VolData>('flowvium:volatility:v1');
  if (!vol || vol.vix === null) return [];

  const results: AlertResult[] = [];

  if (vol.vix >= 30) {
    const type = 'vix-high';
    const cooled = await isCooledDown(redis, type);
    if (!cooled) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '⚡ VIX 고공포 경보',
        description: `VIX 지수가 고공포 구간 **(≥30)** 에 진입했습니다. 시장 변동성이 급격히 높아졌습니다.`,
        color: 0x9B59B6,
        fields: [
          { name: 'VIX', value: `**${vol.vix.toFixed(2)}**`, inline: true },
          { name: '레짐', value: vol.regime === 'backwardation' ? '역전 (Backwardation)' : vol.regime === 'contango' ? 'Contango' : vol.regime, inline: true },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) await markSent(redis, type);
      results.push({ type, sent, detail: `vix=${vol.vix.toFixed(2)}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  } else if (vol.vix >= 25) {
    const type = 'vix-caution';
    const cooled = await isCooledDown(redis, type);
    if (!cooled) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '⚠️ VIX 주의 구간',
        description: `VIX 지수가 주의 구간 **(≥25)** 에 도달했습니다.`,
        color: 0xE67E22,
        fields: [
          { name: 'VIX', value: `**${vol.vix.toFixed(2)}**`, inline: true },
          { name: '레짐', value: vol.regime, inline: true },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) await markSent(redis, type);
      results.push({ type, sent, detail: `vix=${vol.vix.toFixed(2)}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  }

  return results;
}

// ── Credit Spread Alert (IG OAS / HY OAS) ────────────────────────────────────
async function checkCreditAlert(
  redis: Redis, webhookUrl: string
): Promise<AlertResult[]> {
  // macro-indicators uses a KST-date key; try today and yesterday as fallback
  const kst = (daysAgo = 0) => {
    const ts = Date.now() + 9 * 3600000 - daysAgo * 86400000;
    return new Date(ts).toISOString().slice(0, 10);
  };
  let macro: MacroData | null = await redis.get<MacroData>(`flowvium:macro-indicators:v12:${kst(0)}`);
  if (!macro) macro = await redis.get<MacroData>(`flowvium:macro-indicators:v12:${kst(1)}`);
  if (!macro?.indicators?.length) return [];

  const ig = macro.indicators.find(i => i.id === 'ig_spread')?.actual ?? null;
  const hy = macro.indicators.find(i => i.id === 'hy_spread')?.actual ?? null;
  if (ig === null && hy === null) return [];

  const results: AlertResult[] = [];

  // HY > 5% = recession warning
  if (hy !== null && hy > 5.0) {
    const type = 'hy-stress';
    if (!(await isCooledDown(redis, type))) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '🚨 고수익채 신용 스트레스 — HY OAS > 5%',
        description: `정크본드 스프레드가 경기침체 경보 구간(**≥5.0%**)을 돌파했습니다. 신용 시장 패닉 신호.`,
        color: 0xC0392B,
        fields: [
          { name: 'HY OAS', value: `**${hy.toFixed(2)}%**`, inline: true },
          { name: 'IG OAS', value: ig !== null ? `${ig.toFixed(2)}%` : '—', inline: true },
          { name: '해석', value: '기업 부도 위험 상승 → 주식 선행 하락 신호', inline: false },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) await markSent(redis, type);
      results.push({ type, sent, detail: `hy=${hy.toFixed(2)}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  }

  // IG > 1.5% = credit warning
  if (ig !== null && ig > 1.5) {
    const type = 'ig-caution';
    if (!(await isCooledDown(redis, type))) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '⚠️ 투자등급채 신용 주의 — IG OAS > 1.5%',
        description: `투자등급 스프레드가 주의 구간(**≥1.5%**)에 도달했습니다.`,
        color: 0xE67E22,
        fields: [
          { name: 'IG OAS', value: `**${ig.toFixed(2)}%**`, inline: true },
          { name: 'HY OAS', value: hy !== null ? `${hy.toFixed(2)}%` : '—', inline: true },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) await markSent(redis, type);
      results.push({ type, sent, detail: `ig=${ig.toFixed(2)}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  }

  return results;
}

// ── Yield Curve Alert (10Y-2Y spread) ────────────────────────────────────────
async function checkYieldCurveAlert(
  redis: Redis, webhookUrl: string
): Promise<AlertResult[]> {
  const yc = await redis.get<YCData>('flowvium:yield-curve:v2');
  if (!yc || yc.spread2s10sCurrent === null) return [];

  const spread = yc.spread2s10sCurrent;
  const results: AlertResult[] = [];

  // Inversion alert: spread clearly negative (< -0.1%)
  if (yc.inverted && spread < -0.1) {
    const type = 'yc-inverted';
    if (!(await isCooledDown(redis, type))) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '📉 수익률 곡선 역전 — Yield Curve Inversion',
        description: `미국 10Y-2Y 국채 스프레드가 **역전** 상태입니다. 역사적으로 경기침체 선행 지표로 해석됩니다.`,
        color: 0xE74C3C,
        fields: [
          { name: '10Y-2Y 스프레드', value: `**${spread.toFixed(2)}%**`, inline: true },
          { name: '신호', value: '🔴 역전 (Inverted)', inline: true },
          { name: '해석', value: '과거 12~18개월 후 침체 가능성 — 단독 지표로 과신 금지', inline: false },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) await markSent(redis, type);
      results.push({ type, sent, detail: `spread=${spread.toFixed(2)}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  }

  // Normalization alert: spread turned positive (≥ 0.05%)
  if (!yc.inverted && spread >= 0.05) {
    const type = 'yc-normalized';
    if (!(await isCooledDown(redis, type))) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '📈 수익률 곡선 정상화 — Yield Curve Normalization',
        description: `미국 10Y-2Y 국채 스프레드가 **정상** 구간으로 복귀했습니다.`,
        color: 0x27AE60,
        fields: [
          { name: '10Y-2Y 스프레드', value: `**+${spread.toFixed(2)}%**`, inline: true },
          { name: '신호', value: '🟢 정상화 (Normal)', inline: true },
          { name: '해석', value: '역전 해소 → 단기 유동성 압박 완화 신호', inline: false },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) await markSent(redis, type);
      results.push({ type, sent, detail: `spread=${spread.toFixed(2)}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  }

  return results;
}

// ── GET handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    logger.info('send-alerts', 'skipped', { reason: 'DISCORD_WEBHOOK_URL not set' });
    return NextResponse.json({ skipped: true, reason: 'DISCORD_WEBHOOK_URL not configured' });
  }

  const redis = createRedis();
  if (!redis) {
    return NextResponse.json({ skipped: true, reason: 'Redis not configured' });
  }

  const start = Date.now();
  const [fgResults, vixResults, creditResults, ycResults] = await Promise.allSettled([
    checkFGAlert(redis, webhookUrl),
    checkVIXAlert(redis, webhookUrl),
    checkCreditAlert(redis, webhookUrl),
    checkYieldCurveAlert(redis, webhookUrl),
  ]);

  const alerts = [
    ...(fgResults.status === 'fulfilled' ? fgResults.value : []),
    ...(vixResults.status === 'fulfilled' ? vixResults.value : []),
    ...(creditResults.status === 'fulfilled' ? creditResults.value : []),
    ...(ycResults.status === 'fulfilled' ? ycResults.value : []),
  ];

  const sent = alerts.filter(a => a.sent).length;
  logger.info('send-alerts', 'done', { total: alerts.length, sent, durationMs: Date.now() - start });

  return NextResponse.json({ ok: true, alerts, durationMs: Date.now() - start });
}

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet, loggedRedisDel } from '@/lib/logger';
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
  await loggedRedisSet(redis, 'cron.send-alerts', cooldownKey(type), '1', { ex: 24 * 60 * 60 });
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
        title: '🚨 Extreme Fear Alert — Fear & Greed',
        description: `US market F&G index has entered **Extreme Fear** territory.`,
        color: 0xE74C3C,
        fields: [
          { name: 'Score', value: `**${entry.score}** / 100`, inline: true },
          { name: 'Level', value: '🔴 Extreme Fear', inline: true },
          { name: 'Trend', value: entry.trend === 'down' ? '↓ Falling' : entry.trend === 'up' ? '↑ Rising' : '→ Neutral', inline: true },
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
        title: '🚀 Extreme Greed Alert — Fear & Greed',
        description: `US market F&G index has entered **Extreme Greed** territory.`,
        color: 0xF39C12,
        fields: [
          { name: 'Score', value: `**${entry.score}** / 100`, inline: true },
          { name: 'Level', value: '🟠 Extreme Greed', inline: true },
          { name: 'Trend', value: entry.trend === 'up' ? '↑ Rising' : entry.trend === 'down' ? '↓ Falling' : '→ Neutral', inline: true },
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
        title: '⚡ VIX Extreme Fear',
        description: `VIX has entered extreme fear territory **(≥30)**. Market volatility has spiked sharply.`,
        color: 0x9B59B6,
        fields: [
          { name: 'VIX', value: `**${vol.vix.toFixed(2)}**`, inline: true },
          { name: 'Regime', value: vol.regime === 'backwardation' ? 'Backwardation' : vol.regime === 'contango' ? 'Contango' : vol.regime, inline: true },
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
        title: '⚠️ VIX Caution Zone',
        description: `VIX has reached the caution zone **(≥25)**.`,
        color: 0xE67E22,
        fields: [
          { name: 'VIX', value: `**${vol.vix.toFixed(2)}**`, inline: true },
          { name: 'Regime', value: vol.regime, inline: true },
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
  let macro: MacroData | null = await redis.get<MacroData>(`flowvium:macro-indicators:v13:${kst(0)}`);
  if (!macro) macro = await redis.get<MacroData>(`flowvium:macro-indicators:v13:${kst(1)}`);
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
        title: '🚨 High-Yield Credit Stress — HY OAS > 5%',
        description: `Junk bond spread has broken into recession warning territory (**≥5.0%**). Credit market panic signal.`,
        color: 0xC0392B,
        fields: [
          { name: 'HY OAS', value: `**${hy.toFixed(2)}%**`, inline: true },
          { name: 'IG OAS', value: ig !== null ? `${ig.toFixed(2)}%` : '—', inline: true },
          { name: 'Context', value: 'Rising corporate default risk → leading equities lower', inline: false },
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
        title: '⚠️ Investment-Grade Credit Warning — IG OAS > 1.5%',
        description: `Investment-grade spread has reached the caution zone (**≥1.5%**).`,
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

// Persistent inversion flag — survives across days (90d TTL).
// Set when yc-inverted fires; cleared when yc-normalized fires.
// Prevents yc-normalized from spamming when curve was never inverted.
const YC_INVERSION_FLAG = 'flowvium:discord-alert:yc-inversion-active';

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
        title: '📉 Yield Curve Inversion',
        description: `US 10Y-2Y Treasury spread is **inverted**. Historically interpreted as a leading indicator of recession.`,
        color: 0xE74C3C,
        fields: [
          { name: '10Y-2Y Spread', value: `**${spread.toFixed(2)}%**`, inline: true },
          { name: 'Signal', value: '🔴 Inverted', inline: true },
          { name: 'Context', value: 'Historically followed by recession 12-18mo later — do not over-rely on single indicator', inline: false },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) {
        await markSent(redis, type);
        // Mark that an inversion is active so normalization alert can fire later
        await loggedRedisSet(redis, 'cron.send-alerts', YC_INVERSION_FLAG, '1', { ex: 90 * 24 * 60 * 60 });
      }
      results.push({ type, sent, detail: `spread=${spread.toFixed(2)}` });
    } else {
      results.push({ type, sent: false, cooldown: true });
    }
  }

  // Normalization alert: spread turned positive (≥ 0.05%) — only fire if we
  // previously recorded an inversion. Prevents daily false-positives when the
  // curve was never inverted (yc-normalized would otherwise fire every day).
  if (!yc.inverted && spread >= 0.05) {
    const type = 'yc-normalized';
    const wasInverted = await redis.get(YC_INVERSION_FLAG);
    if (wasInverted && !(await isCooledDown(redis, type))) {
      const sent = await sendDiscord(webhookUrl, [{
        title: '📈 Yield Curve Normalization',
        description: `US 10Y-2Y Treasury spread has returned to **positive** territory.`,
        color: 0x27AE60,
        fields: [
          { name: '10Y-2Y Spread', value: `**+${spread.toFixed(2)}%**`, inline: true },
          { name: 'Signal', value: '🟢 Normal', inline: true },
          { name: 'Context', value: 'Inversion resolved → short-term liquidity pressure easing signal', inline: false },
        ],
        footer: { text: 'FlowVium · flowvium.vercel.app' },
        timestamp: new Date().toISOString(),
      }]);
      if (sent) {
        await markSent(redis, type);
        await loggedRedisDel(redis, 'cron.send-alerts', [YC_INVERSION_FLAG]);
      }
      results.push({ type, sent, detail: `spread=${spread.toFixed(2)}` });
    } else if (!wasInverted) {
      results.push({ type: 'yc-normalized', sent: false, detail: 'no prior inversion recorded — skipped' });
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

/**
 * /api/cron/signal-retrospective
 *
 * 주 1회 (일요일 03:30 UTC, evaluate-signals 30분 후) 실행.
 * 평가된 신호 기록 + 타임프레임별 정확도를 LLM에 요약 요청 →
 * Redis에 저장해 UI에서 "지난 2주 신호 회고" 카드로 표시.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
import { callAI } from '@/lib/ai-providers';
import {
  SIGNAL_LOG_KEY,
  SIGNAL_ACCURACY_PREFIX,
  type RotationSignal,
  type AccuracyRecord,
  type Timeframe,
} from '@/lib/signal-accuracy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const RETROSPECTIVE_KEY = 'flowvium:signal-retrospective:v1';
const RETROSPECTIVE_TTL = 14 * 86400; // 14 days

export interface SignalRetrospective {
  generatedAt: string;
  aiSummary: string;           // LLM 생성 회고문 (마크다운)
  aiSource: string;            // 어떤 AI 모델이 썼는지
  totalEvaluated: number;
  byTimeframe: Record<Timeframe, { samples: number; hitRate: number | null }>;
  topHits: Array<{ from: string; to: string; timeframe: Timeframe; spread: number }>;
  topMisses: Array<{ from: string; to: string; timeframe: Timeframe; spread: number }>;
}

function buildPrompt(
  signals: RotationSignal[],
  accuracy: Partial<Record<Timeframe, AccuracyRecord>>,
): string {
  const tfSummary = (['1w', '4w', '13w'] as Timeframe[])
    .map(tf => {
      const rec = accuracy[tf];
      if (!rec) return `${tf}: no data`;
      return `${tf}: ${(rec.hitRate * 100).toFixed(0)}% hit rate (${rec.samples} samples)${rec.suggestedThreshold ? `, suggest threshold ${rec.suggestedThreshold}%` : ''}`;
    })
    .join('\n');

  const hits = signals.filter(s => s.hit === true).slice(0, 5);
  const misses = signals.filter(s => s.hit === false).slice(0, 5);

  const hitLines = hits.map(s =>
    `  ✓ ${s.from}→${s.to} [${s.timeframe}] spread ${s.spread.toFixed(1)}%`
  ).join('\n') || '  (none)';

  const missLines = misses.map(s =>
    `  ✗ ${s.from}→${s.to} [${s.timeframe}] spread ${s.spread.toFixed(1)}%`
  ).join('\n') || '  (none)';

  return `You are a capital-flow analyst. Write a concise 2-3 paragraph retrospective (≤200 words, English) on recent rotation signal accuracy for the FlowVium investment dashboard.

Timeframe accuracy:
${tfSummary}

Recent hits (correct calls):
${hitLines}

Recent misses (wrong calls):
${missLines}

Guidelines:
- Be specific about which timeframes performed best/worst
- Mention any patterns in the hits vs misses (sector type, spread size)
- Suggest one actionable insight for signal filtering
- Tone: analytical, concise, no fluff`;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (cronSecret && auth !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redis = createRedis();
  if (!redis) return NextResponse.json({ ok: false, error: 'no redis' });

  const start = Date.now();
  try {
    // Read signal log (last 200 entries)
    const raw = await redis.lrange(SIGNAL_LOG_KEY, 0, 199);
    const allSignals: RotationSignal[] = raw.flatMap(r => {
      try { return [JSON.parse(r as string) as RotationSignal]; } catch { return []; }
    });
    const evaluated = allSignals.filter(s => s.evaluated && s.hit !== undefined);

    // Read accuracy records
    const accuracy: Partial<Record<Timeframe, AccuracyRecord>> = {};
    for (const tf of ['1w', '4w', '13w'] as Timeframe[]) {
      const rec = await redis.get(`${SIGNAL_ACCURACY_PREFIX}:${tf}`);
      if (rec) accuracy[tf] = JSON.parse(rec as string) as AccuracyRecord;
    }

    // Build summary stats
    const byTimeframe = {} as Record<Timeframe, { samples: number; hitRate: number | null }>;
    for (const tf of ['1w', '4w', '13w'] as Timeframe[]) {
      const rec = accuracy[tf];
      byTimeframe[tf] = { samples: rec?.samples ?? 0, hitRate: rec?.hitRate ?? null };
    }

    const topHits = evaluated
      .filter(s => s.hit === true)
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 5)
      .map(s => ({ from: s.from, to: s.to, timeframe: s.timeframe, spread: s.spread }));

    const topMisses = evaluated
      .filter(s => s.hit === false)
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 5)
      .map(s => ({ from: s.from, to: s.to, timeframe: s.timeframe, spread: s.spread }));

    // Call AI for summary
    const prompt = buildPrompt(evaluated, accuracy);
    const aiResult = await callAI(prompt, {
      tag: 'cron.signal-retrospective',
      maxTokens: 400,
      temperature: 0.6,
      skipVllm: true, // EXAONE is too small for analytical English writing
    });

    const retrospective: SignalRetrospective = {
      generatedAt: new Date().toISOString(),
      aiSummary: aiResult.text || 'Insufficient signal data for retrospective analysis.',
      aiSource: aiResult.source,
      totalEvaluated: evaluated.length,
      byTimeframe,
      topHits,
      topMisses,
    };

    await loggedRedisSet(redis, 'cron.signal-retrospective', RETROSPECTIVE_KEY, retrospective, { ex: RETROSPECTIVE_TTL });

    logger.info('cron.signal-retrospective', 'done', {
      evaluated: evaluated.length,
      aiSource: aiResult.source,
      durationMs: Date.now() - start,
    });

    return NextResponse.json({ ok: true, evaluated: evaluated.length, aiSource: aiResult.source, durationMs: Date.now() - start });
  } catch (e) {
    logger.error('cron.signal-retrospective', 'exception', { error: String(e) });
    return NextResponse.json({ ok: false, error: String(e), durationMs: Date.now() - start });
  }
}

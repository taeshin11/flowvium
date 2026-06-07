/**
 * GET /api/company-desc/[ticker]?locale=ko
 *
 * 회사 사업 개요(description) 동적 생성 — 정적 하드코딩 금지(2026-06-03 사용자 지적).
 *   DART 기업정보(corpName/영문명/업종/매출)로 grounding → 로컬 Ollama 로 2-3문장 요약 생성.
 *   Redis 45일 TTL 캐시(갱신 가능) — 하드코딩 .ts 아님. cloud 의존 X(자가호스팅 Ollama).
 *
 * 현재 KR(.KS/.KQ) 종목 대상. 환각 방지: "알려진 사실만, 수치/고객사 날조 금지" 지시.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRedis } from '@/lib/redis';
import { loggedRedisSet, logger } from '@/lib/logger';
import { localChat } from '@/lib/llm-local';
import { fetchDartFinancials } from '@/lib/dart-financials';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TTL = 45 * 24 * 3600; // 45일
const LOCALE_NAMES: Record<string, string> = {
  ko: 'Korean', en: 'English', ja: 'Japanese', 'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', th: 'Thai',
  vi: 'Vietnamese', id: 'Indonesian', tr: 'Turkish',
};

// 2026-06-07: 모델 통일 — qwen3:8b 네이티브(think:false) localChat. 종전 /v1+exaone 제거.
async function generateViaOllama(prompt: string): Promise<string | null> {
  let txt = await localChat(prompt, { temperature: 0.2, maxTokens: 1024, timeoutMs: 60000 });
  if (!txt) return null;
  // 따옴표/머리말 제거
  txt = txt.replace(/^["'「『]|["'」』]$/g, '').replace(/^(요약|사업\s*개요)\s*[:：]\s*/i, '').trim();
  return txt || null;
}

export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.trim();
  const url = new URL(_req.url);
  const locale = (url.searchParams.get('locale') || 'ko').trim();
  const langName = LOCALE_NAMES[locale] ?? 'Korean';
  const stockCode = ticker.replace(/\.(KS|KQ)$/i, '');
  const isKR = /^\d{6}$/.test(stockCode);

  const redis = createRedis();
  const key = `flowvium:company-desc:v2:${stockCode}:${locale}`;  // v2: US 지원 추가
  if (redis) {
    try {
      const cached = await redis.get<string>(key);
      if (cached) return NextResponse.json({ description: cached, cached: true, source: 'ollama' });
    } catch { /* non-fatal */ }
  }

  let grounding = '';
  if (isKR) {
    // KR — DART grounding
    const fin = await fetchDartFinancials(stockCode, redis).catch(() => null);
    if (!fin) return NextResponse.json({ description: null, error: 'no-dart-data' });
    const rev = fin.latestAnnual?.revenueKRW;
    const revStr = rev != null ? (rev >= 1e12 ? `${(rev / 1e12).toFixed(1)}조원` : `${Math.round(rev / 1e8)}억원`) : '미상';
    const ci = fin.corpInfo ?? {};
    grounding = [
      `기업명: ${fin.corpName}`,
      ci.corpNameEng ? `영문명: ${ci.corpNameEng}` : '',
      ci.indutyCode ? `한국표준산업분류 업종코드: ${ci.indutyCode}` : '',
      ci.establishedDate ? `설립: ${ci.establishedDate.slice(0, 4)}년` : '',
      `최근(${fin.fiscalYear}) 매출: ${revStr}`,
      fin.corpCls === 'Y' ? '시장: KOSPI' : fin.corpCls === 'K' ? '시장: KOSDAQ' : '',
    ].filter(Boolean).join('\n');
  } else {
    // 2026-06-04: US/ADR — SEC company-financials grounding (allCompanies 정적프로필 없는 GDDY 등 사각지대).
    const base = `http://localhost:${process.env.PORT || 3000}`;
    let fin = null;
    try { const r = await fetch(`${base}/api/company-financials/${stockCode.toUpperCase()}`, { signal: AbortSignal.timeout(20000) }); if (r.ok) fin = await r.json(); } catch { /* */ }
    if (!fin || fin.error || fin.latestAnnual?.revenueUSD == null) return NextResponse.json({ description: null, error: 'no-financials' });
    const revUSD = fin.latestAnnual.revenueUSD;
    const revStr = revUSD >= 1e9 ? `$${(revUSD / 1e9).toFixed(1)}B` : `$${Math.round(revUSD / 1e6)}M`;
    grounding = [
      `Company: ${fin.companyName || stockCode.toUpperCase()} (${stockCode.toUpperCase()})`,
      `Recent (${fin.latestAnnual.fy ?? fin.fiscalYear}) revenue: ${revStr}`,
      fin.latestAnnual.netIncomeUSD != null ? `Net income: $${(fin.latestAnnual.netIncomeUSD / 1e9).toFixed(1)}B` : '',
      `Filings: ${fin.source ?? 'SEC EDGAR'}`,
    ].filter(Boolean).join('\n');
  }

  const prompt = `다음은 상장기업의 공시 기본정보입니다. 이 기업이 무엇을 하는 회사인지 ${langName}로 2~3문장으로 객관적으로 요약하세요.
규칙: 널리 알려진 사실(주력 사업영역/제품군)만 기술. 구체적 매출 비중·고객사·점유율 등 확인 불가한 수치는 절대 날조하지 말 것. 불확실하면 일반적 사업영역만 간결히. 머리말/따옴표 없이 본문만.

${grounding}

요약:`;

  const desc = await generateViaOllama(prompt);
  if (!desc) return NextResponse.json({ description: null, error: 'generation-failed' });

  if (redis) {
    try { await loggedRedisSet(redis, 'api.company-desc', key, desc, { ex: TTL }); }
    catch (e) { logger.warn('api.company-desc', 'cache_write_failed', { stockCode, error: String(e).slice(0, 80) }); }
  }
  return NextResponse.json({ description: desc, cached: false, source: 'ollama' });
}

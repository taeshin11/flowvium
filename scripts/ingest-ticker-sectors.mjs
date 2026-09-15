#!/usr/bin/env node
/**
 * ingest-ticker-sectors.mjs — 종목 섹터를 야후에서 받아 적재한다. (2026-09-15 신설)
 *
 * 왜 (실측): 섹터를 candidate-tickers.json 의 meta 에서 읽는데, 그 파일은
 *   **정규식 긁기**로 만들어진다 — 티커 뒤 3000자에서 첫 name·sector 를 집는다.
 *   그래서 내부 제품 배열이나 **다음 회사 항목**을 집어 왔다:
 *     GOOG → name "Meta Platforms" · sector semiconductors
 *     MSFT → name "Amazon AWS"      · sector semiconductors
 *     AMZN → name "Google Cloud"    · sector semiconductors
 *     JNJ  → name "Innovative Medicine" (J&J 의 사업부문명)
 *   이름은 872종 중 **700종(80%)** 이 어긋났다.
 *
 *   섹터는 장식이 아니다 — 분산·회전룰·튜너 섹터분석이 전부 이걸 본다.
 *   META·GOOG·AMZN·MSFT 가 다 '반도체' 면 **포트폴리오는 분산됐다고 믿는데 실제로는 아니다.**
 *
 * 야후 assetProfile 이 정확한 값을 준다(실측 — GOOGL/META Communication Services,
 *   AMZN Consumer Cyclical, NVDA Technology). 섹터는 거의 안 바뀌므로 90일에 한 번이면 넉넉하다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { getYahooCrumb, YAHOO_UA } from './lib/yahoo-crumb.mjs';
import { toYahooTicker } from './lib/ticker-normalize.mjs';
import { pickSectorQueue, saveTickerSector, sectorCoverage } from './lib/db.mjs';

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d; };
const LIMIT = Number(arg('limit', 200));
const CONCURRENT = Number(arg('concurrent', 3));

/** 대상: 후보 풀 전체(한국 종목 포함 — 야후가 .KS 도 섹터를 준다). */
function universe() {
  const j = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
  const list = (Array.isArray(j.tickers) ? j.tickers : Object.values(j.tickers ?? {}).flat())
    .map((x) => (typeof x === 'string' ? x : (x?.ticker ?? x?.symbol))).filter(Boolean);
  return [...new Set(list)];
}

const all = universe();
const queue = pickSectorQueue(all, { limit: LIMIT });
const before = sectorCoverage();
console.log(`풀 ${all.length}종 · 이번 회차 ${queue.length}종`);
console.log(`현재: 시도 ${before.attempted} · 값 있음 ${before.withData ?? 0} · 포기 ${before.givenUp ?? 0}\n`);
if (!queue.length) { console.log('받을 것 없음 — 전부 신선하다'); process.exit(0); }

const auth = await getYahooCrumb();
if (!auth?.crumb) { console.error('[FATAL] Yahoo crumb 실패'); process.exit(1); }

let ok = 0, empty = 0, fail = 0;
const work = [...queue];
async function worker() {
  for (;;) {
    const t = work.shift();
    if (!t) return;
    try {
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(toYahooTicker(t))}`
        + `?modules=assetProfile,price&crumb=${encodeURIComponent(auth.crumb)}`;
      const r = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, Cookie: auth.cookie }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = (await r.json())?.quoteSummary?.result?.[0] ?? {};
      const p = res.assetProfile ?? {};
      // 이름도 같이 받는다 — company-names.json 에 없는 466종이 사업부문명으로 남아 있었다
      //   (MSFT → "Microsoft Azure", AMZN → "Amazon AWS").
      const nm = res.price?.longName || res.price?.shortName || null;
      // 섹터가 없는 종목이 있다(ETF·지주 등). "받았지만 없다" 는 실패가 아니다 — 재시도해도 같다.
      if (!p.sector) empty++; else ok++;
      saveTickerSector({ ticker: t, sector: p.sector ?? null, industry: p.industry ?? null, name: nm });
    } catch (e) { fail++; saveTickerSector({ ticker: t, error: e.message }); }
    await new Promise((r) => setTimeout(r, 140));
  }
}
await Promise.all(Array.from({ length: CONCURRENT }, worker));

const after = sectorCoverage();
console.log(`받음 ${ok} · 섹터 없음 ${empty} · 실패 ${fail}`);
console.log(`적재 후: 시도 ${after.attempted}/${all.length} (${(after.attempted / all.length * 100).toFixed(0)}%) · 값 있음 ${after.withData ?? 0}`);

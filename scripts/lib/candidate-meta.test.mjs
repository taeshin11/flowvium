#!/usr/bin/env node
/**
 * candidate-meta.test.mjs — 종목 이름·섹터가 실제 회사의 것인가.
 *
 * 배경(2026-09-15): GOOGL 과 GOOG 이 같은 회차에 따로 추천된 것을 파다가 나왔다.
 *   candidate-tickers.json 의 meta 가 **정규식 긁기**로 만들어진다 —
 *   티커 뒤 3000자에서 첫 name·sector 를 집는다. 그래서 다음 회사 항목이나
 *   내부 제품 배열이 들어왔다:
 *     GOOG → "Meta Platforms" / semiconductors
 *     MSFT → "Amazon AWS"      / semiconductors
 *     JNJ  → "Innovative Medicine" (J&J 의 사업부문명)
 *   대조 가능한 872종 중 700종(80%)의 이름이 어긋났다.
 *
 *   섹터는 장식이 아니다. 분산·회전룰·튜너 섹터분석이 전부 이걸 본다 —
 *   META·GOOG·AMZN·MSFT 가 다 '반도체' 면 포트폴리오는 분산됐다고 믿는데 아니다.
 */
import { requires } from './test-env.mjs';
await requires({ dbTables: ['ticker_sectors'] });

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const meta = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8')).meta ?? {};

// [1] 실제로 났던 사고들
const known = {
  GOOGL: { name: /Alphabet/, sector: 'Communication Services' },
  GOOG:  { name: /Alphabet/, sector: 'Communication Services' },
  META:  { name: /Meta Platforms/, sector: 'Communication Services' },
  MSFT:  { name: /Microsoft Corp/, sector: 'Technology' },
  AMZN:  { name: /Amazon\.com/, sector: 'Consumer Cyclical' },
  JNJ:   { name: /Johnson & Johnson/, sector: 'Healthcare' },
};
const wrong = Object.entries(known).filter(([t, w]) =>
  !meta[t] || !w.name.test(meta[t].name ?? '') || meta[t].sector !== w.sector);
wrong.length === 0
  ? ok(`실측으로 틀렸던 6종이 전부 바로잡혔다 (${Object.keys(known).join(', ')})`)
  : bad(`아직 틀린 것: ${wrong.map(([t]) => `${t}=${meta[t]?.name}/${meta[t]?.sector}`).join(' · ')}`);

// [2] 빅테크가 한 섹터에 몰려 있지 않은가 — 분산이 거짓이 되는 자리
{
  const big = ['GOOGL', 'META', 'MSFT', 'AMZN', 'NVDA'];
  const secs = new Set(big.map((t) => meta[t]?.sector).filter(Boolean));
  secs.size >= 3
    ? ok(`빅테크 5종이 ${secs.size}개 섹터로 갈린다 (${[...secs].join(' · ')})`)
    : bad(`빅테크 5종이 ${secs.size}개 섹터에만 있다 — 분산이 거짓이 된다: ${[...secs].join(' · ')}`);
}

// [3] 한국 종목 이름은 한글이어야 한다 — 한국어 채널이다
{
  const kr = Object.entries(meta).filter(([t]) => /\.(KS|KQ)$/i.test(t));
  const ko = kr.filter(([, m]) => /[가-힣]/.test(m.name ?? '')).length;
  // 야후 longName 으로 덮으면 "삼성전자" 가 "Samsung Electronics Co., Ltd." 가 된다(실제로 그랬다).
  ko > kr.length * 0.8
    ? ok(`한국 종목 ${kr.length}종 중 ${ko}종이 한글 이름 (영문 법인명으로 덮이지 않았다)`)
    : bad(`한국 종목 이름이 영문으로 덮였다 — 한글 ${ko}/${kr.length}`);
}

// [4] 섹터가 실제로 여러 갈래인가 — 한 값에 쏠려 있으면 긁기가 되살아난 것이다
{
  const counts = {};
  for (const m of Object.values(meta)) if (m.sector) counts[m.sector] = (counts[m.sector] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ['-', 0];
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  top[1] / total < 0.5
    ? ok(`섹터가 흩어져 있다 (최다 "${top[0]}" ${(top[1] / total * 100).toFixed(0)}%)`)
    : bad(`한 섹터에 ${(top[1] / total * 100).toFixed(0)}%가 몰렸다: "${top[0]}"`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);

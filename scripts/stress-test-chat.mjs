#!/usr/bin/env node
// stress-test-chat.mjs — 심판엔진 챗 대량 랜덤질문 스트레스 테스트 (2026-06-18 사용자 "질문 랜덤 300개 테스트").
//   다양한 카테고리 질문을 쏟아 결함을 *선제적*으로 발견. 응답을 production checkChatDefects 류로 검사 + 종목해석/
//   연도/진입가 점검 → 결함유형 집계 + 예시. 결과 logs/stress-test-{ts}.json.
//   사용: node scripts/stress-test-chat.mjs [--n=300] [--conc=4] [--mode=aits-deep]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const N = Number(arg('n', 300)), CONC = Number(arg('conc', 4)), MODE = arg('mode', 'aits-deep');
const BASE = 'http://127.0.0.1:3000';

// 실제 종목 풀(이름/티커) 로드
const ct = JSON.parse(readFileSync(resolve(ROOT, 'data/candidate-tickers.json'), 'utf8'));
const meta = ct.meta || {};
const entries = Object.entries(meta).map(([t, m]) => ({ ticker: t, name: m.name || t, kr: /\.(KS|KQ)$/.test(t) }));
const krs = entries.filter(e => e.kr), uss = entries.filter(e => !e.kr);
// 시드 기반 의사난수(재현성) — Math.random 회피.
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// 질문 카테고리 템플릿
function genQuestion() {
  const cat = Math.floor(rnd() * 12);
  const e = pick(rnd() < 0.5 ? krs : uss);
  switch (cat) {
    case 0: return { cat: 'name_buy', q: `${e.name} 사도돼?` };
    case 1: return { cat: 'ticker_bare', q: e.kr ? e.ticker.replace(/\.(KS|KQ)$/, '') : e.ticker.toLowerCase() };
    case 2: return { cat: 'name_how', q: `${e.name} 어때?` };
    case 3: return { cat: 'name_sell', q: `${e.name} 지금 팔까?` };
    case 4: return { cat: 'fewaccount', q: `${e.name} 소수계좌 매집 있어?` };
    case 5: return { cat: 'reco', q: pick(['오늘 매수추천 top10 뭐야?', '지금 사기 좋은 종목 알려줘', '포트폴리오 점검해줘']) };
    case 6: return { cat: 'dividend', q: `${e.name} 배당 어때?` };
    case 7: return { cat: 'compare', q: `${pick(entries).name} vs ${e.name} 뭐가 나아?` };
    case 8: return { cat: 'general', q: pick(['지금 시장 어때?', '환율이 주식에 미치는 영향은?', '금리 전망 어때?']) };
    case 9: return { cat: 'entry', q: `${e.name} 진입가랑 손절 알려줘` };
    case 10: return { cat: 'edge_unknown', q: pick(['asdfqwer 사도돼?', '없는종목123 어때?', '🚀🚀']) };
    case 11: return { cat: 'business', q: `${e.name} 무슨 사업해? 전망은?` };
    default: return { cat: 'name_buy', q: `${e.name} 사도돼?` };
  }
}

// 응답 결함 점검(production checkChatDefects 핵심 + 종목해석/연도/진입가)
const curYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 4));
function inspect(q, d) {
  const a = d.reply || ''; const defects = [];
  const priced = (d.grounding?.tickers || []).filter(t => t.price != null);
  if (/\(\+\d+\)/.test(a)) defects.push('score_tag_leak');
  if (/\b[a-z]+_[a-z]+_[a-z0-9]+\b/.test(a)) defects.push('rule_id_leak');
  if (/\(발화\s*:|·\s*룰\s*종합\s*:/.test(a)) defects.push('engine_line_verbatim');
  if (!priced.length && /(매수|매도)\s*엔진\s*(총점|점수)?\s*\d+\s*점/.test(a)) defects.push('engine_score_no_data');
  for (const m of a.matchAll(/([\d.]+)\s*%\s*(급락|급등|폭락|폭등)/g)) if (Math.abs(Number(m[1])) < 3) { defects.push('magnitude_overstate'); break; }
  for (const m of a.matchAll(/순이익의\s*([\d,]+)\s*배/g)) if (Number(m[1].replace(/,/g, '')) >= 10) { defects.push('fake_multiple'); break; }
  for (const m of a.matchAll(/20(\d\d)\s*년[^.\n]{0,14}(기준|최신|현재)/g)) if (Number('20' + m[1]) <= curYear - 2) { defects.push('stale_year'); break; }
  if (priced.length === 1 && priced[0].price) {
    const em = a.match(/진입가?[^\d]{0,8}([\d,.]+)\s*[~\-–]\s*([\d,.]+)/);
    if (em) { const mid = (Number(em[1].replace(/,/g, '')) + Number(em[2].replace(/,/g, ''))) / 2; if (mid > 0 && Math.abs(mid / priced[0].price - 1) > 0.15) defects.push('entry_far_from_price'); }
  }
  return { resolved: priced.length > 0, defects };
}

async function ask(item) {
  try {
    const r = await fetch(`${BASE}/api/judge-chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: item.q }], mode: MODE, stream: false }) });
    const d = await r.json();
    return { ...item, ...inspect(item.q, d), len: (d.reply || '').length, ticker: d.grounding?.tickers?.[0]?.ticker ?? null };
  } catch (e) { return { ...item, error: String(e?.message ?? e).slice(0, 60), defects: ['request_error'], resolved: false }; }
}

async function main() {
  const items = Array.from({ length: N }, genQuestion);
  console.log(`[stress] ${N} 질문, 동시 ${CONC}, mode ${MODE}`);
  const results = [];
  for (let i = 0; i < items.length; i += CONC) {
    const batch = await Promise.all(items.slice(i, i + CONC).map(ask));
    results.push(...batch);
    if ((i / CONC) % 5 === 0) console.log(`  ${results.length}/${N} 완료...`);
  }
  // 집계
  const byCat = {}, byDefect = {}; let defectAns = 0, unresolved = 0;
  for (const r of results) {
    byCat[r.cat] = byCat[r.cat] || { n: 0, def: 0 };
    byCat[r.cat].n++; if (r.defects.length) { byCat[r.cat].def++; defectAns++; }
    if (!r.resolved && !['reco', 'general', 'edge_unknown'].includes(r.cat)) unresolved++;
    for (const dft of r.defects) byDefect[dft] = (byDefect[dft] || 0) + 1;
  }
  console.log(`\n=== 결과: ${results.length}건 ===`);
  console.log(`결함 포함: ${defectAns} (${(defectAns / results.length * 100).toFixed(1)}%) | 미해석(종목질문): ${unresolved}`);
  console.log('결함유형:', JSON.stringify(byDefect));
  console.log('카테고리별 결함률:'); for (const [c, s] of Object.entries(byCat)) console.log(`  ${c}: ${s.def}/${s.n}`);
  const examples = results.filter(r => r.defects.length).slice(0, 12).map(r => ({ q: r.q.slice(0, 30), ticker: r.ticker, defects: r.defects }));
  console.log('\n결함 예시:'); examples.forEach(e => console.log(`  "${e.q}" [${e.ticker}] → ${e.defects.join(',')}`));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(resolve(ROOT, `logs/stress-test-${ts}.json`), JSON.stringify({ n: results.length, defectAns, unresolved, byDefect, byCat, results }, null, 2));
  console.log(`\n저장: logs/stress-test-${ts}.json`);
}
main().then(() => process.exit(0)).catch(e => { console.error('[FATAL]', e); process.exit(1); });

#!/usr/bin/env node
/**
 * scripts/inject-etf-strategy.mjs — 발행된 investment-strategy 캐시에 ETF 전략(국가별 포함) 재계산 주입.
 *   코드 배포 전 생성된 보고서가 etfStrategy 를 갖도록(다음 cron 까지 대기 없이 즉시 표시). 일회성.
 */
import { readFileSync } from 'fs';
const SITE = 'http://localhost:3000';
const env = {};
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const cmd = a => fetch(env.UPSTASH_REDIS_REST_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).then(r => r.json()).then(j => j.result);

const ETF_META = { SPY: { name: 'S&P 500', cat: 'broad' }, QQQ: { name: '나스닥100 (성장)', cat: 'broad' }, XLK: { name: '기술 섹터', cat: 'sector' }, XLC: { name: '커뮤니케이션 섹터', cat: 'sector' }, XLE: { name: '에너지 섹터', cat: 'sector' }, XLV: { name: '헬스케어 섹터', cat: 'sector' }, EWY: { name: '한국', cat: 'region' }, EWJ: { name: '일본', cat: 'region' }, FXI: { name: '중국 대형주', cat: 'region' }, EWT: { name: '대만', cat: 'region' }, INDA: { name: '인도', cat: 'region' }, VGK: { name: '유럽', cat: 'region' }, EWZ: { name: '브라질', cat: 'region' }, EWA: { name: '호주', cat: 'region' }, TLT: { name: '미국 장기국채(20년+)', cat: 'bond' }, GLD: { name: '금', cat: 'commodity' } };
const SECTOR_ETF = { semiconductors: 'XLK', technology: 'XLK', 'ai-cloud': 'XLK', energy: 'XLE', healthcare: 'XLV', 'communication-services': 'XLC', communication: 'XLC' };
const REGION_ETF = { us: 'SPY', korea: 'EWY', japan: 'EWJ', china: 'FXI', taiwan: 'EWT', india: 'INDA', europe: 'VGK', brazil: 'EWZ', australia: 'EWA' };
const LBL = { korea: '한국', japan: '일본', china: '중국', taiwan: '대만', india: '인도', europe: '유럽', brazil: '브라질', australia: '호주' };

async function buildEtf(s) {
  const picks = new Map();
  const add = (t, r, tag, action) => { if (t && ETF_META[t] && !picks.has(t)) picks.set(t, { ticker: t, ...ETF_META[t], rationale: r, tag, action }); };
  if (s.stance === 'bullish') { add('QQQ', '강세 스탠스 — 성장주 핵심 노출', 'core', 'buy'); add('SPY', '시장 전체 분산 코어', 'core', 'buy'); } else add('SPY', '시장 전체 분산 코어', 'core', 'buy');
  for (const x of s.sectorAllocation || []) if (x.stance === 'overweight') add(SECTOR_ETF[(x.sector || '').toLowerCase()], `${x.sector} 비중확대 — 섹터 ETF 분산 노출`, 'sector', 'buy');
  for (const [r, v] of Object.entries(s.regionStances || {})) {
    if (!REGION_ETF[r] || r === 'us') continue;
    const st = v?.stance, lb = LBL[r] || r;
    const action = st === 'bullish' ? 'buy' : st === 'bearish' ? 'avoid' : 'watch';
    const note = st === 'bullish' ? `${lb} 강세 — ${(v.thesis || '').slice(0, 24)}` : st === 'bearish' ? `${lb} 약세 — 비중축소` : `${lb} 중립 — 관망 ${(v.thesis || '').slice(0, 18)}`;
    add(REGION_ETF[r], note, 'region', action);
  }
  if (s.riskLevel === 'high' || s.stance === 'bearish') { add('TLT', '리스크 헤지 — 미국 장기국채', 'defensive', 'hedge'); add('GLD', '안전자산 — 금', 'defensive', 'hedge'); }
  const list = [...picks.values()].slice(0, 16);
  let fx = {};
  try { fx = (await (await fetch(`${SITE}/api/batch-prices?tickers=${list.map(x => x.ticker).join(',')}`)).json())?.prices || {}; } catch { /* */ }
  return list.map(x => ({ ticker: x.ticker, name: x.name, category: x.cat, tag: x.tag, action: x.action, rationale: x.rationale, price: fx[x.ticker]?.price ?? null, changePct: fx[x.ticker]?.changePct ?? null }));
}

let cur = '0', keys = [];
do { const r = await cmd(['SCAN', cur, 'MATCH', 'flowvium:investment-strategy:*', 'COUNT', '200']); cur = r[0]; keys.push(...r[1]); } while (cur !== '0');
let n = 0;
for (const k of keys) {
  const raw = await cmd(['GET', k]); if (!raw) continue;
  let s; try { s = JSON.parse(raw); } catch { continue; }
  if (!s || !Array.isArray(s.portfolio)) continue;
  s.etfStrategy = await buildEtf(s);
  if (s.etfStrategy.length) { await cmd(['SET', k, JSON.stringify(s), 'KEEPTTL']); n++; }
}
console.log(`[inject-etf] ${n}/${keys.length} 키 주입`);

#!/usr/bin/env node
/**
 * scripts/add-country-etfs.mjs — 국가별 ETF 를 후보 유니버스에 추가 (2026-06-12, 사용자 "KORU 같은것도").
 * 멱등 — 이미 있으면 skip. data/candidate-tickers.json 의 tickers[] + meta{} 에 append.
 */
import fs from 'fs';

const COUNTRY_ETFS = {
  // vanilla 국가
  EWY: '한국 (iShares MSCI South Korea)', EWJ: '일본 (iShares MSCI Japan)',
  FXI: '중국 대형주 (iShares China Large-Cap)', MCHI: '중국 전체 (iShares MSCI China)',
  VGK: '유럽 (Vanguard FTSE Europe)', INDA: '인도 (iShares MSCI India)',
  EWT: '대만 (iShares MSCI Taiwan)', EWZ: '브라질 (iShares MSCI Brazil)',
  EWA: '호주 (iShares MSCI Australia)', EWG: '독일 (iShares MSCI Germany)',
  EWU: '영국 (iShares MSCI UK)', EEM: '신흥국 (iShares MSCI EM)',
  // leveraged 국가 (단기 트레이딩 — 발간 시 경고 라벨 자동 부착됨)
  KORU: '한국 3x (Direxion Daily South Korea Bull 3X)', YINN: '중국 3x (Direxion Daily FTSE China Bull 3X)',
  EDC: '신흥국 3x (Direxion Daily Emerging Markets Bull 3X)', INDL: '인도 2x (Direxion Daily MSCI India Bull 2X)',
};

const path = 'data/candidate-tickers.json';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));
const existing = new Set(j.tickers);
let added = 0;
for (const [t, name] of Object.entries(COUNTRY_ETFS)) {
  if (existing.has(t)) continue;
  j.tickers.push(t);
  j.meta[t] = { name, sector: 'Country ETF', cap: 'etf' };
  added++;
}
j.total = j.tickers.length;
fs.writeFileSync(path, JSON.stringify(j, null, 0) + '\n');
console.log(`[country-etfs] 추가 ${added} / 기존 ${Object.keys(COUNTRY_ETFS).length - added} — 풀 총 ${j.total}종`);

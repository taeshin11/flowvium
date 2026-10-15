#!/usr/bin/env node
/**
 * forecast-record.mjs — 장 전에 예측을 **고정 기록** 한다. 2026-10-15 신설(사장님 "전향적연구하라 … 왜 오늘같은 일을 예측못했는지").
 *
 * 무엇을: 시장(kr: KOSPI·KOSDAQ / us: S&P500·NASDAQ)마다 세 예측을 한 줄에.
 *   report — 그 시각 최신 보고서의 지역 판단(bullish/bearish → 방향, neutral → 기권) + 판정(verdict) 원문
 *   base   — (kr) 전날 밤 SOX 등락 칸의 과거 다음 날 하락·-2% 이하 비율(2005~, 칸 30건 미만이면 전체)
 *            (us) 기후값과 같다 — 미국 장 전에 알 수 있는 선행 입력을 아직 검증하지 않았다
 *   clim   — 기후값(같은 기간 전체 하락 비율). base·report 가 이걸 못 이기면 신호가 아니다.
 * 고정: data/forecast-ledger.jsonl 에 덧붙이기만 한다. 같은 시장·지수·날짜 줄이 있으면 다시 쓰지 않는다.
 *   cron-runner 가 곧바로 커밋·푸시한다 — 커밋 시각이 '장 전에 적었다' 는 증거다.
 * 계산·규칙: lib/forecast-ledger.mjs(테스트 lib/forecast-ledger.test.mjs). 채점은 forecast-score.mjs.
 *
 * 사용: node scripts/forecast-record.mjs --market kr|us [--dry]   (--dry: 장부에 쓰지 않고 출력만, 장 시각 검사도 건너뜀)
 */
import { readFileSync, appendFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { fetchBars } from './lib/ohlc.mjs';
import { condProb, reportCall } from './lib/forecast-ledger.mjs';

const LEDGER = resolve(ROOT, 'data/forecast-ledger.jsonl');
const market = process.argv[process.argv.indexOf('--market') + 1];
const DRY = process.argv.includes('--dry');
if (!['kr', 'us'].includes(market)) { console.error('사용: --market kr|us'); process.exit(2); }
const TARGETS = market === 'kr' ? [['KOSPI', '^KS11'], ['KOSDAQ', '^KQ11']] : [['S&P500', '^GSPC'], ['NASDAQ', '^IXIC']];
const log = (...a) => console.log(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[forecast-record]', ...a);

const now = new Date();
const dateIn = (tz, d = now) => d.toLocaleString('sv-SE', { timeZone: tz }).slice(0, 10);
const targetDate = market === 'kr' ? dateIn('Asia/Seoul') : dateIn('America/New_York');

// 적는 창: 장 열기 전 07:00(현지)부터 개장 전까지. 장이 열렸으면 '장 전 예측' 이 아니고(결과를 보고 적게 된다),
//   너무 이르면 장 전 최신 보고서가 아니다 — 10/15 13:40 KST 러너 재기동 소급 실행이 미국 장 9시간 전에 적었다.
const hm = (tz) => { const s = now.toLocaleString('sv-SE', { timeZone: tz }); return Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)); };
const [tz, open] = market === 'kr' ? ['Asia/Seoul', 9 * 60] : ['America/New_York', 9 * 60 + 30];
if (!DRY && !(hm(tz) >= 7 * 60 && hm(tz) < open)) {
  log(`${market} 적는 창(현지 07:00~개장) 밖이다(${targetDate} ${String(Math.floor(hm(tz) / 60)).padStart(2, '0')}:${String(hm(tz) % 60).padStart(2, '0')}) — 적지 않는다`);
  process.exit(0);
}

const lines = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

// 최신 보고서(이 시각 이전 발간). 파일 이름이 아니라 generatedAt 으로 고른다.
let report = null, reportFile = null;
for (const f of readdirSync(resolve(ROOT, 'reports')).filter((f) => /^report-\d{4}-\d{2}-\d{2}-\w+-ko\.json$/.test(f))) {
  try {
    const r = JSON.parse(readFileSync(resolve(ROOT, 'reports', f), 'utf8'));
    if (r.generatedAt && new Date(r.generatedAt) <= now && (!report || r.generatedAt > report.generatedAt)) { report = r; reportFile = f; }
  } catch { /* 깨진 파일은 고르지 않는다 */ }
}

const day = (t) => new Date(t).toISOString().slice(0, 10);
const rets = (bars) => bars.slice(1).map((b, i) => ({ d: day(b.t), r: b.c / bars[i].c - 1 }));
const from = '2005-01-01T00:00:00Z', to = now.toISOString();
const sox = market === 'kr' ? await fetchBars('^SOX', from, to) : null;
const soxRets = sox?.bars?.length ? rets(sox.bars) : [];
// 전날 밤 SOX: 지금 시각 기준 마지막으로 끝난 미국 장. kr 기록은 08:5x KST 라 미국 장은 닫혀 있다.
const lastSox = soxRets.at(-1) ?? null;

let wrote = 0;
for (const [name, sym] of TARGETS) {
  if (lines.some((l) => l.market === market && l.index === name && l.targetDate === targetDate)) { log(`${name} ${targetDate} 이미 기록됨 — 고정 기록이라 다시 쓰지 않는다`); continue; }
  const idx = await fetchBars(sym, from, to);
  if (!idx?.bars?.length) { log(`${name} 과거 시세를 못 받았다 — 이번 기록에서 뺀다`); continue; }
  // 목표일 봉이 이미 있으면(장중·장후) 그 봉은 빼고 센다 — 결과가 섞이면 안 된다.
  const ir = rets(idx.bars).filter((x) => x.d < targetDate);
  const clim = condProb(ir.map((x) => ({ x: null, y: x.r })), null);
  let base = clim, pairs = [];
  if (market === 'kr' && soxRets.length) {
    // 짝: KR 날짜 d 의 등락 ↔ d 보다 앞선 마지막 미국 장의 SOX 등락
    let j = 0;
    for (const x of ir) {
      while (j + 1 < soxRets.length && soxRets[j + 1].d < x.d) j++;
      if (soxRets[j].d < x.d) pairs.push({ x: soxRets[j].r, y: x.r });
    }
    base = condProb(pairs, lastSox?.r ?? null);
  }
  const call = reportCall(report, market);
  const rec = {
    id: `${market}-${name}-${targetDate}`, market, index: name, symbol: sym, targetDate,
    // 규칙 버전 — 칸 경계·minN 을 바꾸면 올린다. 바꾸기 전후 기록을 섞어 채점하지 않게.
    rule: 'v1 sox칸(-4,-2,0,+2%] minN30 · 보고서=지역판단',
    recordedAt: now.toISOString(),
    report: report ? { file: reportFile, generatedAt: report.generatedAt, session: report.session } : null,
    inputs: market === 'kr' ? { sox: lastSox ? Number(lastSox.r.toFixed(4)) : null, soxDate: lastSox?.d ?? null } : {},
    forecasts: {
      report: call,
      base: { pDown: base.pDown, pBigDown: base.pBigDown, bucket: base.bucket, n: base.n },
      clim: { pDown: clim.pDown, pBigDown: clim.pBigDown, n: clim.n },
    },
    basis: [
      `보고서 ${report?.session ?? '없음'}(${report?.generatedAt ?? '-'}) 지역판단 ${call.stance ?? '-'} · 판정 ${call.verdict ?? '-'}`,
      market === 'kr' ? `전날 밤 SOX ${lastSox ? (lastSox.r * 100).toFixed(2) + '%' : '결측'}(${lastSox?.d ?? '-'}) → 칸 ${base.bucket} 과거 ${base.n}일: 하락 ${(base.pDown * 100).toFixed(0)}% · -2%이하 ${(base.pBigDown * 100).toFixed(0)}%` : '선행 입력 없음(기후값)',
      `기후값 ${clim.n}일: 하락 ${(clim.pDown * 100).toFixed(0)}% · -2%이하 ${(clim.pBigDown * 100).toFixed(1)}%`,
    ],
  };
  if (!DRY) appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
  wrote++;
  log(`${rec.id}: ${rec.basis.join(' | ')}`);
}
log(DRY ? `--dry: ${wrote}줄(장부에 안 씀)` : `${wrote}줄 기록 → ${LEDGER}`);

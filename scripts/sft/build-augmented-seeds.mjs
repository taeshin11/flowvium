#!/usr/bin/env node
// 시나리오 증강 — 티커별로 가격을 52주 범위에서 이동 + 지표(RSI/MA/거래량) 동반 변형.
// teacher가 각 상황을 판단 → student가 "판단 함수(결정 경계)"를 학습(티커 암기 아님 → 일반화↑).
// v1 데이터에서 티커별 {name,sector,통화,52주범위} 추출 → N 시나리오 합성. KO+EN.
// env: SRC(v1 jsonl), OUT(augmented seeds), N(티커당 시나리오, 기본6)
import fs from 'node:fs';

const SRC = process.env.SRC || 'D:/llama/aisvi-finance-t.jsonl';
const OUT = process.env.OUT || 'D:/llama/augmented-seeds.jsonl';
const N = parseInt(process.env.N || '6', 10);

const KO_SYS = '너는 "매수·매도 심판엔진"이다. 규율·근거 기반으로 매수/분할매수/관망/비중축소/매도/회피를 판단한다. 주어진 데이터만 인용하고 수치를 지어내지 않는다. 반드시 아래 형식 그대로, 마크다운·제목·번호목록 금지, 6줄 이내로 간결하게:\n판단: <행동>(신뢰도 상/중/하)\n근거: <핵심 2~3개를 한 줄로, 데이터 인용>\n진입 <가격대> · 손절 <가격> · 목표 <가격>\n투자 책임은 본인에게 있음.';
const EN_SYS = 'You are the "Buy/Sell Judgment Engine". Judge buy / scale-in / hold / trim / sell / avoid on discipline and evidence. Cite only the given data; never fabricate numbers. Reply in this exact format, no markdown/headings/numbered lists, 6 lines max, concise:\nVerdict: <action>(confidence high/mid/low)\nGrounds: <2-3 key points in one line, cite data>\nEntry <range> · Stop <price> · Target <price>\nThe investment decision is your own responsibility.';

const KR_EN_NAME = { '삼성전자':'Samsung Electronics','현대차':'Hyundai Motor','현대자동차':'Hyundai Motor','기아':'Kia','카카오':'Kakao','네이버':'Naver','POSCO홀딩스':'POSCO Holdings','SK하이닉스':'SK Hynix','셀트리온':'Celltrion','LG에너지솔루션':'LG Energy Solution','LG화학':'LG Chem','현대모비스':'Hyundai Mobis','삼성바이오로직스':'Samsung Biologics' };
const enName = (n, t) => /[가-힣]/.test(n) ? (KR_EN_NAME[n] || t) : n;

// 결정론적 의사난수(시드 기반 — Math.random 회피, 재현성)
function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = s * 16807 % 2147483647) / 2147483647; }

// 티커별 52주 범위 추출 (v1 assistant "52주:$lo-$hi" 또는 "₩lo-₩hi")
const rows = fs.readFileSync(SRC, 'utf8').split('\n').filter(Boolean);
const tickers = new Map();
for (const ln of rows) {
  let msgs; try { msgs = JSON.parse(ln).messages; } catch { continue; }
  const u = msgs.find(m => m.role === 'user')?.content || '';
  const a = msgs.find(m => m.role === 'assistant')?.content || '';
  const um = u.match(/^(.+?)\(([\w.]+),?\s*([^)]*)\)/);
  const wm = a.match(/52주\s*:?\s*([₩$])([\d.,]+)\s*-\s*[₩$]?([\d.,]+)/);
  if (!um || !wm) continue;
  const ticker = um[2];
  if (tickers.has(ticker)) continue;
  const lo = parseFloat(wm[2].replace(/,/g, '')), hi = parseFloat(wm[3].replace(/,/g, ''));
  if (!(hi > lo) || lo <= 0) continue;
  tickers.set(ticker, { name: um[1].trim(), ticker, sector: (um[3] || '').trim(), cur: wm[1], lo, hi });
}

const isKR = t => /\.K[SQ]$/.test(t);
const fmtPrice = (v, cur) => cur === '₩' ? Math.round(v).toLocaleString('en-US') : v.toFixed(2);

const out = [];
let ti = 0;
for (const t of tickers.values()) {
  const rand = rng(1000 + (ti++ * 7919));
  for (let i = 0; i < N; i++) {
    const pos = (i + 0.5) / N + (rand() - 0.5) * 0.1;          // 52주 내 위치 0~1
    const p = Math.max(t.lo, Math.min(t.hi, t.lo + (t.hi - t.lo) * pos));
    const rsi = Math.round(Math.max(22, Math.min(84, 35 + pos * 42 + (rand() - 0.5) * 14)));
    const ma50 = p * (1 - (pos - 0.45) * 0.18);                // 상승추세면 MA 아래
    const maRel = p >= ma50 ? '위' : '아래';
    const maRelEn = p >= ma50 ? 'above' : 'below';
    const vol = Math.round((rand() - 0.4) * 50);               // 거래량 ±
    const sq = Math.round(15 + rand() * 45);
    const c = t.cur;
    const dataKo = `squeeze ${sq}, 50MA ${maRel}(${c}${fmtPrice(ma50, c)}), RSI ${rsi}, 거래량${vol >= 0 ? '+' : ''}${vol}%, 52주:${c}${fmtPrice(t.lo, c)}-${c}${fmtPrice(t.hi, c)}`;
    const dataEn = `squeeze ${sq}, ${maRelEn} 50MA (${c}${fmtPrice(ma50, c)}), RSI ${rsi}, volume ${vol >= 0 ? '+' : ''}${vol}%, 52w range ${c}${fmtPrice(t.lo, c)}-${c}${fmtPrice(t.hi, c)}`;
    const sec = t.sector ? `(${t.ticker}, ${t.sector})` : `(${t.ticker})`;
    const secEn = (t.sector && !/[가-힣]/.test(t.sector)) ? `(${t.ticker}, ${t.sector})` : `(${t.ticker})`;
    out.push({ system: KO_SYS, user: `${t.name}${sec} 매수 판단? 현재가 ${c}${fmtPrice(p, c)}. 데이터: ${dataKo}`, lang: 'ko' });
    out.push({ system: EN_SYS, user: `Judge (buy?) ${enName(t.name, t.ticker)} ${secEn}. Current price ${c}${fmtPrice(p, c)}. Data: ${dataEn}`, lang: 'en' });
  }
}
fs.writeFileSync(OUT, out.map(o => JSON.stringify(o)).join('\n') + '\n');
console.log(`[augmented] 티커=${tickers.size} × N=${N} × 2언어 = ${out.length}개 (KO ${out.filter(o => o.lang === 'ko').length} + EN ${out.filter(o => o.lang === 'en').length}) → ${OUT}`);

#!/usr/bin/env node
// v1(한국어) 데이터 → KO+EN 이중언어 distillation seed 생성.
// teacher가 production처럼 지표(squeeze/50MA/RSI/52주)를 받아 근거 있는 판단을 하도록
// v1 assistant의 "근거:" 지표를 user 프롬프트에 주입. 영어 짝도 생성(토큰 변환).
// env: SRC(v1 jsonl), OUT(bilingual seeds jsonl)
import fs from 'node:fs';

const SRC = process.env.SRC || '/root/aisvi-finance-t.jsonl';
const OUT = process.env.OUT || '/root/bilingual-seeds.jsonl';

const KO_SYS = '너는 "매수·매도 심판엔진" — 규율 있고 근거 기반인 투자 판단 AI다. 종목의 매수/분할매수/관망/비중축소/매도/회피를 판단하고, 실시간 데이터·매수매도 룰·구루 원칙을 근거로 인용하며, 리스크와 진입/손절을 제시한다. 수치를 지어내지 않고, 데이터 없으면 솔직히 말한다. 출력형식: "판단: <행동>(<신뢰도>)" 줄, "근거: ..." 줄, "진입 $.. ~ $.. · 손절 $.. · 목표 $.." 줄, 마지막에 면책 한 줄.';
const EN_SYS = 'You are the "Buy/Sell Judgment Engine" — a disciplined, evidence-based investment-decision AI. You judge a stock as buy / scale-in / hold / trim / sell / avoid, citing real-time data, buy/sell rules, and guru principles as grounds, and you give risk and entry/stop levels. Never fabricate numbers; if data is missing, say so honestly. Output format: a "Verdict: <action>(<confidence>)" line, a "Grounds: ..." line, an "Entry $.. ~ $.. · Stop $.. · Target $.." line, then a one-line disclaimer.';

// KR 회사명 → 영어 (EN seed 순수성; 미매핑은 ticker 사용)
const KR_EN_NAME = {
  '삼성전자': 'Samsung Electronics', '삼성전자우': 'Samsung Electronics (pref)',
  '현대차': 'Hyundai Motor', '현대자동차': 'Hyundai Motor', '기아': 'Kia',
  '카카오': 'Kakao', '네이버': 'Naver', 'POSCO홀딩스': 'POSCO Holdings', '포스코홀딩스': 'POSCO Holdings',
  'SK하이닉스': 'SK Hynix', '셀트리온': 'Celltrion', 'LG에너지솔루션': 'LG Energy Solution',
  'LG화학': 'LG Chem', '현대모비스': 'Hyundai Mobis', '삼성바이오로직스': 'Samsung Biologics',
  'KB금융': 'KB Financial', '신한지주': 'Shinhan Financial', '카카오뱅크': 'KakaoBank',
  '삼성SDI': 'Samsung SDI', 'SK이노베이션': 'SK Innovation', '한화솔루션': 'Hanwha Solutions',
};
function enName(name, ticker) {
  if (!/[가-힣]/.test(name)) return name;
  return KR_EN_NAME[name] || ticker;
}

// 한글 지표/정성 데이터 → 영어 토큰 변환 (US=$, KR=₩ 모두)
function dataToEn(d) {
  return d
    .replace(/(\d+)?\s*MA\s*위\(([₩$])([\d.,]+)\)/g, (m, n, c, a) => `above ${n || ''}MA (${c}${a})`)
    .replace(/(\d+)?\s*MA\s*아래\(([₩$])([\d.,]+)\)/g, (m, n, c, a) => `below ${n || ''}MA (${c}${a})`)
    .replace(/거래량\s*([+\-]?\d+)%/g, (m, a) => `volume ${a}%`)
    .replace(/52주\s*:?\s*([₩$])([\d.,]+)\s*-\s*([₩$])([\d.,]+)/g, (m, c1, a, c2, b) => `52w range ${c1}${a}-${c2}${b}`)
    .replace(/진입지지선\s*:?\s*([₩$])([\d.,]+)/g, (m, c, a) => `entry support ${c}${a}`)
    .replace(/하향\s*교차/g, 'downward cross')
    .replace(/상향\s*교차/g, 'upward cross')
    .replace(/데드\s*크로스/g, 'death cross')
    .replace(/골든\s*크로스/g, 'golden cross')
    .replace(/(스톱\s*)?손절선\s*돌파/g, 'stop-loss breach')
    .replace(/거래량/g, 'volume');
}

const rows = fs.readFileSync(SRC, 'utf8').split('\n').filter(Boolean);
const seen = new Set();
const out = [];
let parsed = 0, skipped = 0;

for (const ln of rows) {
  let msgs;
  try { msgs = JSON.parse(ln).messages; } catch { skipped++; continue; }
  const user = msgs.find(m => m.role === 'user')?.content || '';
  const asst = msgs.find(m => m.role === 'assistant')?.content || '';
  // 매수: "NAME(TICKER, SECTOR) 매수해도 될까? 현재가 $/₩PRICE." / 매도: "SEG(TICKER) 지금 팔아야 할까? ..."
  let name, ticker, sector = '', cur, price, kind;
  let m = user.match(/^(.+?)\(([\w.]+),\s*([^)]+)\)\s*매수.*?현재가\s*([₩$]?)([\d.,]+)/);
  if (m) { [, name, ticker, sector, cur, price] = m; kind = 'buy'; }
  else {
    m = user.match(/^(.+?)\(([\w.]+)\)\s*지금\s*팔아야.*?현재가\s*([₩$]?)([\d.,]+)/);
    if (m) { [, name, ticker, cur, price] = m; kind = 'sell'; }
  }
  if (!m) { skipped++; continue; }
  price = price.replace(/[.,]+$/, '');          // 후행 마침표 제거 ($225.32. → 225.32)
  const curSym = cur || '$';
  // assistant 근거: 지표 데이터 추출 (지표부만)
  const gm = asst.match(/근거:\s*(.+?)(?:\n|진입|$)/);
  let dataKo = gm ? gm[1].trim().replace(/\s*\/\s*$/, '') : '';
  if (dataKo.includes('|')) dataKo = dataKo.split('|').pop().trim();
  const key = `${kind}|${ticker}|${price}`;
  if (seen.has(key)) continue;
  seen.add(key);
  parsed++;

  let dataEn = dataKo ? dataToEn(dataKo) : '';
  if (/[가-힣]/.test(dataEn)) dataEn = '';      // EN seed에 한글 잔존 시 데이터 생략(언어순수성)
  const secKo = sector ? `(${ticker}, ${sector})` : `(${ticker})`;
  const secEn = (sector && !/[가-힣]/.test(sector)) ? `(${ticker}, ${sector})` : `(${ticker})`;
  const verbKo = kind === 'buy' ? '매수 판단?' : '매도 판단?';
  const verbEn = kind === 'buy' ? 'Judge (buy?)' : 'Judge (sell?)';
  const koUser = `${name}${secKo} ${verbKo} 현재가 ${curSym}${price}.` + (dataKo ? ` 데이터: ${dataKo}` : '');
  const enUser = `${verbEn} ${enName(name, ticker)} ${secEn}. Current price ${curSym}${price}.` + (dataEn ? ` Data: ${dataEn}` : '');

  out.push({ system: KO_SYS, user: koUser, lang: 'ko' });
  out.push({ system: EN_SYS, user: enUser, lang: 'en' });
}

fs.writeFileSync(OUT, out.map(o => JSON.stringify(o)).join('\n') + '\n');
const ko = out.filter(o => o.lang === 'ko').length;
const en = out.filter(o => o.lang === 'en').length;
console.log(`[bilingual-seeds] v1행=${rows.length} 파싱=${parsed} skip=${skipped}`);
console.log(`[bilingual-seeds] 출력 ${out.length}개 (KO ${ko} + EN ${en}) → ${OUT}`);

#!/usr/bin/env node
/**
 * scripts/build-company-business.mjs — companies-batch*.ts 의 products(주력 매출상품) + description
 *   을 ticker→{products, desc} JSON 으로 추출. 보고서/회사페이지가 "무슨 사업으로 매출 내는지" 표시용.
 *
 * 배경(2026-06-07 사용자 지적): 보고서 종목(APH 등)에 재무수치만 있고 주력 제품/사업개요가 없어
 *   "뭐로 매출 내는 기업인지 모르겠다". companies-batch 에 products[](name+revenueShare) + description
 *   큐레이션 데이터가 있는데 보고서가 안 씀. LLM 생성(환각위험)보다 이 큐레이션 소스가 정확.
 *
 * 사용: node scripts/build-company-business.mjs   (data/company-business.json 갱신)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const out = {};
let n = 0;

const files = [];
for (let i = 1; i <= 10; i++) { const f = `src/data/companies-batch${i}.ts`; if (existsSync(f)) files.push(f); }
if (existsSync('src/data/companies.ts')) files.push('src/data/companies.ts');

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // ticker 출현마다 그 직후 ~3000자 윈도우에서 products[] + description 추출
  const tickerRe = /ticker:\s*["']([A-Z0-9.\-]+)["']/g;
  let m;
  while ((m = tickerRe.exec(src)) !== null) {
    const ticker = m[1];
    if (out[ticker]) continue;
    const win = src.slice(m.index, m.index + 3500);
    // products: [ ... ] (관계 relationships 의 products 와 구분 — 첫 products 블록만)
    const prodBlock = win.match(/products:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const prods = [...prodBlock.matchAll(/name:\s*["']([^"']+)["'][\s\S]{0,260}?revenueShare:\s*(\d+)/g)]
      .map(x => ({ name: x[1], share: +x[2] }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 4);
    // description (회사 사업 개요 1-2문장) — 4-space 들여쓰기 = 회사레벨(products[].description 는
    //   더 깊은 들여쓰기라 제외). 회사 description 은 products/relationships 블록 뒤에 위치.
    const desc = win.match(/\n {4}description:\s*["']([^"']{20,400})["']/)?.[1] ?? '';
    if (!prods.length && !desc) continue;
    const productsStr = prods.map(p => `${p.name} ${p.share}%`).join(' · ');
    out[ticker] = { products: productsStr, desc: desc.trim() };
    n++;
  }
}

// 큐레이션 — companies-batch 미수록 주요 대형주(보고서 편입되나 사업프로필 없는 사각지대).
//   share% 불확실하면 제품명만(가짜 % 금지 — 환각 방지). 발견 시 추가.
const CURATED = {
  APH: { products: '커넥터·인터커넥트 · 센서 · 안테나/케이블', desc: 'Amphenol — 전기/전자 커넥터, 인터커넥트 시스템, 센서, 안테나, 케이블 제조. IT/데이터센터·모바일·자동차·산업·방산·브로드밴드 시장 공급.' },
  // KR 대형주 — companies-batch 미수록(배치가 US 위주). 공개 사실 기반 주력사업(가짜% 금지).
  //   .KS/.KQ 키로 저장(보고서 ticker 가 6자리.KS 형식, lookup 시 양쪽 시도).
  '005380.KS': { products: '완성차(승용·SUV·제네시스) · 금융 · AS/부품', desc: '현대자동차 — 완성차 제조·판매(내연·하이브리드·EV) 및 자동차할부금융. 글로벌 5위권 완성차 그룹.' },
  '000660.KS': { products: 'DRAM · NAND 플래시 · HBM(고대역폭메모리)', desc: 'SK하이닉스 — 메모리 반도체(DRAM·NAND) 제조. AI용 HBM 시장 선두.' },
  '035420.KS': { products: '서치플랫폼(검색·광고) · 커머스 · 핀테크 · 콘텐츠(웹툰) · 클라우드', desc: 'NAVER — 국내 1위 검색포털·광고, 커머스, 핀테크(네이버페이), 웹툰, 클라우드.' },
  '005490.KS': { products: '철강(열연·냉연·후판) · 2차전지소재(리튬·양극재) · 무역', desc: 'POSCO홀딩스 — 철강 제조 지주사 + 2차전지 소재(리튬·양극재) 신성장.' },
  '051910.KS': { products: '석유화학 · 첨단소재(양극재) · 생명과학', desc: 'LG화학 — 석유화학, 2차전지 양극재 등 첨단소재, 제약/바이오.' },
  '207940.KS': { products: '바이오의약품 위탁생산(CDMO) · 바이오시밀러', desc: '삼성바이오로직스 — 세계 최대급 바이오의약품 위탁개발생산(CDMO).' },
  '000270.KS': { products: '완성차(승용·RV·EV) · 금융', desc: '기아 — 완성차 제조·판매(EV 라인업 확대). 현대차그룹 계열.' },
  '035720.KS': { products: '톡비즈(광고·커머스) · 플랫폼 · 콘텐츠(게임·뮤직) · 핀테크', desc: '카카오 — 카카오톡 기반 광고·커머스, 콘텐츠(게임·뮤직·웹툰), 핀테크.' },
  '012330.KS': { products: '자동차부품(모듈·핵심부품) · AS부품', desc: '현대모비스 — 자동차 모듈·핵심부품·전장 및 AS부품. 현대차그룹 계열.' },
  '068270.KS': { products: '바이오시밀러(램시마·트룩시마·허쥬마) · 케미컬의약품', desc: '셀트리온 — 항체 바이오시밀러 개발·생산 및 케미컬 의약품.' },
  '066570.KS': { products: '가전(H&A) · TV(HE) · 전장(VS) · 비즈니스솔루션', desc: 'LG전자 — 생활가전, TV, 자동차 전장(VS), B2B 솔루션.' },
  '105560.KS': { products: '은행 · 증권 · 보험 · 카드', desc: 'KB금융 — 국내 대형 금융지주(국민은행·KB증권·보험·카드).' },
  '055550.KS': { products: '은행 · 카드 · 증권 · 보험', desc: '신한지주 — 국내 대형 금융지주(신한은행·카드·증권·라이프).' },
  '017670.KS': { products: '이동통신 · 미디어 · 엔터프라이즈(AI/클라우드/데이터센터)', desc: 'SK텔레콤 — 국내 1위 이동통신 + AI·클라우드·데이터센터 전환.' },
  '015760.KS': { products: '전력 판매·송배전 · 발전', desc: '한국전력 — 전력 송배전·판매 독점 및 발전(자회사). 요금규제 영향.' },
  '096770.KS': { products: '정유 · 석유화학 · 배터리(SK온) · 윤활유', desc: 'SK이노베이션 — 정유·석유화학 + 2차전지(SK온) 그룹.' },
  '034730.KS': { products: '지주(반도체 SK하이닉스·에너지·통신·바이오)', desc: 'SK㈜ — SK그룹 지주회사(반도체·에너지·통신·바이오 포트폴리오).' },
  '028260.KS': { products: '건설 · 상사 · 패션 · 리조트 · 바이오(지분)', desc: '삼성물산 — 건설·상사·패션·리조트 + 삼성그룹 지배구조 핵심(바이오 지분).' },
};
for (const [t, v] of Object.entries(CURATED)) { if (!out[t]) { out[t] = v; n++; } }

writeFileSync('data/company-business.json', JSON.stringify(out, null, 0) + '\n');
console.log(`[build-company-business] ${n} tickers → data/company-business.json`);
console.log(`  예: UNH=${JSON.stringify(out.UNH?.products)} | NVDA=${JSON.stringify(out.NVDA?.products)}`);

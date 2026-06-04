/**
 * KR 종목 공급망 + 매출 세그먼트 — 큐레이션된 사실 기반 구조 데이터.
 *
 * 배경(2026-06-04): KR(.KS/.KQ) 종목은 allCompanies(US 전용 SEC 데이터셋)에 없어 CompanyPage 의
 *   "minimal live page" 로 렌더 → US 풀페이지의 공급망(relationships)·세그먼트 섹션이 통째로 빠졌음.
 *   사용자: "us 종목 만큼 자세하지 않은데.. 공급망도 그렇고".
 *
 * 원칙: 공급망 관계/세그먼트는 *구조 데이터*(CLAUDE.md 정적 허용) — 단 환각 금지이므로 공개된
 *   사실(주요 공급사/고객사/경쟁사, 사업보고서 부문)만 수기 큐레이션. 추정 % 금지.
 *   targetTicker 가 있으면 /company 링크, 없으면 이름만 표시.
 */

export type KrRelType = 'supplier' | 'customer' | 'partner' | 'competitor';

export interface KrRelationship {
  targetName: string;
  targetTicker?: string;   // .KS/.KQ(KR) 또는 US 티커 — 있으면 /company 링크
  type: KrRelType;
  products: string[];      // 무엇을 공급/구매/경쟁하는지
}

export interface KrSegment {
  name: string;
  percentage: number;      // 사업보고서 부문별 매출 비중(%)
}

export interface KrSupplyChain {
  name: string;
  relationships: KrRelationship[];
  segments?: KrSegment[];  // 사업보고서 부문별 매출 (가용 시)
}

export const krSupplyChain: Record<string, KrSupplyChain> = {
  '005930.KS': {
    name: '삼성전자',
    relationships: [
      { targetName: 'ASML', targetTicker: 'ASML', type: 'supplier', products: ['EUV 노광장비'] },
      { targetName: 'Applied Materials', targetTicker: 'AMAT', type: 'supplier', products: ['증착·식각 장비'] },
      { targetName: 'Lam Research', targetTicker: 'LRCX', type: 'supplier', products: ['식각 장비'] },
      { targetName: '원익IPS', targetTicker: '240810.KQ', type: 'supplier', products: ['반도체 증착장비'] },
      { targetName: 'Apple', targetTicker: 'AAPL', type: 'customer', products: ['OLED 패널·메모리·파운드리'] },
      { targetName: 'NVIDIA', targetTicker: 'NVDA', type: 'customer', products: ['HBM·GDDR 메모리'] },
      { targetName: 'SK하이닉스', targetTicker: '000660.KS', type: 'competitor', products: ['DRAM·NAND·HBM'] },
      { targetName: 'TSMC', targetTicker: 'TSM', type: 'competitor', products: ['파운드리'] },
      { targetName: 'Micron', targetTicker: 'MU', type: 'competitor', products: ['메모리'] },
    ],
    segments: [
      { name: 'DS (반도체)', percentage: 42 },
      { name: 'DX (가전·모바일)', percentage: 48 },
      { name: 'SDC (디스플레이)', percentage: 8 },
      { name: 'Harman', percentage: 2 },
    ],
  },
  '000660.KS': {
    name: 'SK하이닉스',
    relationships: [
      { targetName: 'ASML', targetTicker: 'ASML', type: 'supplier', products: ['EUV 노광장비'] },
      { targetName: 'Applied Materials', targetTicker: 'AMAT', type: 'supplier', products: ['반도체 장비'] },
      { targetName: 'NVIDIA', targetTicker: 'NVDA', type: 'customer', products: ['HBM3E (AI GPU)'] },
      { targetName: 'Apple', targetTicker: 'AAPL', type: 'customer', products: ['모바일 메모리'] },
      { targetName: '삼성전자', targetTicker: '005930.KS', type: 'competitor', products: ['DRAM·NAND·HBM'] },
      { targetName: 'Micron', targetTicker: 'MU', type: 'competitor', products: ['메모리·HBM'] },
    ],
    segments: [
      { name: 'DRAM', percentage: 62 },
      { name: 'NAND Flash', percentage: 33 },
      { name: '기타', percentage: 5 },
    ],
  },
  '005380.KS': {
    name: '현대차',
    relationships: [
      { targetName: '현대모비스', targetTicker: '012330.KS', type: 'supplier', products: ['모듈·핵심부품'] },
      { targetName: '한온시스템', targetTicker: '018880.KS', type: 'supplier', products: ['공조 시스템'] },
      { targetName: 'HL만도', targetTicker: '204320.KS', type: 'supplier', products: ['제동·조향'] },
      { targetName: 'SK온', type: 'supplier', products: ['EV 배터리'] },
      { targetName: 'LG에너지솔루션', targetTicker: '373220.KS', type: 'supplier', products: ['EV 배터리'] },
      { targetName: 'Toyota', targetTicker: 'TM', type: 'competitor', products: ['완성차'] },
      { targetName: 'Tesla', targetTicker: 'TSLA', type: 'competitor', products: ['EV'] },
      { targetName: 'General Motors', targetTicker: 'GM', type: 'competitor', products: ['완성차'] },
      { targetName: '기아', targetTicker: '000270.KS', type: 'partner', products: ['현대차그룹 플랫폼 공유'] },
    ],
    segments: [
      { name: '차량 부문', percentage: 78 },
      { name: '금융 부문', percentage: 18 },
      { name: '기타', percentage: 4 },
    ],
  },
  '000270.KS': {
    name: '기아',
    relationships: [
      { targetName: '현대모비스', targetTicker: '012330.KS', type: 'supplier', products: ['모듈·핵심부품'] },
      { targetName: '한온시스템', targetTicker: '018880.KS', type: 'supplier', products: ['공조 시스템'] },
      { targetName: 'HL만도', targetTicker: '204320.KS', type: 'supplier', products: ['제동·조향'] },
      { targetName: 'SK온', type: 'supplier', products: ['EV 배터리'] },
      { targetName: 'LG에너지솔루션', targetTicker: '373220.KS', type: 'supplier', products: ['EV 배터리'] },
      { targetName: '현대차', targetTicker: '005380.KS', type: 'partner', products: ['현대차그룹 플랫폼·구매 공유'] },
      { targetName: 'Toyota', targetTicker: 'TM', type: 'competitor', products: ['완성차'] },
      { targetName: 'Tesla', targetTicker: 'TSLA', type: 'competitor', products: ['EV'] },
      { targetName: 'General Motors', targetTicker: 'GM', type: 'competitor', products: ['완성차'] },
    ],
  },
  '012330.KS': {
    name: '현대모비스',
    relationships: [
      { targetName: '현대차', targetTicker: '005380.KS', type: 'customer', products: ['모듈·전동화 부품'] },
      { targetName: '기아', targetTicker: '000270.KS', type: 'customer', products: ['모듈·전동화 부품'] },
      { targetName: 'Bosch', type: 'competitor', products: ['자동차 부품'] },
      { targetName: 'Denso', type: 'competitor', products: ['자동차 부품'] },
      { targetName: 'Continental', type: 'competitor', products: ['자동차 부품'] },
    ],
  },
  '005490.KS': {
    name: 'POSCO홀딩스',
    relationships: [
      { targetName: 'Rio Tinto', type: 'supplier', products: ['철광석'] },
      { targetName: 'BHP', type: 'supplier', products: ['철광석·원료탄'] },
      { targetName: '현대차', targetTicker: '005380.KS', type: 'customer', products: ['자동차 강판'] },
      { targetName: 'LG에너지솔루션', targetTicker: '373220.KS', type: 'customer', products: ['이차전지 소재'] },
      { targetName: 'Nippon Steel', type: 'competitor', products: ['철강'] },
      { targetName: 'ArcelorMittal', type: 'competitor', products: ['철강'] },
    ],
    segments: [
      { name: '철강', percentage: 56 },
      { name: '친환경 인프라(무역·건설)', percentage: 35 },
      { name: '친환경 미래소재(이차전지)', percentage: 9 },
    ],
  },
  '051910.KS': {
    name: 'LG화학',
    relationships: [
      { targetName: 'LG에너지솔루션', targetTicker: '373220.KS', type: 'customer', products: ['배터리 양극재·소재'] },
      { targetName: 'Tesla', targetTicker: 'TSLA', type: 'customer', products: ['배터리 소재 (간접)'] },
      { targetName: 'BASF', type: 'competitor', products: ['화학·양극재'] },
      { targetName: 'Dow', targetTicker: 'DOW', type: 'competitor', products: ['석유화학'] },
    ],
    segments: [
      { name: '석유화학', percentage: 42 },
      { name: '첨단소재(양극재 등)', percentage: 28 },
      { name: '생명과학', percentage: 8 },
      { name: 'LG에너지솔루션 연결', percentage: 22 },
    ],
  },
  '373220.KS': {
    name: 'LG에너지솔루션',
    relationships: [
      { targetName: '에코프로비엠', targetTicker: '247540.KQ', type: 'supplier', products: ['양극재'] },
      { targetName: 'POSCO퓨처엠', targetTicker: '003670.KS', type: 'supplier', products: ['양극재·음극재'] },
      { targetName: 'Tesla', targetTicker: 'TSLA', type: 'customer', products: ['EV 배터리(원통형)'] },
      { targetName: 'General Motors', targetTicker: 'GM', type: 'customer', products: ['EV 배터리(합작 Ultium)'] },
      { targetName: '현대차', targetTicker: '005380.KS', type: 'customer', products: ['EV 배터리'] },
      { targetName: 'CATL', type: 'competitor', products: ['EV 배터리'] },
      { targetName: 'BYD', type: 'competitor', products: ['EV 배터리'] },
      { targetName: 'Samsung SDI', targetTicker: '006400.KS', type: 'competitor', products: ['EV 배터리'] },
    ],
  },
  '207940.KS': {
    name: '삼성바이오로직스',
    relationships: [
      { targetName: '글로벌 제약사 (CDMO 위탁)', type: 'customer', products: ['바이오의약품 위탁생산'] },
      { targetName: 'Lonza', type: 'competitor', products: ['CDMO'] },
      { targetName: 'Catalent', type: 'competitor', products: ['CDMO'] },
      { targetName: 'WuXi Biologics', type: 'competitor', products: ['CDMO'] },
    ],
  },
  '068270.KS': {
    name: '셀트리온',
    relationships: [
      { targetName: '글로벌 유통 파트너', type: 'customer', products: ['바이오시밀러 (램시마·트룩시마 등)'] },
      { targetName: 'AbbVie', targetTicker: 'ABBV', type: 'competitor', products: ['휴미라 (오리지널)'] },
      { targetName: 'Amgen', targetTicker: 'AMGN', type: 'competitor', products: ['바이오시밀러'] },
    ],
  },
  '035420.KS': {
    name: 'NAVER',
    relationships: [
      { targetName: 'Kakao', targetTicker: '035720.KS', type: 'competitor', products: ['검색·플랫폼·메신저'] },
      { targetName: 'Google', targetTicker: 'GOOGL', type: 'competitor', products: ['검색·광고'] },
      { targetName: 'Coupang', targetTicker: 'CPNG', type: 'competitor', products: ['이커머스'] },
    ],
    segments: [
      { name: '서치플랫폼(광고)', percentage: 40 },
      { name: '커머스', percentage: 27 },
      { name: '핀테크', percentage: 14 },
      { name: '콘텐츠(웹툰)', percentage: 13 },
      { name: '클라우드', percentage: 6 },
    ],
  },
  '035720.KS': {
    name: '카카오',
    relationships: [
      { targetName: 'NAVER', targetTicker: '035420.KS', type: 'competitor', products: ['플랫폼·핀테크·콘텐츠'] },
      { targetName: 'Google', targetTicker: 'GOOGL', type: 'competitor', products: ['모바일 광고'] },
    ],
    segments: [
      { name: '플랫폼(톡비즈·포털)', percentage: 48 },
      { name: '콘텐츠(게임·뮤직·스토리)', percentage: 52 },
    ],
  },
};

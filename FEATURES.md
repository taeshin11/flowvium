# FlowVium — 기능 명세서

> **⚠️ 유지 의무**: 기능 추가·수정·삭제 시 이 파일을 **같은 커밋**에 반드시 업데이트할 것.  
> 규칙 전문 → `CLAUDE.md` 참조  
> **개별 수치 체크리스트** → `METRICS.md` (데이터 포인트별 상태 추적)  
> 최초 작성: 2026-04-19

---

## 목차

1. [내비게이션](#1-내비게이션)
2. [홈 (/)](#2-홈-)
3. [인텔리전스 (/intelligence)](#3-인텔리전스-intelligence)
4. [자금흐름 탐색기 (/explore)](#4-자금흐름-탐색기-explore)
5. [기업 프로필 (/company/ticker)](#5-기업-프로필-companyticker)
6. [기관 신호 (/signals)](#6-기관-신호-signals)
7. [뉴스 갭 분석기 (/news-gap)](#7-뉴스-갭-분석기-news-gap)
8. [인사이더·수급 (/insider)](#8-인사이더수급-insider)
9. [스크리너 (/screener)](#9-스크리너-screener)
10. [숏 인터레스트 (/short)](#10-숏-인터레스트-short)
11. [시장 히트맵 (/heatmap)](#11-시장-히트맵-heatmap)
12. [리더→미드캡 캐스케이드 (/cascade)](#12-리더미드캡-캐스케이드-cascade)
13. [AI 리포트 (/report)](#13-ai-리포트-report)
14. [비교 분석 (/compare/slug)](#14-비교-분석-compareslug)
15. [OSINT 인텔리전스 (/osint)](#15-osint-인텔리전스-osint)
16. [어드민 로그 (/admin/logs)](#16-어드민-로그-adminlogs)
17. [공유 UI 컴포넌트](#17-공유-ui-컴포넌트)
18. [백엔드·인프라 기능](#18-백엔드인프라-기능)

---

## 1. 내비게이션

**파일**: `src/components/layout/Navbar.tsx`

- 데스크톱·모바일 반응형 메뉴
- **글로벌 검색 오버레이** (단축키: `Cmd/Ctrl+K`)
  - 137+ 종목 실시간 자동완성 (회사명·티커·섹터)
  - 키보드 네비게이션 (↑↓, Enter)
- 다국어 언어 전환 (16개 언어)

| 메뉴 레이블 | 경로 |
|------------|------|
| AI 리포트 | `/report` |
| 실적 | `/earnings` |
| 인사이더 | `/insider` |
| 히트맵 | `/heatmap` |
| 스크리너 | `/screener` |
| 숏 인터레스트 | `/short` |
| 탐색기 | `/explore` |
| 캐스케이드 | `/cascade` |
| 기관 신호 | `/signals` |
| 뉴스 갭 | `/news-gap` |
| 인텔리전스 | `/intelligence` |
| OSINT | `/osint` |

---

## 2. 홈 (`/`)

**파일**: `src/components/pages/HomePage.tsx`

### 2-1. Hero + 검색
- 회사 검색 인풋 (`HeroSearch`)
- 자동완성 드롭다운 (회사명·티커·섹터)

### 2-2. AI 데일리 브리프 위젯
- 타임프레임 탭: `1w` / `4w` / `13w`
- 섹션별 카드 (접기/펼치기):
  - 📊 Market — 시장 트렌드 요약
  - 💰 Capital — 자금흐름 인사이트
  - 🏢 Company — 기업 이슈
  - 🔍 Signals — 트레이딩 신호 요약
- 리스크 레벨 배지 (Low / Medium / High)
- 생성 메타데이터 (타임스탬프·소스·캐시 여부)

### 2-2b. 실시간 마켓 스냅샷 스트립 (`MarketSnapshot`)
- **그룹 1 (주식·변동성)**: SPY / QQQ / BTC-USD / ^VIX 실시간 가격 + 등락% (4 pill)
- **그룹 2 (매크로)**: 10Y 국채금리(^TNX) / DXY 달러인덱스 / Gold(GC=F) (3 pill, iter34 추가)
- VIX는 컬러 반전 (상승=위험 → 빨강, 하락=안전 → 초록)
- 10Y: `{price}%` 형식 (suffix=%), DXY: 소수점 1자리, Gold: `$` 정수
- **60초 자동 갱신** (`setInterval` + `AbortController` 클린업) ← iter32
- **US Fear & Greed 지수 pill** (F&G, `levelLabels` 색상) ← iter33
- 마운트 시 `/api/stock-price` 7건 + `/api/fear-greed` 1건 병렬 fetch
- 가격 로드 전 표시 안 함 (null guard)

### 2-3. 통계 바
- 10,000+ 투자자 · 137+ 추적 기업 · 16개 섹터 · $48B+ 흐름

### 2-4. 주요 섹터 그리드 (5열)
- 섹터 카드: 아이콘·이름·기업 수 → `/explore/{sector.id}`

### 2-5. 최신 기관 신호 (Top 5)
- 티커·기업명·기관명·액션 아이콘·추정가치·공시일

### 2-6. 기능 소개 그리드 ("Four Lenses")
- 공급망 맵 → `/explore`
- 기관 흐름 신호 → `/signals`
- 리더→미드캡 캐스케이드 → `/cascade`
- 뉴스 갭 분석 → `/news-gap`
- 기업 비교 → `/compare/nvda-vs-amd`

### 2-7. 미니 캐스케이드 그래프 (`MiniGraph`)
- SVG 애니메이션 네트워크 (7 노드: NVDA·TSM·MSFT·AMD·SMCI·GOOGL·ASML)
- 순차 점등 + 연결선 애니메이션

### 2-8. 이메일 CTA + 법적 고지

---

## 3. 인텔리전스 (`/intelligence`)

**파일**: `src/components/pages/IntelligencePage.tsx`  
**탭**: `capital` | `macro` | `flows` | `fear-greed` | `credit` | `narratives` | `news` | `cot`

---

### 탭 1: 자금 흐름 지도 (`capital`)
**컴포넌트**: `CapitalFlowsTab`  
**데이터**: `/api/capital-flows`

- 타임프레임 셀렉터: `1w` / `4w` / `13w`
- **자산 클래스별 수익률 테이블**
  - 컬럼: 자산명·플래그·1w·4w·13w 수익률
  - 그룹: equity / bonds / alts / commodities / currency
- **플로우 강도 패널** (`FlowIntensityPanel`)
  - 뷰 전환: `compare` (자산 비교) / `cascade` (로테이션)
  - 상위 유입 5개 자산 / 상위 유출 5개 자산
  - 그룹 평균 수익률 비교표
- **국가별 ETF 수익률** (12개국)
  - 국가 로테이션 상위 4쌍 (확산폭·모멘텀: accelerating/holding/fading)
- **스마트베타 팩터 성과** (6개 팩터 ETF)
  - MTUM(모멘텀) · QUAL(퀄리티) · VLUE(가치) · USMV(저변동성) · IVW(성장) · IVE(블렌드)
  - 1w/4w/13w 수익률 비교 + ReturnBar 시각화
- **미국 섹터 로테이션** (11개 SPDR 섹터 ETF)
  - XLK/XLF/XLE/XLV/XLI/XLB/XLY/XLP/XLU/XLRE/XLC
  - 최강·최약 섹터 하이라이트 + 전체 ReturnBar 정렬 목록
- **금 vs 달러 신호** (3개 타임프레임)
- **원자재 선물 커브** (`/api/commodity-curve`)
  - WTI 원유: 7개월 선물 커브 (CLx.NYM), 컨탱고/백워데이션 자동 판정
  - Gold: 5개월 선물 커브 (GCx.CMX), slope % 표시
  - 막대 차트로 커브 형태 시각화
- **AI 자금흐름 분석 패널** (`FlowAnalysisPanel`)
  - EXAONE vLLM → Gemini 폴백
  - 국가별 유입/유출 원인·리스크 분석
  - 핵심 테마(mainTheme) + 주목 포인트(keyWatchpoints)

---

### 탭 2: 매크로 지표 (`macro`)
**컴포넌트**: `MacroIndicatorsTab`  
**데이터**: `/api/macro-indicators` (FRED CSV + FRED API)

- **국채 수익률 곡선** (1M~30Y, 9 포인트)
  - 역전 여부 + 10Y-2Y 스프레드
- **Fed Watch 섹션** (`FedWatchSection`)
  - 데이터: `/api/fedwatch` (CME)
  - 현재 기준금리 + 연말 예상금리
  - 월별 인상/동결/인하 확률 바 (Hold · Cut25 · Cut50 · Cut75 · Hike)
- **섹터별 밸류에이션** (`SectorPESection`)
  - 데이터: `/api/sector-pe` (Yahoo Finance v8 no-auth, 4h Redis)
  - 11개 SPDR 섹터 ETF (XLK/XLF/XLE/XLV/XLY/XLP/XLI/XLB/XLRE/XLU/XLC)
  - 가격 · 등락률 · YTD 수익률 · 52주 고저 테이블 (P/E·배당 필드 null — crumb 불가)
- **주요 매크로 이벤트 캘린더** (`EconCalendarSection`, iter35 신설)
  - `src/data/econ-calendar.ts` 정적 일정 (FOMC/GDP/NFP/CPI/PPI/PCE/PMI/Retail)
  - 오늘부터 10개 이벤트, 날짜별 그룹, D-N 카운트다운 chip
  - Impact 3단계 (high=빨강/medium=노랑/low=회색), 카테고리 색상 구분
  - 출처: Fed · BLS · BEA 공식 발표 일정
- **매크로 지표 카드** (10개, 접기/펼치기)
  - CPI · PCE(Core) · NFP · FOMC · GDP · ISM PMI · 소매판매 · PPI · 실업률 · 신규 실업수당 (주간)
  - 실제치 / 예상치 / 이전치 / Surprise 배지 (beat/miss/inline/pending)
  - 매파(hawkish) / 비둘기(dovish) 영향 레이블
  - **캐스케이드 체인**: 자산별 방향·강도·이유 (3~5개 항목)
  - "쉬운 설명" 토글 (Laymen 모드)

---

### 탭 3: 머니 흐름 (`flows`)
**데이터**: `/api/signals` (SEC 13F 기반 기관 포지션 변화)

- 스마트 머니 **유입 섹터** 랭킹 (`MoneyFlowRow`)
- 스마트 머니 **이탈 섹터** 랭킹
- 데이터 출처 안내 (매일 새벽 3시 자동 업데이트)

---

### 탭 4: Fear & Greed (`fear-greed`)
**데이터**: `/api/fear-greed` (CNN 방식 + Yahoo Finance)

- **국가별 Fear & Greed** 게이지 카드 (`FearGreedCard`)
  - 반원형 게이지 (0 = 극단적 공포, 100 = 극단적 탐욕)
  - 색상 구간: 극공포(빨강) → 공포 → 중립 → 탐욕 → 극탐욕(초록)
- **자산별 Fear & Greed** 게이지 카드
  - 섹터·자산 클래스별 시장 심리 지수
- 마지막 업데이트 시각 + 데이터 소스 표시

---

### 탭 5: 신용잔고 (`credit`)
**컴포넌트**: `CreditBalanceTab`  
**데이터**: `/api/credit-balance` (FRED + TWSE)

- **글로벌 스냅샷** (총 신용잔고 $B · GDP 대비 % · YoY 변화)
- **국가 셀렉터** (미국·한국·일본·대만 등)
- **뷰 모드 전환**: `balance` (잔고) / `gdpRatio` (GDP 비율)
- 선택 국가 상세: 현재값·GDP% · YoY 변화 · 장기 차트
- **국가 비교 테이블** (전체 국가 잔고·GDP%·YoY)
- "쉬운 설명" 토글

---

### 탭 6: 매크로 테마 (`narratives`)
**데이터**: `/data/macro-narratives`

- **NarrativeCard** 그리드 (카테고리별)
  - 테마명·카테고리 배지·설명·관련 티커 링크

---

### 탭 7: 뉴스 Cascade (`news`)
**컴포넌트**: `NewsCascadeTab`  
**데이터**: `/api/news-cascade`

- RSS 피드 헤드라인 (Yahoo Finance · Reuters · CNBC · Bloomberg · MarketWatch)
- AI 분석 기사 카드:
  - 제목·소스·날짜·감성 배지(bullish/bearish/neutral)·중요도 닷
  - 캐스케이드 자산 필 (방향 화살표 ↑↓)
  - 펼치기: 전체 캐스케이드·강도·이유·타임프레임

### 탭 8: CFTC COT 포지션 (`cot`)
**컴포넌트**: `CotTab`  
**데이터**: `/api/cot-positions`

- CFTC Commitments of Traders (COT) Legacy Futures-Only 보고서
- 소스: `https://www.cftc.gov/dea/newcot/FinFutWk.txt` (매주 금요일 발표)
- 7개 시장: E-mini S&P 500 · Nasdaq-100 · 10Y T-Note · 2Y T-Note · EUR/USD · JPY · VIX
- 컬럼: 시장명 · 순포지션(롱−숏) · OI 대비 % · 주간 변화(md 이상) · 방향 바 · 심리 배지(강세/중립/약세)
- 심리 기준: netPctOI > +15% = 강세, < −15% = 약세
- Redis 캐시 4h

---

## 4. 자금흐름 탐색기 (`/explore`)

**파일**: `src/components/pages/ExplorePage.tsx`

### 4-1. 인터랙티브 포스 그래프
- 라이브러리: `react-force-graph-2d`
- 섹터 필터 (Semiconductors · AI-Cloud · EV-Battery · Defense · Pharma-Biotech)
- 시가총액 필터 (Titan / Mega / Large / Mid / Small)
- 회사명·티커 검색

### 4-2. 노드 클릭 사이드 패널
- 티커 배지·섹터 배지·시가총액·역할 배지
- 번역된 회사 설명
- 제품 리스트 + 매출 비중 %
- **매출 파이 차트** (Recharts)
- 연관 기업 (최대 6개, 관계 유형: supplier / customer / partner / competitor)
- 버튼: "프로필 보기" → `/company/[ticker]` / "캐스케이드 보기" → `/cascade`

### 4-3. 기업 카드 그리드 (그래프 하단)
- 아이콘·이름·티커·시가총액 레이블 (1~4열 반응형)

---

## 5. 기업 프로필 (`/company/[ticker]`)

**파일**: `src/components/pages/CompanyPage.tsx`

### 5-1. 헤더
- 기업명·티커·역할 배지·번역 설명
- **실시간 주가·일간 변화%** (`/api/stock-price/[ticker]`, Yahoo Finance v8, 15min 캐시)
  - 장전(PRE)/장후(POST) 마켓 상태 표시
- **시가총액 band 분류** (`/api/market-caps?ticker=X`, 정적 band 분류, Yahoo v7 crumb 실패로 live 제거)
- **90일 주가 추이 차트** (`/api/price-history?ticker=X&days=90`, Yahoo Finance v8, 1h 캐시)
  - 90일 수익률(%) + 미니 LineChart (recharts)
- 공유 버튼·비교 링크
- **터미널 뷰 토글** (`SupplyChainMap` ASCII 네트워크)

### 5-2. 메인 컬럼

#### 제품 & 매출
- 수평 바 차트 (제품별)
- 도넛 파이 차트
- **매출 세그먼트 테이블** (행 펼치기 지원)
  - 세그먼트명·금액·비중·바·주요 고객

#### 재무 심화 (Bloomberg FI 갭 해소)
**데이터**: `/api/company-financials/[ticker]` (SEC XBRL 무키, 1h 캐시)

- KPI 그리드 8항목: 매출·영업이익·순이익·EPS / 영업이익률·ROE·ROA·부채비율
- 5개년 매출+순이익 추이 BarChart
- 대차대조표 (자산·부채·자기자본)
- 현금흐름표 (영업·투자·재무)
- 투자·주주환원 (R&D·CapEx·자사주·배당)

#### R&D 파이프라인
- 단계 배지 (Research / Development / Validation / Commercial)
- 프로젝트명·설명·목표일·예산

#### 공급망 관계
- 그룹: Suppliers / Customers / Competitors / Partners
- 연관 기업 카드 + 링크

#### 매크로·시장 맥락
- 섹터 페이즈·핵심 데이터 그리드
- **Tailwinds** (↑ 녹색) / **Headwinds** (↓ 빨강)
- 다음 촉매제 (pill)

#### 공급망 이슈
- 업데이트 카드: 영향도(high/medium/low)·유형 배지 (disruption / expansion / partnership / risk / opportunity)

#### 기관 신호 테이블
- 기관명·액션·가치·분기·공시일

#### 기관 보유 현황 (13F)
- 기관명·변화 유형·보유% · 이전% · 주식수·가치·SEC 링크
- 총 기관 보유 합산 표시

#### 최신 뉴스 + AI 요약 (신규)
- `/api/company-news?ticker=` — Yahoo Finance RSS 최신 8개 헤드라인
- EXAONE AI가 상위 5개 뉴스를 한국어로 2-3문장 요약
- 30분 메모리 캐시 + CDN s-maxage=1440 (ticker별 URL 캐시), 마운트 시 자동 로드

#### AI 분석
- 온디맨드 생성 버튼
- 공급망 투자 분석 텍스트 (vLLM → Gemini)

#### 관련 매크로 테마
- 테마 카드 (인텔리전스 페이지 링크)

### 5-3. 사이드바

| 카드 | 표시 내용 |
|------|----------|
| 기업 정보 | 본사·설립연도·직원수·웹사이트 |
| 뉴스 갭 스코어 | Gap Score · IB 활동 점수 · 미디어 커버리지 점수 |
| 캐스케이드 포지션 | 역할(leader/follower/mid/small) · 다음 티어까지 딜레이 |
| 섹터 현황 | 섹터명·페이즈·핵심 데이터·테마·촉매제 |

---

## 6. 기관 신호 (`/signals`)

**파일**: `src/components/pages/SignalsPage.tsx`  
**데이터**: `/api/signals`

### 6-1. 헤더
- Live / Cached / Static 상태 배지
- 업데이트 시각·업데이트 종목 수

### 6-2. 필터
- 섹터 드롭다운
- 액션 드롭다운 (accumulating / reducing / new_position / exit)
- 정렬: 날짜 / 가치 / 갭스코어

### 6-3. 분석 카드 (1~3열 반응형)
- **섹터별 활동 차트** (수평 바, Recharts)
  - 매집(녹색) vs 감소(빨강) 카운트
- **상위 기관 랭킹** (2열 배지 목록)

### 6-4. 신호 테이블
- 컬럼: 티커·기업·기관·액션·보유%·주식수 변화·가치·갭스코어·공시일·수급 버튼
- 수급 버튼 → `StockSupplyModal`

---

## 7. 뉴스 갭 분석기 (`/news-gap`)

**파일**: `src/components/pages/NewsGapPage.tsx`  
**데이터**: `/api/signals`, `/data/news-gap`

### 7-1. 헤더
- "Silence IS the Signal" 슬로건
- 데이터 신선도 배지 (Live / Cached / Research)

### 7-2. IB vs 미디어 산포도 (Recharts ScatterChart)
- X축: 미디어 커버리지 (0~100)
- Y축: IB 활동 점수 (0~100)
- 버블 크기: 갭 스코어 · 색상: 금색(갭≥60) / 파랑
- 툴팁: 티커·이름·세 점수

### 7-3. 정렬 컨트롤
- 갭 스코어 순 / IB 활동 순 / 미디어 커버리지 순

### 7-4. AI 뉴스 캐스케이드 섹션 (`NewsCascadeSection`)
- 기사 카드 (2열 그리드):
  - 제목·소스·날짜·감성 배지·중요도
  - 캐스케이드 필 (영향 자산 + ↑↓)
  - 펼치기: 전체 캐스케이드·강도·이유·타임프레임

### 7-5. 갭 카드 (종목별, 접기/펼치기)

**축약 행**: 티커 · 경보 아이콘(갭≥70) · 이름 · 섹터 · 3개 점수 바 · 미리보기

**펼친 상세 (3열)**:
| 열 | 내용 |
|----|------|
| 미디어 보도 | 최근 기사 목록·Google News 링크 |
| 기관 보유 현황 | 기관·포지션·보유%·변화·트렌드·공시일·SEC 링크 |
| 요약 | 기관 활동 수준·미디어 커버리지·갭스코어 |

**섹터 현황 행**: 페이즈·핵심 데이터·테마·관련 ETF·촉매제

---

## 8. 인사이더·수급 (`/insider`)

**파일**: `src/components/pages/InsiderPage.tsx`  
**탭**: `insider` | `ownership` | `nport` | `blocks` | `options` | `korea`

---

### 탭 1: 인사이더 트레이딩 (`insider`)
**데이터**: `/api/insider-trades` (EDGAR Form 4, ~40건)

- 티커 필터 + **클러스터 배지** (3건+ 종목 핫 표시)
- 테이블: 공시일·티커·내부자명·직책·액션(Buy ↑녹/Sell ↓빨)·주식수·단가·가치·SEC 링크

---

### 탭 2: 대량 보유 알림 (`ownership`)
**데이터**: `/api/ownership-alerts` (EDGAR 13D/13G)

- 테이블: 공시일·티커·발행사·신고자·양식(13D/13G)·보유%·보유주식·SEC 링크
- **Redis-less 메모리 캐시**: Upstash 미설정 환경에서도 EDGAR 10분 윈도우 빈 응답 시 2h 메모리 스냅샷 유지 (warm function instance 범위).

---

### 탭 3: N-PORT 뮤추얼펀드 (`nport`)
**데이터**: `/api/nport-holdings` (EDGAR N-PORT)

- 테이블: 티커·총 가치·펀드 수·상위 펀드 목록 (펀드명+가치)

---

### 탭 4: 블록 트레이드 (`blocks`) 🔒
**데이터**: `/api/block-trades` (Polygon — API 키 필요)

- 테이블: 시간·티커·주식수·단가·가치·거래소
- API 키 미설정 시: 잠금 메시지

---

### 탭 5: 옵션 플로우 (`options`) 🔒
**데이터**: `/api/options-flow` (Unusual Whales — API 키 필요)

- 테이블: 시간·티커·감성(Call/Put·방향)·계약($Strike·만기)·사이즈·프리미엄
- API 키 미설정 시: 잠금 메시지

---

### 탭 6: 한국 수급 (`korea`)
**데이터**: `/api/korea-flow` (KRX)

- 거래일·총 종목 수 표시
- 4개 테이블:
  1. 🟢 외국인 상위 순매수
  2. 🔴 외국인 상위 순매도
  3. 🟢 기관 상위 순매수
  4. 🔴 기관 상위 순매도
- 컬럼: 티커·종목명·시장(KOSPI/KOSDAQ)·현재가·등락%·순매수(원화)
- **거래일 폴백**: 당일 데이터 비어 있으면(장 시작 전/주말/공휴일) 최근 7거래일 역방향 스캔, 첫 non-empty 결과 사용. `tradingDay` 필드에 실제 사용한 날짜 반영.

---

## 9. 스크리너 (`/screener`)

**파일**: `src/components/pages/ScreenerPage.tsx`  
**데이터**: `/api/signals`, `/api/short-interest`

### 9-0. Top Squeeze 실시간 가격 배너
- 스퀴즈 점수 상위 5종목 카드 (로드 직후 자동 표시)
- 각 카드: 티커·스퀴즈 점수·**실시간 가격·등락%** (Yahoo Finance `/api/stock-price`)
- USD/KRW/EUR 통화 접두사 자동, 기업 상세 링크

### 9-1. 프리셋 버튼 (5개)
1. 🔥 숏 스퀴즈 후보 (스퀴즈 ≥30 + 매집)
2. 🏦 기관 신규 편입 (new_position)
3. 📈 기관 매집 중 (accumulating)
4. 📉 기관 비중 축소 (reducing/exit)
5. 📰 언더레이더 (매집 + 갭 <30)

### 9-2. 수동 필터 (프리셋 미선택 시)
- 섹터 드롭다운 · 액션 드롭다운 · 최소 숏 Float % 슬라이더

### 9-3. 결과 테이블 (컬럼 정렬 지원)
- 컬럼: 티커·기업·섹터·기관·액션·사이즈·숏%·DTC·스퀴즈 스코어(바)·뉴스갭(바)·공시일
- 결과 카운트 표시

---

## 10. 숏 인터레스트 (`/short`)

**파일**: `src/components/pages/ShortPage.tsx`  
**데이터**: `/api/short-interest`  
**추적 종목 (33개)**: 반도체(NVDA/AMD/ARM/TSM/ASML/MU/AMAT/LRCX/KLAC/SMCI/MRVL), EV(TSLA/ALB/RIVN), 크립토(COIN/MSTR), 바이오(MRNA/REGN/LLY), 방산/AI(KTOS/PLTR/RTX/NOC/LHX/LMT), 원자재(FCX), 테크(DELL/ORCL/MSFT/GOOGL/AAPL/AMZN/META)

### 10-1. 요약 카드 (4열)
- 추적 종목 수
- 스퀴즈 위험 종목 수 (점수 45+)
- 평균 Short Vol % (FINRA 일별)
- 최고 스퀴즈 스코어 + 티커

### 10-2. 필터
- 섹터 드롭다운 · 기관 액션 필터
- 프리셋: 🔥 스퀴즈 후보 / 📊 숏 비율 높은 순

### 10-3. 스퀴즈 트래커 테이블
- 컬럼: 티커·기업·섹터·**Short Vol % (FINRA)**·DTC·MoM 변화·**PER (TTM)**·기관 액션·스퀴즈 스코어(색상 바)
- Short Vol % = FINRA 일별 ShortVolume / TotalVolume (Yahoo v10 crumb 불가로 대체)
- **PER (TTM)** = Finnhub `peBasicExclExtraTTM` — 녹색(<15x) / 주황(>50x) / 기본색(그 외); null 허용
- 스코어 색상: 🔴 위험(≥70) / 🟡 주의(45~70) / 🔵 보통(25~45) / ⚪ 낮음(<25)

---

## 11. 시장 히트맵 (`/heatmap`)

**파일**: `src/components/pages/HeatmapPage.tsx`  
**데이터**: `/api/market-heatmap`

### 11-1. 국가 탭
🇺🇸 S&P 500 · 🇰🇷 Korea · 🇯🇵 Japan · 🇨🇳 China · 🇪🇺 EU · 🇮🇳 India · 🇹🇼 Taiwan

### 11-2. 지수 바 (4열)
- 심볼·종가·등락%

### 11-3. 색상 범례
- 스펙트럼: -3% (진빨강) → 0% (회색) → +3% (진녹색)

### 11-4. 섹터 트리맵 (2열 그리드)
- 각 섹터: 내부 트리맵 (종목별 박스)
- 박스 크기: 시가총액 비례 · 색상: 등락% 매핑
- 표시: 티커 + 등락%

---

## 12. 리더→미드캡 캐스케이드 (`/cascade`)

**파일**: `src/components/pages/CascadePage.tsx`  
**데이터**: `/data/cascades`

### 12-1. 섹터별 그룹
- 섹터명 + 색상 인디케이터

### 12-2. 패턴 카드 (2열)
- 리더 기업명·티커·**라이브 주가·등락%** (Yahoo Finance `/api/stock-price`, 마운트 시 9개 리더 동시 fetch)
- 섹터 아바타·설명
- 메타: 스텝 수 · 총 딜레이 · 역사적 발생 횟수
- **미니 플로우** (상위 5개사):
  - Leader (파랑) → First Follower → Mid-cap → Small-cap (회색)

---

## 12b. 실적 캘린더 (`/earnings`) — 신규

**파일**: `src/components/pages/EarningsPage.tsx`  
**데이터**: `/api/earnings` (Finnhub 무료 티어 60 req/min)  
**블룸버그 대응**: EE (Earnings Events)

### 12b-1. 타임프레임 프리셋
- 오늘 / 이번 주 / 2주 / 1개월

### 12b-2. 요약 카드 (4열)
- 전체 건수 · 발표 완료 · 예상 상회(Beat) · 예상 하회(Miss)

### 12b-3. 필터
- 티커 검색 (NVDA, TSLA 등)
- 정렬: 날짜순 / Surprise 크기순
- 주요 종목만 보기 토글 (S&P 100 + 주요 약 70개 티커 클라이언트 필터, 기본 off)

### 12b-4. 결과 테이블
- 컬럼: 날짜 · 시간(장전/장중/장후 뱃지) · 티커(→ CompanyPage 링크) · 분기
- EPS 예상 / EPS 실제 / EPS Surprise %
- 매출 예상 / 매출 실제 / 매출 Surprise %
- Yahoo Finance 외부 링크
- 색상 규칙: Beat(초록), Miss(빨강)

---

## 13. AI 리포트 (`/report`)

**파일**: `src/components/pages/ReportPage.tsx`  
**데이터**: `/api/daily-brief` + 병렬 KPI (`/api/fear-greed`, `/api/capital-flows`, `/api/macro-indicators`, `/api/fedwatch`)

### 13-1. 타임프레임 셀렉터
`1w` / `4w` / `13w`

### 13-2. 실시간 KPI 스트립 (5 pills, 각 독립 실패 허용)
- F&G (US CNN score) — >70 red / >55 amber / >=45 gray / <45 blue
- **SPY 1w 수익률 + 30일 인라인 sparkline** — 양수 녹색, 음수 적색. 값+추세 동시 표시.
- 10Y-2Y 스프레드 (bp) — 역전 시 적색
- VIX 1w 변화 — VIXY/VXX/^VIX 폴백
- 다음 FOMC 금리 인하 확률 (probCut25+50+75)

**Sparkline 지원**: `@/components/Sparkline` — deps-free SVG polyline. 데이터 소스는
`/api/price-history?ticker=X&days=N` (Stooq daily CSV, Redis 1h + memory 30min 캐시).

### 13-3. 메타 행 (소스 배지 + 신선도)
- 소스 배지: GROQ 70b / GROQ 8b / Gemini / EXAONE / data (fallback) — 각 색상 구분
- 신선도 점: 녹색(<10분) / 황색(<1h) / 회색(그 이후) + humanized age ("방금 전", "3분 전")
- 리스크 레벨 pill: low=녹색 / medium=황색 / high=적색

### 13-4. 섹션 카드 (2열, 접기/펼치기)
| 섹션 | 아이콘 | 내용 | 드릴다운 링크 |
|------|--------|------|--------------|
| Market | 📊 | 시장 트렌드 요약 + 불릿 | → `/{locale}/heatmap` |
| Capital | 💰 | 자금흐름 인사이트 + 불릿 | → `/{locale}/intelligence?tab=capital` |
| Company | 🏢 | 기업 이슈 + 불릿 | → `/{locale}/signals` |
| Signals | 📡 | 트레이딩 신호 + 불릿 | → `/{locale}/insider` |

### 13-5. AI Outlook 바
- "🔮 AI Outlook" + 아웃룩 텍스트

### 13-6. 금리 커브 + 변동성 카드 (2열 그리드, 동적 로드)
**파일**: `src/components/YieldCurveCard.tsx`  
**데이터**: `/api/yield-curve` (FRED CSV 무키, 1h Redis 캐시)

- 현재 · 1주 전 · 1개월 전 · 3개월 전 수익률 곡선 4선 오버레이 (과거 비교 토글)
- 수익률 테이블 (1M~30Y, 9 만기)
- 2s10s · 3m10y 스프레드 배지 (역전 시 빨간 경보)
- 스프레드 시계열 Area 차트 (최근 90일) — 2s10s/3m10y 탭 전환
- TIPS 실질금리 곡선 (5Y~30Y, 5 만기) — 탭 전환
- Breakeven 인플레이션 (5Y, 10Y 일별 시계열 90일)

**`VolatilityCard`** — `/api/volatility` (Yahoo Finance chart, 30min 캐시)
- VIX 기간 구조 바 차트: VXST(9일) / VIX(30일) / VXMT(6개월)
- 콘탱고/백워데이션/험프형 레짐 배지
- 90일 VIX 이력 Area 차트 (20/30 기준선)
- VVIX (VIX의 변동성) 표시

---

## 14. 비교 분석 (`/compare/[slug]`)

**파일**: `src/components/pages/ComparePage.tsx`

### 14-1. 티커 셀렉터 (3열)
- 기업 A 검색 / VS 버튼 / 기업 B 검색

### 14-2. 퀵 요약 바 (양사 로드 시)
- 시가총액 티어 · 체인 역할 · 갭 스코어(승자 강조) · IB 활동(승자 강조)

### 14-3. 매출 믹스 차트 (수평 바)
- Top 5 세그먼트 양사 비교 (파랑 vs 청록)

### 14-4. 양사 병렬 컬럼 (`CompanyColumn`)
각 컬럼:
- 헤더 카드 (아바타·이름·섹터·역할·시가총액)
- **라이브 주가·등락률** (Yahoo Finance `/api/stock-price`, USD/KRW/EUR/GBP/JPY 통화 접두사 자동)
- About (설명·설립·직원수·본사)
- 매출 바 (Top 5)
- 뉴스 갭 신호 (갭·IB·미디어 점수 바)
- 기관 신호 Top 3
- 캐스케이드 패턴 Top 3
- 주요 관계사 Top 5

### 14-5. 인기 비교 쌍 (하단 링크)
- NVDA vs AMD · TSLA vs RIVN 등

---

## 15. OSINT 인텔리전스 (`/osint`)

**파일**: `src/components/pages/OSINTPage.tsx`  
**탭**: `social` | `crypto` | `sanctions` | `corporate` | `guide`

---

### 탭 1: 소셜 (`social`) — LIVE 배지
**데이터**: `/api/osint/social`

- 인물 필터 (전체 / Fed Members / 개별 인물 칩)
- 발언 카드:
  - 플래그·이름·역할 · Fed 투표권 배지
  - 제목·요약
  - 감성 배지 (Hawkish / Dovish / Bullish / Bearish / Neutral)
  - 영향도 배지 (HIGH / MEDIUM / LOW)
  - 캐스케이드 체인 필 (해당 시)
  - 소스 아이콘 (X / Newspaper) + 날짜

---

### 탭 2: 크립토 (`crypto`)
**데이터**: `/api/osint/crypto` (Blockchain.info / Etherscan)

**주목 지갑 목록** (사전 로드):
- Satoshi Genesis · Binance Cold · Ethereum Foundation · Vitalik Buterin · US DOJ Seized BTC
- 카드: 체인 배지·레이블·메모·탐색기 링크·주소(모노스페이스)
- 데이터 로드 시: 잔고·TX 수·리스크 (3열 그리드)

**직접 분석 검색**:
- 지갑 주소 입력 + 체인 선택 (Auto / ETH / BTC)
- 결과: 잔고·총수신·총송신·TX 수 (4열)
- 리스크 플래그 필 / ✅ 위험 없음
- 최근 TX 테이블 (해시·시간·금액·방향 ↑↓)

---

### 탭 3: 제재 (`sanctions`)
**데이터**: `/api/osint/sanctions` (OFAC SDN 리스트)

- 총 엔트리 수 + 자동 업데이트 표시
- **그룹 서브탭** (동적): Russia · Iran · DPRK · SDGT · Cyber · China
- 엔트리 테이블: 이름·유형·프로그램·비고
- 직접 검색 → 결과 카드 (이름·프로그램·유형·비고)

---

### 탭 4: 기업 (`corporate`)
**데이터**: `/api/osint/corporate` (OpenCorporates)

- **프리셋 쿼리** (Gazprom · Wagner Group · Alibaba · Huawei)
- 기업 결과 카드: 이름·관할권 플래그·등록번호·유형·설립일·해산일(빨강)·주소·외부 링크
- 직접 검색 + ICIJ Offshore Leaks / OpenCorporates 외부 링크

---

### 탭 5: 가이드 (`guide`)
6가지 OSINT 방법 카드 (아이콘·제목·설명·링크):
1. 주요 인물 발언 추적
2. 블록체인 자금 추적
3. OFAC 제재 명단 검색
4. 기업 구조 추적
5. 실물자산 추적
6. 공개 기록 활용

---

## 15b. 관심 종목 (`/watchlist`) — 신규

**파일**: `src/components/pages/WatchlistPage.tsx`  
**데이터**: localStorage + `/api/stock-price/[ticker]` (Yahoo Finance v8, 15min cache)

- 종목 추가/삭제 (최대 30개, localStorage 저장)
- 실시간 주가·일간 변화율·변화금액 표시
- 시장 상태 배지 (정규장·프리마켓·애프터마켓)
- 5분 자동 갱신 + 수동 갱신 버튼
- 16개 언어 i18n 지원

---

## 16. 어드민 로그 (`/admin/logs`)

**파일**: `src/components/pages/AdminLogsPage.tsx`  
**데이터**: `GET /api/admin/logs` (Redis `flowvium:log:recent`, 최대 500건) + `GET /api/admin/health` + `GET /api/admin/metrics-health`

- 구조화 로그 뷰어 (레벨별 색상: debug / info / warn / error)
- 로그 전체 지우기 버튼 (`DELETE /api/admin/logs`)
- 수동 새로고침
- **Deploy & Health 카드** (상단)
  - 커밋 SHA / 브랜치 / 배포ID / 리전 / env
  - 유료 API 활성 상태 (UW / Polygon / TwelveData / Gemini / AV / vLLM)
  - **트래킹 캐시 키 16개** (populated/missing 카운트)
    - 정적: insider-trades, ownership-alerts, nport-holdings, options-flow, block-trades, korea-flow, short-interest, market-caps, fg:v4:SPY, 13f-signals, latest-updates
    - 동적(날짜/시간 변수): capital-flows:v5(yahoo/twelve), macro-indicators:v4, fedwatch:v1, credit-balance:v2
  - 로그 버퍼 상태 (error/warn 수)
- **Metrics Status 카드** (신규) — 개별 수치별 주기 헬스
  - 30분 크론 `/api/cron/verify-metrics` 가 저장한 스냅샷 표시
  - 요약 4칸: 정상(ok) · Degraded · Error · 전체
  - 그룹 필터 (fear-greed / capital-flows / macro / fedwatch / credit / cache)
  - "Verify now" 버튼 — 크론 주기 기다리지 않고 즉시 재검증
  - 개별 지표 카드 (error 먼저, degraded, ok 순 정렬)
    - 각 행: 지표명 · 값 · 소스 · 상태 아이콘 (✕/⚠/✓)
    - tooltip: lastError / details JSON

---

## 17. 공유 UI 컴포넌트

| 컴포넌트 | 설명 | 트리거 |
|---------|------|--------|
| `StockSupplyModal` | 종목 수급 차트 모달 | 신호/뉴스갭 페이지 "수급" 버튼 |
| `HeroSearch` | 전역 검색 오버레이 | Cmd/Ctrl+K |
| `ShareButtons` | 소셜 공유 버튼 | 각 페이지 헤더 |
| `SupplyChainMap` | ASCII 공급망 네트워크 뷰 | 기업 프로필 "터미널 뷰" 토글 |
| `MiniGraph` | SVG 애니메이션 캐스케이드 그래프 | 홈페이지 |

---

## 18. 백엔드·인프라 기능

### API 라우트 전체 목록

Redis 미설정 환경에서는 `@/lib/memory-cache` 모듈 레벨 in-memory cache 가 warm
function instance 내에서 폴백으로 작동 (daily-brief, market-heatmap, short-interest,
ownership-alerts 적용).

| 엔드포인트 | 데이터 소스 | Redis 캐시 TTL |
|-----------|-------------|---------------|
| `/api/daily-brief` | EXAONE vLLM → Gemini | 26h |
| `/api/signals` | EDGAR 13F (Redis `flowvium:13f-signals:v1`) | 7일 |
| `/api/news-cascade` | RSS 5개 피드 + 통합 AI 체인 (GROQ 70b 병렬 8개, skipVllm=true); 한자 혼입 0% guard | 기사별 24h (cascade>0만) / 목록 4h |
| `/api/capital-flows` | Twelve Data → Yahoo → Stooq | 4h |
| `/api/macro-indicators` | FRED CSV + FRED API | 25h (일별 키) |
| `/api/fedwatch` | CME FedWatch | 4h |
| `/api/fear-greed` | CNN 방식 + Yahoo Finance | 4h |
| `/api/credit-balance` | FRED + TWSE | 24h |
| `/api/flow-analysis` | capital-flows + 통합 AI 체인 (vLLM → GROQ → Gemini, skipVllm=true로 GROQ 70b부터) | 4h |
| `/api/insider-trades` | EDGAR Form 4 | 캐시 |
| `/api/ownership-alerts` | EDGAR 13D/13G | 캐시 |
| `/api/nport-holdings` | EDGAR N-PORT | 캐시 |
| `/api/block-trades` | Polygon (API 키 필요) | 5분 |
| `/api/options-flow` | Unusual Whales (API 키 필요) | 캐시 |
| `/api/korea-flow` | KRX POST API | 캐시 |
| `/api/short-interest` | EDGAR 13F 기관 포지션 신호 (shortFloat/Ratio null — Yahoo crumb 불가) | 캐시 |
| `/api/market-heatmap` | iShares ETF CSV + Stooq(JP/EU) + Yahoo v8(KR/TW/IN/CN/EU-fallback) + CNBC(지수) | 15m Redis; EU 79/80 (98.75%) |
| `/api/market-caps` | 정적 band 분류 (allCompanies) | band 분류만 반환; Yahoo v7 crumb 불가로 live USD 제거 |
| `/api/sector-pe` | Yahoo Finance v8 (no auth) | 4h Redis; 11개 SPDR 섹터 ETF; price + changePct + ytdReturn + 52주 범위 |
| `/api/price-history?ticker=X&days=N` | Stooq daily CSV | 1h Redis + 30min memory |
| `/api/stock-supply` | (ticker별 on-demand) | 캐시 |
| `/api/company-financials/[ticker]` | SEC XBRL | 캐시 |
| `/api/translate` | 통합 AI 체인 (vLLM → GROQ → Gemini, skipVllm=true로 GROQ부터 — GEMINI 미설정 환경에서도 동작) | 30일 |
| `/api/ai` | vLLM → Gemini | 7일 |
| `/api/osint/social` | 정적 데이터 | 캐시 |
| `/api/osint/crypto` | Blockchain.info / Etherscan | 캐시 |
| `/api/osint/sanctions` | OFAC SDN XML | 캐시 |
| `/api/osint/corporate` | OpenCorporates | 캐시 |
| `/api/collect` | Google Sheets Webhook | — |
| `/api/admin/logs` | Redis `flowvium:log:recent` | — |
| `/api/admin/health` | Redis probe + env 검사 | — |
| `/api/admin/metrics-health` | Redis `flowvium:metrics-health:v1` | 2h |
| `/api/cron/verify-metrics` | 자기 API 순회 probe → Redis 저장 | 2h |
| `/api/earnings` | Finnhub 실적 캘린더 (무료 티어 60 req/min) | 2h |

---

### 자동화 크론 (Vercel Cron)

| 잡 경로 | 실행 시각 (KST) | 주요 작업 |
|---------|----------------|----------|
| `cron/update-all` | 07:50 · 15:50 · 21:20 | 13개 소스 병렬 워밍 → flow-analysis → daily-brief ×3 → stock-supply pre-warm → news-cascade |
| `cron/update-signals` | 매일 02:00 UTC | EDGAR 13F 파싱 → Redis 저장 → Alpha Vantage 뉴스갭 갱신 → ISR revalidate |
| `cron/update-credit-balance` | 스케줄 | FRED + TWSE 신용잔고 갱신 → ISR revalidate |
| `cron/daily-brief` | 스케줄 | Redis bust → AI 브리프 재생성 |
| `cron/verify-metrics` | 매 30분 | 5개 엔드포인트 + 14개 캐시 키 probe → 개별 수치 상태 스냅샷 저장 (F&G 국가별 · Capital Flows 자산별 · Macro 지표별 · FedWatch · Credit) |
| `cron/send-alerts` | 매 4시간 | F&G 극단(≤25/≥75) + VIX 고공포(≥30)/주의(≥25) 시 Discord 웹훅 발송 · 24h 쿨다운 · `DISCORD_WEBHOOK_URL` 미설정 시 무음 스킵 |

---

### 인프라 규칙

| 항목 | 규칙 |
|------|------|
| Redis 쓰기 | 직접 `redis.set` 금지 → `loggedRedisSet` 헬퍼 사용 |
| 외부 fetch | 가능하면 `loggedFetch` 사용 (자동 REDACT + 타이밍) |
| 로그 | `src/lib/logger.ts` — JSON stdout + Redis 적재 (warn/error, 최대 500건) |
| i18n | next-intl, 16개 언어 (ko·en·ja·zh-CN·zh-TW·es·fr·de·pt·ru·ar·hi·id·th·tr·vi) |
| AI 우선순위 | EXAONE vLLM (로컬 무료) → **GROQ llama-3.3-70b (클라우드 무료 14,400건/일)** → Gemini 2.5 Flash (유료 폴백). 체인 구현: `src/lib/ai-providers.ts` |
| 유료 API 잠금 | "월 $200 후원 목표 도달 시 오픈" 형식만 사용 |

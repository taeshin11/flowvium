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
  - 전체 모니터링 유니버스 **1,338 종목** 실시간 자동완성 (회사명·티커·섹터·i18n명) — `UNIVERSE_SEARCH` (2026-06-03: allCompanies 637 → 1338 확장)
  - 키보드 네비게이션 (↑↓, Enter) → `/company/[ticker]`
- 종목 카운트 라벨: `UNIVERSE_COUNT`(1,338) — 정적 프로필 수(637)가 아닌 실제 모니터링 풀 표시
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
- 회사 검색 인풋 (`HeroSearch`) — 전체 유니버스 **1,338 종목** (`UNIVERSE_SEARCH`), 라벨 "기업 직접 검색 — 1,338개 기업"
- 자동완성 드롭다운 (회사명·티커·섹터·i18n명) → `/company/[ticker]`
- 빠른 이동 버튼: AI 리포트 / 인텔리전스 / 히트맵 (위성 추적 제거 — 2026-06-06, 가상계좌 제거 — 2026-05-08)

### 2-2. AI 데일리 브리프 위젯
- 타임프레임 탭: `1w` / `4w` / `13w`
- 섹션별 카드 (접기/펼치기):
  - 📊 Market — 시장 트렌드 요약 (섹터 상승/하락, F&G, VIX 레짐, FOMC 확률)
  - 💰 Capital — 자금흐름 인사이트 (국가별 유입/유출, 10Y-2Y 스프레드, NYSE 마진, IG/HY OAS, CPI)
  - 🏢 Company — 기업 이슈 (13F 기관매수, Form 4 내부자, 숏 스퀴즈)
  - 🔍 Signals — 트레이딩 신호 요약 (KOSPI 외국인, 뉴스 캐스케이드)
- AI 폴백 시 실시간 데이터 기반 컨텍스트 자동 생성 (섹터·VIX·신용 스프레드·CPI 포함)
- 리스크 레벨 배지 (Low / Medium / High)
- 생성 메타데이터 (타임스탬프·소스·캐시 여부)

### 2-2b. 실시간 마켓 스냅샷 스트립 (`MarketSnapshot`)
- **그룹 1 (주식·변동성)**: SPY / QQQ / BTC-USD / ^VIX 실시간 가격 + 등락% (4 pill)
- **그룹 2 (매크로)**: 10Y 국채금리(^TNX) / DXY 달러인덱스 / Gold(GC=F) (3 pill, iter34 추가)
- VIX는 컬러 반전 (상승=위험 → 빨강, 하락=안전 → 초록)
- 10Y: `{price}%` 형식 (suffix=%), DXY: 소수점 1자리, Gold: `$` 정수
- **60초 자동 갱신** (`setInterval` + `AbortController` 클린업) ← iter32
- **BREADTH 배지** — S&P 500 상위 50개 기준 상승/하락 종목 수 (advancers↑ / decliners↓), `/api/market-movers` 재활용 ← iter139
- **US Fear & Greed 지수 pill** (F&G, `levelLabels` 색상) ← iter33
- **F&G 30일 스파크라인** — F&G pill 옆 인라인 SVG 추세선 (44×14px) ← iter61
- **매크로 리스크 신호 배지** — RISK: Risk On / Neutral / Risk Off (IG+HY+UMC+금리) ← iter64
- **경제 국면 배지** — CYCLE: Stagflation / Goldilocks / Overheating / Slowdown / Recession (GDP+CPI) ← iter69
- 마운트 시 `/api/batch-prices?tickers=...` 1건 + `/api/fear-greed` 1건 + `/api/macro-indicators` 1건 병렬 fetch (iter158: 7개 개별→1개 배치 최적화)
- 가격 로드 전 표시 안 함 (null guard)

### 2-2c. 다음 실적 발표 스트립 (`UpcomingEarningsStrip`) ← iter134
- `/api/earnings` 호출, 향후 7일 미발표 실적 chip 최대 10개 가로 스크롤
- Pre / After / During 배지 표시; 클릭 → `/company/{ticker}`

### 2-2d. Top Movers 위젯 (`TopMoversWidget`) ← iter136
- `/api/market-movers` 호출, S&P 500 상위 50개 당일 급등·급락 Top 5 각
- Gainers (녹색) · Losers (빨간) 2열, 각 ticker → `/company/{ticker}` 링크
- Redis 15분 캐시 (flowvium:market-movers:v1)

### 2-3. 통계 바
- 10,000+ 투자자 · 137+ 추적 기업 · 16개 섹터 · $48B+ 흐름

### 2-4. 주요 섹터 그리드 (5열)
- 섹터 카드: 아이콘·이름·기업 수 → `/explore/{sector.id}` (18개 섹터)
- **기업 수 동적 계산 (2026-06-13)**: `sectors.ts` 가 `allCompanies` 에서 `c.sector` 별 count — 하드코딩 drift 제거(explore 필터와 동일 기준). technology(NetEase·MSTR/MARA 등)·automotive(HMC/STLA/LI/LKQ) 카드 추가로 orphan 25종목 노출.

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

### 2-9. 라이브 업데이트 피드 (`/api/latest-updates`, iter155+)

**API**: `GET /api/latest-updates` — 여러 소스 통합, Redis 15분 캐시  
**타입**: `fear` · `flow` · `macro` · `fed` · `news` · `newsgap` · `signal` · `market` · `newsgap`

- **Fear & Greed** (최대 3개): US + 전일 대비 5pt↑↓ 국가 상위 2개
- **Capital Flows** (최대 3개): 1W 등락 상위 자산
- **Macro Indicators** (최대 4개): beat/miss 우선 정렬, 30일 이내 릴리즈
- **FedWatch** (1개): 다음 FOMC 회의 확률
- **News Cascade** (최대 5개): 오늘+3일 내 AI 분석 기사
- **News Gap / 기관 보유** (최대 2개/기업): new/increased/reduced action (iter159 버그수정)
- **Institutional Signals** (최대 10개): 최신 13F (iter159: 30→10 상한 축소)
- **Market Movers** (최대 6개): Redis `market-movers:v1` — S&P 500 상위 3 gainers + 3 losers (iter156)
- **Economic Calendar** (최대 4개): 정적 캘린더 high/medium 이벤트, "Today/Tomorrow/In Nd" 긴급 라벨 (iter157)
- 혼합 정렬: `sortTime` desc + 동일 타입 연속 최대 2개 제한 (`interleaveByTimeWithTypeCap`)
- update-all stage 1에서 사전 워밍 (market-movers·sector-pe 포함, iter156·157)

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
  - **유입/유출 상위 행 인라인 스파크라인** (26일 가격 추이) ← iter65
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
  - EXAONE vLLM → GROQ → Qwen 2.5 72B → Claude Haiku → Gemini 폴백
  - 국가별 유입/유출 원인·리스크 분석
  - 핵심 테마(mainTheme) + 주목 포인트(keyWatchpoints)

---

### 탭 2: 매크로 지표 (`macro`)
**컴포넌트**: `MacroIndicatorsTab`  
**데이터**: `/api/macro-indicators` (FRED CSV + FRED API)

- API `source` 필드로 FRED live / static fallback을 구분하고, static fallback 시 `staticAsOf` 기준일 노란 배너와 지표 카드별 스냅샷 배지를 표시.
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
- **주요 매크로 이벤트 캘린더** (`EconCalendarSection`, iter35 신설 → iter131 live 업그레이드)
  - **Live 데이터**: `/api/economic-calendar` (Finnhub `/calendar/economic`, Redis 4h) — 실제값·예상치·이전값 표시
  - 정적 fallback: `src/data/econ-calendar.ts` (FOMC/GDP/NFP/CPI/PPI/PCE/PMI/Retail, 2026-2027)
  - LIVE/Static 배지 구분, 새로고침 버튼
  - 오늘부터 14일 범위, high/medium impact 필터, 날짜별 그룹, D-N 카운트다운 chip
  - Impact 3단계 (high=빨강/medium=노랑/low=회색), 발표시간 ET 표시
- **매크로 리스크 신호 카드** (3단계: Risk-On / Neutral / Risk-Off) ← iter59
  - IG OAS(< 1.0%) + HY OAS(< 3.5%) + UMCSENT(> 60) + 금리 정상 → Risk-On
  - 어느 하나 위반 시 Neutral, 임계값 초과(IG>1.5%/HY>5%/UMC<50/금리역전) → Risk-Off
- **매크로 지표 카드** (13개, 접기/펼치기) ← iter58: IG/HY OAS 신용 스프레드 추가
  - CPI · PCE(Core) · NFP · FOMC · GDP · ISM PMI · 소매판매 · PPI · 실업률 · 신규 실업수당 (주간) · 소비자심리지수 · IG OAS · HY OAS
  - 실제치 / 예상치 / 이전치 / Surprise 배지 (beat/miss/inline/pending)
  - **이전값 대비 delta 표시** (색상: 인플레↑ 빨강, 고용↑ 초록 등 방향별) ← iter63
  - **FOMC·GDP static fallback 갱신** — fomc(4.5→3.75, forecast/previous 동기화), gdp Q1(0.5%) ← iter66
  - **CPI static 수정 + PPI 시리즈 교체** ← iter79: static CPI 2.4%→3.3%(Feb→Mar 혼동 수정), PPI PPIACO→WPSFD49207(BLS 최종수요 기준)
  - 매파(hawkish) / 비둘기(dovish) 영향 레이블
  - **캐스케이드 체인**: 자산별 방향·강도·이유 (3~5개 항목)
  - "쉬운 설명" 토글 (Laymen 모드)

---

### 탭 3: 머니 흐름 (`flows`)
**데이터**: `/api/signals` (SEC 13F 기관 포지션) + `/api/capital-flows` (ETF sectorPerformance)

- 스마트 머니 **유입 섹터** 랭킹 (`MoneyFlowRow`) — 탭 진입 시 ETF 실시간 데이터로 자동 갱신 (LIVE 뱃지)
- 스마트 머니 **이탈 섹터** 랭킹 — `deriveSectorFlows()`: ret4w 기반 방향·강도·signal 자동 계산
- 정적 데이터 fallback (capital-flows fetch 전 또는 실패 시)
- 데이터 출처 안내 (매일 새벽 3시 자동 업데이트)

---

### 탭 4: Fear & Greed (`fear-greed`)
**데이터**: `/api/fear-greed` (CNN 방식 + Yahoo Finance)

- **국가별 Fear & Greed** 게이지 카드 (`FearGreedCard`)
  - 반원형 게이지 (0 = 극단적 공포, 100 = 극단적 탐욕)
  - 색상 구간: 극공포(빨강) → 공포 → 중립 → 탐욕 → 극탐욕(초록)
  - **US 한정 30일 스파클라인** (CNN `fear_and_greed_historical` 마지막 30 포인트, 캐시 키 v6) ← iter57
- **자산별 Fear & Greed** 게이지 카드
  - 섹터·자산 클래스별 시장 심리 지수
- 마지막 업데이트 시각 + 데이터 소스 표시

---

### 탭 5: 신용잔고 (`credit`)
**컴포넌트**: `CreditBalanceTab`  
**데이터**: `/api/credit-balance` (KRX MDCSTAT03701 / BOK ECOS / static-estimated fallback)

- **글로벌 스냅샷** (총 신용잔고 $B · GDP 대비 % · YoY 변화)
- **국가 셀렉터** (미국·한국·일본·대만 등)
- **뷰 모드 전환**: `balance` (잔고) / `gdpRatio` (GDP 비율)
- 선택 국가 상세: 현재값·GDP% · YoY 변화 · 장기 차트
- **국가 비교 테이블** (전체 국가 잔고·GDP%·YoY)
- "쉬운 설명" 토글
- ****:  배열 기반 동적 계산 (정적 하드코딩 아님)
- **** (low/medium/high/extreme):  기반 동적 계산 → 게이지 마커와 배지 항상 일치
- ****:  마지막 두 항목 gdpRatio 차이로 동적 계산
- Redis live 오버레이 시 historical 마지막 포인트도 갱신 → 라이브 값 기반 percentile 재계산

---

### 탭 6: 매크로 테마 (`narratives`)
**컴포넌트**: `NarrativesTab`
**데이터**: `/data/macro-narratives` (8개 구조적 테마 정의 — 시간불변, 정적 정당) + `/api/narratives` (라이브 intensity overlay)

- **NarrativeCard** 그리드 (카테고리별)
  - 테마명·카테고리 배지·설명·관련 티커 링크
  - **라이브 intensity 배지** (2026-06-05): 각 테마의 현재 강도(0-100) + direction(heating/cooling/neutral)
    — relatedTickers 평균 모멘텀(stooq 배치) + relatedSectors ret4w(capital-flows) 로 산출, intensity 바 + topMovers
  - `/api/narratives` source=live\|static + liveCount, Redis 4h 캐시; 헤더가 약속만 하고 미구현이던 동적 레이어 구현

---

### 탭 7: 뉴스 Cascade (`news`)
**컴포넌트**: `NewsCascadeTab`  
**데이터**: `/api/news-cascade`

- RSS 피드 헤드라인 (US/글로벌: MarketWatch · Investing.com · WSJ · Seeking Alpha · Yahoo · Reuters)
  + **국가별 네이티브 (2026-06-05)**: 🇰🇷 연합뉴스·한국경제·매일경제 · 🇯🇵 Yahoo Japan · 🇨🇳 SCMP
  — **region 쿼터 선택** (KR 3 / JP 1 / CN 1 / 나머지 US, 총 12) 으로 각 국가 뉴스 보장 (이전 US 영어만)
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

### 5-0. KR(.KS/.KQ) 종목 페이지 (2026-06-03 — 전면 동적화)
KR 종목은 US 정적 프로필(allCompanies)에 없어 라이브 데이터로만 구성 (정적 하드코딩 금지 원칙):
- **사업 개요**: `/api/company-desc` 동적 생성 (DART grounded + Ollama, 45d 캐시, 환각방지)
- **기업 정보**: DART company.json 라이브 — 영문명·대표·설립일·본사·홈페이지
- **재무 (DART)**: 매출/영업익/순익/ROE/총자산/자본/부채/순이익률/부채비율 + 2년 매출추이 (조/억 표기)
- **90일 주가 차트**(Naver) · **애널리스트 목표가**(KRW) · **관련 종목**(peer)
- **공급망 관계**(2026-06-04): `src/data/kr-supply-chain.ts` 큐레이션 — 주요 KR 종목(삼성/SK하이닉스/현대/기아/POSCO/LG화학·에너지/네이버/카카오 등) 공급사·고객사·파트너·경쟁사. 구조 데이터(공개 사실, 환각 0) — US `company.relationships`와 동일 성격. .KS/US 티커 있으면 /company 링크.
- **사업 부문별 매출**(2026-06-04): 사업보고서 부문 비중(%) 바차트 — 가용 종목 한정. 구조 데이터.
- 한계: 큐레이션이라 주요 ~12종목 커버(나머지는 미표시). DART 미제공 정량 세부(EPS·분기매출)는 미생성.

### 5-0b. US 폴백(미큐레이션) 종목 페이지 보강 (2026-06-12 — "WDAY 부실" 전수조사 후속)
전수조사: US 873 중 329종(38%)이 companies-batch 미수록 → minimal 폴백, 그중 316종은 사업설명도 없었음.
- **기업 프로필 카드**: `data/company-profiles.json` (build-company-profiles.mjs — Yahoo assetProfile 사실 데이터) — 섹터·업종·직원수·웹사이트·사업요약(`<T>` 번역). LLM 생성 아님.
- **실제 회사명 헤더**: ticker 대신 Yahoo longName/company-names.json (이전엔 "WDAY" 그대로 표시)
- **사업 개요 라벨 fix**: US 는 "AI 요약 (SEC 기업정보 기반)" (이전 DART 오표기)
- `/api/company-business/[ticker]` 응답에 `name` + `profile` 필드 추가
- **재무 심화 풀 패리티 (2026-06-12 "전부 풀 페이지")**: 폴백도 8 KPI(매출·영업익·순익·EPS·마진·ROE·ROA·부채비율) + 연간 추이 BarChart + 대차대조표/현금흐름 — SEC XBRL 동일 데이터, 이전엔 2칸만 렌더
- **매출 구성 도넛 (검증형 동적)**: DB company_segments(10-K Σ검증 통과분) 있으면 도넛+테이블+as-of 렌더 — 벌크 sweep 으로 coverage 성장 중. 검증 미통과 종목은 미표시(가짜 % 금지)

### 5-0c. 종목 시그널 통합 카드 (2026-06-13 — "각 1338개 종목 page에 UOA·버스트·공급계약·수주잔고 다 있어야")
전 1338 종목(static + live-only 폴백 양쪽 렌더 경로)에 노출. `/api/company-signals/[ticker]` (전부 무료·결정론, 보고서 엔진과 동일 소스):
- **비정상 옵션 활동 (UOA)**: Redis `flowvium:iv:v1` unusual[] (콜/풋·strike·만기·Vol/OI·프리미엄) 상위 3건
- **거래량 버스트**: Yahoo 5분봉 라이브 — 평균 4배+ & notional $3M+ 최대 이상치 (방향·금액·시각)
- **공급계약 영향도 (US+KR)**: Redis `supply-chain-signals:v1` ticker 필터 — 수주/실주·요약·금액(₩)·매출대비%·일자. 존재가 아닌 **영향도(매출%)** 표기. **2026-06-14: 💡파급분석(whyMatters) 결정론 추가** — contractRevenuePct materiality 기반(초대형/유의미/통상/경미 + 일회성·고객집중 리스크), summary materiality-led 로 반복 prefix 제거(audit ❌→통과). **US 경로 재구축(2026-06-14)**: 종전 EFTS 전문검색 q="ticker" 가 ticker 를 *언급*한 무관 제출자(garbage)를 반환 → SEC submissions API(회사 CIK 별 제출목록, `MONITOR_US_TICKERS` 34개)로 교체. 8-K Item 1.01 중 차입/신용약정(2.03 동반) 제외, 순수 사업계약만. conviction(66)이 dart(82-92)·cascade(70)보다 낮아 묻히던 문제 → 라우트·생성기 양쪽 sec-8k 슬롯 보장(쿼터 4/3). US 엔 KR DART 수주공시 등가물 부재 → 본질적 희소(없으면 빈 게 정직)
- **수주잔고 (US)**: `data/backlog.json` SEC RPO 레벨 + YoY%. KR 은 표준 수주잔고 공시 부재 → 신규 공급계약으로 대체 표기(backlogNote)
- i18n `company.signals*` 16언어

### 5-1. 헤더
- 기업명·티커·역할 배지·번역 설명
- **실시간 주가·일간 변화%·거래량·당일/52주 범위** (`/api/stock-price/[ticker]`, Yahoo Finance v8, 15min 캐시)
  - 장전(PRE)/장후(POST) 마켓 상태 표시
  - 거래량(Vol), 당일 범위(Day), 52주 범위(52W) 표시 (iter122)
- **시가총액 band 분류** (`/api/market-caps?ticker=X`, 정적 band 분류, Yahoo v7 crumb 실패로 live 제거)
- **90일 주가 추이 차트** (`/api/price-history?ticker=X&days=90`, Yahoo Finance v8, 1h 캐시)
  - 90일 수익률(%) + 미니 LineChart (recharts)
- 공유 버튼·비교 링크
- **터미널 뷰 토글** (`SupplyChainMap` ASCII 네트워크)

### 5-2. 메인 컬럼

#### 제품 & 매출
- 수평 바 차트 (제품별)
- 도넛 파이 차트 — **동적 우선 (2026-06-12)**: DB company_segments(10-K 검증형 동적 추출) 있으면 동적 % + "SEC 10-K {asOf} 동적 추출" 배지, 없으면 정적 큐레이션 % + "비중% 큐레이션" 표기
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
| 관련주 추천 | Yahoo v6 추천 5개 · 라이브 주가·등락% · CompanyPage 링크 (`/api/company-recs/[ticker]`) |
| 애널리스트 컨센서스 | 평균·고·저 목표가 · 상승여력 % · Buy/Hold/Sell 분포 바 · 총 애널리스트 수 (`/api/analyst-target/[ticker]`) |
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
- 테이블: 공시일·티커·내부자명·직책·액션(Buy ↑녹/Sell ↓빨)·**매수 사유 추정**(규칙 기반)·주식수·단가·가치·SEC 링크

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

### 탭 4: 블록 트레이드 (`blocks`) ✅ (2026-06-13 무료 전환 — 🔒 해제)
**데이터**: `/api/block-trades` (Yahoo v8 5분봉 거래량 버스트 proxy — 무료, Polygon 대체)

- 탐지: 봉 거래량 ≥ 20봉 평균 4배 AND 명목 ≥ $3M (27 추적 종목, 30분 캐시)
- 테이블: 티커·시간·단가·거래량·명목금액·방향(burst-up/down). "실제 체결 아님" 라벨 명시

---

### 탭 5: 옵션 플로우 (`options`) ✅ (2026-06-13 무료 전환 — 🔒 해제)
**데이터**: `/api/options-flow` (Yahoo 옵션체인 vol/OI 파생 — 무료, Unusual Whales 대체)

- 탐지: 계약 volume ≥ 300 AND vol/OI ≥ 2 (iv-screener 기보유 체인 캐시 재사용 — 추가 fetch 0)
- 테이블: 티커·Call/Put·Strike·만기·Vol·OI·Vol/OI·프리미엄. ~15-20분 지연 라벨 명시

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
- **KRX 차단 Yahoo fallback**: KRX API 완전 차단 시 Yahoo Finance 20 KOSPI 종목으로 대체. 1d·1w·4w·13w 모든 기간에 fallback 적용. `fallback: true` 배지 표시, 순매수 컬럼 숨김.

#### 한국 내부자 지분공시 (DART) — 2026-06-17 신설
**데이터**: `/api/insider-kr` (시장 피드, `data/insider-kr-feed.json`) + `/api/insider-kr/[ticker]` (종목별, DART live)
- korea 탭 하단 테이블 — US Form 4(`insider` 탭)의 KR 대응. 임원·주요주주 *실제 지분 변동 공시*(기존 korea 탭은 외인/기관 *수급 흐름*만).
- 소스: DART OpenAPI `elestock.json`(임원·주요주주 특정증권 소유상황) + `majorstock.json`(대량보유 5%룰). corp_code 매핑(정적 권위 소스), 12h Redis 캐시.
- 컬럼: 공시일·종목(한글명)·구분(임원/대량보유)·보고자(직위)·방향(매수/매도/변동)·증감수량·지분%·DART 원문링크
- 피드: `scripts/scan-insider-kr.mjs` 가 KR 후보 종목 순회(로컬 라우트 재사용=단일소스), 최근 60일 공시만, 크론 2회/일.
- 정적 폴백 금지: 파일 부재/DART 미제출(ETF) → 빈 배열 + `source` 명시(live/stale/empty/not-applicable).

---

## 9. 스크리너 (`/screener`) ← 타임프레임 1w/4w/13w 추가

**파일**: `src/components/pages/ScreenerPage.tsx`  
**데이터**: 13w=`/api/signals`+`/api/short-interest` | 1w/4w=`/api/insider-trades`

### 9-0. 타임프레임 셀렉터 (1w / 4w / 13w)
- **1w**: Form 4 내부자 거래 최근 7일 (D+2 시차)
- **4w**: Form 4 내부자 거래 최근 28일 (D+2 시차)
- **13w**: 기관 13F 포지션 분기 기준 (현행 유지)
- 각 탭 상단에 데이터 소스 설명 배너 (기준일·시차 명시)

### 9-1. 13w 뷰 (13F 기관 포지션)
- Top Squeeze/신규 편입/언더레이더 카드 (5종목씩)
- 프리셋 버튼 7개 + 수동 필터 + 테이블
  - 🔥 스퀴즈 후보 / 🟢 기관 신규 편입 / 📈 기관 매집 중 / 📉 기관 비중 축소 / 🕵️ 언더레이더
  - 🔮 다수 기관 합의 (9개 기관 중 매집 기관 ≥2개) ← **iter114 추가**
  - 🔱 N-PORT 이중 매집 (13F 매집 + N-PORT 뮤추얼펀드 보유 교차) ← **iter116 추가**

### 9-2. 1w/4w 뷰 (Form 4 내부자 거래)
- 💰 대규모 내부자 매수 배너 (기간 내 총 매수금액 top5)
- 👑 C-Suite 매수 배너 (CEO/CFO/임원 직접 매수 top5)
- 🔁 집중 매수 배너 (복수 내부자가 같은 종목 매수)
- 내부자 거래 테이블: 티커·기업·**현재가**·**1W/4W 기간수익률**·내부자·직책·매수금액·건수·거래일
  - 1W 탭: `/api/batch-prices?period=1w` → Yahoo spark 5거래일 수익률 (iter268)
  - 4W 탭: `/api/batch-prices?period=4w` → Yahoo spark 20거래일 수익률 (iter268)
  - 데이터 부족 시 Bloomberg 스타일 유추 (available oldest close 기준)

### 9-3. 결과 테이블 (컬럼 정렬 지원)
- 컬럼: 티커·기업·섹터·기관·액션·사이즈·숏%·DTC·스퀴즈 스코어(바)·뉴스갭(바)·공시일·**합의**·**N-PORT**
  - **합의** (iter113): 9개 추적 기관 중 매집/감소 기관 수 뱃지 (초록=매집 수, 빨강=감소 수)
  - **N-PORT** (iter116): 뮤추얼펀드·ETF 월간 보유 총액 (cyan 배지, hover=펀드 수 툴팁)
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

## 10b. 내재변동성 스크리너 (`/volatility`) — 신규 (2026-05-12)

**파일**: `src/components/pages/VolatilityPage.tsx`, `src/app/[locale]/volatility/page.tsx`
**데이터**: `/api/iv-screener` (집계) · `/api/iv/[ticker]` (개별)
**라이브러리**: `src/lib/options/iv-math.ts` (Brent + Black-76 + 콜-풋 패리티) · `src/lib/options/yahoo-chain.ts` · `src/lib/options/iv-summary.ts`

### 10b-1. 방법론 (Bloomberg-style)
- 콜-풋 패리티로 expiry 별 forward + implied rate 자동 추출 (r, q 가정 X)
- Brent's method 로 Black-76 시장가 → σ 역산 (bid/ask wide 환경에 robust)
- 30d/90d ATM IV: variance-space 시간가중 보간
- 25Δ skew: σ(25Δ put) - σ(25Δ call)
- term slope: 90d - 30d ATM IV
- quality score: spread/OI/lastTradeDate 기반 stale 필터링 후 0-100 점

### 10b-2. 표시 컬럼
- 티커 · 주가 · 30d ATM IV · IV 순위 (데이터셋 내 percentile) · Term Slope · 25Δ Skew · P/C · 품질 점수 · 상세 링크

### 10b-3. 추적 종목 (31개)
NVDA/MSFT/AAPL/META/GOOGL/AMZN/TSLA/AMD/MU/AVGO/ARM/TSM/ASML/AMAT/LRCX/KLAC/JPM/GS/BAC/V/UNH/XOM/CVX/LMT/RTX/NOC/SPY/QQQ/IWM/GLD/TLT

**캐시 채우기 정책 (2026-05-24 강화)**:
- `cron/iv-prewarm` 가 평일 2x/일 (22:30 KST · 03:00 KST) 전 종목 4h TTL 워밍
- `/api/iv-screener` 가 미스 시 무작위 3건 lazy compute (이전 `.slice(0,3)` 였으면 NVDA/MSFT/AAPL 고정으로 MSFT 영구실패가 28종목 영구 빈칸 유발 — 사건 후 무작위 샘플링으로 변경)
- 영구실패 티커는 1h `neg:` 캐시로 격리되어 lazy 슬롯 낭비 방지

### 10b-4. CompanyPage 통합
- 우측 컬럼에 "옵션 내재변동성 (IV)" 카드 표시
- 30d/90d ATM IV, Term Slope, 25Δ Skew, P/C, 품질
- "전체 스크리너 →" 링크로 `/volatility` 이동

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

### 11-4. Overview 트리맵 — Finviz 스타일 (iter269)
- **섹터 그룹화**: depth=1 섹터 컨테이너 (색상 테두리 + 섹터명 라벨)
- depth=2 종목 박스: 시가총액 기준 크기 · 등락% 기준 색상
- 섹터 면적: totalMarketCap 비례 배분 → 자금 흐름 시각화
- API 변경 없이 HeatmapPage.tsx UI 레이어만 수정

### 11-5. 섹터 상세 트리맵 (2열 그리드)
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
**노이즈 필터 (2026-06-04)**: Finnhub 캘린더의 커버리지 없는 CEF/마이크로캡(estimate 영구 NULL) 제거 — universe US 티커 OR estimate 보유 OR known 기업명만 유지. 응답에 `coverage{withEstimate,total,estCoverage,droppedNoise}` 메타. 검증: `check-data-quality [G]` 가 estimate 채움률 ≥70% 확인.

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

## 13. AI 투자 전략 리포트 (`/report`) ← 전면 재설계

**파일**: `src/components/pages/ReportPage.tsx`  
**데이터**: `/api/investment-strategy` (모든 탭 컨텍스트 종합 → GROQ/Claude Haiku/Gemini AI 포트폴리오 생성)

### 13-1. 투자 스탠스 히어로
- 매수우위(bullish) / 중립(neutral) / 관망·방어(bearish) 뱃지
- 리스크 레벨 (low/medium/high)
- AI 한 줄 투자 전략 (thesis)

### 13-1b. ⚡ 속보 배너 (2026-06-15 신설 — 사용자 "이란 딜 같은 중요 이슈가 메인에 왜 없냐")
- 정기 보고서는 시점 스냅샷이라 cron cycle 사이(최대 ~5h) 발생한 시장급변 속보를 놓침.
- 히어로 *위*에 표출: news-cascade 중 `importance=high` + `pubDate > 보고서 generatedAt`(발간 후) +
  cascade 에 broad-market 자산(S&P/DOW/Oil/Gold/VIX/금리/유가/방산 등) 포함 뉴스 top 2 + cascade 칩.
- 최신 보고서에서만(selectedHistoryId 없음), 12h 이내 뉴스만. 보고서 재생성 불필요 — 클라이언트 필터.
- i18n `report.breakingTitle`/`breakingNote` ×16.

### 13-0. 🔓 장중 보고서 회원 게이트 (2026-06-13 신설)
- noon/afternoon/evening/midnight 세션 보고서는 비회원에게 stance·종합판단까지만 + 이메일 가입 카드 (morning 은 전체 무료 맛보기)
- `/api/member` POST {email} → Redis `flowvium:members:emails` SADD + HMAC 쿠키(fv_member, 1년). 비밀번호/결제 없음
- i18n `report.gate*` 6키 ×16. 한계(인지): UI 게이트 v1 — API 직접 호출 미차단 (가입 유도 목적)

### 13-1b. 🚨 거시 급락 조기경보 배너 (2026-06-06 신설)
- `earlyWarning` 결정론적 composite — 신용 OAS(HY/IG 확대·고위험) / VIX 단계 / 금리커브 역전 / F&G 극단 / USD-KRW 급변 / jobless·PMI 위축 → 0-100 위험점수 + level(low/elevated/high/severe) + drivers.
- level high/severe 시 보고서 **최상단 강한 시각 배너**(severe=빨강+animate-pulse+shadow, high=주황) + drivers 나열 + 위험점수. LLM riskLevel 과 독립(결정론적, 환각 무관).
- 16개 언어 i18n (`report.ewTitle/ewSevere/ewHigh/ewScore/ewNote`).

### 13-1c. 📍 종합 판단 카드 (2026-06-12 신설 — 사용자 "관망/매수/중립 결정이 되야")
- `marketVerdict` 결정론 판정: 하락 전조(earlyWarning) + 상승 전조(reboundWatch) + **공포 매수**(F&G≤25·낙폭≥5%·VIX≥25 조합, 버핏/템플턴/막스 원칙) + **과거 유사국면**(^GSPC+^VIX+**^TNX(10Y)+^IRX(13주)**+RSP 1990~ 일봉 라이브 fetch, **다요인 가중거리 매칭** — VIX·낙폭·20일수익률 + **거시(10Y 금리·수익률곡선 기울기·금리 3개월 모멘텀)** 정규화 가중 유클리드, 적응형 임계(8건 목표) → 1/3/6개월 forward 중앙값·상승확률 실측. `macroContext`(F&G·신용스프레드 현재 overlay)·`factorsUsed`·`matchTightness` 투명화. 2026-06-14 다요인 확장) 종합.
- verdict 6단계: buy_dip(공포 매수)/accumulate(분할 매수)/neutral_ready(중립-매수준비)/neutral/wait(관망)/defensive(방어) + 근거 reasons[] 전부 코드 생성 (LLM 무관, 하드코딩 사례표 금지 — 데이터에서 직접 계산).
- **US / KR 별도 박스 + 독립 종합판단 (2026-06-13, 사용자 "다른 박스로 종합판단 따로")**: 🇺🇸 미국·거시 박스(global+us 근거) / 🇰🇷 한국 박스(`krVerdict` — KOSPI 추세+계절성+breadth(KOSDAQ vs KOSPI)+과거유사국면, 글로벌 거시 게이트 적용, US 동일 tier). KR 도 전부 동적(^KS11/^KQ11 라이브). i18n `verdictUsTitle/verdictKrTitle/verdictRegion*` 16언어.
- stance hero 바로 아래 카드, verdict 별 색상. i18n `report.verdictTitle/verdict_*/verdictNote` 16언어.

### 13-1d. 🚨 작전주(펌프&덤프) 의심 — manipulation-risk (2026-06-13 신설)
- `/api/manipulation-risk/[ticker]` 결정론 스코어 0-100: 단기급등(20일)+거래량폭발(5d vs 평소)+저유동성(일거래대금 USD환산)+펀더갭(급등하나 매출역성장/부재) 동시발화 가중. 2개+ 동시발화 미달이면 25 캡(단일신호≠작전주). tier low/elevated/high/severe.
- **사전 포착(phase 'accumulation')**: 급등은 후행 → 거래량 선반영+가격평탄+저유동성 = 매집 의심(급등 前). 'markup'=급등중.
- **거래소 공식 시장경보 매칭(KR, 2026-06-14 신설)**: `surveillance` 필드 — KRX 투자주의/경고/위험(KIND 라이브, `src/lib/market-alerts`). **'소수지점/계좌·단일계좌·매매관여과다'=소수계좌 거래집중 → score≥60 + phase accumulation + 작전주 *선행*(오르기 前) 공식 flag**. 투자경고 score≥70, 투자위험 score≥85(후행 위험). data.krx getJsonData LOGOUT 차단을 KIND investattentwarnrisky.do 로 우회 성공.
- **US 공식 surveillance 매칭(2026-06-14 신설)**: `surveillance` 필드(US 경로) — `src/lib/us-market-alerts`. SEC 거래정지(EDGAR FTS, score≥90)·거래소 halts(LULD/T12/H10, score 45~80)·FINRA Reg SHO 결제실패(FTD, +12). KRX 소수계좌의 US 대응(미국은 계좌집중 공개피드 부재→공개 surveillance 3종 대체). 전부 keyless.
- 전부 동적(Yahoo 일봉+financials.json+Naver 수급+KRX 시장경보). CompanyPage 에 ⚠️ 경고 배너(tier elevated+, phase별 제목). i18n `company.manip*` 16언어.

### 13-1e. 📋 KRX 시장경보 피드 — market-alerts (2026-06-14 신설, 사용자 "소수계좌 거래집중 뚫어봐")
- `/api/market-alerts` — 거래소 공식 투자주의/경고/위험 라이브 목록. KIND investattentwarnrisky.do 크랙(세션쿠키 GET + method=investattentwarnriskySub + forward=invstcautnisu_sub + startDate=endDate). 회사명→6자리 ticker Naver autocomplete 해소.
- 응답 `{alerts[], counts{caution/warning/risk/fewAccount}, source('live'|'cache'|'empty'), asOf}`. 쿼리 `?fewAccount=1`(소수계좌만)·`?category=`·`?ticker=`. Redis 캐시 3h, miss 폴백 `[]`(정적 금지 — 시계열 surveillance). `source` 필드로 라이브/캐시 구분.
- 작전주 매집 스크리너(`scripts/scan-accumulation.mjs`)가 교차검증: 매집 탐지 ∩ 공식 소수계좌 flag = 최고신뢰(score +25, `officialFewAccount` 카운트).
- **보고서 `manipulationWatch` 필드(2026-06-14)**: 매집 워치리스트를 보고서 데이터에 surfacing(`buildManipulationWatch` — accumulation-watchlist.json 읽기, 36h 신선도 가드). 각 item `{ticker, name, tier, phase:'pre_pump_accumulation', score, signals, official(KRX매칭), action:'watch_only', reason}`. "추천 아님 — 관찰 우선".
- **2-tier 분류(`accumulationTier`, 2026-06-14)**: 고정밀 게이트(score≥32)만 쓰니 관찰 목적 종목이 사라진다는 사용자 피드백 → **'strong'(고확신 coFire≥3+score≥32) + 'watch'(세력매집/공식 corroboration + coFire≥2 + score≥14)** 2단계. **5일 급등 가드(runup5d≥15%=markup 진입→제외)** 로 이미 오른 종목 차단. 예: 한글과컴퓨터(flat, score 25)=관찰 복원 / 솔브레인(5d +21.6%)=markup 제외. UI amber '관찰' 배지.
- **UI 노출(2026-06-14)**: `/screener` 에 2개 카드 — 🚨 매집 의심(오르기 前) + ⚠️ 거래소 시장경보(투자주의/경고/위험·소수계좌). 소수계좌 flag red 배지 우선정렬. ReportPage(`manipulationWatch` 섹션, 16-lang). 회사명→/company 링크. `/api/accumulation-watch` 신설(워치리스트 노출, 36h 신선도·source 필드).
- **US 작전주 매집 커버리지(2026-06-17, 사용자 "us종목 파악안됨?")**: 동일 탐지코어를 US 소형주에 적용. `/api/accumulation-watch?market=us` + `/screener` 🇺🇸 카드. 핵심 결정: ① 대형주 candidate 풀(873종)은 ADV 수십억$·coiling 부재로 매집신호 **구조적 0** → Yahoo screener `aggressive_small_caps`로 **US 소형주 유니버스**(`scripts/build-us-smallcap-universe.mjs`, ~309종, 주1회) 별도 구성. ② US 는 Naver수급·KRX경보 corroboration 부재 → `volumeOnlyWatch` tier(거래량추세/변동성수축/종가강도 기술패턴만, coFire≥2+score≥14, 관찰 전용). ③ 유동성 상한 $30M/$100M(소형주). `scripts/scan-accumulation.mjs --us` → `data/accumulation-watchlist-us.json`, 크론 2회/일.

### 13-2. 3단 분석 카드
- 거시경제 분석 (파란색)
- 기술적 분석 (보라색)
- 기본적 분석 (초록색)

### 13-3. AI 추천 포트폴리오 (고확신 종목만, 최대 US 6 + KR 6, 룰+LLM ensemble)
- **2026-06-14 개수 강제 폐지**(사용자 "12 꽉 채우지 마, 없을수도 많을수도 — 품질만"): 종전 US6+KR6 강제 retry + candidate pool 합성 padding('Auto-pad 추가검증 권장' 가짜 종목 주입) 제거. 이제 *고확신 종목만* 선별(적으면 적게). retry 는 생성부실(total<4)일 때만, 품질패널티 12→4 floor.
- 31개 룰 multi-factor scoring (`data/buy-rules-tuned.json`) — 8 카테고리 전부 커버
- 4-stage scoring: light (모든 ticker) → OHLCV top 100 → financials top 50 → LLM top 30 중 고확신 선택
- 룰 카테고리: 가격(5) / 기술(4) / 기본(4) / 구루(4) / 거시(3) / 미시(6) / 회전(3) / selflearn(2)
- 종목명, 섹터, 비중(%), 매수 근거
- **주력 사업/매출상품 (확장 최상단, 2026-06-07)** — "무슨 사업으로 매출 내는지" 표시. `data/company-business.json`(build:business 가 companies-batch `products[]`(name+revenueShare)+description 추출, 619 ticker + KR 대형주 CURATED) → 발간직전 `businessSummary`(예: "iPhone 52% · Services 22%")+`businessDesc` 주입. LLM 생성 아닌 큐레이션 권위소스. i18n `report.businessLabel`(주력 사업) 16언어
  - **2026-06-14 grounding 보강**: 큐레이션 미수록 종목(KR 대부분·US 폴백)은 `company-profiles.json`(Yahoo summary) 로 `businessDesc` fallback 주입(공백 방지). 또 `businessOneLiner()` 가 매수후보 프롬프트(BUY CANDIDATES 블록)에 종목별 사업 한줄 주입 → LLM rationale 환각(HPSP="차량"·KODEX="국방") 차단. **제품명/코드(H100·PECVD·GeForce)는 번역 안 함**(`TBizSummary` raw 렌더 — 로컬모델 모지바케 `¶4◇¦��c◆` 방지, 결정론·GPU 0). `<T>` 모지바케 가드(U+FFFD/기호밀집→원문 fallback).
- **종목 티커 클릭 → `/{locale}/company/[ticker]` 기업 프로필 이동** (보라색 링크, 2026-06-03 — 매수·매도 카드 양쪽)
- 🇺🇸 US Market / 🇰🇷 KR Market 시장별 분리 표시
- 클릭 확장: 진입 구간 / 손절가 / 목표가 / Exit Ladder (entry/exit 분할)
- **IV 평이 설명 (손절 칸 아래, 2026-06-05)** — 종전 `IV 45.1% · skew -2.7` 전문용어 배지를 손절 옆 평이한 한 줄로: 📊 내재변동성 N% (안정/보통/변동큼/매우큼) · 하루 ±X% 등락 예상(=IV/√252) · 옵션 skew 심리(상승 기대/하락 대비/중립). 16개 언어 i18n (`report.ivPlain*`/`ivLevel*`/`ivSkew*`)
- 확신도 뱃지 (high/medium/low)
- `buyCandidateScoring.top30` 메타 — score + 매칭 룰 ID 보존 (audit 가능)
- 7 카테고리 31룰 multi-factor: 가격(5) / 기술(4) / 기본(4) / 구루(4) / 거시(3) / 미시(6) / 회전(3) + selflearn(2) (`data/buy-rules-tuned.json`)
- `buy_candidates` DB 적재 — 선택 12 외 score top 30 까지 모두 보존 (Karpathy 학습 source, 룰별 category/score JSON)

### 13-3b. 📤 매도 추천 (US 6 + KR 6, multi-factor + Karpathy 학습, 2026-05-29)
- 7 카테고리 19룰 multi-factor: 가격 / 기술 / 기본 / 구루 / 거시 / 미시 / 회전 (`data/sell-rules-tuned.json`)
- 룰 — stop_breach, dead_cross, 200ma_breach, rsi_overbought, op_margin_decline, lynch_peg, macro_high_risk, sector_underweight, news_negative, rotation_profit/loss/neutral 등
- 매칭 룰 category 메타 보존 (sell_recommendations.matched_rules) — audit-coverage Probe [5] 가 buy/sell 카테고리 대칭 자동 점검
- Exit Ladder 자동 생성 (Klarman 부분 매도): stop_breach=즉시전량 / target_near=1/3/1/3/1/3 trailing / rotation_profit=1/3 + breakeven lock
- urgency 배지 (🔴 high / 🟠 medium / ⚪ low) — JSON 룰 메타에서 직접 (하드코딩 X)
- **유형 배지 (2026-06-12, POSCO 익절 혼란 사건)**: ruleId 결정론 분류 — 🟢 익절 분할(target_near·rotation_profit) / 🔴 손절·방어(stop*·rotation_loss) / 🟠 종목 악화(tech/fund/guru/내부자/13F) / 🔵 시장 환경(macro/sector/region). i18n 4키 × 16언어
- `sell_recommendations` + `sell_outcomes` DB 적재 → `tune-sell-rules.mjs` weekly grid search 학습
- Wave 2 LLM rationale (240s timeout) — 구루 framework + tech/fund/macro 신호 inject
- **per-model 결함률 추적 (2026-06-17)**: `reports.model` 컬럼(실제 모델명 runtimeModel) + `getModelDefectRates(days)` (hallucination_history ⋈ reports.model, harness_* 제외 → 모델별 reports/defects/defectsPerReport). 기존 DB 는 openDb 마이그레이션 ALTER + source 백필. 모델 효과 A/B 측정 기반
- **Judgment Doctrine (2026-06-17, 사용자 19장 학습)**: `data/judgment-doctrine.json` — 7대 구루(PTJ/Kovner/Buffett/Marcus/Klarman/Robertson/Druckenmiller) + 철학(Ellis 10/O'Neil 6속성/Duke 13습관/Velez 인식-반응/Trump 최악수질문) 13원칙 구조화. `getGuruContext()` 가 LLM 포트폴리오 프롬프트에 `[JUDGMENT DOCTRINE]` 블록으로 주입(자본보존/안전마진·추격금지/손절·물타기금지/추세존중200MA/moat·1위/휩쏘방지)
- **Cross-session whipsaw hysteresis (~7307)**: 최근 매도 종목 재매수 시 매수확신 바 25→35 상향, 못 넘으면 비중↓·확신↓. lookback **36h→72h (2026-06-17 TER 휩쏘 사건)** — cross-day BUY→SELL→BUY flip 차단 강화
- **추격(chase) 하드 veto (2026-06-17, 심판 게이트 filter 최상단)**: 최근 48h(CHASE_LOOKBACK_HOURS) 매수 추천 종목을 직전 진입가 mid 대비 +8%(CHASE_THRESHOLD) 초과 높은 가격에 재추천하면 **즉시 드롭**(`getRecentBuyEntries`). TER(noon 380-390 → 같은날 afternoon 425-435 +12% 추격→익일 손절) 차단. 눌림목(같거나 낮은 재진입)은 통과 — no-chase doctrine

### 13-4. 섹터 배분 전략
- 섹터별 비중 바 차트
- 비중확대/중립/비중축소 스탠스
- **2026-06-14 정규화 dedup(불변식)**: portfolio.sector 가 두 어휘(Yahoo 'Semiconductors' + 내부 kebab 'semiconductors'/'it-software') 혼재 → case-sensitive 중복·모순 stance("반도체 중립+비중축소") 발생. `canonicalizeSectorAllocation` 가 case-insensitive 병합 + 병합 pct 로 stance 재계산 → **섹터 1회·1 stance** 보장. display 정규화(Semiconductors/IT·Software/AI·Cloud 등).

### 13-4a. ETF 전략 (2026-06-04 신설)
- 보고서 stance/sectorAllocation/regionStances 에 grounded 한 ETF 추천 (환각 없음)
- 카테고리(8): broad(코어) / sector(11 GICS+반도체) / **thematic(반도체·AI·청정에너지·바이오·우라늄·방위 등)** / **style(가치·성장·모멘텀·퀄리티·최소변동)** / **dividend(배당성장·귀족)** / region(강세지역 ≤5) / commodity(금·은·원유·종합) / bond(장단기·종합·회사채·물가연동)
- 티커 클릭 → `/company/[ticker]`, 라이브 가격·등락% (livePrices/batch-prices)
- `etfStrategy` 필드 (generate-report-local `buildEtfStrategy`). **ETF 풀 67종**(2026-06-05 30→62 테마/스타일/배당, 06-12 국가 ETF 4종, 06-13 크립토 IBIT/ETHA 신설). stance/sectorAllocation/regionStances grounded 선택, 보고서당 ~18개 노출(8 카테고리)

### 13-4a-2. ⚡ 기회 신호 (S4: Opportunity Signals)
- 숏스퀴즈 후보 + 내부자 매수 클러스터 + topOpportunity 한 줄 요약. 없으면 "현재 포착 없음" 빈 상태 유지(섹션 숨김 안 함).
- **테두리 강조 (2026-06-18, 사용자 "기회신호 칸도 잘보이게 테두리 쳐줘")**: `border-2 border-orange-300 shadow-sm` — 위기포착(빨강) 대비 잘 보이는 주황 테두리. 채워진/빈 상태 양쪽 동일.

### 13-4b. 위기 포착 (S4b: Crisis Alerts)
- 🚨 패널: 내부자 매도 집중 / BB 4d4σ 극단 과매수 / 어닝스 미스 / 기관 이탈 / 가이던스 하향 / 매크로 리스크
- 심각도 배지 (긴급/경고/주의)
- 종목·신호·대응·근거 표시
- Wave 2 병렬 AI 호출 (`invest-crisis`, 600 tokens)
- 데이터: `ctx.institutional` (내부자 sell 패턴) + `ctx.bbWarnings` + 어닝스 + 뉴스

### 13-4c. 🏢 기업 변화 이벤트 분석 (companyChanges, 2026-06-14 event 격상)
- 종전 "매출 X%·마진 Y%" 평면 재무요약 템플릿 → **event 분석**으로 격상 (audit-section-richness fail 해소).
- **eventType 배지** (코드 결정론 분류, 환각/슬롭 불가): 가이던스↑↓·매출 급증/성장/감소·M&A·소송·신제품·규제·계약·임원 변동·긍정/부정. i18n 13종 × 16언어.
- **보유 배지(held)**: 포트폴리오 보유 종목 표시 (코드 단정).
- **💡 whyMatters**: 투자자 관점 영향 (≤70자, LLM 산문 — keyChange 재진술 아님).
- **🔍 nextCheck**: 다음 확인 catalyst (≤40자, LLM, 실제 날짜 없으면 null — 환각 금지).
- 원칙 "숫자는 코드가(eventType/held), LLM은 문장만(keyChange/whyMatters/nextCheck)". audit-section-richness 가 whyMatters 고유성까지 검사(boilerplate 차단).

### 13-5. 주요 리스크 이벤트 (2026-06-14 포트폴리오 민감도 + 예상치/서프라이즈 격상)
- 날짜, 이벤트명, 위험도, 주목 포인트
- **📊 예상치(estimate)/직전값(prev)**: economic-calendar estimate/prev 를 **날짜+이벤트 유형 일치**로 매칭(FOMC 3.75%가 소매판매에 붙는 cross-contamination 방지). forward 컨센서스는 FOMC 등 일부만(Finnhub econ-cal=premium 불가), **직전 실제값은 FRED series units 변환으로 정확단위 제공**(2026-06-14): CPI=%YoY, GDP=%연율, 소매=%MoM, NFP=K. 예상 없으면 직전값을 비교 앵커로 표시. 환각 금지(소스값만).
- **🎯 노출종목 KR 회사명**(2026-06-14 사용자 "KS종목은 이름으로"): affectedPortfolio 의 .KS/.KQ 는 회사명 표시(포트폴리오 name 매핑), US 는 ticker 유지.
- **▲예상 상회/▼하회 영향(surprise)**: 이벤트 유형별 방향성 결정론(FOMC 매파→성장·반도체 압박, CPI 상회→인하 지연, 소매 상회→소비재 수혜 등). 사용자 "예상보다 높/낮을시 영향 알려줘야".
- **🎯 포트폴리오 노출(affectedPortfolio)**: 거시 이벤트 키워드 → 민감 섹터 → 보유 종목 결정론 매핑(FOMC→반도체/성장, CPI→소비/에너지 등). exposureChannel 라벨.
- **▶ 액션**: impact 별 결정론(high=노출종목 비중·헤지 점검 / medium=관망·재평가 / low=모니터). "단순 경제일정 나열" 탈피 — audit-section-richness ⚠️ 해소.

### 13-4a-1. ETF 전략 exposure map (2026-06-14)
- 기존 ETF 추천에 **📐 사이징(sizingHint)**(core 5–10% / satellite 2–4% / 전술 1–3%, tag 결정론) + **⛔ 무효화조건(invalidation)**(action 별: buy=50일선 하회·스탠스 약세 전환 시 축소 / reduce=강세 전환 시 재진입 등) 부가 → 'ETF 추천'을 exposure map 으로 격상. audit ⚠️(무효화/사이징 전무) 해소.

### 13-6. KPI 스트립 (5 pills)
- F&G / SPY 수익률(sparkline) / 10Y-2Y / VIX / FOMC
- 각 pill 툴팁

### 13-7. 메타 정보
- AI 소스 배지 (GROQ/Claude Haiku/Gemini/Fallback)
- 신선도 표시
- 면책 고지

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
**데이터**: `/api/yield-curve` (FRED CSV 무키, 1h Redis 캐시; `source: fred\|fred-stale(>7일)\|empty`)

- 현재 · 1주 전 · 1개월 전 · 3개월 전 수익률 곡선 4선 오버레이 (과거 비교 토글)
- 수익률 테이블 (1M~30Y, 9 만기)
- 2s10s · 3m10y 스프레드 배지 (역전 시 빨간 경보)
- 스프레드 시계열 Area 차트 (최근 90일) — 2s10s/3m10y 탭 전환
- TIPS 실질금리 곡선 (5Y~30Y, 5 만기) — 탭 전환
- Breakeven 인플레이션 (5Y, 10Y 일별 시계열 90일)

**`VolatilityCard`** — `/api/volatility` (Yahoo Finance chart → CBOE CDN fallback, 30min 캐시; `source: yahoo\|cboe-fallback\|mixed\|stale\|empty`)
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
**데이터**: `GET /api/admin/logs` + `GET /api/admin/health` + `GET /api/admin/metrics-health` + `GET /api/admin/metrics-db`

- 구조화 로그 뷰어 (레벨별 색상: debug / info / warn / error)
- 로그 전체 지우기 버튼 (`DELETE /api/admin/logs`)
- 수동 새로고침
- **Deploy & Health 카드** (상단)
- **Metrics DB 카드** — per-metric 최신값·업데이트 시각 테이블 (그룹·상태 필터, 상대 시각 표시, staleness 색상 코딩)
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
| `guru-methodologies` | 투자 구루 8명 매수/매도 원칙 DB + AI 프롬프트 주입 유틸 | `/api/investment-strategy` AI 포트폴리오 생성 시 |
| `error.tsx` / `global-error.tsx` | 청크 로드 에러(재배포 후 해시 교체) 세션당 1회 자동 새로고침 복구 + 재시도 UI | 클라이언트 런타임 크래시 / ChunkLoadError |

---

### CompanyPage 섹터 지표 live overlay
-  client-side fetch →  state
- keyData 라벨 매칭 (WTI, 천연가스, 연체율, ISM, 10년물, Fed Funds) → live 값 교체
- live 값 있으면  뱃지 표시 (초록색)

### CascadeDetailPage AI 자동 기록 이벤트
-  fetch →  state
- historicalOccurrences 섹션 아래 날짜 내림차순 표시
- 각 이벤트에  배지

## 18. 백엔드·인프라 기능

### API 라우트 전체 목록

Redis 미설정 환경에서는 `@/lib/memory-cache` 모듈 레벨 in-memory cache 가 warm
function instance 내에서 폴백으로 작동 (daily-brief, market-heatmap, short-interest,
ownership-alerts 적용).

| 엔드포인트 | 데이터 소스 | Redis 캐시 TTL |
|-----------|-------------|---------------|
| `/api/daily-brief` | EXAONE vLLM → GROQ → Gemini | 26h |
| `/api/investment-strategy` | 전 탭 컨텍스트 종합 + Yahoo v7 배치 19종목 → GROQ/Qwen/Gemini (v6 키: 일별 1회 갱신; 폴백 5min 캐시) | 12h Redis / 4h mem |
| `/api/signals` | EDGAR 13F (Redis `flowvium:13f-signals:v1`) | 7일 |
| `/api/news-cascade` | RSS 5개 피드 + 통합 AI 체인 (GROQ 8b, skipVllm=true, preferSmallModel); Redis 분산 락(90s) 썬더링 허드 차단; 한자 혼입 0% guard | 기사별 24h (cascade>0만) / 목록 1h~12h |
| `/api/capital-flows` | Twelve Data → Yahoo v7 spark batch → Nasdaq public API (5-concur/200ms) → Finnhub (FINNHUB_KEY); `source: live\|stale\|empty` | 4h |
| `/api/macro-indicators` | FRED CSV + FRED API; `source: fred\|mixed\|static` + `liveCount/staticCount` (일부 indicator 만 live 일 때 mixed) | 25h (일별 키) |
| `/api/fedwatch` | CME FedWatch | 4h |
| `/api/fear-greed` | CNN 방식 + Yahoo Finance | 4h |
| `/api/credit-balance` | per-country live overlay: us=FRED·tw=TWSE 실시간(liveCount 2/7), kr/jp/cn/eu/in=정적(소스 차단·미구현); 정적 entry는 source에 "(static est.)" 마커 + liveData=false (live처럼 보이던 라벨 정직화, 2026-06-05); `source: live\|mixed\|static` + `liveCount/staticCount` | 24h |
| `/api/narratives` | 8개 매크로 테마 라이브 intensity (relatedTickers stooq 모멘텀 + relatedSectors ret4w); `source: live\|static` + liveCount; 정의는 정적(구조적) overlay 만 라이브 | 4h |
| `/api/flow-analysis` | capital-flows + 통합 AI 체인 (vLLM → GROQ → Qwen → Gemini, skipVllm=true로 GROQ 70b부터) | 4h |
| `/api/insider-trades` | EDGAR Form 4; `source: edgar-form4\|edgar-form4-stale\|empty` | 캐시 |
| `/api/insider-kr` | **KR 임원·주요주주 지분공시 시장 피드** (`data/insider-kr-feed.json`, scan-insider-kr.mjs 산출, 최근 60일·408종); `source: live\|stale\|empty` (2026-06-17) | 파일(크론 2x/일) |
| `/api/insider-kr/[ticker]` | **KR 종목별 내부자 지분공시** — DART `elestock.json`(임원·주요주주 특정증권 소유)+`majorstock.json`(대량보유 5%룰); `source: dart-live\|dart-stale\|empty\|not-applicable` (2026-06-17) | 12h Redis |
| `/api/ownership-alerts` | EDGAR 13D/13G; `source: edgar-13dg\|edgar-13dg-stale\|empty` | 캐시 |
| `/api/nport-holdings` | EDGAR N-PORT-P; `source: edgar-nport\|empty` | 캐시 |
| `/api/block-trades` | Polygon (API 키 필요) | 5분 |
| `/api/options-flow` | Unusual Whales (API 키 필요) | 캐시 |
| `/api/iv/[ticker]` | Yahoo v7/finance/options 풀체인 + Bloomberg-style 콜-풋 패리티 + Brent BS 역산; `source: live\|cached\|error` | 4h Redis + 24h stale |
| `/api/iv-screener` | 31 종목 mget 캐시 + 무작위 3 lazy 계산 + 영구실패 1h negative cache; `source: live\|cached\|mixed\|partial\|error` | 4h Redis |
| `/api/cron/iv-prewarm` | iv-screener watchlist 31종목 IV 사전 워밍 (concurrency 4); `source: live\|error` | 4h Redis + 24h stale + 1h neg cache; 평일 13:30 UTC / 18:00 UTC 2x/일 |
| `/api/korea-flow` | KRX → Naver(foreign-only) → Yahoo(price-only) cascade; `source: krx\|naver-fallback\|yahoo-price-only` | 캐시 |
| `/api/short-interest` | EDGAR 13F + FINRA 일간 공매도율; shortRatio(DTC): FINRA monthly 403(Cloudflare) → null 유지 | 캐시 |
| `/api/market-heatmap` | iShares ETF CSV + Stooq(JP/EU) + Yahoo v8(KR/TW/IN/CN/EU-fallback) + CNBC(지수) | 15m Redis; EU 79/80 (98.75%) |
| `/api/market-caps` | 정적 band 분류 (allCompanies); 단일 ticker 시 Yahoo v8 chart 의 live cap; `source: yahoo-live\|static-band` | map 24h CDN; 단일 ticker 4h CDN (장중 변동 반영) |
| `/api/sector-pe` | Yahoo Finance v8 (no auth) | 4h Redis; 11개 SPDR 섹터 ETF; price + changePct + ytdReturn + 52주 범위 |
| `/api/sector-metrics` | Yahoo Finance (CL=F, ^TNX) + FRED CSV (MHHNGSP, DRCCLACBS, DFEDTARU) + Redis ISM 캐시 | 6h Redis |
| `/api/cascade-events` | Redis `flowvium:cascade:events:v1` | Redis (크론 갱신) |
| `/api/cron/log-cascade-events` | Yahoo Finance 10d prices + AI 체인 설명 생성 (주간 크론) | Redis LPUSH, TTL 180일 |
| `/api/price-history?ticker=X&days=N` | Stooq daily CSV | 1h Redis + 30min memory |
| `/api/batch-prices?tickers=A,B,...` | Yahoo Finance v7 quote (최대 120 티커) | 5분 메모리 (티커별) ← iter117 |
| `/api/stock-supply` | (ticker별 on-demand) Yahoo v8 + EDGAR Form 4 + Redis 13F live overlay; `source: live\|price-only\|ownership-only\|static` | 1h Redis (3h→1h: 가격/거래량 신선도) |
| `/api/company-financials/[ticker]` | SEC XBRL | 캐시 |
| `/api/company-signals/[ticker]` | 종목별 시그널 통합 (UOA Redis `flowvium:iv:v1` unusual[] · 거래량 버스트 Yahoo 5분봉 라이브 · 공급계약 Redis `supply-chain-signals:v1` ticker 필터 금액·매출대비% · 수주잔고 `data/backlog.json` SEC RPO; KR 은 표준 수주잔고 부재→계약 flow 대체) — 전 1338 company page 노출 (2026-06-13) | 10min CDN |
| `/api/manipulation-risk/[ticker]` | 작전주(펌프&덤프) 의심 결정론 스코어 0-100 — 급등+거래량폭발+저유동성+펀더갭 동시발화 + 사전 매집(accumulation) + 투자자 수급분산(Naver) + **거래소 공식 시장경보 매칭(KR, surveillance 필드 — 소수계좌 거래집중=선행 flag)**. Yahoo 일봉+financials.json+KIND 시장경보 (2026-06-14) | 10min CDN |
| `/api/market-alerts` | **KR+US 공식 시장경보 병합** 라이브. KR=KIND 투자주의/경고/위험·소수계좌. US=SEC 거래정지(EDGAR FTS)+FINRA Reg SHO threshold(FTD)+Nasdaq/UTP halts(LULD/T12/H10). `?region=KR\|US`·`?fewAccount=1`·`?category=`·`?ticker=`. counts{kr,us}, source{kr,us} (2026-06-14) | KR 3h·US 2h Redis |
| `/api/company-kr/[ticker]` | DART OpenAPI (fnlttSinglAcntAll **연결(CFS)→개별(OFS) 폴백** — 자회사 없는 단일법인(HPSP 등) 복구 2026-06-14 + company.json 기업메타: 영문명/대표/설립일/본사/홈페이지/업종 2026-06-03). ETF/ETN/펀드는 DART 법인 아님 → `notApplicable` 200(404 오탐 제거) | 24h Redis (corp-code 30d) |
| `/api/company-kr/list` | DART CORPCODE.xml + company.json (companies-kr.ts 기반) | 7일 Redis |
| `/api/company-desc/[ticker]` | 사업개요 동적 생성 — DART grounded → 로컬 Ollama(qwen3:8b), 환각방지 프롬프트. **정적 하드코딩 금지**(2026-06-03) | 45일 Redis |
| `/api/company-recs/[ticker]` | Yahoo Finance v6 recommendationsbysymbol + v7 quote | 1h CDN |
| `/api/analyst-target/[ticker]` | Finnhub price-target + recommendation | 24h CDN |
| `/api/translate` | 통합 AI 체인 (vLLM → GROQ 8b → Qwen → Gemini, skipVllm=true, preferSmallModel=true) | 30일 |
| `/api/ai` | vLLM → Gemini | 7일 |
| `/api/osint/social` | 정적 데이터 | 캐시 |
| `/api/osint/crypto` | Blockchain.info / Etherscan | 캐시 |
| `/api/osint/sanctions` | OFAC SDN XML | 캐시 |
| `/api/osint/corporate` | OpenCorporates | 캐시 |
| `/api/admin/logs` | Redis `flowvium:log:recent` | — |
| `/api/admin/health` | Redis probe + env 검사 | — |
| `/api/admin/metrics-health` | Redis `flowvium:metrics-health:v1` | 2h |
| `/api/admin/metrics-db` | Redis hash `flowvium:mdb:v1` — per-metric 최신값 DB | 72h |
| `/api/cron/verify-metrics` | 자기 API 순회 probe → Redis 스냅샷 + metrics-db hash 갱신 | 2h |
| `/api/earnings` | Finnhub 실적 캘린더 (KST 날짜 + 기업명 + 무료 티어 60 req/min) | 2h |
| `/api/economic-calendar` | Finnhub 경제 캘린더 (실제값·예상치·이전값 포함, 정적 fallback) | 4h |
| `/api/market-movers` | Yahoo Finance v7 batch — S&P 500 상위 50개 당일 급등·급락 Top 5 각 | 15m |

---

---

## 19. 위성 공급망 추적 — 전면 제거됨 (2026-06-06)

**상태**: SAR/Sentinel 기반 공장 활동 추정이 **부정확**하여 기능 전체 제거(2026-06-06). nav 메뉴는
2026-05-27 제거됐고, 잔여 백엔드(크론·`/api/satellite-signals`·`/api/satellite-image`·
`/api/cron/satellite-scan`·`SatellitePage`·`scripts/satellite-factory-scan.mjs`·supply-chain
satellite 소스 주입·i18n 16언어·vercel cron·`npm run scan:satellite`)까지 일괄 삭제.
Copernicus 자격증명(.env.local)은 보존(추후 재활용 대비).

---

## 19b. 가상계좌 (Paper Trading) — 내비게이션에서 제거됨 (2026-05-08)

**상태**: 코드 존재, 내비게이션·홈 Hero에서 제거됨.

### 페이지: 

- **계좌 요약**: 총 자산 / 현금 / 포지션 가치 / 총 수익률 카드
- **보유 포지션 테이블**: ticker · 수량 · 평균단가 · 현재가 · 미실현손익(%) · 손절가 · 목표가 · 진입일
- **거래 내역 테이블**: 날짜 · 종목 · 매수/매도 · 체결가 · 수량 · 거래금액 · 실현손익
- 시드 00,000 가상 매매 (Yahoo Finance 현재가 체결, 수수료 0.1%)
- AI 리포트 생성 시 자동 실행 ()
- Stop-loss / Target 자동 청산 ()

### API: 

| 파라미터 | 설명 |
|---------|------|
|  | 계좌 요약 (현금 + 포지션 + 손익) |
|  | 거래 내역 (최대 200건 저장) |
|  | 일별 자산 스냅샷 (포트폴리오 가치 추이) |
|  | stop-loss / target 자동 청산 체크 (크론용) |
|  + CRON_SECRET | 계좌 초기화 |

---

### 자동화 크론 (Vercel Cron)

| 잡 경로 | 실행 시각 (KST) | 주요 작업 |
|---------|----------------|----------|
| `run-report.bat` (Windows Task Scheduler, 로컬) | **트리거 06:40·11:40·15:40·21:10·23:40 → 발간 07:00·12:00·16:00·21:30·00:00 KST** | AI 보고서 5슬롯 생성(midnight/morning/noon/afternoon/evening) → Ollama 다단계 → 정시 sleep 후 발간. 세션 단일소스 `data/report-sessions.json`, drift는 check-data-quality [J] 가 감지 (2026-06-04 noon/midnight 추가) |
| 시장 쇼크 모니터 (cron-runner 로컬, 2026-06-12) | **매 10분** | `check-market-shock.mjs` 결정론 3채널 — 속보 키워드 임팩트(관세/Fed/전쟁/제재/정책발언, 최근 90분 가중스코어) + VIX 인트라데이 급변 + KOSPI/원화 급변 → score≥4 시 **비정기 보고서 즉시 트리거**(2h 쿨다운 + 보고서 mutex 2중 보호). 트럼프 트윗류는 기사화(수분 lag) 프록시 |
| `cron/update-all` | 07:10 · 16:00 · 21:10 KST | 13개 소스 병렬 워밍 → flow-analysis → daily-brief ×3 → stock-supply pre-warm → news-cascade |
| `cron/update-signals` | 매일 02:00 UTC | EDGAR 13F 파싱 → Redis 저장 → Alpha Vantage 뉴스갭 갱신 → ISR revalidate |
| `cron/update-credit-balance` | 스케줄 | FRED + TWSE 신용잔고 갱신 → ISR revalidate |
| `cron/daily-brief` | 07:15 · 16:05 · 21:15 KST | Redis bust → AI 브리프 재생성 |
| `cron/investment-strategy` | 07:20 · 16:10 · 21:20 KST | force=1 재생성 → stale cache 갱신 |
| `cron/verify-metrics` | 매 30분 | 255+ 지표 21개 검증 그룹 병렬 probe → per-ticker/sector/maturity 세부 커버리지 (F&G · Capital Flows · Macro · Short per-ticker 35개 · Heatmap 섹터 11개 · MarketCaps · SectorPE · YieldCurve 만기별 · FedWatch 회의별 · COT 상품별 · KoreaFlow · Additional · Earnings · Cache · Accuracy · Volatility · Commodity · **Missing: Brief/FlowAnalysis/YC-hist/CompanyNews/StockPrice**) ← iter84 확장 |
| `cron/send-alerts` | 매 4시간 | F&G 극단(≤25/≥75) + VIX 고공포(≥30)/주의(≥25) 시 Discord 웹훅 발송 · 24h 쿨다운 · `DISCORD_WEBHOOK_URL` 미설정 시 무음 스킵 |
| `cron/evaluate-signals` | 일요일 03:00 UTC | 평가 기한 지난 로테이션 신호 Yahoo Finance 수익률 대조 → hit/miss → 타임프레임별 정확도 갱신 |
| `cron/signal-retrospective` | 일요일 03:30 UTC | evaluate-signals 결과 + 정확도 레코드 → AI(callAI cascade) 요약 → Redis 14일 캐시 (`/api/signal-retrospective`) |
| `cron/iv-prewarm` | 평일 22:30 KST (13:30 UTC) · 03:00 KST (18:00 UTC) | iv-screener watchlist 31종목 IV pre-warm (concurrency 4) → 4h Redis + 24h stale + 1h neg-cache (영구실패 티커 격리). 미수행 시 `/volatility` 페이지 2/31 만 표시되는 사건(2026-05-24) 이후 신설 |
| `cron/refresh-ownership-alerts` | 매일 17:00 KST (08:00 UTC) | EDGAR Schedule 13D/13G EFTS pull → Redis 24h 캐시. live request 가 SEC rate-limit/throttle 받으면 prior 캐시로 fallback. 0건 응답 시 prior 유지 (stale 우선) — 2026-05-25 ownership-alerts Vercel empty 사건 이후 신설 |
| `scan-accumulation` (cron-runner 로컬) | 16:00 · 07:00 KST | KOSDAQ 작전주 매집 워치 → `data/accumulation-watchlist.json` (자동 커밋+푸시) |
| `scan-accumulation --us` (cron-runner 로컬, 2026-06-17) | 06:30 · 22:00 KST | US 소형주 작전주 매집(거래량) → `data/accumulation-watchlist-us.json` (자동 커밋+푸시) |
| `build-us-smallcap` (cron-runner 로컬, 2026-06-17) | 월 04:00 KST | Yahoo screener `aggressive_small_caps` → US 소형주 유니버스 `data/us-smallcap-universe.json` (주 1회) |
| `scan-insider-kr` (cron-runner 로컬, 2026-06-17) | 16:30 · 07:30 KST | KR 임원·주요주주 지분공시 피드(DART, 로컬 라우트 순회) → `data/insider-kr-feed.json` (자동 커밋+푸시) |

---

### 인프라 규칙

| 항목 | 규칙 |
|------|------|
| Redis 쓰기 | 직접 `redis.set` 금지 → `loggedRedisSet` 헬퍼 사용 |
| 외부 fetch | 가능하면 `loggedFetch` 사용 (자동 REDACT + 타이밍) |
| 로그 | `src/lib/logger.ts` — JSON stdout + Redis 적재 (warn/error, 최대 500건) |
| i18n | next-intl, 16개 언어 (ko·en·ja·zh-CN·zh-TW·es·fr·de·pt·ru·ar·hi·id·th·tr·vi) |
| AI 우선순위 | EXAONE vLLM (로컬 무료) → **GROQ llama-3.3-70b** → GROQ 8b → **Qwen 2.5 72B** (OpenRouter free, OPENROUTER_API_KEY 설정 시) → Gemini 2.0 Flash (유료 최종 폴백). Redis TPD guard로 GROQ 소진 즉시 Qwen/Gemini로 전환. 체인: `src/lib/ai-providers.ts` |
| 유료 API 잠금 | "월 $200 후원 목표 도달 시 오픈" 형식만 사용 |

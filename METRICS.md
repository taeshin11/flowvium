# FlowVium — 수치·지표 체크리스트

> **목적**: 사이트에 표시되는 모든 개별 수치·지표를 한 줄씩 분리하여 상태·소스·갱신주기·블룸버그 대응을 체크한다.
> `FEATURES.md`는 기능 카탈로그(페이지/탭), 이 파일은 **데이터 포인트 레벨** 체크리스트.
> **유지 의무**: 새 수치·지표 추가·수정·삭제 시 같은 커밋에 반영.

## 상태 범례

| 뱃지 | 의미 |
|------|------|
| ✅ live | 요청 시점 계산 또는 5분 이하 캐시 |
| 💾 cached | Redis 캐시 (TTL 있음) — 대부분 4~26h |
| 🔄 cron | Vercel 크론 주기 갱신 → Redis |
| 📋 static | 하드코딩된 데이터 (업데이트 안 됨) |
| ⛔ missing | 미구현, 블룸버그 갭 |
| 🔒 locked | 유료 API 대기 ($200 후원 락) |
| ⚠️ buggy | 현재 정상 작동 의심·개선 필요 |

---

## 목차

1. [홈 (/)](#1-홈-)
2. [인텔리전스 (/intelligence)](#2-인텔리전스-intelligence)
3. [탐색기 (/explore)](#3-탐색기-explore)
4. [기업 프로필 (/company/[ticker])](#4-기업-프로필-companyticker)
5. [기관 신호 (/signals)](#5-기관-신호-signals)
6. [뉴스 갭 (/news-gap)](#6-뉴스-갭-news-gap)
7. [인사이더·수급 (/insider)](#7-인사이더수급-insider)
8. [스크리너 (/screener)](#8-스크리너-screener)
9. [숏 인터레스트 (/short)](#9-숏-인터레스트-short)
10. [시장 히트맵 (/heatmap)](#10-시장-히트맵-heatmap)
11. [캐스케이드 (/cascade)](#11-캐스케이드-cascade)
12. [AI 리포트 (/report)](#12-ai-리포트-report)
13. [비교 분석 (/compare)](#13-비교-분석-compare)
14. [OSINT (/osint)](#14-osint-osint)
15. [백엔드 헬스 (/admin/health)](#15-백엔드-헬스-adminhealth)
16. [블룸버그 갭 (미구현)](#16-블룸버그-갭-미구현)

---

## 1. 홈 (`/`)

### 1-1. AI 데일리 브리프 위젯

| # | 지표 | 상태 | 소스 | 주기 | 비고 |
|---|------|------|------|------|------|
| 1 | Market 섹션 요약 텍스트 | 🔄 cron | vLLM→Gemini | 7h×3 | 1w/4w/13w 타임프레임별 |
| 2 | Capital 섹션 요약 | 🔄 cron | vLLM→Gemini | 7h×3 | |
| 3 | Company 섹션 요약 | 🔄 cron | vLLM→Gemini | 7h×3 | |
| 4 | Signals 섹션 요약 | 🔄 cron | vLLM→Gemini | 7h×3 | |
| 5 | 리스크 레벨 (Low/Med/High) | 🔄 cron | AI 판단 | 7h | |
| 6 | AI Outlook 문구 | 🔄 cron | AI | 7h | |
| 7 | 생성 타임스탬프 | ✅ live | metadata | - | |
| 8 | 소스 · 캐시 여부 배지 | ✅ live | metadata | - | |

### 1-1b. 실시간 마켓 스냅샷 스트립

| # | 지표 | 상태 | 소스 | 주기 | 비고 |
|---|------|------|------|------|------|
| 239-M | SPY 실시간 가격 + 등락% | ✅ live | `/api/stock-price/SPY` | 60s 갱신 | MarketSnapshot |
| 239-N | QQQ 실시간 가격 + 등락% | ✅ live | `/api/stock-price/QQQ` | 60s 갱신 | |
| 239-O | BTC-USD 실시간 가격 + 등락% | ✅ live | `/api/stock-price/BTC-USD` | 60s 갱신 | |
| 239-P | ^VIX 실시간 수준 + 등락% | ✅ live | `/api/stock-price/^VIX` | 60s 갱신 | 컬러 반전 |
| 239-Q | US Fear & Greed 지수 | ✅ live | `/api/fear-greed` | 60s 갱신 | F&G pill, iter33 |
| 239-Q2 | F&G 30일 히스토리 스파크라인 | 💾 cached | `/api/fear-greed` (CNN hist) | 4h Redis | iter61, 홈 F&G pill 옆 SVG 추세선 |
| 239-R | 10Y 국채금리 (^TNX) | ✅ live | `/api/stock-price/^TNX` | 60s 갱신 | `{price}%` 표시, iter34 |
| 239-S | DXY 달러인덱스 (DX-Y.NYB) | ✅ live | `/api/stock-price/DX-Y.NYB` | 60s 갱신 | 소수점 1자리, iter34 |
| 239-T | Gold 선물 가격 (GC=F) | ✅ live | `/api/stock-price/GC=F` | 60s 갱신 | `$` 정수, iter34 |
| 239-U | 매크로 리스크 신호 배지 | 💾 cached | `/api/macro-indicators` (mount 1회) | daily Redis | iter64, Risk On/Off/Neutral |
| 239-V | 경제 국면 배지 (CYCLE) | 💾 cached | `/api/macro-indicators` (GDP+CPI 합성) | daily Redis | iter69, Stagflation/Goldilocks/Overheating/Slowdown/Recession |

### 1-2. 통계 바

| # | 지표 | 상태 | 소스 | 비고 |
|---|------|------|------|------|
| 9 | "10,000+ 투자자" | 📋 static | 하드코딩 | 실제 유저 수 아님 |
| 10 | "137+ 추적 기업" | 📋 static | 하드코딩 | `explore-data` 기준 검증 필요 |
| 11 | "16개 섹터" | 📋 static | 하드코딩 | |
| 12 | "$48B+ 흐름" | 📋 static | 하드코딩 | |

### 1-3. 섹터 그리드 (5개)

| # | 지표 | 상태 | 비고 |
|---|------|------|------|
| 13 | 섹터별 기업 수 | 📋 static | `explore-data`에서 집계 |

### 1-4. 최신 기관 신호 Top 5

| # | 지표 | 상태 | 소스 | 주기 |
|---|------|------|------|------|
| 14 | 티커 | 💾 cached | 13F | 7d |
| 15 | 기관명 | 💾 cached | 13F | 7d |
| 16 | 액션 아이콘 | 💾 cached | 13F | 7d |
| 17 | 추정가치($) | 💾 cached | 13F | 7d |
| 18 | 공시일 | 💾 cached | 13F | 7d |

### 1-5. LiveFeed (최근 업데이트)

| # | 지표 | 상태 | 소스 | 주기 |
|---|------|------|------|------|
| 19 | Fear & Greed 최신값 | 💾 cached | 4h | SPY 기준 |
| 20 | Capital Flows 상위 유입 자산 | 💾 cached | Yahoo/Twelve | 4h |
| 21 | Capital Flows 상위 유출 자산 | 💾 cached | Yahoo/Twelve | 4h |
| 22 | Macro 업데이트 타임스탬프 | 💾 cached | FRED | 25h |

---

## 2. 인텔리전스 (`/intelligence`)

### 2-1. 탭: 자금 흐름 (`capital`)

**자산 클래스별 수익률** (1w/4w/13w)

| # | 자산 | 상태 | 소스 |
|---|------|------|------|
| 23 | SPY (S&P 500) 1w/4w/13w 수익률 | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 24 | QQQ (Nasdaq) 1w/4w/13w | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 25 | IWM (Russell 2000) 1w/4w/13w | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 26 | EFA (개도국 제외 선진국) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 27 | EEM (이머징 주식) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 28 | TLT (장기국채) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 29 | IEF (중기국채) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 30 | LQD (투자등급회사채) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 31 | HYG (하이일드) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 32 | EMB (이머징 채권) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 33 | TIP (물가연동채) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 34 | GLD (금) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 35 | SLV (은) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 36 | USO (WTI 원유) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 37 | DBC (원자재) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 38 | UUP (달러) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 39 | BTC (비트코인) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 40 | ETH (이더리움) | 💾 cached | Twelve→Yahoo→Nasdaq→Finnhub |
| 41 | 플로우 강도: 상위 유입 5개 | 💾 cached | 자체계산 | |
| 42 | 플로우 강도: 상위 유출 5개 | 💾 cached | 자체계산 | |
| 43 | 그룹 평균 수익률 (equity/bonds/alts/commodities/currency) | 💾 cached | 자체계산 | |

**국가별 ETF** (12개국)

| # | 국가 | 상태 | 티커 |
|---|------|------|------|
| 44 | 🇺🇸 미국 | 💾 cached | SPY |
| 45 | 🇨🇳 중국 | 💾 cached | MCHI |
| 46 | 🇯🇵 일본 | 💾 cached | EWJ |
| 47 | 🇰🇷 한국 | 💾 cached | EWY |
| 48 | 🇹🇼 대만 | 💾 cached | EWT |
| 49 | 🇮🇳 인도 | 💾 cached | INDA |
| 50 | 🇧🇷 브라질 | 💾 cached | EWZ |
| 51 | 🇩🇪 독일 | 💾 cached | EWG |
| 52 | 🇬🇧 영국 | 💾 cached | EWU |
| 53 | 🇫🇷 프랑스 | 💾 cached | EWQ |
| 54 | 🇲🇽 멕시코 | 💾 cached | EWW |
| 55 | 🇦🇺 호주 | 💾 cached | EWA |
| 56 | 국가 로테이션 모멘텀 (accelerating/holding/fading) | 💾 cached | 자체계산 |
| 57 | 국가 로테이션 상위 4쌍 확산폭 | 💾 cached | 자체계산 |

**금 vs 달러 신호**

| # | 지표 | 상태 |
|---|------|------|
| 58 | 1w 금/달러 신호 | 💾 cached |
| 59 | 4w 금/달러 신호 | 💾 cached |
| 60 | 13w 금/달러 신호 | 💾 cached |

**AI 자금흐름 분석**

| # | 지표 | 상태 |
|---|------|------|
| 61 | 국가별 유입 원인 | 🔄 cron |
| 62 | 국가별 유출 원인 | 🔄 cron |
| 63 | 국가별 리스크 | 🔄 cron |
| 64 | mainTheme | 🔄 cron |
| 65 | keyWatchpoints (여러 개) | 🔄 cron |
| 65a | 유입·유출 상위 행 인라인 스파크라인 (26일) | 💾 cached | Yahoo v7 batch | iter65 |

### 2-2. 탭: 매크로 지표 (`macro`)

**국채 수익률 곡선 (9 포인트)**

| # | 만기 | 상태 | 소스 |
|---|------|------|------|
| 66 | 1M T-Bill | 💾 cached | FRED DGS1MO |
| 67 | 3M T-Bill | 💾 cached | FRED DGS3MO |
| 68 | 6M T-Bill | 💾 cached | FRED DGS6MO |
| 69 | 1Y Note | 💾 cached | FRED DGS1 |
| 70 | 2Y Note | 💾 cached | FRED DGS2 |
| 71 | 5Y Note | 💾 cached | FRED DGS5 |
| 72 | 10Y Note | 💾 cached | FRED DGS10 |
| 73 | 20Y Bond | 💾 cached | FRED DGS20 |
| 74 | 30Y Bond | 💾 cached | FRED DGS30 |
| 75 | 10Y-2Y 스프레드 | 💾 cached | 자체계산 (DGS2/DGS10) + T10Y2Y fallback |
| 76 | 역전 여부 | 💾 cached | 자체계산 |
| 76a | 매크로 API source/live-static 구분 | 💾 cached | `/api/macro-indicators` source + staticAsOf |
| 76b | 매크로 forecast staleness probe | 🔄 cron | `/api/cron/verify-metrics` 90일 초과 감지 |

**Fed Watch**

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 77 | 현재 기준금리 | 💾 cached | CME |
| 78 | 연말 예상금리 | 💾 cached | CME |
| 79 | 다음 FOMC Hold 확률 | 💾 cached | CME |
| 80 | 다음 FOMC Cut25 확률 | 💾 cached | CME |
| 81 | 다음 FOMC Cut50 확률 | 💾 cached | CME |
| 82 | 다음 FOMC Cut75 확률 | 💾 cached | CME |
| 83 | 다음 FOMC Hike25 확률 | 💾 cached | CME |
| 84 | 월별 확률 바 (향후 12개월) | 💾 cached | CME |

**매크로 이벤트 캘린더 (EconCalendarSection, iter35)**

| # | 지표 | 상태 | 소스 | 비고 |
|---|------|------|------|------|
| 239-U | FOMC 회의 일정 + 카운트다운 | 📋 static | Fed 공식 일정 | 2026 전체 |
| 239-V | NFP/CPI/PPI/PCE/GDP 발표일 | 📋 static | BLS·BEA 일정 | 2026 전체 |
| 239-W | D-N 카운트다운 chip | ✅ live | 클라이언트 계산 | 매 렌더 갱신 |

**매크로 지표 카드 (9개)**

| # | 지표 | 상태 | 필드 |
|---|------|------|------|
| 85 | CPI (실제·예상·이전·Surprise) | 💾 cached | 4필드 + 레이블 |
| 86 | PCE Core | 💾 cached | 4필드 |
| 87 | NFP (비농업 고용) | 💾 cached | 4필드 |
| 88 | FOMC 결정 (actual=3.75%, forecast=3.75%, prev=4.0%) | 💾 cached | 4필드, iter66 static 갱신 |
| 89 | GDP Q1 Advance (actual=0.5%, forecast=0.9%, prev=2.4%) | 💾 cached | 4필드, iter66 static 갱신 |
| 90 | ISM PMI | 💾 cached | 4필드 |
| 91 | 소매판매 | 💾 cached | 4필드 |
| 92 | PPI | 💾 cached | 4필드 |
| 93 | 실업률 | 💾 cached | 4필드 |
| 93a | 신규 실업수당 청구 (ICSA 주간, 천명) | 💾 cached | FRED ICSA series |
| 93b | 미시간대 소비자심리지수 (UMCSENT 월간) | 💾 cached | FRED UMCSENT series |
| 93c | IG 신용 스프레드 OAS (ICE BofA, 일별) | ✅ live | FRED BAMLC0A0CM, iter58 |
| 93d | HY 신용 스프레드 OAS (ICE BofA, 일별) | ✅ live | FRED BAMLH0A0HYM2, iter58 |
| 93e | 매크로 리스크 신호 (Risk-On/Neutral/Risk-Off) | ✅ live | IG+HY+UMC+금리 합성, iter59 |
| 93f | 지표별 이전값 대비 δ·방향색 표시 (← prev) | 💾 cached | 카드 하단 delta, POSITIVE_DIR 기준 green/red | iter63 |
| 94 | 각 지표 매파/비둘기 영향 | 💾 cached | hawkish/dovish |
| 95 | 각 지표 캐스케이드 체인 (3~5개 자산) | 💾 cached | 방향·강도·이유 |

### 2-3. 탭: 머니 흐름 (`flows`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 96 | 스마트머니 유입 섹터 랭킹 | 💾 cached | 13F |
| 97 | 스마트머니 이탈 섹터 랭킹 | 💾 cached | 13F |
| 97a | ETF 섹터 자금흐름 (inflow/outflow) | ✅ live | capital-flows sectorPerformance (11 ETF) |

### 2-4. 탭: Fear & Greed (`fear-greed`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 98 | F&G (SPY) 게이지 | ✅ live | CNN 공식 API | 4h | CNN 차단 시 composite로 자동 폴백 + error 로깅 |
| 98a | F&G US 30일 스파클라인 | 💾 cached | CNN `fear_and_greed_historical` | 4h | 마지막 30 포인트, iter57 |
| 99 | F&G 자산별 (Gold/Tech/Bonds 등) | 💾 cached | FlowVium 합성 | 4h | RSI×40+SMA125×35+Vol×25 |
| 100 | F&G 국가별 (한/일/중/유/영/인/브/대/호) | 💾 cached | FlowVium 합성 | 4h | 국가 ETF 기반 composite (CNN 대응 없음) |
| 100a | 출처 뱃지 (CNN/합성) | ✅ live | `source` 필드 | - | UI 투명성: 같은 숫자라도 계산법 구분 |

### 2-5. 탭: 신용잔고 (`credit`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 101 | 미국 신용잔고 ($B) | 💾 cached | FRED BOGZ1FL663067003Q |
| 102 | 미국 GDP 대비 % | 💾 cached | FRED |
| 103 | 미국 YoY 변화 | ✅ live | historical 마지막 두 항목 gdpRatio 차이 동적계산 |
| 104 | 한국 신용잔고 (₩31조, KRW-basis ATH) | ⚠️ buggy→💾 static-estimated | KRX MDCSTAT03701 / BOK ECOS 901Y001 (key-free KRX 시도, 실패시 static-estimated 반환) |
| 105 | 일본 신용잔고 | 💾 cached | 추정 |
| 106 | 대만 신용잔고 | 💾 cached | TWSE |
| 107 | 글로벌 스냅샷 (총합) | 💾 cached | 자체계산 |
| 108 | 국가별 장기 시계열 차트 | 💾 cached | FRED/외 |
| 109a | 국가별 histPercentile (역사적 백분위) | ✅ live | historical 배열 기반 동적계산 (하드코딩 제거) |
| 109b | 국가별 riskLevel 배지 (low/medium/high/extreme) | ✅ live | histPercentile 기반 동적계산 → 게이지·배지 일치 |
| 109c | 국가별 changeYoY | ✅ live | historical 마지막 두 포인트 차이 동적계산 |

### 2-6. 탭: 매크로 테마 (`narratives`)

| # | 지표 | 상태 |
|---|------|------|
| 109 | 테마명·카테고리·설명 | 📋 static | `/data/macro-narratives` |

### 2-7. 탭: 뉴스 캐스케이드 (`news`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 110 | RSS 헤드라인 (Yahoo/Reuters/CNBC/Bloomberg/MarketWatch) | 💾 cached | 5개 피드, 4h |
| 111 | 기사별 감성 배지 | 💾 cached | AI 분석 |
| 112 | 기사별 중요도 닷 | 💾 cached | AI 분석 |
| 113 | 기사별 캐스케이드 자산 (↑↓) | 💾 cached | AI 분석 |
| 114 | 기사별 전체 캐스케이드·강도·이유·타임프레임 | 💾 cached | AI |

### 2-8. 탭: CFTC COT 포지션 (`cot`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 114a | E-mini S&P 500 투기세력 순포지션 + 주간 변화 | 💾 cached | CFTC FinFutWk.txt (4h) |
| 114b | Nasdaq-100 투기세력 순포지션 + 주간 변화 | 💾 cached | CFTC FinFutWk.txt |
| 114c | 10Y T-Note 투기세력 순포지션 + 주간 변화 | 💾 cached | CFTC FinFutWk.txt |
| 114d | 2Y T-Note 투기세력 순포지션 + 주간 변화 | 💾 cached | CFTC FinFutWk.txt |
| 114e | EUR/USD 투기세력 순포지션 + 주간 변화 | 💾 cached | CFTC FinFutWk.txt |
| 114f | JPY 투기세력 순포지션 + 주간 변화 | 💾 cached | CFTC FinFutWk.txt |
| 114g | VIX 투기세력 순포지션 + 주간 변화 | 💾 cached | CFTC FinFutWk.txt |

---

## 3. 탐색기 (`/explore`)

| # | 지표 | 상태 | 비고 |
|---|------|------|------|
| 115 | 137개 기업 노드 | 📋 static | `/data/explore-data` |
| 116 | 기업 간 연관 엣지 (supplier/customer/partner/competitor) | 📋 static | |
| 117 | 시가총액 (Explore 페이지 band 필터) | 💾 cached | Yahoo Finance v7 (crumb), 24h Redis |
| 118 | 섹터 분류 | 📋 static | |
| 119 | 역할 배지 | 📋 static | |
| 120 | 제품 매출 비중 | 📋 static | |
| 121 | 매출 파이차트 | 📋 static | |
| 122 | 연관 기업 Top 6 | 📋 static | |

---

## 4. 기업 프로필 (`/company/[ticker]`)

### 4-1. 헤더

| # | 지표 | 상태 | 비고 |
|---|------|------|------|
| 123 | 기업명·설명·역할 | 📋 static | |
| 123-P | 실시간 주가·일간 변화% | ✅ live | /api/stock-price Yahoo v8, 15min |
| 123-M | 시가총액 band 분류 (기업 프로필 헤더) | 📋 static | /api/market-caps — Yahoo v7 crumb 불가, 정적 band만 |
| 123-C | 90일 주가 추이 차트 + 수익률 | 💾 cached | /api/price-history Yahoo v8, 1h |
| 124 | 번역 설명 (16개 언어) | 💾 cached | Gemini 번역, 30d |
| 125 | ASCII 공급망 네트워크 뷰 | 📋 static | |

### 4-2. 제품 & 매출

| # | 지표 | 상태 |
|---|------|------|
| 126 | 제품별 매출 바 차트 | 📋 static |
| 127 | 매출 도넛 파이 차트 | 📋 static |
| 128 | 세그먼트 금액·비중 | 📋 static |
| 129 | 세그먼트별 주요 고객 | 📋 static |

### 4-3. R&D 파이프라인

| # | 지표 | 상태 |
|---|------|------|
| 130 | 프로젝트명·단계·설명 | 📋 static |
| 131 | 목표일 | 📋 static |
| 132 | 예산 | 📋 static |

### 4-4. 공급망 관계

| # | 지표 | 상태 |
|---|------|------|
| 133 | Suppliers 카드 | 📋 static |
| 134 | Customers 카드 | 📋 static |
| 135 | Competitors 카드 | 📋 static |
| 136 | Partners 카드 | 📋 static |

### 4-5. 매크로·시장 맥락

| # | 지표 | 상태 |
|---|------|------|
| 137 | 섹터 페이즈 | 📋 static |
| 138 | Tailwinds (↑ 녹색) | 📋 static |
| 139 | Headwinds (↓ 빨강) | 📋 static |
| 140 | 다음 촉매제 | 📋 static |

### 4-6. 공급망 이슈

| # | 지표 | 상태 |
|---|------|------|
| 141 | 업데이트 카드 (영향도·유형) | 📋 static |

### 4-7. 기관 신호 테이블

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 142 | 기관 액션·가치·분기·공시일 | 💾 cached | 13F |

### 4-8. 기관 보유 현황 (13F)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 143 | 기관별 보유%·이전%·변화 | ✅ live | `flowvium:13f-ownership:v1` (방금 활성화) |
| 144 | 기관별 주식수·가치 | ✅ live | 13F |
| 145 | 총 기관 보유 합산 | ✅ live | 13F |

### 4-9. AI 분석

| # | 지표 | 상태 |
|---|------|------|
| 146 | 공급망 투자 분석 텍스트 | 💾 cached | vLLM→Gemini, 7d, 온디맨드 |

### 4-10. 사이드바

| # | 지표 | 상태 |
|---|------|------|
| 147 | 본사·설립연도·직원수·웹사이트 | 📋 static |
| 148 | Gap Score | 💾 cached | Alpha Vantage |
| 149 | IB 활동 점수 | 💾 cached | Alpha Vantage |
| 150 | 미디어 커버리지 점수 | 💾 cached | Alpha Vantage |
| 151 | 캐스케이드 포지션·딜레이 | 📋 static |

### 4-11. 재무 심화 (XBRL) — ✅ 배선 완료 (2026-04-24)

| # | 지표 | 상태 | 소스 | 비고 |
|---|------|------|------|------|
| 152 | 매출 시계열 (연간 5년) | ✅ live | SEC EDGAR XBRL 10-K | CompanyPage 재무 심화 카드 |
| 153 | 영업이익 시계열 | ✅ live | SEC XBRL `OperatingIncomeLoss` | |
| 154 | 순이익 시계열 | ✅ live | SEC XBRL `NetIncomeLoss` | |
| 155 | EPS (희석, 최신 FY) | ✅ live | SEC XBRL `EarningsPerShareDiluted` | |
| 156 | 총자산 | ✅ live | SEC XBRL `Assets` | |
| 157 | 총부채 | ✅ live | SEC XBRL `Liabilities` | |
| 158 | 자본 | ✅ live | SEC XBRL `StockholdersEquity` | |
| 159 | 영업현금흐름 | ✅ live | SEC XBRL `NetCashProvided…Operating` | |
| 160 | 투자현금흐름 | ✅ live | SEC XBRL `NetCashProvided…Investing` | |
| 161 | 재무현금흐름 | ✅ live | SEC XBRL `NetCashProvided…Financing` | |
| 162 | R&D 비용 | ✅ live | SEC XBRL `ResearchAndDevelopmentExpense` | |
| 163 | CapEx | ✅ live | SEC XBRL `PaymentsToAcquirePropertyPlant…` | |
| 164 | 자사주매입 | ✅ live | SEC XBRL `PaymentsForRepurchaseOfCommonStock` | |
| 165 | 배당금 | ✅ live | SEC XBRL `PaymentsOfDividends` | |
| 166 | ROE | ✅ live | 파생: 순이익/자본 | |
| 167 | ROA | ✅ live | 파생: 순이익/총자산 | |
| 168 | 영업이익률 | ✅ live | 파생: 영업이익/매출 | |
| 169 | 부채비율 | ✅ live | 파생: 총부채/총자산 | |
| 170 | 분기별 Y/Y 성장률 (최근 8분기) | ✅ live | SEC XBRL 10-Q (form=10-Q, fp=Q1/Q2/Q3) |

---

## 5. 기관 신호 (`/signals`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 171 | 상태 배지 (Live/Cached/Static) | ✅ live | 자체 판단 |
| 172 | 업데이트 시각·종목 수 | ✅ live | metadata |
| 173 | 섹터별 활동 차트 (매집 vs 감소) | 🔄 cron | 13F (3,141개 Q4 2025) |
| 174 | 상위 기관 랭킹 | 🔄 cron | 13F (9기관: BRK/BLK/VGD/SST/WEL/VGI/TP/PSQ/FMR) |
| 175 | 신호 테이블: 티커·기업·기관 | 🔄 cron | 13F (72 tickers) |
| 176 | 신호 테이블: 액션·보유%·주식수 변화 | 🔄 cron | 13F |
| 177 | 신호 테이블: 가치·갭스코어·공시일 | 🔄 cron | 13F |

---

## 6. 뉴스 갭 (`/news-gap`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 178 | 신선도 배지 (Live/Cached/Research) | ✅ live | 자체 판단 |
| 179 | IB vs 미디어 산포도 (137개 종목) | 💾 cached | AV + 정적 |
| 180 | 종목별 갭 스코어 | 💾 cached | AV |
| 181 | 종목별 IB 활동 점수 | 💾 cached | AV |
| 182 | 종목별 미디어 커버리지 점수 | 💾 cached | AV |
| 183 | 뉴스 캐스케이드 기사 (2열) | 💾 cached | RSS |
| 184 | 갭 카드 상세: 최근 기사 | 💾 cached | AV |
| 185 | 갭 카드 상세: 기관 보유 | ✅ live | 13F (방금 활성화) |

---

## 7. 인사이더·수급 (`/insider`)

### 7-1. 탭: 인사이더 (`insider`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 186 | 공시일 | 💾 cached | EDGAR Form 4 |
| 187 | 티커 | 💾 cached | |
| 188 | 내부자명·직책 | 💾 cached | |
| 189 | 액션 (Buy↑녹 / Sell↓빨) | 💾 cached | |
| 189a | 매수 사유 추정 (규칙 기반) | ✅ live | 자체계산 (transactionCode·직책·금액) |
| 190 | 주식수·단가·가치 | 💾 cached | |
| 191 | SEC 링크 | 💾 cached | |
| 192 | 클러스터 배지 (3건+ 종목) | 💾 cached | 자체계산 |

### 7-2. 탭: 대량 보유 (`ownership`)

| # | 지표 | 상태 |
|---|------|------|
| 193 | 공시일·티커·발행사 | 💾 cached | EDGAR 13D/13G |
| 194 | 신고자·양식(13D/13G) | 💾 cached | |
| 195 | 보유%·보유주식 | 💾 cached | |

### 7-3. 탭: N-PORT (`nport`)

| # | 지표 | 상태 |
|---|------|------|
| 196 | 티커·총 가치·펀드 수 | 💾 cached | EDGAR N-PORT |
| 197 | 상위 펀드 목록 + 가치 | 💾 cached | |

### 7-4. 탭: 블록 트레이드 (`blocks`) 🔒

| # | 지표 | 상태 |
|---|------|------|
| 198 | 시간·티커·주식수·단가 | 🔒 locked | Polygon (API 키) |
| 199 | 가치·거래소 | 🔒 locked | |

### 7-5. 탭: 옵션 플로우 (`options`) 🔒

| # | 지표 | 상태 |
|---|------|------|
| 200 | 시간·티커·감성 | 🔒 locked | Unusual Whales |
| 201 | 계약($Strike·만기) | 🔒 locked | |
| 202 | 사이즈·프리미엄 | 🔒 locked | |

### 7-6. 탭: 한국 수급 (`korea`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 203 | 거래일·총 종목 수 | 💾 cached | Naver frgn (15min TTL) |
| 204 | 외국인 상위 순매수 | 💾 cached | Naver frgn (주수 × 종가 = KRW 근사) |
| 205 | 외국인 상위 순매도 | 💾 cached | Naver frgn |
| 206 | 기관 상위 순매수 | ⛔ missing | Naver per-stock 기관 데이터 없음 |
| 207 | 기관 상위 순매도 | ⛔ missing | Naver per-stock 기관 데이터 없음 |
| 208 | 종목별 현재가·등락% | 💾 cached | Naver frgn |
| 209 | 외국인 순매수 금액(원) | 💾 cached | Naver frgn 주수 × 종가 (근사값) |

---

## 8. 스크리너 (`/screener`) ← 타임프레임 1w/4w/13w 추가

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 210-TF | **타임프레임 셀렉터 (1w/4w/13w)** | ✅ live | 사용자 선택 |
| 210-src | **데이터 소스 설명 배너** (분기/시차 명시) | ✅ live | 정적 표시 |
| **13w (기관 13F 뷰)** | | | |
| 210-T | Top Squeeze 배너: 상위 5 실시간 가격·등락% | ✅ live | Yahoo Finance `/api/stock-price` |
| 210 | 프리셋: 숏 스퀴즈 후보 | 💾 cached | signals + short |
| 211 | 프리셋: 기관 신규 편입 | 💾 cached | signals |
| 212 | 프리셋: 기관 매집 중 | 💾 cached | signals |
| 213 | 프리셋: 기관 비중 축소 | 💾 cached | signals |
| 214 | 프리셋: 언더레이더 | 💾 cached | signals + news-gap |
| 214-A | 프리셋: 🔮 다수 기관 합의 (bullishCount ≥ 2) | 💾 cached | 13F 9개 기관 교차 ← iter114 |
| 214-B | 프리셋: 🔱 N-PORT 이중 매집 (13F+N-PORT 교차) | 💾 cached | 13F + EDGAR N-PORT ← iter116 |
| 215 | 숏 Float % 슬라이더 | ✅ live | 사용자 입력 |
| 215-A | 결과 테이블: 합의 컬럼 (매집/감소 기관 수) | 💾 cached | 13F 9개 기관 bullishCount/bearishCount ← iter113 |
| 215-B | 결과 테이블: N-PORT 컬럼 (뮤추얼펀드 보유 총액) | 💾 cached | `/api/nport-holdings` byTicker ← iter116 |
| 215-C | 결과 테이블: 가격 컬럼 (현재가, 정렬 가능) | ✅ live | `/api/batch-prices` Yahoo v7 → Finnhub 폴백 ← iter210 |
| 215-D | 결과 테이블: 등락% 컬럼 (일간 등락, 정렬 가능) | ✅ live | `/api/batch-prices` Yahoo v7 → Finnhub 폴백 ← iter210 |
| 216 | 결과 테이블: 스퀴즈 스코어(바) | 💾 cached | 자체계산 |
| 217 | 결과 테이블: 뉴스갭(바) | 💾 cached | AV |
| 218 | 결과 테이블: DTC (Days to Cover) | 💾 cached | Yahoo |
| **1w/4w (Form 4 내부자 뷰)** | | | |
| 210-I1 | 대규모 내부자 매수 배너 (총 매수금액 top5) | ✅ live | `/api/insider-trades` (D+2) |
| 210-I2 | C-Suite 매수 배너 (CEO/CFO/임원 매수 top5) | ✅ live | `/api/insider-trades` |
| 210-I3 | 집중 매수 배너 (복수 내부자 동시 매수) | ✅ live | `/api/insider-trades` |
| 210-I4 | 내부자 테이블: 티커·기업·내부자·직책·매수금액·건수·거래일 | ✅ live | `/api/insider-trades` |
| 210-I5 | 기간 필터: 1w=최근7일, 4w=최근28일 | ✅ live | transactionDate 기준 |
| 210-I6 | 내부자 테이블: 현재가 컬럼 | ✅ live | `/api/batch-prices` Yahoo v7 → Finnhub 폴백 ← iter268 |
| 210-I7 | 내부자 테이블: 1W/4W 기간수익률 컬럼 | ✅ live | `/api/batch-prices?period=1w\|4w` Yahoo spark 5/20거래일 ← iter268 |

---

## 9. 숏 인터레스트 (`/short`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 219 | 추적 종목 수 | 💾 cached | 집계 |
| 220 | 스퀴즈 위험 종목 수 (45+) | 💾 cached | 자체계산 |
| 221 | 평균 Short Vol % (FINRA 일별) | 💾 cached | FINRA CNMSshvol |
| 222 | 최고 스퀴즈 스코어 + 티커 | 💾 cached | 자체계산 |
| 223 | 종목별 Short Vol % (FINRA 일별) | 💾 cached | FINRA CNMSshvol (ShortVol/TotalVol) |
| 224 | 종목별 DTC | 💾 cached | Yahoo |
| 225 | MoM 변화 | 💾 cached | 자체계산 |
| 226 | 기관 액션 | 💾 cached | 13F |
| 227 | 스퀴즈 스코어 (색상 바) | 💾 cached | 자체계산 |

---

## 10. 시장 히트맵 (`/heatmap`)

### 10-1. 국가 탭 (7개)

| # | 국가 | 상태 |
|---|------|------|
| 228 | 🇺🇸 S&P 500 종목 시가총액·등락 | 💾 cached | Yahoo |
| 229 | 🇰🇷 Korea KOSPI 상위 | 💾 cached | Stooq/KRX |
| 230 | 🇯🇵 Japan Nikkei 상위 | 💾 cached | Yahoo |
| 231 | 🇨🇳 China CSI 상위 | 💾 cached | Yahoo |
| 232 | 🇪🇺 EU 상위 | 💾 cached | Yahoo |
| 233 | 🇮🇳 India NIFTY 상위 | 💾 cached | Yahoo |
| 234 | 🇹🇼 Taiwan TAIEX 상위 | 💾 cached | Yahoo |

### 10-2. 지수 바

| # | 지표 | 상태 |
|---|------|------|
| 235 | 국가별 대표 지수 4개 (심볼·종가·등락%) | 💾 cached | Yahoo |

### 10-3. Overview 트리맵 (Finviz 스타일, iter269)

| # | 지표 | 상태 |
|---|------|------|
| 236 | 섹터 컨테이너 (depth=1, 크기=totalMarketCap, 색상 테두리+라벨) | 💾 cached | API 데이터 재가공 |
| 237 | 종목 박스 (depth=2, 크기=시가총액, 색상=등락%) | 💾 cached | Yahoo |

### 10-4. 섹터 상세 트리맵 (2열 그리드)

| # | 지표 | 상태 |
|---|------|------|
| 238 | 섹터별 종목 박스 (크기=시가총액) | 💾 cached | Yahoo |
| 239 | 박스 색상 (등락%) | 💾 cached | Yahoo |

---

## 11. 캐스케이드 (`/cascade`)

| # | 지표 | 상태 |
|---|------|------|
| 238 | 섹터별 패턴 그룹 | 📋 static | `/data/cascades` |
| 239-L | 리더 기업 라이브 주가·등락% | ✅ live | Yahoo Finance `/api/stock-price` |
| 239 | 리더 기업·티커·섹터 | 📋 static |
| 240 | 스텝 수·총 딜레이 | 📋 static |
| 241 | 역사적 발생 횟수 | 📋 static |
| 242 | 미니 플로우 (Top 5) | 📋 static |

---

## 12. AI 투자 전략 리포트 (`/report`) ← 전면 재설계

모든 탭 데이터 → AI 종합 → 실제 투자 전략 & 포트폴리오 생성. `/api/investment-strategy` (24h CDN, 23h 메모리 캐시).

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 12-S1 | 투자 스탠스 (bullish/neutral/bearish) | 💾 cached | `/api/investment-strategy` (GROQ/Gemini) |
| 12-S2 | AI 투자 thesis (한 줄 전략) | 💾 cached | AI 생성 (locale-aware) |
| 12-S3 | 거시경제 분석 텍스트 | 💾 cached | AI 생성 (locale-aware) |
| 12-S4 | 기술적 분석 텍스트 | 💾 cached | AI 생성 (locale-aware) |
| 12-S5 | 기본적 분석 텍스트 | 💾 cached | AI 생성 (locale-aware) |
| 12-P1 | AI 추천 포트폴리오 (5종목, 비중%) | 💾 cached | AI 생성 (locale-aware) |
| 12-P2 | 종목별 진입 구간 | 💾 cached | AI 생성 |
| 12-P3 | 종목별 손절가 | 💾 cached | AI 생성 |
| 12-P4 | 종목별 목표가 | 💾 cached | AI 생성 |
| 12-P5 | 종목별 확신도 (high/medium/low) | 💾 cached | AI 생성 |
| 12-P6 | 종목별 매수 액션 (buy/hold/watch) | 💾 cached | AI 생성 ← iter210 |
| 12-A1 | 섹터 배분 (비중확대/중립/비중축소) | 💾 cached | AI 생성 |
| 12-R1 | 주요 리스크 이벤트 목록 | 💾 cached | AI 생성 |
| 12-K1 | KPI: F&G (US) | 💾 cached | `/api/fear-greed` (CNN 4h) |
| 12-K2 | KPI: SPY 1w 수익률 + sparkline | 💾 cached | `/api/capital-flows` |
| 12-K3 | KPI: 10Y-2Y 스프레드 bp | 💾 cached | `/api/yield-curve` |
| 12-K4 | KPI: VIX 레벨 | 💾 cached | `/api/volatility` |
| 12-K5 | KPI: 다음 FOMC 인하 확률 | 💾 cached | `/api/fedwatch` |
| 12-M1 | 메타: 소스 배지 (GROQ/Gemini/Fallback) | ✅ live | investment-strategy.source |
| 12-M2 | 메타: 신선도 점 + humanized age | ✅ live | generatedAt diff |
| 12-M3 | 리스크 레벨 (low/medium/high) | 💾 cached | AI 판단 |
| 12-M4 | 데이터 기준 시각 (dataAsOf) | ✅ live | 시장 데이터 수집 시각 ← iter210 |
| 12-B1 | 지금 매수 추천 종목 스트립 (action=buy) | 💾 cached | 포트폴리오 액션 필드 ← iter210 |
| 12-G1 | entryRationale 펀더멘탈+구루 근거 포함 여부 | 💾 cached | guru-methodologies 프롬프트 주입 ← iter267 |
| 12-G2 | targetRationale 밸류에이션 앵커 포함 여부 | 💾 cached | guru-methodologies 프롬프트 주입 ← iter267 |

---

## 13. 비교 분석 (`/compare`)

| # | 지표 | 상태 |
|---|------|------|
| 243 | 티커 셀렉터 (A vs B) | ✅ live | 사용자 입력 |
| 244 | 퀵 요약: 시가총액·역할 | 📋 static |
| 245 | 퀵 요약: 갭 스코어 (승자 강조) | 💾 cached | AV |
| 246 | 퀵 요약: IB 활동 | 💾 cached | AV |
| 247 | 매출 믹스 차트 (Top 5, 양사) | 📋 static |
| 248 | 컬럼별 헤더·About·매출·신호·캐스케이드·관계사 | 📋 static + 💾 cached 혼합 |
| 248-L | 컬럼별 라이브 주가·등락률 (각 ticker) | ✅ live | Yahoo Finance `/api/stock-price` |
| 249 | 인기 비교 쌍 링크 | 📋 static |

---

## 14. OSINT (`/osint`)

### 14-1. 탭: 소셜 (`social`)

| # | 지표 | 상태 |
|---|------|------|
| 250 | 인물 목록 (Fed Members + 공인) | 📋 static + API |
| 251 | 발언 제목·요약 | 💾 cached |
| 252 | 감성 배지 (Hawkish/Dovish/Bullish/Bearish/Neutral) | 💾 cached |
| 253 | 영향도 배지 (HIGH/MEDIUM/LOW) | 💾 cached |
| 254 | 캐스케이드 필 | 💾 cached |
| 255 | 소스 아이콘 (X/Newspaper) + 날짜 | 💾 cached |

### 14-2. 탭: 크립토 (`crypto`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 256 | 주목 지갑 5개 (잔고·TX·리스크) | 💾 cached | Blockchain.info/Etherscan |
| 257 | 직접 분석: 잔고·총수신·총송신·TX 수 | ✅ live | on-demand |
| 258 | 리스크 플래그 | ✅ live | 자체판단 |
| 259 | 최근 TX 테이블 (해시·시간·금액·방향) | ✅ live | on-demand |

### 14-3. 탭: 제재 (`sanctions`)

| # | 지표 | 상태 |
|---|------|------|
| 260 | 총 엔트리 수 | 💾 cached | OFAC SDN |
| 261 | 그룹별 (Russia·Iran·DPRK·SDGT·Cyber·China) | 💾 cached | |
| 262 | 엔트리 상세 (이름·유형·프로그램·비고) | 💾 cached | |

### 14-4. 탭: 기업 (`corporate`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 263 | 프리셋 쿼리 결과 (4개) | 💾 cached | OpenCorporates |
| 264 | 직접 검색 결과 카드 | ✅ live | on-demand |

### 14-5. 탭: 가이드 (`guide`)

| # | 지표 | 상태 |
|---|------|------|
| 265 | 가이드 6개 카드 | 📋 static |

---

## 15. 백엔드 헬스 (`/admin/health`)

### 15-1. Deploy

| # | 지표 | 상태 |
|---|------|------|
| 266 | 커밋 SHA | ✅ live |
| 267 | 브랜치 | ✅ live |
| 268 | 배포 ID | ✅ live |
| 269 | 리전 | ✅ live |
| 270 | env | ✅ live |
| 271 | Node version | ✅ live |

### 15-2. Paid APIs (설정 여부)

| # | API | 상태 |
|---|-----|------|
| 272 | UnusualWhales | ✅ live |
| 273 | Polygon | ✅ live |
| 274 | TwelveData | ✅ live |
| 275 | Gemini | ✅ live |
| 276 | Alpha Vantage | ✅ live |
| 277 | vLLM | ✅ live |

### 15-3. 트래킹 캐시 키 (16개)

| # | 캐시 키 | 상태 |
|---|---------|------|
| 278 | insider-trades:v1 | ✅ live |
| 279 | ownership-alerts:v1 | ✅ live |
| 280 | nport-holdings:v1 | ✅ live |
| 281 | options-flow:v1 | ✅ live |
| 282 | block-trades:v1 | ✅ live |
| 283 | korea-flow:v2 | ✅ live |
| 284 | short-interest:v4 | ✅ live |
| 285 | market-caps:v2 | ✅ live |
| 286 | fg:v5:SPY | ✅ live |
| 287 | 13f-signals:v1 | ✅ live |
| 288 | capital-flows:v10:yahoo | ✅ live |
| 289 | capital-flows:v10:twelve | ✅ live |
| 290 | macro-indicators:v13:$(date) | ✅ live |
| 291 | fedwatch:v1:$(hour) | ✅ live |
| 292 | credit-balance:v2:$(date) | ✅ live |
| 293 | latest-updates:v3 | ✅ live |

### 15-4. 로그 버퍼

| # | 지표 | 상태 |
|---|------|------|
| 294 | error count (최근 500건) | ✅ live |
| 295 | warn count | ✅ live |
| 296 | 버퍼 oldest 타임스탬프 | ✅ live |

### 15-5a. AI 체인 헬스 모니터링 (2026-04-22)

`/api/cron/verify-metrics` 매 30분 cron이 AI 제공자를 순서대로 reachability probe.

| # | 지표 | 상태 | 주기 | 비고 |
|---|------|------|------|------|
| 295a | vLLM EXAONE 로컬 reachability | 🔄 cron | 30m | `${VLLM_URL}/v1/models` ping. 터널 죽으면 즉시 error |
| 295b | GROQ llama-3.3-70b reachability | 🔄 cron | 30m | `/v1/models` ping. 429 감지 (quota 소진) |
| 295c | Gemini API 키 설정 | 🔄 cron | 30m | 비용 방지로 실제 추론 호출은 안 함 |

### 15-5. Metrics Status (2026-04-21)

30분 크론 `/api/cron/verify-metrics` 가 사이트 전체 수치를 순회 probe 해서
개별 상태를 `flowvium:metrics-health:v1` 에 저장. `/admin/logs` 페이지 상단에
색상 카드로 표시. "Verify now" 버튼으로 즉시 재검증 가능.

| # | 지표 | 상태 | 비고 |
|---|------|------|------|
| 296a | 전체 수치 요약 (ok/degraded/error/total) | 🔄 cron | 30분 주기 |
| 296b | 그룹별 드릴다운 (fear-greed · capital-flows · macro · short-interest · heatmap · market-caps · sector-pe · yield-curve · fedwatch · cot · korea-flow · additional · earnings · cache · accuracy · volatility · commodity · brief · flow-analysis · yield-curve-hist · company-news · stock-price) | 🔄 cron | iter84 +5그룹 |
| 296c | 개별 지표 상태 (255+ 지표, 21개 그룹) | 🔄 cron | ✕ 먼저 정렬 ← iter84: 250→255+ 확장 |
| 296d | 각 지표 value + source 표시 | 🔄 cron | tooltip에 details JSON |
| 296e | 수동 즉시 검증 버튼 | ✅ live | /api/cron/verify-metrics 직접 호출 |
| 296f | F&G dataQuality 필드 노출 (full/partial/insufficient) | ✅ live | #98~100 관련 |
| 296g | F&G degradedFactors 필드 (rsi/sma/vol 부족 감지) | ✅ live | price<15 / <55 / <125 경고 |
| 296h | fg.asset.* `no_native_index` 단독이면 ok 승격 | ✅ live | 자산 카테고리(gold/defense/tech 등 10개)는 원지수 부재가 설계상 기본값. partial 오분류 방지 |
| 296i | korea-flow 거래일 폴백 (최대 7일 역스캔) | ✅ live | 장 전/주말/공휴일에도 최근 trading day 데이터 반환 |
| 296j | ownership-alerts in-memory cache (Redis-less 환경) | ✅ live | warm instance 내 2h TTL, EDGAR 10분 빈 윈도우에도 snapshot 유지 |
| 296k | daily-brief MEMORY_CACHE fallback 저장 차단 | ✅ live | source==='data' 인 fallback brief 는 캐시하지 않아 다음 요청에 AI 재시도 (10min 저품질 연쇄 방지) |
| 296l | daily-brief HTTP ctx: short-interest + news-cascade 추가 | ✅ live | Redis 없을 때 12 엔드포인트 병렬 fetch — 기존 10 → 12 (short/cascade 커버) |
| 296m | market-heatmap memory cache fallback | ✅ live | Redis-less 10min TTL per-country — 3.5s → <50ms on warm hit |
| 296n | short-interest memory cache fallback | ✅ live | Redis-less 30min TTL — 1.9s → <30ms on warm hit |
| 296o | @/lib/memory-cache 공용 유틸 | ✅ live | FIFO eviction(max 50) + namespaced logger, 엔드포인트별 TTL 지정 |
| 296p | verify-metrics `skipped` status 신설 | ✅ live | optional cascade stage(vllm), 미설정 유료 키(gemini) 는 degraded 대신 skipped — overallStatus 영향 없음 |
| 296q | ai.vllm 미응답 → `skipped` 분류 | ✅ live | 로컬 Cloudflare tunnel 다운은 product 고장 아님 (GROQ 70b/8b 로 cascade) |
| 296r | ai.gemini 미설정 → `skipped` 분류 | ✅ live | 유료 최종 폴백 선택 사항 — 앞 3단계 중 하나만 동작해도 AI 정상 |
| 296s | AdminLogsPage `skipped` 렌더 | ✅ live | 회색 ◌ 아이콘, opacity 60%, skipReason tooltip — 시각적으로 "무시" 명확화 |
| 296t | /api/price-history (Stooq daily) | ✅ live | 가격 시계열 — ticker+days 파라미터, Redis 1h + memory 30min |
| 296u | /report SPY 30일 sparkline | ✅ live | KPI pill 인라인 SVG polyline, 색상(상승 emerald/하락 red), 값+추세 동시 표시 |
| 296v | @/components/Sparkline | ✅ live | deps-free 범용 컴포넌트 — values/width/height prop, 재사용 준비 완료 |
| 296w | verify-metrics `market.priceHistory` probe | ✅ live | /api/price-history 반환 points ≥10 확인 |
| 296x | Yahoo v8 chart 소스 전환 (Stooq deprecated) | ✅ live | Stooq /q/d/l/ captcha화 → Yahoo v8 chart (UA-only gate). Vercel 도달성 실측 완료 |
| 296y | VIX sparkline + 자동 1w% 계산 | ✅ live | ^VIX 30d 종가로 VIX pill 값+추세 동시 산출 (capital-flows 에 VIX 미존재 회피) |
| 296z | ticker sanitizer `^`/`.` 허용 | ✅ live | 인덱스 심볼(^VIX, ^GSPC), 접미사 점(.TO) 지원 |
| 297a | news-cascade 한자 혼입 가드 | ✅ live | GROQ 70b 한국어 응답에 중국어 Hanzi(U+4E00~9FFF) 12%+ 혼입 — 시스템 프롬프트 language lock + post-parse hasChineseLeak() 감지 시 title 로 대체 |
| 297b | accuracy.cpi — FRED CPIAUCSL YoY 대조 | 🔄 cron | ±0.2pp 허용, 초과 시 degraded/error, iter67 (static 2.4%=Feb2026, live FRED=March2026 3.3% 정확) |
| 297c | accuracy.ppi — FRED WPSFD49207(최종수요) YoY 대조 | 🔄 cron | ±0.2pp 허용, iter67→iter79 PPIACO→WPSFD49207 수정 |
| 297d | accuracy.fomc — FRED DFEDTARU/L 금리 대조 | 🔄 cron | ±0.25pp 허용 (iter68 조정), iter67 |
| 297e | accuracy.gdp — FRED A191RL1Q225SBEA QoQ SAAR 대조 | 🔄 cron | ±0.5pp 허용 (advance 수정 여지), 당해연도 미공개 시 skipped, iter76 |
| 297f | daily-brief fallback: IG/HY OAS 신용 스프레드 표시 | ✅ live | AI 없을 때 capital 섹션에 IG OAS / HY OAS 실값 추가 (iter231) |
| 297g | daily-brief fallback: VIX + regime 표시 | ✅ live | AI 없을 때 market 섹션에 VIX 수치 + low/elevated/high regime 레이블 (iter231) |
| 297h | daily-brief fallback: CPI YoY 표시 | ✅ live | AI 없을 때 capital 섹션에 CPI%YoY + miss/beat 서프라이즈 (iter231) |
| 297i | daily-brief 섹터명 한국어→영문 변환 | ✅ live | SECTOR_EN 역매핑으로 정보기술→Tech 등 11개 섹터 영문 표기 (전 언어 버전 정상화, iter231) |

---

## 15b. 위성 공급망 추적 (`/satellite`) ← 신규 2026-05-08

| # | 지표 | 상태 | 소스 | 주기 |
|---|------|------|------|------|
| SAT-1 | 공장별 활동 지수 (0~100) | 🔄 cron | Sentinel-2 L2A + Claude/Gemini Vision | 수동 scan:satellite 실행 시 |
| SAT-2 | 차량 밀도 (low/medium/high) | 🔄 cron | Claude/Gemini Vision | 스캔 시 |
| SAT-3 | 하역 활동 (inactive/normal/busy) | 🔄 cron | Claude/Gemini Vision | 스캔 시 |
| SAT-4 | 구름 피복 (clear/partial/heavy) | 🔄 cron | Sentinel-2 메타 | 스캔 시 |
| SAT-5 | 신규 공사 가시 여부 | 🔄 cron | Claude/Gemini Vision | 스캔 시 |
| SAT-6 | AI 요약 텍스트 | 🔄 cron | Claude/Gemini | 스캔 시 |
| SAT-7 | 이미지 날짜 (Sentinel-2 촬영일) | 🔄 cron | STAC API | 스캔 시 |
| SAT-8 | 베이스라인 점수 (최근 3~6회 평균) | 🔄 cron | Redis 히스토리 | 스캔 누적 시 |
| SAT-9 | deltaFromBaseline (현재 - 베이스라인) | 🔄 cron | 자체계산 | 스캔 누적 시 |
| SAT-10 | zScore (표준편차 기준 이상치) | 🔄 cron | 자체계산 | 스캔 누적 시 |
| SAT-11 | 모니터링 공장 수 | 📋 static | 12개 (factory-locations.ts) | — |
| SAT-12 | 활발한 공장 수 (점수 ≥70) | 🔄 cron | 집계 | 스캔 시 |
| SAT-13 | 핵심 시설 수 (significance=critical) | 📋 static | 5개 (TSMC×2·삼성×1·SK하이닉스·Micron) | — |
| SAT-14 | 공급망 신호 자동 주입 (delta≥±15 또는 절대≥80/≤20) | 🔄 cron | supply-chain-signals satellite source | 스캔 시 |
| SAT-15 | Sentinel-2 위성사진 PNG 썸네일 (공장별) | 🔄 cron | Redis base64 → `/api/satellite-image` | 스캔 시 (7일 TTL) |

**Redis 키**: `flowvium:satellite:v1:{YYYY-MM-DD}` (공장 배열), `flowvium:satellite:img:{id}` (base64 PNG, 7일), `flowvium:satellite:history:{id}` (LPUSH 최대 10), `flowvium:satellite:last-image:{id}` (중복 방지)

---

## 16. 블룸버그 갭 (미구현)

우선순위 순서.

### 16-1. 기업 재무 심화 — ✅ 완료 (2026-04-24)

`/api/company-financials/` + `CompanyPage` 재무 심화 카드. SEC XBRL 18/19 지표 live.
→ 체크리스트 #152~169 ✅ live, #170 (분기 Y/Y) 다음 iter

### 16-2. 금리 커브 차트 — ✅ 완료 (2026-04-24)

`/api/yield-curve` + `YieldCurveCard` in ReportPage.

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 297 | 실시간 수익률 곡선 (1M→30Y) | ✅ live | FRED CSV (`cosd/coed` param) |
| 298 | 1주/1개월/3개월 전 곡선 오버레이 | ✅ live | FRED 시계열 |
| 299 | 2s10s 스프레드 시계열 (90일) | ✅ live | FRED 파생 |
| 300 | 3m10y 스프레드 시계열 (90일) | ✅ live | FRED 파생 |
| 301 | TIPS 실질금리 곡선 (5Y~30Y, 5종) | ✅ live | FRED CSV (DFII5/7/10/20/30) |
| 302 | Breakeven 인플레이션 (5Y/10Y 90일) | ✅ live | FRED CSV (T5YIE, T10YIE) |

### 16-3. 실적 캘린더 — ✅ 완료 (2026-04-22)

Finnhub 무료 티어 연동, `/earnings` 페이지 신설. 블룸버그 EE 대응.

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 303 | 이번주 발표 예정 티커 | 💾 cached | Finnhub (2h) — KST 날짜 기준 (iter78 수정) |
| 303-N | 기업 공식명 | ✅ live | 하드코딩 맵 (~180종목) + Finnhub profile2 (7d Redis 캐시) |
| 304 | EPS 컨센서스 | 💾 cached | Finnhub |
| 305 | 매출 컨센서스 | 💾 cached | Finnhub |
| 306 | 과거 Surprise 이력 | 💾 cached | Finnhub (epsSurprise %, ±999 cap, null when \|est\|<0.01) |
| 307 | 발표 시간 (장전/장중/장후) | 💾 cached | Finnhub hour field |

### 16-4. 워치리스트 + 알림 — 4순위

| # | 지표 | 상태 |
|---|------|------|
| 308 | 사용자 커스텀 종목 리스트 | ✅ live | localStorage + /api/stock-price per ticker, 30개 제한, 5분 자동갱신 |
| 309 | Discord 웹훅 알림 | 🔄 cron | `/api/cron/send-alerts` 4h 주기, `DISCORD_WEBHOOK_URL` env 설정 필요 |
| 310 | 알림 조건 (F&G ≤25/≥75, VIX ≥25/≥30) | 🔄 cron | 24h 쿨다운, 타입별 cooldown 키 Redis 저장 |

### 16-5. 실시간 WebSocket — 5순위 (블룸버그 QM)

| # | 지표 | 상태 |
|---|------|------|
| 311 | 실시간 주가 스트리밍 | ⛔ missing | 🔒 Polygon Starter |
| 312 | 실시간 호가 스프레드 | ⛔ missing | Yahoo v8 bid/ask=undefined (chart 엔드포인트 미지원) |
| 313 | 실시간 거래량 | ✅ live | Yahoo v8 meta.regularMarketVolume — CompanyPage 표시 (iter122) |
| 320 | 관련주 추천 5개 (주가·등락%) | ✅ live | Yahoo v6 recommendationsbysymbol + v7 quote — CompanyPage 사이드바 (iter125) |

### 16-6. 기타 갭

| # | 지표 | 상태 | 참고 블룸버그 |
|---|------|------|--------------|
| 314 | ETF 순유입 절대금액 | 🔒 locked | ETF.com Cloudflare 차단, Yahoo v8 미지원 — 유료 필요 |
| 315 | 섹터별 ETF 순유입 | ✅ live | XLK/XLF/XLE/XLV/XLI/XLB/XLY/XLP/XLU/XLRE/XLC Yahoo (방향 근사) |
| 316 | 원자재 커브 (컨탱고/백워데이션) | ✅ live | CL=F/CLx.NYM + GC=F/GCx.CMX Yahoo Finance (WTI 7개월 + Gold 5개월) |
| 317 | VIX 기간 구조 (9일/30일/6개월) | ✅ live | CBOE indices via Yahoo Finance (^VXST/^VIX/^VXMT) |
| 318 | 변동성 곡면 (Vol Surface) | ⛔ missing | 🔒 |
| 319 | IV Rank/Percentile | ⛔ missing | 🔒 |
| 320 | 섹터 ETF 가격·등락률·YTD·52주 범위 | ✅ live | Yahoo Finance v8 (no auth), SPDR ETFs, 4h Redis |
| 320b | 섹터 ETF trailingPE·dividendYield·totalAssets·beta3Year | ✅ live | Yahoo Finance v10 crumb (정적 폴백 2026-04-25), 4h Redis |
| 321 | Smart Beta 팩터 (Quality·Momentum·Value) | ✅ live | MTUM/QUAL/VLUE/USMV/IVW/IVE Yahoo |
| 322 | 기업 뉴스 AI 요약 (종목별 전용) | ✅ live | Yahoo Finance v1 JSON API + GROQ→Gemini AI, /api/company-news, Redis 2h |
| 323 | 경제지표 발표 캘린더 (이벤트명·날짜·임박 D-N) | 💾 cached | Finnhub /calendar/economic — EconCalendarSection, Redis 4h (iter131) |
| 327 | 경제지표 실제값 (actual vs estimate vs prev) | 💾 cached | Finnhub /calendar/economic — 발표 후 값 자동 표시, Redis 4h (iter131) |
| 324 | 애널리스트 목표가 (평균·고·저) | ✅ live | Finnhub /stock/price-target — CompanyPage 사이드바 (iter128) |
| 325 | 애널리스트 매수/중립/매도 비율 | ✅ live | Finnhub /stock/recommendation — CompanyPage 사이드바 (iter128) |
| 326 | 상승 여력 % (목표가 vs 현재가) | ✅ live | 계산값 (목표가 / 현재가 - 1) — CompanyPage 사이드바 (iter128) |
| 328 | 홈 Top 5 급등주 (당일 등락%) | ✅ live | Yahoo Finance v7 batch — TopMoversWidget (iter136) |
| 329 | 홈 Top 5 급락주 (당일 등락%) | ✅ live | Yahoo Finance v7 batch — TopMoversWidget (iter136) |
| 330 | 시장 Breadth (상승/하락 종목 수, S&P500 50개 기준) | ✅ live | /api/market-movers advancers/decliners — MarketSnapshot BREADTH 배지 (iter139) |

---

## 17. API 엔드포인트 전체 목록 (2026-04-24 기준)

> `src/app/api/` 하위 전체 route.ts 목록. 상태=엔드포인트 자체 정상 여부.

| # | 경로 | 목적 | 상태 | 소스 | 캐시 TTL |
|---|------|------|------|------|----------|
| E1 | `/api/fear-greed` | 공포탐욕지수 (11개국 + 9개 자산) | ✅ live | CNN + composite | Redis 4h |
| E2 | `/api/capital-flows` | ETF 자금흐름 (ret1w/4w/13w) | ✅ live | Twelve Data → Yahoo v7 spark batch → Finnhub candle 3단계 폴백 | Redis 4h |
| E3 | `/api/macro-indicators` | 거시경제 지표 (CPI/PCE/NFP 등) | 💾 cached | Finnhub macro events | Redis 6h |
| E4 | `/api/fedwatch` | CME FedWatch 금리 확률 | ✅ live | CME Group 파싱 | Redis 1h |
| E5 | `/api/credit-balance` | 신용잔고 7개국 | 💾 cached | 정적+FRED 혼합 | Redis 12h |
| E6 | `/api/news-cascade` | AI 뉴스 cascade분석 Bloomberg/WSJ/SA RSS | 💾 cached | Bloomberg+WSJ+SA RSS → GROQ 70b | Redis 12h(AI 있음)/1h(AI 없음) list+24h article |
| E7 | `/api/signals` | 기관 신호 13F 매집/청산 | 💾 cached | SEC EDGAR 13F | Redis 7d |
| E8 | `/api/insider-trades` | 내부자 Form 4 매집 | ✅ live | SEC EDGAR RSS | Redis 30min |
| E9 | `/api/ownership-alerts` | 13D/13G 대량보유 알림 | ✅ live | SEC EDGAR RSS | Redis 2h |
| E10 | `/api/nport-holdings` | N-PORT 뮤추얼펀드 보유 | 💾 cached | SEC EDGAR | Redis 6h |
| E11 | `/api/korea-flow` | 한국 외국인·기관 수급 (KRX) | 💾 cached | KRX 차단 공식 포기(iter140) — Yahoo fallback 영구 운용, 순매수액 컬럼 숨김 | Redis 15min |
| E12 | `/api/short-interest` | FINRA 일별 shortVolPct + EDGAR 13F squeezeScore + Finnhub P/E | 💾 cached | FINRA CNMSshvol + EDGAR 13F + Finnhub | Redis 4h (v4) |
| E13 | `/api/market-heatmap` | 시장 트리맵 (7개국) — EU 79/80 (98%) | 💾 cached | iShares CSV + Stooq + Yahoo v8 | Redis 15min |
| E14 | `/api/market-caps` | 시가총액 band 분류 (live caps 불가) | 📋 static | allCompanies 정적 bands | Redis 24h |
| E15 | `/api/price-history` | 가격 시계열 (30d sparkline) | ✅ live | Yahoo Finance v8 chart | Redis 1h |
| E16 | `/api/earnings` | 실적 캘린더 (기업명+KST날짜) | 💾 cached | Finnhub + profile2 | Redis 2h (v2) |
| E16-MDB | `/api/admin/metrics-db` | Metrics DB — per-metric 최신값+updatedAt | ✅ live | Redis hash `flowvium:mdb:v1` | 72h TTL |
| E17 | `/api/daily-brief` | AI 데일리 브리프 조회 | 🔄 cron | vLLM→GROQ cascade | Redis (cron 갱신) |
| E18 | `/api/latest-updates` | 홈 LiveFeed 집계 | ✅ live | 다수 엔드포인트 집계 | Redis 30min |
| E19 | `/api/flow-analysis` | 자금흐름 심층분석 | 💾 cached | capital-flows 파생 | Redis 8h |
| E20 | `/api/stock-supply` | 개별주 수급 (ticker별) | ✅ live | Yahoo v8 + EDGAR Form 4 | Redis 2h |
| E21 | `/api/company-financials/[ticker]` | 기업 재무제표 (SEC XBRL, 미국) | ✅ live | SEC EDGAR XBRL | Redis 24h |
| E36 | `/api/company-kr/[ticker]` | 한국 기업 재무제표 (DART, KOSPI/KOSDAQ) | ✅ live | DART OpenAPI fnlttSinglAcntAll | Redis 24h |
| E37 | `/api/company-kr/list` | KOSPI 200 + KOSDAQ 150 기업 목록 | ✅ live | DART CORPCODE.xml + company.json | Redis 7일 |
| E35 | `/api/sector-pe` | 섹터별 ETF P/E·배당수익률·YTD·52w (11개 SPDR) | ✅ live | Yahoo v8(가격/YTD) + v10 crumb(P/E·배당·자산·베타) | Redis 4h |
| E24 | `/api/yield-curve` | 미국 국채 수익률 커브 (9개 만기 + TIPS + BEI) | ✅ live | FRED CSV (무료) | Redis 1h |
| E31 | `/api/volatility` | VIX 기간 구조 (VXST/VIX/VXMT/VVIX) + 90일 이력 | ✅ live | Yahoo Finance chart + CBOE CDN 폴백 (Yahoo 차단 시 자동) | Redis 30min |
| E22 | `/api/block-trades` | 블록거래 | 🔒 locked | Polygon.io 키 필요 (donation-gate) | 5min |
| E23 | `/api/options-flow` | 옵션 플로우 | 🔒 locked | 유료 API 필요 | — |
| E24 | `/api/osint/corporate` | 기업 OSINT | ✅ live | public web | no-store |
| E25 | `/api/osint/crypto` | 암호화폐 OSINT | ✅ live | public web | no-store |
| E26 | `/api/osint/sanctions` | 제재 명단 조회 | ✅ live | OFAC 등 | no-store |
| E27 | `/api/osint/social` | 소셜미디어 OSINT | ✅ live | public RSS/scrape | no-store |
| E28 | `/api/translate` | AI 번역 (vLLM→GROQ→Qwen→Gemini cascade) | ✅ live | GROQ 8b / Qwen 2.5 72B / Gemini | no-store |
| E29 | `/api/ai` | AI 생성 (inline) | ✅ live | vLLM→GROQ cascade | no-store |
| E30 | `/api/collect` | 데이터 수집 수동 트리거 | ✅ live | 내부 | — |
| E31 | `/api/cron/daily-brief` | 데일리 브리프 생성 크론 | 🔄 cron | vLLM→GROQ | 3×/day |
| E32 | `/api/cron/update-all` | 전체 캐시 갱신 크론 (07:50/15:50/21:20 KST) | 🔄 cron | 내부 | 3×/day |
| E33 | `/api/cron/update-credit-balance` | 신용잔고 갱신 크론 | 🔄 cron | FRED | 1×/day |
| E34 | `/api/cron/update-signals` | 기관신호 갱신 크론 | 🔄 cron | SEC EDGAR | 1×/day |
| E35 | `/api/cron/verify-metrics` | 전체 헬스 프로브 | ✅ live | 모든 엔드포인트 | no-store |
| E36 | `/api/admin/health` | 서버 헬스 체크 | ✅ live | 시스템 | no-store |
| E37 | `/api/admin/logs` | 서버 로그 조회 | ✅ live | Redis logs | no-store |
| E38 | `/api/admin/metrics-health` | verify-metrics 결과 표시 | ✅ live | cron 결과 | no-store |
| E39 | `/api/stock-price/[ticker]` | 실시간 주가·일간 변화 | ✅ live | Yahoo Finance v8 | 15min mem |
| E40 | `/api/commodity-curve` | WTI/Gold 선물 커브 (컨탱고/백워데이션) | ✅ live | Yahoo v8 futures → FRED+carry모델 폴백 (6pt) ← iter211 | 30min mem |
| E41 | `/api/company-news` | 종목별 최신 뉴스 + AI 요약 | ✅ live | Yahoo Finance v1 JSON API (type=STORY) + GROQ→Gemini | Redis 30min |
| E42 | `/api/cot-positions` | CFTC COT 투기세력 포지셔닝 (7개 시장) | 💾 cached | CFTC FinFutWk.txt | Redis 4h |
| E43 | `/api/cron/evaluate-signals` | 로테이션 신호 정확도 평가 크론 | 🔄 cron | Yahoo Finance (실제 수익률) | 1×/week (일요일 03:00 UTC) |
| E44 | `/api/cron/signal-retrospective` | AI 신호 회고 생성 크론 | 🔄 cron | callAI cascade (Claude→GROQ→Gemini) | 1×/week (일요일 03:30 UTC) |
| E45 | `/api/signal-retrospective` | AI 신호 회고 조회 | 💾 cached | Redis `signal-retrospective:v1` | Redis 14일 |

**총 API 라우트: 45개** (크론 7 + 어드민 3 + 공개 35)

---

## 요약 통계

| 상태 | 개수 |
|------|------|
| ✅ live | ~102 |
| 💾 cached | ~181 |
| 🔄 cron | ~20 |
| 📋 static | ~46 |
| ⛔ missing | ~5 |
| 🔒 locked | ~5 |
| **총 추적 지표** | **336** |

**live + cached + cron 활성**: ~312개 (92.9%)
**미구현 갭**: ~10개 (3.1%)

---


---

## 19. 가상계좌 (Paper Trading)

| # | 지표 | 상태 | 소스 | 주기 |
|---|------|------|------|------|
| 1 | 총 자산 (cash + positions) | ✅ live | Redis  | 리포트 생성 시 |
| 2 | 현금 잔액 | ✅ live | Redis | 리포트 생성 시 |
| 3 | 포지션 가치 합계 | ✅ live | Yahoo Finance 현재가 | 리포트 생성 시 |
| 4 | 총 수익률 (vs 00K 시드) | ✅ live | 계산값 | 리포트 생성 시 |
| 5 | 보유 포지션 목록 | 💾 cached | Redis | 리포트 생성 시 |
| 6 | 미실현 손익 (포지션별) | ✅ live | Yahoo Finance | 리포트 생성 시 |
| 7 | 거래 내역 (최근 200건) | 💾 cached | Redis  | 리포트 생성 시 |
| 8 | 실현 손익 (거래별) | 💾 cached | Redis | 거래 시 |
| 9 | 일별 자산 스냅샷 (최근 365일) | 💾 cached | Redis  | 리포트 생성 시 |
| 10 | stop-loss 자동 청산 | ✅ live | Yahoo Finance + 크론 | check-stops 호출 시 |
| 11 | target 자동 청산 | ✅ live | Yahoo Finance + 크론 | check-stops 호출 시 |
| 12 | 처리된 리포트 수 | 💾 cached | Redis | 리포트 생성 시 |


## 20. 섹터 지표 live overlay (CompanyPage)

| # | 지표 | 상태 | 소스 | 주기 |
|---|------|------|------|------|
| 1 | WTI 유가 (CL=F) | ✅ live | Yahoo Finance v8 | 6h Redis |
| 2 | 10년물 국채금리 (^TNX) | ✅ live | Yahoo Finance v8 | 6h Redis |
| 3 | Henry Hub 천연가스 (MHHNGSP) | 💾 cached | FRED CSV | 6h Redis (월간 지표) |
| 4 | 신용카드 연체율 (DRCCLACBS) | 💾 cached | FRED CSV | 6h Redis (분기 지표) |
| 5 | Fed Funds Rate (DFEDTARU) | 💾 cached | FRED CSV | 6h Redis |
| 6 | ISM PMI | 💾 cached | Redis macro-indicators 캐시 재사용 | 6h Redis |

## 21. Cascade AI 자동 이벤트 로그

| # | 지표 | 상태 | 소스 | 주기 |
|---|------|------|------|------|
| 1 | cascade 이벤트 (리더 주간 ±10%+ 탐지) | 🔄 cron | Yahoo Finance 10d + AI 체인 설명 | 매주 일요일 01:00 UTC |
| 2 | 이벤트 설명 (한국어 ≤200자) | 🔄 cron | callAI (vLLM→GROQ→Qwen→Gemini) | 크론 실행 시 |
| 3 | CascadeDetailPage AI 이벤트 표시 | ✅ live | Redis `flowvium:cascade:events:v1` | 요청 시 |

## 유지 가이드

- 새 지표 추가 시: 해당 섹션 하단에 다음 번호로 행 추가
- 상태 변경 시: 상태 배지만 변경 (번호·소스는 유지)
- 지표 제거 시: 해당 행 삭제 + 요약 통계 조정
- `FEATURES.md`의 기능 섹션과 1:1 대응되도록 유지
- 블룸버그 갭 해소 시: 16번 섹션에서 해당 행 제거 + 해당 페이지 섹션에 추가

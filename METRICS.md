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
| 23 | SPY (S&P 500) 1w/4w/13w 수익률 | 💾 cached | Twelve→Yahoo |
| 24 | QQQ (Nasdaq) 1w/4w/13w | 💾 cached | Twelve→Yahoo |
| 25 | IWM (Russell 2000) 1w/4w/13w | 💾 cached | Twelve→Yahoo |
| 26 | EFA (개도국 제외 선진국) | 💾 cached | Twelve→Yahoo |
| 27 | EEM (이머징 주식) | 💾 cached | Twelve→Yahoo |
| 28 | TLT (장기국채) | 💾 cached | Twelve→Yahoo |
| 29 | IEF (중기국채) | 💾 cached | Twelve→Yahoo |
| 30 | LQD (투자등급회사채) | 💾 cached | Twelve→Yahoo |
| 31 | HYG (하이일드) | 💾 cached | Twelve→Yahoo |
| 32 | EMB (이머징 채권) | 💾 cached | Twelve→Yahoo |
| 33 | TIP (물가연동채) | 💾 cached | Twelve→Yahoo |
| 34 | GLD (금) | 💾 cached | Twelve→Yahoo |
| 35 | SLV (은) | 💾 cached | Twelve→Yahoo |
| 36 | USO (WTI 원유) | 💾 cached | Twelve→Yahoo |
| 37 | DBC (원자재) | 💾 cached | Twelve→Yahoo |
| 38 | UUP (달러) | 💾 cached | Twelve→Yahoo |
| 39 | BTC (비트코인) | 💾 cached | Twelve→Yahoo |
| 40 | ETH (이더리움) | 💾 cached | Twelve→Yahoo |
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
| 75 | 10Y-2Y 스프레드 | 💾 cached | 자체계산 |
| 76 | 역전 여부 | 💾 cached | 자체계산 |

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

**매크로 지표 카드 (9개)**

| # | 지표 | 상태 | 필드 |
|---|------|------|------|
| 85 | CPI (실제·예상·이전·Surprise) | 💾 cached | 4필드 + 레이블 |
| 86 | PCE Core | 💾 cached | 4필드 |
| 87 | NFP (비농업 고용) | 💾 cached | 4필드 |
| 88 | FOMC 결정 | 💾 cached | 4필드 |
| 89 | GDP | 💾 cached | 4필드 |
| 90 | ISM PMI | 💾 cached | 4필드 |
| 91 | 소매판매 | 💾 cached | 4필드 |
| 92 | PPI | 💾 cached | 4필드 |
| 93 | 실업률 | 💾 cached | 4필드 |
| 94 | 각 지표 매파/비둘기 영향 | 💾 cached | hawkish/dovish |
| 95 | 각 지표 캐스케이드 체인 (3~5개 자산) | 💾 cached | 방향·강도·이유 |

### 2-3. 탭: 머니 흐름 (`flows`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 96 | 스마트머니 유입 섹터 랭킹 | 💾 cached | 13F |
| 97 | 스마트머니 이탈 섹터 랭킹 | 💾 cached | 13F |

### 2-4. 탭: Fear & Greed (`fear-greed`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 98 | F&G (SPY) 게이지 | ✅ live | CNN 공식 API | 4h | CNN 차단 시 composite로 자동 폴백 + error 로깅 |
| 99 | F&G 자산별 (Gold/Tech/Bonds 등) | 💾 cached | FlowVium 합성 | 4h | RSI×40+SMA125×35+Vol×25 |
| 100 | F&G 국가별 (한/일/중/유/영/인/브/대/호) | 💾 cached | FlowVium 합성 | 4h | 국가 ETF 기반 composite (CNN 대응 없음) |
| 100a | 출처 뱃지 (CNN/합성) | ✅ live | `source` 필드 | - | UI 투명성: 같은 숫자라도 계산법 구분 |

### 2-5. 탭: 신용잔고 (`credit`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 101 | 미국 신용잔고 ($B) | 💾 cached | FRED BOGZ1FL663067003Q |
| 102 | 미국 GDP 대비 % | 💾 cached | FRED |
| 103 | 미국 YoY 변화 | 💾 cached | 자체계산 |
| 104 | 한국 신용잔고 | 💾 cached | KOFIA/TWSE 추정 |
| 105 | 일본 신용잔고 | 💾 cached | 추정 |
| 106 | 대만 신용잔고 | 💾 cached | TWSE |
| 107 | 글로벌 스냅샷 (총합) | 💾 cached | 자체계산 |
| 108 | 국가별 장기 시계열 차트 | 💾 cached | FRED/외 |

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

---

## 3. 탐색기 (`/explore`)

| # | 지표 | 상태 | 비고 |
|---|------|------|------|
| 115 | 137개 기업 노드 | 📋 static | `/data/explore-data` |
| 116 | 기업 간 연관 엣지 (supplier/customer/partner/competitor) | 📋 static | |
| 117 | 시가총액 | 📋 static | 하드코딩 (⚠️ Yahoo 라이브로 교체 가능) |
| 118 | 섹터 분류 | 📋 static | |
| 119 | 역할 배지 | 📋 static | |
| 120 | 제품 매출 비중 | 📋 static | |
| 121 | 매출 파이차트 | 📋 static | |
| 122 | 연관 기업 Top 6 | 📋 static | |

---

## 4. 기업 프로필 (`/company/[ticker]`)

### 4-1. 헤더

| # | 지표 | 상태 |
|---|------|------|
| 123 | 기업명·설명·역할 | 📋 static |
| 124 | 번역 설명 (16개 언어) | 💾 cached | Gemini 번역, 30d |
| 125 | ASCII 공급망 네트워크 뷰 | 📋 static |

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
| 173 | 섹터별 활동 차트 (매집 vs 감소) | 💾 cached | 13F |
| 174 | 상위 기관 랭킹 | 💾 cached | 13F |
| 175 | 신호 테이블: 티커·기업·기관 | 💾 cached | 13F |
| 176 | 신호 테이블: 액션·보유%·주식수 변화 | 💾 cached | 13F |
| 177 | 신호 테이블: 가치·갭스코어·공시일 | 💾 cached | 13F |

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

| # | 지표 | 상태 |
|---|------|------|
| 203 | 거래일·총 종목 수 | 💾 cached | KRX |
| 204 | 외국인 상위 순매수 | 💾 cached | KRX |
| 205 | 외국인 상위 순매도 | 💾 cached | KRX |
| 206 | 기관 상위 순매수 | 💾 cached | KRX |
| 207 | 기관 상위 순매도 | 💾 cached | KRX |
| 208 | 종목별 현재가·등락% | 💾 cached | KRX |
| 209 | 순매수 금액(원) | 💾 cached | KRX |

---

## 8. 스크리너 (`/screener`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 210 | 프리셋: 숏 스퀴즈 후보 | 💾 cached | signals + short |
| 211 | 프리셋: 기관 신규 편입 | 💾 cached | signals |
| 212 | 프리셋: 기관 매집 중 | 💾 cached | signals |
| 213 | 프리셋: 기관 비중 축소 | 💾 cached | signals |
| 214 | 프리셋: 언더레이더 | 💾 cached | signals + news-gap |
| 215 | 숏 Float % 슬라이더 | ✅ live | 사용자 입력 |
| 216 | 결과 테이블: 스퀴즈 스코어(바) | 💾 cached | 자체계산 |
| 217 | 결과 테이블: 뉴스갭(바) | 💾 cached | AV |
| 218 | 결과 테이블: DTC (Days to Cover) | 💾 cached | Yahoo |

---

## 9. 숏 인터레스트 (`/short`)

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 219 | 추적 종목 수 | 💾 cached | 집계 |
| 220 | 스퀴즈 위험 종목 수 (45+) | 💾 cached | 자체계산 |
| 221 | 평균 Short Float % | 💾 cached | 자체계산 |
| 222 | 최고 스퀴즈 스코어 + 티커 | 💾 cached | 자체계산 |
| 223 | 종목별 Short % Float | 💾 cached | Yahoo |
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

### 10-3. 트리맵

| # | 지표 | 상태 |
|---|------|------|
| 236 | 섹터별 종목 박스 (크기=시가총액) | 💾 cached | Yahoo |
| 237 | 박스 색상 (등락%) | 💾 cached | Yahoo |

---

## 11. 캐스케이드 (`/cascade`)

| # | 지표 | 상태 |
|---|------|------|
| 238 | 섹터별 패턴 그룹 | 📋 static | `/data/cascades` |
| 239 | 리더 기업·티커·섹터 | 📋 static |
| 240 | 스텝 수·총 딜레이 | 📋 static |
| 241 | 역사적 발생 횟수 | 📋 static |
| 242 | 미니 플로우 (Top 5) | 📋 static |

---

## 12. AI 리포트 (`/report`)

홈의 AI 브리프와 동일한 지표 (#1~8). 타임프레임 1w/4w/13w 전환 + 실시간 KPI 스트립.

| # | 지표 | 상태 | 소스 |
|---|------|------|------|
| 12-K1 | KPI: F&G (US) | 💾 cached | `/api/fear-greed` (CNN 4h) |
| 12-K2 | KPI: SPY 1w 수익률 | 💾 cached | `/api/capital-flows` (Yahoo/Twelve 6h) |
| 12-K3 | KPI: 10Y-2Y 스프레드 bp | 💾 cached | `/api/macro-indicators` (FRED) |
| 12-K4 | KPI: VIX 1w 변화 | 💾 cached | `/api/capital-flows` (VIXY/VXX 폴백) |
| 12-K5 | KPI: 다음 FOMC 인하 확률 | 💾 cached | `/api/fedwatch` (CME) |
| 12-M1 | 메타: 소스 배지 (GROQ 70b/8b/Gemini/EXAONE/data) | ✅ live | daily-brief.source |
| 12-M2 | 메타: 신선도 점 + humanized age | ✅ live | generatedAt diff |
| 12-M3 | 메타: 리스크 레벨 pill (low/medium/high) | 💾 cached | daily-brief.riskLevel |
| 12-D1~D4 | 섹션 카드 드릴다운 링크 (heatmap/intelligence/signals/insider) | 📋 static | next/link |

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
| 283 | korea-flow:v1 | ✅ live |
| 284 | short-interest:v1 | ✅ live |
| 285 | market-caps:v1 | ✅ live |
| 286 | fg:v3:SPY | ✅ live |
| 287 | 13f-signals:v1 | ✅ live |
| 288 | capital-flows:v5:yahoo | ✅ live |
| 289 | capital-flows:v5:twelve | ✅ live |
| 290 | macro-indicators:v4:$(date) | ✅ live |
| 291 | fedwatch:v1:$(hour) | ✅ live |
| 292 | credit-balance:v2:$(date) | ✅ live |
| 293 | latest-updates:v2 | ✅ live |

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
| 296b | 그룹별 드릴다운 (fear-greed · capital-flows · macro · fedwatch · credit · cache) | 🔄 cron | |
| 296c | 개별 지표 상태 (~60+ 지표) | 🔄 cron | ✕ 먼저 정렬 |
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
| 303 | 이번주 발표 예정 티커 | 💾 cached | Finnhub (2h) |
| 304 | EPS 컨센서스 | 💾 cached | Finnhub |
| 305 | 매출 컨센서스 | 💾 cached | Finnhub |
| 306 | 과거 Surprise 이력 | 💾 cached | Finnhub (epsSurprise %) |
| 307 | 발표 시간 (장전/장중/장후) | 💾 cached | Finnhub hour field |

### 16-4. 워치리스트 + 알림 — 4순위

| # | 지표 | 상태 |
|---|------|------|
| 308 | 사용자 커스텀 종목 리스트 | ⛔ missing |
| 309 | Discord 웹훅 알림 | ⛔ missing |
| 310 | 알림 조건 (가격·거래량·신호) | ⛔ missing |

### 16-5. 실시간 WebSocket — 5순위 (블룸버그 QM)

| # | 지표 | 상태 |
|---|------|------|
| 311 | 실시간 주가 스트리밍 | ⛔ missing | 🔒 Polygon Starter |
| 312 | 실시간 호가 스프레드 | ⛔ missing | |
| 313 | 실시간 거래량 | ⛔ missing | |

### 16-6. 기타 갭

| # | 지표 | 상태 | 참고 블룸버그 |
|---|------|------|--------------|
| 314 | ETF 순유입 절대금액 | ⛔ missing | ETF.com |
| 315 | 섹터별 ETF 순유입 | ⛔ missing | |
| 316 | 원자재 커브 (컨탱고/백워데이션) | ⛔ missing | CL/GC 선물 |
| 317 | VIX 기간 구조 (9일/30일/6개월) | ✅ live | CBOE indices via Yahoo Finance (^VXST/^VIX/^VXMT) |
| 318 | 변동성 곡면 (Vol Surface) | ⛔ missing | 🔒 |
| 319 | IV Rank/Percentile | ⛔ missing | 🔒 |
| 320 | 섹터별 P/E·P/B·배당수익률 | ⛔ missing | |
| 321 | Smart Beta 팩터 (Quality·Momentum·Value) | ✅ live | MTUM/QUAL/VLUE/USMV/IVW/IVE Yahoo |
| 322 | 기업 뉴스 AI 요약 (종목별 전용) | ⛔ missing | |
| 323 | 경제지표 컨센서스 캘린더 | ⛔ missing | 블룸버그 ECO |

---

## 17. API 엔드포인트 전체 목록 (2026-04-24 기준)

> `src/app/api/` 하위 전체 route.ts 목록. 상태=엔드포인트 자체 정상 여부.

| # | 경로 | 목적 | 상태 | 소스 | 캐시 TTL |
|---|------|------|------|------|----------|
| E1 | `/api/fear-greed` | 공포탐욕지수 (11개국 + 9개 자산) | ✅ live | CNN + composite | Redis 1h |
| E2 | `/api/capital-flows` | ETF 자금흐름 (ret1w/4w/13w) | ✅ live | Twelve Data + Yahoo Finance | Redis 15min |
| E3 | `/api/macro-indicators` | 거시경제 지표 (CPI/PCE/NFP 등) | 💾 cached | Finnhub macro events | Redis 6h |
| E4 | `/api/fedwatch` | CME FedWatch 금리 확률 | ✅ live | CME Group 파싱 | Redis 1h |
| E5 | `/api/credit-balance` | 신용잔고 7개국 | 💾 cached | 정적+FRED 혼합 | Redis 12h |
| E6 | `/api/news-cascade` | AI 뉴스 번역+감성분석 | 💾 cached | GROQ → vLLM | Redis 4h |
| E7 | `/api/signals` | 기관 신호 13F 매집/청산 | 💾 cached | SEC EDGAR 13F | Redis 7d |
| E8 | `/api/insider-trades` | 내부자 Form 4 매집 | ✅ live | SEC EDGAR RSS | Redis 2h |
| E9 | `/api/ownership-alerts` | 13D/13G 대량보유 알림 | ✅ live | SEC EDGAR RSS | Redis 2h |
| E10 | `/api/nport-holdings` | N-PORT 뮤추얼펀드 보유 | 💾 cached | SEC EDGAR | Redis 24h |
| E11 | `/api/korea-flow` | 한국 외국인·기관 수급 (KRX) | ✅ live | KRX data.krx.co.kr | Redis 15min |
| E12 | `/api/short-interest` | 숏인터레스트·공매도 비율 | 💾 cached | Yahoo Finance v10 (crumb) | Redis 12h |
| E13 | `/api/market-heatmap` | 시장 트리맵 (7개국) | 💾 cached | iShares CSV + Yahoo v8 | Redis 15min |
| E14 | `/api/market-caps` | 시가총액·band 분류 | 💾 cached | Yahoo Finance v7 (crumb) | Redis 24h |
| E15 | `/api/price-history` | 가격 시계열 (30d sparkline) | ✅ live | Yahoo Finance v8 chart | Redis 1h |
| E16 | `/api/earnings` | 실적 캘린더 | 💾 cached | Finnhub | Redis 2h |
| E17 | `/api/daily-brief` | AI 데일리 브리프 조회 | 🔄 cron | vLLM→GROQ cascade | Redis (cron 갱신) |
| E18 | `/api/latest-updates` | 홈 LiveFeed 집계 | ✅ live | 다수 엔드포인트 집계 | Redis 30min |
| E19 | `/api/flow-analysis` | 자금흐름 심층분석 | 💾 cached | capital-flows 파생 | Redis 1h |
| E20 | `/api/stock-supply` | 개별주 수급 (ticker별) | ✅ live | Yahoo v8 + EDGAR Form 4 | Redis 2h |
| E21 | `/api/company-financials/[ticker]` | 기업 재무제표 (SEC XBRL) | ✅ live | SEC EDGAR XBRL | Redis 24h |
| E24 | `/api/yield-curve` | 미국 국채 수익률 커브 (9개 만기 + TIPS + BEI) | ✅ live | FRED CSV (무료) | Redis 1h |
| E31 | `/api/volatility` | VIX 기간 구조 (VXST/VIX/VXMT/VVIX) + 90일 이력 | ✅ live | Yahoo Finance chart | Redis 30min |
| E22 | `/api/block-trades` | 블록거래 | 🔒 locked | Polygon.io 키 필요 (donation-gate) | 5min |
| E23 | `/api/options-flow` | 옵션 플로우 | 🔒 locked | 유료 API 필요 | — |
| E24 | `/api/osint/corporate` | 기업 OSINT | ✅ live | public web | no-store |
| E25 | `/api/osint/crypto` | 암호화폐 OSINT | ✅ live | public web | no-store |
| E26 | `/api/osint/sanctions` | 제재 명단 조회 | ✅ live | OFAC 등 | no-store |
| E27 | `/api/osint/social` | 소셜미디어 OSINT | ✅ live | public RSS/scrape | no-store |
| E28 | `/api/translate` | AI 번역 (vLLM→GROQ cascade) | ✅ live | vLLM→GROQ | no-store |
| E29 | `/api/ai` | AI 생성 (inline) | ✅ live | vLLM→GROQ cascade | no-store |
| E30 | `/api/collect` | 데이터 수집 수동 트리거 | ✅ live | 내부 | — |
| E31 | `/api/cron/daily-brief` | 데일리 브리프 생성 크론 | 🔄 cron | vLLM→GROQ | 3×/day |
| E32 | `/api/cron/update-all` | 전체 캐시 갱신 크론 | 🔄 cron | 내부 | 1×/day |
| E33 | `/api/cron/update-credit-balance` | 신용잔고 갱신 크론 | 🔄 cron | FRED | 1×/day |
| E34 | `/api/cron/update-signals` | 기관신호 갱신 크론 | 🔄 cron | SEC EDGAR | 1×/week |
| E35 | `/api/cron/verify-metrics` | 전체 헬스 프로브 | ✅ live | 모든 엔드포인트 | no-store |
| E36 | `/api/admin/health` | 서버 헬스 체크 | ✅ live | 시스템 | no-store |
| E37 | `/api/admin/logs` | 서버 로그 조회 | ✅ live | Redis logs | no-store |
| E38 | `/api/admin/metrics-health` | verify-metrics 결과 표시 | ✅ live | cron 결과 | no-store |

**총 API 라우트: 38개** (크론 5 + 어드민 3 + 공개 30)

---

## 요약 통계

| 상태 | 개수 |
|------|------|
| ✅ live | ~35 |
| 💾 cached | ~145 |
| 🔄 cron | ~12 |
| 📋 static | ~40 |
| ⛔ missing | ~55 |
| 🔒 locked | ~8 |
| **총 추적 지표** | **323** |

**live + cached + cron 활성**: ~192개 (59.4%)
**미구현 갭**: ~63개 (19.5%)

---

## 유지 가이드

- 새 지표 추가 시: 해당 섹션 하단에 다음 번호로 행 추가
- 상태 변경 시: 상태 배지만 변경 (번호·소스는 유지)
- 지표 제거 시: 해당 행 삭제 + 요약 통계 조정
- `FEATURES.md`의 기능 섹션과 1:1 대응되도록 유지
- 블룸버그 갭 해소 시: 16번 섹션에서 해당 행 제거 + 해당 페이지 섹션에 추가

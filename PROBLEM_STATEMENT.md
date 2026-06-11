# FlowVium 보고서 엔진 — 현재 문제 상황 (프롬프트)

## 시스템 개요
- **FlowVium**: 글로벌 자금흐름·기관신호·AI 투자전략 리포트 서비스 (flowvium.net).
- **자가호스팅**: Cloudflare 터널 → RTX 4050(6GB VRAM) 로컬 서버. Vercel 무관. pm2(web/cron/tunnel).
- **보고서 생성**: `scripts/generate-report-local.mjs` 가 하루 5회(midnight/morning/noon/afternoon/evening, KST)
  cron 으로 실행. 로컬 **Ollama qwen3:8b**(thinking 모델, `/no_think` 필요) 로 LLM 생성. cloud(groq/gemini) quota 소진.
- **파이프라인**: gatherContext(16+ API: 가격/기관신호/공매도/뉴스/매크로/공급망) → Wave1 LLM(macro/portfolio/
  regional/opportunity/narrative) → Wave2 LLM(risk/companyChanges/stockDetail/sellRationale) → critique →
  4-stage buy funnel(1338종목 light score → OHLCV top100 → financials top50 → LLM top30 중 US6+KR6) →
  발간前 grounding/gate → saveReport → 정시발간 업로드 → verify-report(발간後) → Karpathy hallucination_history.

## 핵심 문제

### 1. 로컬 8B LLM 이 종목별 정량수치를 환각함 (가장 큰 문제)
- **가격/기술(RSI/MA)은 grounded**(실데이터 주입+verbatim 강제) 되지만, **fundamentalBasis/catalysts 의 정량값
  (매출 YoY%, 영업이익률%, 내부자 매수%)은 LLM 자유생성** → 환각 빈발.
- 실제 사례: GOOGL 매출 "35% YoY"(실제 21.8%), 동일 "12.3% 인사이더"가 4종목에 copy-paste,
  "28.7% YoY"가 2종목 동일. 서로 다른 기업·지표가 같은 숫자 = copy-paste 환각.
- **현재 방어**: (a) 발간前 strip — 소수% 2+종목 중복 시 제거(strip-when-uncertain), (b) 매출 YoY 는
  signalDigest 실 fin.yoy 와 >7%p 이탈 시 실값 교정, (c) verify-report [6b] 가 발간後 감지 → Karpathy.
- **남은 갭**: 단일(비중복) 비-매출 환각(마진%·내부자 단일값)은 실값 대조 grounding 없음.
  근본 해결 = 프롬프트가 모든 정량필드에 [COMPUTED] 실값을 주고 verbatim 강제(technicalBasis 처럼).

### 2. 매수·매도 엔진 의견 합의(경합심사) — 비대칭 잔존
- **양방향 경합심사 구현됨**: 매수 후보를 매도룰로 cross-exam(opMarginDecline/deadCross/RSI과매수 등 ≥7 score
  veto) + 매도 후보를 매수신호(과매도반등/골든크로스/PEG저평가)로 재심사(buyConflict 플래그).
  reconciliation trail(`reports/reconciliation/*.json`)에 양방향 기록.
- **비대칭 갭**: 매수 엔진은 **내부자 매수**(micro_insider_buying)를 보지만, **매도 엔진엔 내부자 매도(Form4
  sell)·13F 기관 이탈 sell 룰이 없음**. 기관이 파는데 매도 신호로 안 잡힘.
- 매도가 target_near 일 때 "더 갈 수 있는지" 는 골든크로스 buyConflict 로 부분 surface 되나, 명시적
  매수엔진 재평가는 아직 휴리스틱.

### 3. 데이터 소스 취약성
- Stooq(무료 CSV)가 봇차단(JS/PoW) → Yahoo v7 quote(crumb 인증) 배치로 전환(coverage 99.5%). 단일 무료
  소스 의존 리스크 상존.
- KR 종목은 옵션 IV 미상장(atmIv30d=null), DART EPS 미제공(KR PE 인용 금지).

### 4. 검증체계 (Karpathy closed loop)
- verify-report 결함 → hallucination_history 적재 → 다음 프롬프트 anti-pattern inject → LLM 학습.
- recency-aware 프로브(고친 라우트의 과거 실패 false-positive 제거). 자동모니터 */20분(hang-protected).

## 해결하고 싶은 것 (ASK)
1. **8B LLM 의 정량수치 환각 근본 차단** — 모든 정량필드(매출/마진/ROE/내부자)에 실값 grounding 강제하는
   최선의 아키텍처. 프롬프트 엔지니어링 vs 발간前 결정론적 교정 vs 더 큰 모델(14B) 트레이드오프.
2. **매수·매도 엔진 완전 대칭 경합심사** — 내부자 매도/13F 이탈 sell 룰 추가 + target_near winner 의
   매수엔진 재평가 정식화.
3. **종목별 기업정보를 "더 자세할 수 없을 정도로" 정확·풍부하게** — 1338 종목 전수 company 페이지 깊이.

## 관련 코드 파일 (이 zip 에 포함)
- `scripts/generate-report-local.mjs` — 메인 보고서 엔진(전 파이프라인, 경합심사 게이트, grounding, strip).
- `data/buy-rules-tuned.json` / `data/sell-rules-tuned.json` — 매수/매도 룰(카테고리·score).
- `scripts/verify-report.mjs` — 발간後 검증 프로브(환각 감지 → Karpathy).
- `scripts/lib/db.mjs` — SQLite(추천/outcome/hallucination_history/스냅샷).
- `src/app/api/supply-chain-signals/route.ts` — DART/SEC 기업변화·공급망 신호(buyback 분류).
- `CLAUDE.md` — 프로젝트 규칙(동적소스·검증의무·grounding 원칙).

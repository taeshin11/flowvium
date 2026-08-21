# 2026-07-02 — PUSH blocker 2건 해소(정상 push 복원) + 전 엔드포인트 전수점검 + 저지 채팅 엔진 경합 검증/개선

## 1. PUSH blocker 해소 (verify-all fail 0 — --no-verify 강요 종식)

### verify-latest-report stale_event (Karpathy ≥5회 escalation)
- 원인: 미드나잇 리포트(익일 라벨)가 전날 이미 발생한 이벤트 5건을 riskEvents(미래 risk)로 표기. detector-without-corrector.
- fix (ea74af5c): `correctStaleRiskEvents` — date < 보고서일(KST, generatedAt 앵커=verify-report와 동일) drop + 잔여 <3이면 econCal 미래 이벤트 결정론 backfill → enrichRiskEvents가 노출/예상치 주입. drop분은 H1 폐루프에 `stale_event_sanitized` 적재(프롬프트 anti-pattern inject).
- 발간본 midnight-ko 데이터 교정(프로덕션 함수 추출 재사용, 인라인 재구현 금지 원칙) + `--upload` 재발간(품질 97/100). 과거 5건은 `stale_event_sanitized` 재분류(원 타입 details_json 보존 — 2026-07-01 "_sanitized는 차단만 제외" 원칙).
- 검증: 모닝 리포트(06:52, corrector 적용)가 riskEvents 전부 미래 날짜로 발간, verify-report 0 defects.

### audit-coverage /api/signal-retrospective 4XX 57%
- 원인: 라우트 죽음이 아니라 **콜드캐시** — Redis 키 TTL 14일 만료(마지막 성공 기록 ~06-17) + 컷오버로 신규머신 cron-runner가 07-01 03:30 UTC 슬롯을 놓침.
- fix: cron 수동 트리거로 warm(200 복귀) + 회복 스냅샷 2건 적재(audit recency-aware 강등). 매일 03:30 UTC cron이 이후 유지.

## 2. 사이트 전수점검 (사용자 요청 "모든 탭/페이지/엔드포인트 업데이트 확인")
- 결과: **엔드포인트 48/48 OK, 페이지 24/24 OK** (compare/fear-greed는 파라미터 라우트 — /ko/compare/aapl-vs-msft, /ko/fear-greed/us 로 200 확인).
- 발견·fix (ff9a7764): `skipVllm:true` stale 안티패턴 — 클라우드 키 전부 revoked(06-15) 상태라 유일한 LLM(vLLM)을 건너뛰어 **flow-analysis 영구 static-fallback**, **signal-retrospective 매번 aiSource=fallback**. skipVllm 제거 + 타임아웃 실측(10 tok/s) 반영(25s→150s / 90s). 라이브 검증: source=vllm-local.
- 번역 경로들(translate/news-cascade 등)의 skipVllm은 자체 로컬 Ollama 폴백이 있는 의도된 설계 — 유지(한자 TRACKED 작업과 연계).

## 3. 저지 채팅 매수/매도/심판 엔진 검토 (사용자 요청)

### 경합 구조 판정: 정상 (배선 검증)
- 매수엔진(scoreBuy)·매도엔진(scoreSell)은 보고서와 단일소스(buy-sell-engine.mjs), 심판(adjudicate)이 net±5/±12+hardSell+buyVeto+coverage gate로 결정론 단정, LLM은 서술만.
- 라이브 실증 2건: TSM(매수 net30 → 매수, LLM 결론 일치) / 삼성전자 deep(매수14 vs 매도3인데 **과열 veto 200MA+81% 발동 → 관망** — veto 규율이 챗에서 점수를 이기고 작동).

### 발견 결함 → fix (1b2cdbdc)
1. `fmtEngine`이 buyVeto에 F&G 미전달 — 극공포 capitulation 앵커 면제가 primaryVerdict(verdict_mismatch 기준)에만 적용, LLM에 보여주는 심판과 불일치 가능. fg 전달로 단일화.
2. verdict_mismatch가 detector-without-corrector — DEFECT_LESSON 매핑 부재로 챗 학습 폐루프에 안 실림. 교훈 추가.
3. streamVllm 55s 고정 타임아웃 — finance 모델 ~10 tok/s 실측에서 deep 답변(3800tok) 중간 절단 확정. `llmTimeoutMs=30s+100ms/tok cap300s`로 4경로(스트림/fallback/논스트림/리서치) 스케일. deep 실측 109초 완주.
4. sanitizeAnswer를 narrative-fix `sanitizeText`와 단일소스화 — garble 매핑(금융크로스→골든크로스 신규) 챗 적용 + **ja/zh 답변 한자 파괴 버그 fix**(종전 인라인 무조건 스트립).

### 잔여 (모델레벨 — AWQ 재양자화 백로그와 연동)
- 답변 축약(deep 6소제목 요건 미준수, 371자) · "금융권 상승 추세" 류 golden-cross 신종 garble(금융권은 실제 단어라 blind 치환 위험 — 매핑 보류) · 면책 라인 누락.
- 챗 사용 로그(verify/index)는 신규머신에서 0건 — 실사용 누적 후 verdict_mismatch/결함 추세 재점검 권장.

## 커밋: ea74af5c → ff9a7764 → 1b2cdbdc (전부 pre-push verify-all 통과, --no-verify 없음)

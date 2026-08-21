# 2026-07-02 — 자율 하네스 스윕 (좀비/모니터/Karpathy/vLLM속도/검증체계/디스크)

## 커밋: a02b7386(cron 자동커밋) → ed0dfbc2 (verify-all 13게이트 PASS, --no-verify 없음)

## 1. 좀비 프로세스 — 0건 (실측)
node 전수=pm2 트리(웹2·cron·shim·tunnel)만, conhost/powershell 부모 전부 생존·정상(GoogleDriveFS/
cloudflared/WSL vLLM/VS Code). 잔재였던 pm2 `flowvium-stall`(one-shot 스크립트의 stopped 등록) delete+save.
/loop·세션cron 0. Running 스케줄태스크는 상주 FlowVium-vLLM 뿐.

## 2. 모니터/스톨 — 정상 + 사각지대 1클래스 봉쇄
check-stall 직접 실행 전항목 OK, monitor-status */20 fresh, DeepMonitor Ready. 모니터가 표면화한
결함 추적 → **컷오버 콜드스타트 클래스** 발견: cron-runner 시작 전 지나간 슬롯은 영구 미실행
(HTTP 크론=Redis TTL 사망, 유지보수=다음 주간슬롯까지 방치). fix = **시작시 catchup**:
- runJob 성공기록(logs/cron-last-run.json) + 주기 초과분 소급(발신성 send-alerts 제외, 순차, 보고서 lock 중단)
- MAINT_JOBS 테이블 단일소스(등록·HB_MAX·catchup 3소비처) + heartbeat 초과분 소급
- 실측: 재시작 후 18개 소급 완주. us-smallcap/backlog/tune-rules heartbeat 채워짐.

## 3. Karpathy 폐루프 — 작동 실증
F26 inject 소비 중(narrative_garble avg 8.7/max 52, stale_event_sanitized 모닝 1회차), harness_* 0회는
설계(결정론 수정분 재학습 불필요, inject 예산 절약 — db.mjs 주석 문서화 확인). escape 추세
9-10건/일(06-17) → 1건/일(07-01) 수렴. report.log "[F26/AntiPattern] 15건 inject ✓" 실증.

## 4. /api/signals 빈배열 — 진범 EDGAR 429
콜드캐시가 아니라 **15기관 완전병렬 → SEC rate-limit(≤10req/s) 전기관 429 → "no signals parsed"**.
순차+500ms+429재시도(3s)로 fix → 393신호/72종목, 라이브 len=310 복구.

## 5. vLLM 속도 (10.3 tok/s baseline 실측)
근본원인: **AWQ 아님** — 57GB bf16 머지본을 `--quantization bitsandbytes` 즉석양자화 + `--enforce-eager`
(merge-v2.py "이후 AWQ" 계획이 RAM벽 63GB/48GB WSL 로 미이행 → BNB 임시가 굳음).
- graphs 시도: max-num-seqs 8 + GPU_UTIL 0.92→0.94 — KV 3.0GiB 필요 vs 2.4 가용, 32k 컨텍스트와 양립불가
  → eager 복원(서비스 연속). 백업 /opt/vllm/model.conf.bak-eager.
- **근본해법 AWQ W4A16 준비 완료**: /opt/quant-venv(llmcompressor 0.12.0) + /opt/quant/awq-quant.py
  (MoE 라우터/게이트 ignore, ultrachat 128, mmap 순차라 RAM벽 우회) + awq-night-run.sh
  (vLLM 중지→양자화 하드컷 6.5h→trap 무조건 복원, 중복실행 가드).
- **야간 실행 예약**: 21:37 세션cron(감독) + 21:42 FlowVium-AWQ-Once(OS 안전망). 미드나잇 리포트(04:40) 전
  복원 보장. 성공 시 BNB 대비 3-6× + 무게 -2GB로 graphs+32k 도 수용 예상. 산출 검증 후 수동 전환.
- GPU 경합상 지금 실행 불가(vLLM 22GB 점유, 정오/오후 리포트 전멸 위험) — 게으른 미루기 아닌 단일 GPU 시퀀싱.

## 6. 검증체계 신설 — "왜 최선 미시행" 클래스 봉쇄
scripts/check-llm-routing.mjs (verify-all critical): ① vLLM-skip 표면 allowlist(로컬폴백 실증 5경로만)
② 고정 타임아웃<토큰요구량 검출(skipVllm 동반=vLLM 미도달 제외). 최초 실행이 실결함 9곳 표면화
(invest-critic 25s/600tok — 경합심사 매 실행 silent skip 포함) → 전부 llmTimeoutMs 전환.

## 7. 디스크 — 정리할 것 없음 (실측)
C: 여유 708GB, 레포 1.1GB, WSL vhdx 83.9GB(내부 79GB — sparse 낭비 ~5GB, 압축 불필요). .bak 2개=튜너 롤백 설계.

## 열린 것: (a) AWQ 야간 결과 → model.conf 전환+속도/품질 검증 (b) ja/zh 뉴스번역 콜드 auto-warm 수렴 관찰
(c) 모델레벨 garble/축약은 AWQ 후 재평가

---
## [추기 2026-07-03 01:20] AWQ 야간 재양자화 — 성공 (9.2× 속도 개선)

- 1차(21:37): MoE 선형화 중 **RAM OOM-kill**(anon 47GB/48GB 상한) → trap vLLM 자동복원 ✓
- 조치: WSL swap 24→64GB(.wslconfig, 백업 .wslconfig.bak-20260702) + WSL 재기동
- 2차(21:46): 캘리브레이션 활성캐시 **pin_memory CUDA OOM**(WSL 고정메모리 pool 고갈) → trap 복원 ✓
- 조치: pin_memory 실패시 unpinned 폴백 패치 + 샘플 128→64·시퀀스 1024→512 + 하드컷 5.5h
- 3차(21:55): **성공** — 00:54 완료(exit=0). 산출 /root/AISVI_FINANCE_T_2.0.0-AWQ (57GB→16GB, W4A16 compressed-tensors)
- 전환: model.conf AWQ 경로 + BNB/enforce-eager 제거(+CUDA graphs 활성) + max-num-seqs 8 유지.
  구설정 백업 /opt/vllm/model.conf.bak-bnb-final, /opt/vllm/model.conf.bak-eager. 전환 중 trap복원분과
  이중 인스턴스 경합 발생 → 구설정 인스턴스 kill 로 해소(런북: 전환 시 pkill 후 단일 기동 확인 필수).
- **실측: 10.3 → 94.4 tok/s (9.2×)**, judge-chat 8.1초 응답(종전 19-38s)·한국어 클린(garble/한자 0·심판 일치)
- 부수 발견: verify-report latin_garble 검출기가 CamelCase 브랜드+조사("SoftBank의"→"ank") 오탐
  → 룩비하인드 라틴 제외 fix(6af34311, TP 보존 단위검증) + 학습루프의 FP 행 1건 제거
- 다음: 미드나잇 리포트(04:40)가 AWQ 첫 프로덕션 생성 — 05:23 자동 검증(결함률/생성시간 BNB 대비, 열화 시 롤백)

## [추기 2026-07-03 05:25] AWQ 첫 프로덕션 리포트 검증 — 정상, 롤백 불필요
- 미드나잇 07-03 (model=AISVI_FINANCE_T_2.0.0-AWQ, per-model 결함추적이 첫 A/B 데이터 제공):
  verify-report **0 defects(발간본 클린)**. 내부 결함 6건은 전부 *_sanitized(발간 전 자동교정:
  garble 5+stale 1) — BNB 미드나잇(07-02)과 동수, 열화 신호 없음(표본 1, check-stall [4] 추세로 계속 관찰).
- 속도 반영: Wave1 34.7s/Wave2 21.6s, **발간 05:13(BNB) → 02:22(AWQ)** (~2.9h 단축). SUCCESS 02:23.
- stale_event corrector·narrative sanitizer·Karpathy 적재 모두 새 모델에서 정상 작동.

## [추기 2026-07-03 05:55] 사용자 질의 2건 조사
### (1) 07-02 afternoon/evening 리포트 라이브 미반영 — latin_garble 오탐 발간차단
- 파일은 생성됐으나 pre-publish gate 가 latin_garble 1건으로 두 세션 모두 업로드 차단(로그 2042/2328행).
- fragment = "SoftBank의"→ank(evening), "Hynix의"→ynix(afternoon) — **검출기 CamelCase 오탐**(06af34311 로 새벽 fix 완료, 수정 검출기 재검 두 리포트 모두 0건). FP 학습행 2건 제거.
- 사각지대: 차단 사건을 어떤 모니터도 표면화 못함(check-stall·catchup 은 파일 기준) → **check-stall [7] 라이브 반영 정합 probe 신설**(로컬 최신 vs 라이브 generatedAt lag>75분 경보, a9a9b016).
### (2) TER 투자실패 회고 — 06-16 추천 → 06-17 스톱아웃(-5.3%), 이후 484→369 붕괴
- 당시 데이터에 있었는데 못 쓴 신호: ①3일 +24% parabolic·200MA +74% 과확장(가점만 있고 차단 없음 —
  **06-23 hasHardBuyVeto 가 이미 봉쇄, 소급판정 실증: "과열 추격 veto +74%" 발화**) ②rationale 에 기록된
  "거래량 -10%"(상승-거래량 다이버전스) — 소비 룰 부재(잔존 갭) ③noon rationale "52주고점 460달러 15% 할인"
  = 환각 460+오산수(실제 52주고점 418, 현재가 432 가 이미 신고가) ④스톱 -3.9% vs 당시 일중변동 8-13%
  — ATR 비례 스톱 부재(잔존 갭, 휩쏘 스톱아웃 구조적).
- 잔존 갭 2건(거래량 다이버전스 룰·ATR 스톱)은 사용자 승인 후 착수 권고.

## [추기 2026-07-03 09:45] 자율 스윕 2회차 + TER 잔존갭 구현 (2b614e7c)
- 좀비 0(재확인, WSL awq/tail 잔류 0)·모니터 7/7 OK([7] 라이브정합 포함)·결함 0·/loop 0.
- Karpathy AWQ 이틀째: escape 중앙값 0 유지, 결함수 BNB 동등(3~6, 전부 sanitized 클래스).
- TER 갭 구현: ①tech_volume_divergence(sell 4점, 신고가권+거래량감소 — 공유엔진이라 리포트·챗 동시)
  ②applyVolatilityStopFloor(ccVol14 기반 스톱 플로어 4~12%, 거리<floor×0.75만 확장 — 지지선 스톱 존중).
  스모크 11/11(TER 06-15 재현: 발화+스톱 -4.0%→-9.3%). buildTechnicalData.volMeta 신설(기존 소비처 무영향).
- "생산되나 미소비" 클래스 전수 분석: stage-2 생산 17필드 전부 엔진 소비 확인 — 잔여 갭 없음.
  (상시 게이트化는 보류 — 생산/소비 집합이 정당하게 자주 변해 오탐 게이트가 될 위험. 근거 기록.)
- 배포 후 챗 스모크: 구조 완전 준수(결론/근거/데이터/리스크/진입손절/면책), 7.3s — AWQ 가 BNB 보다
  instruction-following 도 개선(양자화 노이즈 제거 추정).

## [추기 2026-07-03 10:25] 전향 연구 파이프라인 구축 (0b6054d5) + 첫 백테스트 결과
- 사용자 "전향적 연구가 안되고 있나?" — 맞음(절반만): outcomes 전향평가·기존 룰 튜닝은 있으나
  *새 가설*은 사후 부검에서만 탄생하던 갭 → shadow 룰(별도 파일, live 채점 절대 미참여) →
  리포트 stage-2 발화 기록(shadow_hits) → eval-shadow-rules 주간 전향 5/10d 집계 → 승격 제안 체계 신설.
- 백테스트 사전심사(69종목×2년, 5일 쿨다운) 첫 결과:
  | 룰 | 발화 | 5d | 20d | 승률5d | 판정 |
  | breakout_volume(buy) | 297 | +1.08% | +3.95% | 53% | 지지 |
  | trend_pullback(buy) | 275 | +1.00% | +3.76% | 55% | 지지(승률 최고) |
  | oversold_uptrend(buy) | 405 | +0.46% | +2.42% | 52% | 약함(타 buy 대비 절반) |
  | parabolic_fade(sell) | 83 | -2.93% | -11.21% | 46% | **기각 방향** — 과확장+과매수+수급이탈 후에도
    평균은 상승(모멘텀 지속 > 평균회귀). TER -24% 붕괴는 꼬리 사례. 의미 재해석: 매도신호가 아니라
    "변동성 확대" 신호(스톱 강화/비중 관리용). 전향 연구가 사후 부검의 생존편향을 첫 판에 교정한 사례.
- 파생 조치: 같은 고점징후 계열인 live tech_volume_divergence 즉시 백테스트(진행 중) — 결과 따라 처분.

## [추기 2026-07-03 12:15] shadow 파이프라인 E2E 검증 — 정오 리포트에서 실전 첫 작동
- 정오 리포트(11:42) stage-2 에서 shadow 발화 8건 기록→적재 확인(로그 "[shadow] 8건 적재" + DB 8행).
- 발화 내용 시장맥락 정합: KOSPI 급락 국면이라 oversold_uptrend(200MA 위 과매도, RSI 23-35)가 주로 발화
  (082920.KQ/103590.KS/329180.KS/267260.KS/MPWR 등). verify-report 0 defects.
- 다음: 일요일 eval-shadow-rules 가 첫 전향 5/10d 성적 산출(발화 8일 경과분부터).

## [추기 2026-07-03 12:45] recheck 캡처물 *검증* 단계 신설 (6fe28c08, 사용자 "캡쳐만 하면 안되고 검증하라")
- 종전: 캡처(길이만 확인)+JSON verify+DOM garble 패턴 — "발간본이 실제로 렌더됐는가" 대조 부재,
  몽타주는 육안용 저장만 되고 아무도 안 봄.
- 신설 (2.5): ①렌더↔발간본 대조 — innerText 에 portfolio 전 종목(US=티커/KR=회사명) ≥70% + thesis
  앞 24자 존재 확인(stale/부분 렌더 검출) ②빈 슬라이스 감지(PNG<8KB=단색). alert → 모니터가 20분 내 표면화.
- 정오 발간본 실전 재실행: portfolio 100%·thesis✓·빈슬라이스 0·RECHECK OK. 몽타주 10슬라이스
  육안 검증도 수행 — 전 섹션 정상, 리스크 이벤트 카드가 미래 일정만 표시(stale corrector 라이브 시각 증거).

## [추기 2026-07-03 18:50] "US 0 / 1종목 100%" 사건 (사용자 발견) — 3중 봉쇄 (a0002a79)
- 실측: afternoon 15:42본 = 삼성화재 1종목 100%(watch). 18:20 시장쇼크(KOSPI -2.6%·원화 -1.5%) 자동
  재발간본 = AAPL/INCY 50/50. 추세: 5→4→3→1 (극단 이분화 장세: 과열 veto ↔ 칼받기 veto 사이 공집합).
- 규율(veto)은 정직: 하이닉스 200MA +137%, 삼전 +77%, 삼성전기 +229% 과확장 / 기아 -29% 칼받기 —
  탈락 자체는 정당. 문제는 *출력 표현*과 *구조 버그*:
  ① US 재충원 우회 버그 — hadCands 가 심판 후보(LLM 산출) 기준이라 LLM 이 US 통째 누락 시(top30 에
     US 21개 있어도) 재충원이 공석노트도 없이 skip → buyCandidates 풀 기준으로 교체.
  ② 100 정규화 몰빵 — veto 대량탈락 후 잔존 1~2종목이 100%로 스케일 → 종목<4 시 단일 25% 캡 +
     "잔여 N% 현금 보유(현금도 포지션)" 결정론 주입(applyLocalHarness).
  ③ 게이트 사각 — thin/몰빵이 전 게이트 통과 → verify-report probe 신설(portfolio_thin·
     allocation_concentration). 정합화: 현금 명시 시 thin·합<100 은 정상(규율상 공석) — 명시 없을 때만 결함.
- 신규 probe 가 내 push 를 즉시 차단(발간본 50/50) → 발간본 캡 교정+재업로드 후 통과 = 게이트 자기검증 실증.
  라이브 = AAPL 25/INCY 25/현금 50 명시. 이브닝 발간에서 캡·재충원 라이브 검증(21:47 cron).

## [추기 2026-07-03 21:55] 이브닝 검증 — 재충원 fix 실증 + 캡 우회 발견·이관 (4075f7a9)
- hadCands fix 라이브 실증 ✓: LLM 이 US 1(V)만 내고 V 탈락 → 재충원이 buyCandidates 풀에서 AAPL(편입,
  score 4)·ABNB(재심탈락 7)·INCY(편입, 0) 시도 — US 침묵 소실 해소. KR 재충원 8건 재심(전탈락 — 장세).
- 캡 우회 발견: applyLocalHarness(8331) 캡을 "저장 직전 최종 정규화"(8399)가 100 으로 되돌림
  (evening 42/42/16 실측) → thin 분기를 최종 정규화 지점으로 이관(권위 지점 단일화). 발간본 교정
  (25/25/16+현금 34% 명시) 재업로드, verify PASS, 라이브 반영.
- 미드나잇(04:40)이 수정 경로의 첫 자연 실행 — 신규 probe(thin/concentration)가 push 게이트로
  자기강제되므로 별도 감시 불요.

## [추기 2026-07-04 11:40] ChatGPT 외부 리뷰 차용 (8f8b5c66) — flow 순환논리 구조 차단
- 검증: topInflows=4w 수익률 정렬 ✓, korea-flow `||null` falsy·retail 0둔갑 ✓ — 지적 전부 실코드 일치.
- 차용(D0 전체): ①flow 타입 분리 — capital-flows topReturnLeaders/Laggards(1w·4w)+measurement:
  price_return_proxy+warning(구명칭 deprecated 별칭), flow-analysis returnSignal 스키마(direction 은
  UI 화살표 전용 별칭), korea-flow measurement:measured_investor_net_buy ②flow claim contract —
  buildFlowNarrativeEvidence(KR 실측 |외인+기관|≥3000억=true_flow / 1w 스프레드≥3%p=return_proxy)
  → 프롬프트 계약(허용/금지 동사) → enforceFlowNarrativeContract 백스톱(proxy-only 유입동사 교정 +
  미언급 시 macroAnalysis 만 결정론 append, thesis 불개입) → verify probe(return_proxy_as_flow high /
  unsupported_flow_claim medium, evidence 기반). 스모크 8/8 ③portfolioConstruction 정책 — 현금을
  사후잔여→정책값으로: targetInvested=min(posture캡, 종목수캡), 단일 20~25% 캡, mode 필드 발간
  ④korea-flow 버그픽스+full=1(캐시 우회, 라이브 실증: retailNet null 정직화).
- 이연 기록: ICI 주간 route / ETF shares-outstanding 스냅샷 / TIC / per-ticker intensity 엔진 편입 /
  conditionalEntryWatch(UI 렌더 필요) — 외부소스 검증 각 반나절+, 다음 사이클.
- 11:40 정오 리포트 = 자산이동 주입+최근성+계약+구성정책 첫 통합 실행 (12:08 자동 검증 예약됨).

## [추기 2026-07-04 12:05] 정오 보류-검증-반영 체제 (사용자 지시 "오늘만 다 고친 다음 반영")
- 11:40 자동 파이프라인 중지(generate 전 단계) + lock 으로 catchup/쇼크 억제 + 무발간 수동 생성.
- 산출 검증: verify 0 defects(신규 flow-claim·구성 probe 포함) / thesis 가 **실측 자산이동 반영**
  ("KR 외국인·기관 19,922억 순매수로 단기 지지" — true_flow claim, 계약 준수) / portfolioConstruction
  =thin_defensive(veto율 0.89) 투자 49%+현금 51%, 단일≤20% / US 재충원 AAPL·INCY.
- 발견·즉정정: 콘탱고 신종 변형 "컨탱고" → CONTANGO_VARIANTS 추가(2f16fe86) + 파일 재sanitize.
- 11:46 수동 발간 → 12:00 세션 경계에서 라이브 전환(RECHECK 첫 ALERT 는 버그 아님 — 세션창 전 발간이라
  morning 서빙이 정상. 12:00:17 전환 실측) → 최종 RECHECK OK(portfolio 100%·thesis 대조·빈슬라이스 0).

## [추기 2026-07-04 12:45] 자율 스윕 3회차 + 전 페이지·탭 캡처 검증 (e807b02d)
- 스윕: 좀비 0·/loop 0·check-stall 7/7(라이브정합 lag 0)·Karpathy escape 중앙값 0·디스크 637GB
  여유(스크린샷 28MB — 정리 실익 없음 확인 후 보존).
- **scan-accumulation 44h stale 발견·근본해소**: 슬롯(07:00/16:00 정각)이 morning/afternoon 리포트
  종료창과 겹쳐 lock skip 4연속 — 모니터는 몇 시간째 감지만("본다≠고친다" 전형). fix: ①슬롯 +20분 이동
  ②runMonitor self-heal(stale 잡 즉석 소급, 사이클당 1개·lock 시 다음 사이클 자동 재시도)(6bd484b6).
  재시작 catchup 이 12:08 소급 완료 실증(heartbeat 갱신+산출물 자동커밋).
- **전 페이지·탭 캡처 검증**: audit-pages 확장 — 페이지 14→23(judge/paper-trading/watchlist/blog/
  company US·KR/compare/fear-greed 시장), 탭별 fullPage 캡처 신설. 1차 전수 29항목 0 flag.
  육안 스팟에서 **insider 6탭 미발견 사각지대 실증**(탭 버튼의 카운트 배지가 줄바꿈 붙어 16자 제한 초과)
  → 휴리스틱 fix(첫줄 라벨·26자·hasText 클릭) → 재감사에서 6탭 전부 발견·순회·감사 ✓. judge 퀵액션도 커버.
  monitor-deep 이 --tabs 로 6h 마다 이미 실행 → 확장분 자동 상시화(타임아웃 300→900s 상향).
- 육안: insider(6탭 데이터 풍부)·judge(채팅 UI 클린)·삼성전자 회사페이지(전 섹션 데이터 채움; ko 페이지 내
  영어 설명 잔존은 알려진 번역 TRACKED — "한자보다 영어" 정책상 허용) 확인.

## [추기 2026-07-04 14:00] 전 회사페이지(1,338) 렌더 전수검증 완료 + thesis 자금흐름 서사 보강
- 사용자 "모든 회사 페이지 캡쳐검증 해봤어?" — 정직 답: 대표 2건뿐이었음 → audit-company-render.mjs 신설.
- 1차 전수(15.7분): 렌더에러/NaN/garble/가격미렌더 전부 0. thin 757건은 임계 오탐(페이지 3계층:
  리치형 4천자+/경량형 1.7-2.5천/ETF 0.8-1.1천 — GOOG·PPLT 육안 정상 실증) → 임계 650 재보정.
- 공식 재실행: **COMPANY-RENDER OK — 1,338종목 high 0/med 0/flag 0** (15.5분). 주간 MAINT 등록
  (일 05:40, 렌더 회귀 상시감시)(1756dc48).
- 사용자 "자금 흐름 내용없는데"(정오 thesis) 회고: 데이터 표면(intelligence 탭들) 정상 — 문제는 서술 품질
  ①등락% 주어 부재 ②로테이션(어디서→어디로) 서사 부재 ③KR 수급이 랭킹상위 합계인데 무범위 서술.
  → flow 계약 보강(817e18a6): rotations1w secondary claim + 주어 명시 강제 + "수급 상위 종목 합계" 범위
  명시. 16:18 오후 리포트 검증 예약.

## [추기 2026-07-04 15:00] 자율 스윕 4회차 — ICI 실측 fund-flow 소스 이행 (2f790f64)
- 스윕: 스톨 OK·모니터 결함 0·좀비 0·/loop 0(원샷 검증 cron 만)·디스크 정리대상 없음(재확인).
  중복 크롤 오버랩(수동 실행이 heartbeat 미기록→catchup 재실행) 무해 완주 — 소소 교훈 기록.
- Karpathy: escape 0 유지. inject 소비 정상(garble_sanitized avg 6.7, stale_sanitized avg 4.2 —
  corrector 계열이 학습 순환 중). shadow 발화 누적 48건(일요일 첫 전향성적).
- **이연 D3 이행 — /api/fund-flows(ICI 주간 ETF net issuance)**: HTML 파싱(키 불필요), 12h Redis+
  stale 10d, 파싱실패 명시적 502. 실측 curl = ICI 공표치 전항목 일치(6/24: 미국주식 -4,807 / 해외 +7,035 /
  채권 +7,475 / 원자재 -738 $M). 초기 파싱 2결함(최신 열 방향·Domestic/World 단독 라벨)을 원본 라인
  실측으로 교정. flowEvidence true_flow(US) claim + macro prompt 블록 + TRACKED + FEATURES/METRICS #337.
- 잔여 이연(사유 유지): ETF shares-outstanding 스냅샷(발행사별 페이지 포맷 검증 필요) / TIC 월간 /
  KR per-ticker intensity 엔진 편입(거래대금 데이터 파이프 필요) / conditionalEntryWatch(UI 렌더 필요).

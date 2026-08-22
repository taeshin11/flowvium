# SESSION_LOG

작업 세션의 running log. **매 세션 시작 시 이 파일부터 읽는다.**

- 이 파일 = *세션 단위* 로그. "지금 무엇이 열려 있고, 무엇이 검증됐고, 무엇을 안 했는지".
- `research_history/YYYY-MM-DD_*.md` = *주제 단위* 심층 기록 (CLAUDE.md 규약).
- `HANDOFF.md` = 기기 사망 시 복구 runbook.

기록 규칙: **측정한 것만 쓴다.** "개선됐다" 금지, 숫자와 파일:라인으로 쓴다.
안 한 일과 그 이유도 같이 쓴다 — 다음 세션이 그걸 모르면 같은 판단을 다시 한다.

> ⚠️ 2026-08-22 신설. 사용자가 여러 세션에 걸쳐 이 파일을 물었는데 저장소에 없었다.
> 그전까지의 기록은 `research_history/` 와 커밋 메시지에 있다.

---

## 2026-08-21 ~ 08-22 (진행 중)

### 이 세션에서 고친 것 — 근본 원인이 확인된 것만

| 커밋 | 증상 | 근본 원인 | 증거 |
|---|---|---|---|
| `41036c5d` | Wave1 이 공유 3600s 상한에 함께 죽음 | 직렬 백엔드(`--prompt-concurrency 1`)에 동시 발사 → 큐 대기가 각 요청의 AbortSignal 예산을 먹음 | cron 실측 Wave1 5/5, 자정 4134.9s(옛 상한 초과인데 완주) |
| `652ee910` | `saveDomainArchives` 무동작 | `db.mjs` 의 import 2줄이 **헤더 블록 주석 안**에 있었음(`node --check` 통과) | acorn AST 검사 신설, 오후·저녁 아카이브 소급 |
| `fc94f7f4` | KR 종목 페이지가 16개 로케일 전부 영문 | `middleware.ts` matcher 가 **점이 든 모든 경로**를 제외 (`005930.KS`) | 16/16 로케일 렌더 확인 |
| `a17ea6f6` | KR 뉴스 요약 30.1s 타임아웃·요약 없음 | `preferSmallModel` 이 선언만 되고 라우팅에 미사용 | 30.1s→2.7s, 요약 생성됨 |
| `4ed0efcb` | 유휴 시 "가동률 0%" 오경보 | duty 를 이벤트 *사이* 로만 계산 | 실제 98.3% |
| `fe2f755f` | `stall=TIMEOUT(hang)` ×17, **모니터 6시간 실명** | 내가 넣은 `[9] 백업` 검사가 Drive 에 `readdirSync` 를 상한 없이 | launchd 실측 10분+ 미완료 → 29초 정상 종료 |
| `b3dd826d` | 예약 백업 잡이 **5시간 좀비** | 상한 넘겨 버린 Drive 연산이 libuv 스레드풀 4칸(전부) 영구 점유 → 종료 직전 *로컬* unlink 조차 스케줄 불가 | `sample` 로 libuv-worker ×4 커널 대기 확인 |
| `54c20b00` | /ko 뉴스 태그에 티커↔회사명 환각 발간 | `cascades[].asset` 이 UI 배지로 나가는데 cross-check probe 0 | DART 3,984사 대조 — KR 4건 중 3건 이름 오류 |
| `890a17b4` | /ko 화면에 원시 enum 25건 노출 | 라벨 배선이 컴포넌트 안에만 있어 소비처마다 어긋남 | audit-pages english_leak 25 → 3 |
| `4bff3201` | **깨끗한 clone 에서 보고서 잡 5개가 안 뜬다** | `.sh` 16개가 git 에 실행권한 없이(100644) 커밋됨. launchd 가 argv[0] 로 직접 실행 | fresh clone 재현 → chmod 후 실행 가능 확인 |
| `015371a3` | 회귀 테스트 92개가 **GitHub 에서 한 번도 안 돎** | ci.yml 이 lint·tsc·grep 만 실행. 로컬 훅은 cron 자동커밋 푸시를 안 탐 | CI 시뮬 85통과/7스킵/0실패 |
| `49cd693e` | 탐지한 환각이 `logger.warn` 에서 끝남 | probe→hallucination_history 적재의 마지막 칸이 비어 있었음 | 수확 20건, 재실행 시 중복 0(멱등) |
| `cc425b16` | **내가 `git reset --hard` 로 라이브 DB 파괴** | `data/flowvium.db` 가 git 추적 중(문서는 gitignore 라 주장) | 백업 복구 후 reports 48→205 원상 |

| `4bff3201` | 깨끗한 clone 에서 보고서 잡 5개 기동 불가 | `.sh` 16개가 실행권한 없이 커밋됨 | fresh clone 재현 → 수정 후 실행가능 |
| `73c11b31` | 라이브 DB 파괴를 모니터가 못 봄 | check-stall 이 DB 를 열지만 최신 보고서 한 줄만 읽음 | 파괴본 투입 시 회귀 28건 검출 |
| `f1da95c0` | **/ko/blog 제목·요약 전부 영문** | `blog-translate`·`translate-headlines` 가 `skipVllm:true` 로 로컬 건너뜀 + 429 를 로그 없이 삼킴 | ko 캐시 0/8 적중 · 관련 로그 0건 |

### 이번에 배운 것 (다음 세션이 반드시 알아야 함)

1. **타임아웃은 취소가 아니다.** `Promise.race` 는 기다리기를 그만둘 뿐, 밑의 fs 연산은
   스레드풀에 그대로 남는다. 4칸이 다 막히면 *로컬* fs 도 멈춘다.
2. **`process.exit(0)` 로도 못 빠져나온다.** FIFO 재현 실측 —
   `process.exit(0)` 6초+ 미종료(외부 SIGKILL 필요) vs `process.kill(self,'SIGKILL')` 0.46초.
   libuv 가 종료 시 워커를 join 하기 때문. → 취소 가능한 경계는 **프로세스 경계뿐**.
   재현 테스트: `scripts/lib/threadpool-starvation.test.mjs`
3. **동기 fs 는 호출 스레드에서 돈다** — 스레드풀 기아의 영향을 안 받는다.
   단 느린 경로에 걸면 *메인 스레드* 가 멈춘다(1차 회귀가 이것).
4. `node --check` 는 주석 안에 든 import 를 잡지 못한다 → `source-placement.test.mjs`(acorn).
5. 한 곳만 고치고 나머지를 안 보는 게 이 저장소의 반복 패턴이다. 같은 규율을
   **소비처 전수**에 적용했는지 grep 으로 확인하고 끝낸다.
   이번 세션에서만 세 번 반복했다 — backup 상한(실행기만/판독기 누락),
   role 라벨(CompanyPage 만), 섹터·행동 라벨(페이지마다 손수 맵).
   교정: 라벨·판정 배선은 **컴포넌트 안에 두지 말고 훅/모듈로 뺀다.**
   그리고 '손수 만든 맵의 존재 자체' 를 테스트가 결함으로 본다 — 다시 만들면 또 빠진다.
6. **게이트가 '등록' 만 보고 '사실' 을 안 볼 수 있다.** `check-llm-routing` 의 allowlist 에
   `blog-translate.ts` 가 "로컬 우선 체인의 클라우드 leg" 로 등록돼 있었는데, 그 파일엔
   로컬 호출이 하나도 없었다. 게이트는 통과, 화면은 영문. 등록과 사실의 대조가 필요하다
   (`local-first-translate.test.mjs` 가 그 역할).
7. **주석이 코드보다 낙관적인 사례가 이 저장소에 반복된다.** 오늘만 네 건 —
   `db.mjs:4`("git ignore" 인데 추적 중) · `blog-translate`("vLLM → GROQ" 인데 skipVllm)
   · `translate-headlines`("Ollama → Groq" 인데 skipVllm) · news-cascade("asset 은 ticker").
   **주석의 주장은 검사 대상이다** — 테스트로 대조하지 않으면 아무도 확인하지 않는다.
8. **눈검증이 코드 grep 을 이긴다.** 이번 세션의 가장 큰 결함(티커↔회사명 환각 발간)은
   발간본 화면의 영문 태그 하나를 이상하게 여긴 데서 시작했다. grep 으로는 안 잡혔다 —
   값이 코드가 아니라 LLM 출력이었기 때문이다. 노출되는 LLM 필드에는 probe 를 붙인다.

### 열려 있는 것 — 사용자 조치 필요

- 🔴 **GitHub PAT 폐기**: 이전 세션에서 채팅에 붙여넣어진 토큰이 키체인에 있고 푸시에 쓰이는 중.
  github.com/settings/tokens 에서 삭제 후 재발급, 새 값은 **나에게 알리지 말고**
  `git credential-osxkeychain store` 로 저장.
- 🔴 **Cloudflare 터널 토큰 회전**: `~/Library/LaunchAgents/com.spinai.flowvium-tunnel.plist`
  ProgramArguments 에 **평문**으로 있고 접두부가 전사에 노출됨.
- 🔴 **PAT 재발급 시 `workflow` 스코프 포함** — 없으면 `.github/workflows/` 를 밀 수 없다.
  실제로 CI 개선 커밋이 원격에 거부돼 로컬에 보류 중이다(`ci: lib 회귀 스위트 …`).
  토큰은 어차피 전사 노출로 폐기 대상이므로 재발급할 때 체크만 하면 된다.
- 🟡 **node 에 전체 디스크 접근 권한**: 시스템 설정 → 개인정보 보호 및 보안 →
  전체 디스크 접근 권한 → `/Users/spinai-mini/.local/node/bin/node`.
  **정정(08-22 06:30 실측)**: "원격 백업이 항상 실패한다" 는 내 앞선 기술은 틀렸다.
  launchd 에서도 **DB 는 Drive 에 올라간다** — 원격 사본 실측 154,411,008바이트로
  원본과 일치, `integrity_check=ok`, reports 205행·recommendations 1481행으로 복원 가능.
  막히는 건 *이미 원격에만 있는(dehydrated) 작은 파일의 갱신* 이다:
  `secrets/`·`HANDOFF.md`·`CLAUDE.md`·미러. 원격 HANDOFF.md 는 08-22 00:35 판으로 멈춰 있다.
  → 즉 **기기가 죽어도 DB 는 산다.** 잃는 건 시크릿·runbook 의 최신판과 미러다.
  권한을 주면 그것까지 자동으로 따라온다.

### 의도적으로 안 한 것 (감으로 고르지 않기 위해)

- `squeeze-score.mjs` 배선 — 소비처 0. 배선하면 **투자 추천이 바뀐다**(MRNA → `49 · exhausted · 후보 아님`). 사용자 판단 영역.
- 열 조절기 `MIN_PAUSE` 변경·SMC 팬 제어 도구 설치 — 하드웨어 리스크.
- 차용어 모호 nav 값 강제 번역(de 8·id 6·fr 6·pt 5·vi 2·es 2·tr 1) — 단어별 판단 필요.
- `data/flowvium.db`(159MB)가 git 에 추적 중이고 `.gitignore` 에 없음 — `db.mjs` 헤더 주석과 모순. **보고만 하고 안 건드림**(되돌리기 어려운 변경).

### 내가 낸 사고 — 라이브 DB 파괴 (2026-08-22 10:11)

커밋 순서를 바꾸려고 `git reset --hard <이전커밋>` 을 했다. `data/flowvium.db` 가 **git 추적 중**
이라 커밋본으로 되돌아갔다.

    사고 전  reports=205 · recommendations=1481 · outcomes=1340 · buy_candidates=4382
    사고 후  reports=48  · recommendations=254  · outcomes=214  · buy_candidates=0
    복구     ~/flowvium_backups/flowvium-2026-08-22.db (07:40) · integrity_check=ok · 전 테이블 원상

**오늘 아침 고쳐 둔 백업이 이걸 살렸다.** 그 전 상태(23일 끊긴 백업)였다면 복구 불가였다.

유실: 07:40~10:11 창의 `sell-outcomes` 1회 · Redis 로그 캡(500) 회전으로 수확 대기 결함 19건.

교훈 — 내 실수지만 **구조가 그 실수를 가능하게 했다.** 그리고 이미 문서와 어긋나 있었다:
`scripts/lib/db.mjs:4` 가 "(git ignore)" 라고 *주장* 하는데 `.gitignore` 엔 항목이 없었다.
주석이 코드보다 낙관적이면 아무도 확인하지 않는다. 추적 해제 + `.gitignore` + 검사 신설.
`--strict` 스위트가 파괴를 즉시 잡았다(outcome-integrity·outcome-loop·rule-ic·market-lessons 4건 실패).

**다음 세션 규칙: 이 저장소에서 `git reset --hard` / `git checkout <ref> -- .` 을 쓰기 전에
반드시 `git status`로 추적 중인 런타임 산출물이 있는지 먼저 본다.**

### 강제 재분석 실측 (2026-08-22 08:52, 캐시 삭제 후 live)

프롬프트를 조인 뒤 실제로 어떤 값이 나오는지 캐시를 지우고 확인했다 —
"검증기가 걸러준다" 와 "애초에 안 나온다" 는 다르고, 후자여야 커버리지를 안 잃는다.

    KR 티커 산출: 000660.KS · 005930.KS · 035420.KS · 054180.KS · 068270.KS
                  247540.KQ · 373220.KS   (KRX: 접두 0 · 괄호 회사명 0)
    DART 대조:    SK하이닉스 · 삼성전자 · NAVER · 메디콕스 · 셀트리온
                  에코프로비엠 · LG에너지솔루션   — 7/7 실재
    ko 렌더:      ticker 39 · theme 18 · 영문 테마 0 · 티커 오번역 0
                  ('AI 반도체' · 'EV 배터리' · '건설 자재 공급망' · '광케이블' · '메모리 칩')

→ 이름 주장이 붙은 KR 항목을 버리는 규칙 때문에 커버리지를 잃을까 걱정했는데,
   프롬프트가 애초에 맨 티커를 내므로 그 분기를 타지 않는다. 우려 해소.

### 매수 추천 파이프라인 실측 (2026-08-22, 사용자 질문 "5개 축 다 고려했나")

최근 12개 보고서·후보 382행 기준 카테고리 기여도:

    fundamental 36.9% · price 23.3% · technical 15.5% · guru 14.4% · micro 8.8% · macro 0.8% · rotation 0.2%

축별 결론 — **기술적·기업 상황은 반영, 거시는 사실상 0, 공급망은 배선이 죽어 있었다.**

죽은 배선 2개(둘 다 수정·푸시):
  [A] generate-report-local:6955 이 `ctxRaw.cascade`(news-cascade **기사**)에서
      downstreamBeneficiaries 를 읽었다. 그 스키마엔 그 필드가 없다(실측 12키 전수).
      올바른 소스는 ctxRaw.supplyChainSignals(:3887). → Set 항상 비어 룰 발화 불가.
  [B] supply-chain-signals/route.ts:320 이 `downstreamBeneficiaries: []` 를 박고
      inferDownstream 을 안 불렀다(:190·:570·:608 은 부른다). 2026-06-15 본문파싱 개선 시 회귀.
      → A 만 고쳐도 데이터가 없어 여전히 안 울린다.
  실측: 수정 전 보유 0/20 → 수정 후 1/20, NVDA → 000660.KS · MU · TSM (Set 3종)

거시(0.8%)는 **순서 문제**다 — `buyMacroCtx.riskLevel: null` (:6895 주석: "Wave 1 macroData 가
아직 없음"). 후보 선정이 거시·섹터 분석보다 먼저 돈다. 순서 변경은 투자 로직 결정이라
하지 않고, 대신 '평가 불가' 를 매 실행 경고로 드러냈다:
    ⚠️ [buy-cand] 전 종목에서 null 인 입력 3종 … macroRiskLevel, sectorStance, regionStance

성과(판정 1,340건): 종결 721건 +1.86% vs SPY -0.02% (+1.88%p) · 승률 54.7% · 손익비 약 4:1
                    **not_entered 244건(18%)** — 가장 큰 누수.

**미검증(14:30 오후 보고서에서 확인할 것)**: 현재 발간본의 supplyChainChanges 10건은
downstream 보유 0건(NVDA 도 `down=[]`). 수정 후 첫 보고서에서 `↘ 수혜: SK하이닉스, MU, TSM`
이 떠야 한다. ReportPage.tsx:1575 는 발간 JSON 을 읽으므로 라이브 API 로는 확인 불가.

### '없는 필드를 읽는 코드' 자동 검사 (2026-08-22 신설)

같은 부류를 세 번 만나고서야 도구로 만들었다 — preferSmallModel · ctx.news?.articles ·
ctxRaw.cascade[].downstreamBeneficiaries. 셋 다 `?? []` 가 조용히 삼켜 몇 달간 무증상.

근거는 정적 분석이 아니라 **실행 시점에 기록한 진짜 모양**이다:
    context-coverage.describeContextShapes → logs/ctx-shapes.json (매 보고서 실행 갱신)
    check-context-fields  소스의 필드 접근 ↔ 기록된 모양 대조 (verify-all 등록)

**첫 실행 5건 중 4건이 진짜였다:**
  · insiderMap `i.filings ?? i.count ?? 1` → 항상 1 → micro_insider_buying{gte:3} 구조적 불가.
    라이브가 매도 48:매수 1 이라 행 수를 그냥 세면 매도를 매수 신호로 만든다 →
    insider-direction 단일 출처로 **매수만** 센다. 실측 49건 → NGTF=1.
  · nport 13F 루프 `nport.positions` 없음 → 개통 이래 미실행. byTicker 에 변화율이 없어
    **연결하지 않고 제거**했다(절대 보유량을 변화량 누적기에 넣으면 지표가 오염된다).
  · creditSpread — credit 은 신용*융자 잔고* 지 스프레드가 아니다. 항상 null. 명시로 교체.
    HY OAS 는 FRED BAMLH0A0HYM2 수집이 필요 — 새 통합이라 안 함.
  · fearGreed.us.score — 작동하지 않는 안전망. 제거.

교훈: **`?? 폴백` 은 계측 없이 쓰면 사각지대를 만든다.** 폴백이 100% 발생하면 그건 결함이다.

### 성과 수치 정정 (2026-08-22) — 내가 앞서 사용자에게 틀리게 말한 것

두 가지를 레거시 데이터에 기반해 잘못 보고했다. 파고들어 바로잡았다.

  ✗ "not_entered 18% — 가장 큰 누수"  → **이미 해결됨.** 월별: 05월 29% · 06월 14% · 07월 1% · 08월 0%.
     5·6월 행은 진입가가 QQQ 180~185(실제 677~714)처럼 몇 년 전 값이고 price_at_gen 도 null(204/1485).
  ✗ "초과수익 +1.88%p"  → **최근 구간은 사실상 0.**
     2026-07 이후 종결 167건 · 평균 +1.98% · SPY +2.01% · **초과 -0.03%p** · 승률 50.0%.

조사 중 확인(둘 다 이미 고쳐져 있었다 — 레거시):
  · stop_loss 인데 손익 양수 39/78 → realized-pnl.mjs 가 08-20 수정, 이후 0건.
  · outcome 중복 120건(9%) → 정당한 재평가. 손익 평균 영향 없음(2.04% == 2.04%, 실측).

**live 인 것**: 판정 관용이 2% 일찍 발동한다(hit: target×0.98, stop: stop×1.02).
  hit_target 94건 중 실제 목표 도달 **31건(33%)** · stop_loss 78건 중 33건(42%).
  예 AAPL high_seen 342.89 vs target 346.85 = 98.9%.
  이 수치가 프롬프트에 주입돼 모델이 "목표 94회 달성" 으로 학습한다.
  관용 폭 변경은 성과 측정 정책이라 하지 않고, **주입 문장이 두 수치를 다 말하게** 했다.

### 검증기 오탐이 환각을 가르치고 있었다 (2026-08-22)

오후 보고서가 `flow_movement_missing` 으로 발간 검증 실패 → 푸시 차단.
`--no-verify` 로 덮지 않고 추적하니 **이력 6건 전부 오탐**이었다.

  · `/→| vs /` 가 *비교* 를 *이동* 으로 오판. 걸린 건 전부 ICI 라인이고 부호가 모두 +(유입)였다.
  · 고치자 `return_proxy` claim 두 건이 걸렸다 — 화살표는 있지만 가격 기준 proxy 다.
    바로 위 `return_proxy_as_flow` 검사는 proxy 를 자금유입으로 쓰면 벌한다. **두 검사가 모순.**

핵심: 이 오탐이 hallucination_history → 프롬프트 anti-pattern 으로 주입된다(F26).
  **데이터에 없는 이동 표현을 쓰라고 모델을 가르치고 있었다.** 오탐이 환각을 만든다.
  판정을 `flow-move-claim.mjs` 로 분리 — true_flow 이면서 화살표 또는 **부호 갈림**일 때만 이동.
  결함 1 → 0. 3번 시도(부호규칙 → 배선확인 → kind 반영).

### 오탐률 추적에서 나온 것 3건 (2026-08-22 저녁)

앞 항목("오탐이 환각을 가르친다") 이후 **검증기별 오탐률**을 재 봤다. 다양성 지표
(검출 대비 고유입력 비율)가 낮으면 오탐 신호다. 최근 7일 최대 항목이
`harness_currencyMismatch` 60건 · 고유 60 · 다양성 100% — 반복입력이 아니라 **체계적**이었다.

**(1) 원화에 `$` — 코드가 만들고 코드가 고치고 모델 탓으로 적었다**
  `enrichStopLoss` 가 `isEn`(언어)으로만 분기하고 통화 기호는 항상 `$` 였다.
  KR 종목이 `현재 $281500 → 손절선 ~$261795.00` 으로 만들어졌고 하네스(6j-2)가 매번 되돌렸다.
  집계: **187건 중 185건이 이 코드 산출물, 진짜 모델 오류는 2건.**
  · 발간본은 멀쩡했다(하네스가 먼저 고침) — 독자 피해는 없다.
  · 비용은 오귀인이다. 결함 추세·/admin/logs·오탐률 분석이 그만큼 왜곡됐다.
  · **정정**: 처음에 "프롬프트에 anti-pattern 으로 주입된다"고 썼는데 틀렸다.
    `db.mjs:1377` 이 `harness_*` 를 주입에서 제외한다(2026-06-17부터). 코드로 확인 후 정정.
    주입 경로가 있는 건 접두어 없는 `flow_movement_missing` 쪽이다.
  · `:680` 주석에 2026-05-24 에 같은 증상을 보고 교정기를 붙인 기록 —
    **증상만 덮고 생산자는 석 달간 그대로**였다. 이번엔 생산자를 고쳤다.
  → `scripts/lib/stop-loss-enrich.mjs` 로 분리(통화 판정 단일 출처, 원화 소수점 제거).

**(2) Yahoo `"Too Many Requests"` 가 crumb 이 되고 있었다**
  pre-push 가 `Yahoo v7 quote 401` 로 막혀 추적. 401 은 증상이고 원인은 앞단이었다:
    fc.yahoo 404(정상·쿠키는 나옴) → getcrumb **429** body=`"Too Many Requests\r\n"` → v7 **401**
  가드가 `crumb.length > 30` 으로 **길이만** 봤다. 19자라 통과해 그대로 crumb 파라미터에 실렸다.
  같은 코드가 **6개 스크립트에 복제**돼 있었고 6곳 모두 getcrumb 의 status 를 보지 않았다.
  더 나쁜 것: 실패값이 `_yCrumb` 에 캐시된다 — 한 번 429 면 그 보고서 실행은 끝까지
  Yahoo 가격 0건으로 **조용히** 진행된다.
  429 자체도 자초한 것이다(프로세스마다 따로 getcrumb). → 디스크 캐시로 호출 빈도를 줄였다.
  → `scripts/lib/yahoo-crumb.mjs`. 캐시는 세션 쿠키를 담으므로 `.gitignore` + mode 0600.
  → 이어서 내가 만든 부작용도 잡았다: 모듈 UA 와 호출부 UA 가 달라 같은 401 을 되살릴 뻔했다.
    crumb 은 쿠키·UA 조합에 묶인다 → `YAHOO_UA` 를 함께 반환하고 캐시도 ua 로 무효화.

**(3) 셸 명령 한 줄이 '보고서 실행 중'으로 잡혀 발간을 건너뛸 수 있었다**
  lib 스위트에서 `proc-match` 가 간헐 실패(단독은 통과). 규칙이
  `/node…\s[^\n]*generate-report-local\.mjs/` 라 `node` 와 파일명이 **한 줄에 같이** 있으면 매칭.
  내가 친 `/bin/zsh -c "node scripts/run-lib-tests.mjs … git add … generate-report-local.mjs"` 가 걸렸다.
  같은 함정이 **발간 런처**에 있었다: `run-report.sh` 의 `pgrep -f "generate-report-local"`.
  오탐이면 예약 발간이 `[SKIP]` 으로 조용히 넘어간다 — **발간 누락**.
  실측(미끼 셸 상태): 옛 pgrep `exit=0`(SKIP) / 새 판정 `exit=1`. 옛 정규식 2건 / 새 규칙 0건.
  → `isGeneratorCommand()`: argv[0] basename 이 node 이고 뒤 인자가 그 스크립트일 때만 생성기.
    셸은 내용과 무관하게 제외. `scripts/is-report-running.mjs` 로 셸에서도 같은 규칙을 쓴다.
  · report-running.mjs 주석이 "run-report.sh 와 같은 패턴을 쓴다 — 어긋나면 재발한다"고
    적어 뒀는데 **실제로 어긋나 있었다**. 주석은 규칙을 강제하지 못한다 → 테스트로 봉쇄했다.

교훈: 다양성 100%(항상 다른 입력)는 오탐이 아니라 **체계적 결함**의 지문이다.
      낮은 다양성은 오탐, 높은 다양성은 진짜 버그 — 둘 다 추적할 값이 된다.
      그리고 이번 3건 중 2건은 "증상을 고치는 코드가 이미 있고, 그게 몇 달간 원인을 가린" 형태였다.

lib 스위트 102 → 105 (`--strict` 전부 통과). check-stall 11/11.

### 오탐률 추적 2차 — 결함 3건 더 (2026-08-22 저녁)

**(4) 멀쩡한 문장을 "garble" 로 모델에 가르치고 있었다** — 최근 7일 **최대 주입 항목**
  `narrative_garble_sanitized` 검출 50 · 12개 보고서 전부 · **주입 251회**.
  실물: `llm_value` 와 `correct_value` 가 **같은 문장**이었다.
    LLM    : thesis: "오늘 한국 시장에서는 외국인 투자자가 6,727억 원을 순매수하며 …"
    CORRECT: 교정형 "오늘 한국 시장에서는 …" — 이 garble 반복 금지
  원인은 before/after 를 각각 `.slice(0, 80)` 한 것. 교정은 대개 문장 **뒤쪽**에서 일어나
  앞 80자는 서로 같다. harness_ 접두어가 없어 **실제로 주입된다**(db.mjs:1377 은 harness_/cascade_ 만 제외).
  → `diff-fragment.mjs`: 공통 접두/접미를 걷어내고 바뀐 구간만 담는다. 차이 없으면 기록 안 함.
  · 설계 의도는 옳았다("모델이 garble 자체를 학습"). 자르는 위치가 틀렸을 뿐이다.

**(5) 코드가 쓴 산문을 코드가 정규식으로 되읽어 모델 탓** — `harness_actionCritiqueMismatch` 27건
  전부 `buy→watch (note 매칭)`. 걸린 문장 `⚠️ 고점 주의 — 신규 매수 자제: RSI 78(과매수권)` 은
  코드가 쓴다(`:2200`). 강등 자체는 옳고 **귀속**이 틀렸다.
  더 나쁜 것: 하네스 패턴이 등급별로 고르지 않다 —
    `⚠️ 고점 주의…`(w2-3) 걸림 / `🟠 고점 경고…`(w4-7) 안 걸림 / `🔴 덤핑 고위험…`(w≥8) 안 걸림.
    요약이 상위 2~3개 신호만 담아 `과매수` 라벨마저 잘릴 수 있다.
    → **경미한 과열은 강등되고 심한 과열은 buy 로 남는 역전**이 코드상 가능했다.
    실측: 최근 14일 🟠/🔴 발생 **0건** — 잠재 결함이지 발생 이력은 없다(과장 금지).
  → `peak-risk-action.mjs`: 과열 맵에 들어온 것 자체가 신호이고 등급이 높다고 느슨할 수 없다 → 전부 watch.
    후처리에서 미리 정하므로 하네스 6h 는 `action!=='buy'` 라 지나간다.

**(6) SEC 법인명 title-case 가 약어를 깨서 발간본에 나갔다** — 유일하게 **독자에게 보인** 것
  `harness_usNameMismatch` 32건 중 EOG 9건이 `"EOG Resources"→"Eog Resources Inc"` 였다.
  발간본 **6건**에 `"name":"Eog Resources Inc"` 가 실제로 나갔다.
  원인: `build-company-names.mjs:48` 의 `s.toLowerCase().replace(/\b\w/g, …)`.
  SEC 원본은 전부 대문자라 통째 소문자화하면 약어가 죽는다. 접미 코드 제거도 `/\/\w+$/` 라
  `"AMPHENOL CORP /DE/"`(끝이 `/`)를 못 잡아 16건이 `Corp /De/` 로 남아 있었다.
  · Yahoo 로 통째 교체하지 않은 이유: 875개 대조 결과 이름이 통째로 다른 9건 중
    **PARA 는 Yahoo 쪽이 틀렸다**(티커 재배정 → "Banzai International"). 맹신하면 새 오류가 들어온다.
  → 두 권위 교차검증: 같은 회사면 Yahoo 표기 채택, 어긋나면 SEC 남기고 conflict 로 올림.
    ETF/ETN 은 SEC 에 **발행사**로 등록되므로(VXX→"Barclays Bank PLC") `quoteType` 으로 구분해 상품명 사용.
  결과 905개(+1, 손실 0) · 160개 개선 · 충돌 0건.
    `Nvidia Corp→NVIDIA Corporation` `Kla Corp→KLA Corporation` `Abbvie→AbbVie`
    `Coca Cola Co→The Coca-Cola Company` `Amphenol Corp /De/→Amphenol Corporation`
  · 부수 발견: 채움 조건의 `&& sec[t]` 탓에 SEC 목록에서 빠진 티커가 통째로 누락됐다(SATS/EchoStar).
  · 나머지 22건은 `"Visa"→"Visa Inc."` 류 **정상 축약형**이었다 → `sameCompany()` 로 기록에서 제외.
    같은 판정이 cascade-asset.mjs 에도 따로 있어 한 곳으로 모았다.

이 세션에서 반복된 형태(6건 중 4건): **증상을 고치는 코드가 이미 있고, 그게 원인을 몇 달간 가렸다.**
  통화 교정기(2026-05-24 주석), 하네스 6h, garble 적재, 이름 override 전부 같은 구조다.
  교정기가 있으면 증상이 안 보이므로 아무도 생산자를 안 고친다.

lib 스위트 102 → **108** (`--strict` 전부 통과). verify-all fail 0. check-stall 11/11.

### 매수 추천 성과 — 정정된 최종 수치

    2026-07 이후 종결 167건 · 평균 +1.98% · SPY +2.01% · **초과 -0.03%p** · 승률 50.0%
    hit_target 94건 중 실제 목표 도달 **31건(33%)** — 2% 관용 탓
    not_entered 는 실재했던 문제가 교정됨: 진입상단↔저가 괴리 중앙 -5.1%(5월) → -0.2%(7월)

### 판단이 필요해 남긴 것 (내가 정할 게 아님)

- `Fear & Greed` 내비 표기 — 하위 라벨이 '국가별 Fear & Greed' 로 일부러 혼용 중이라
  브랜드 표기 정책 문제다. '공포·탐욕 지수' 로 바꿀지는 제품 결정.
- 시장 라벨 로케일화 — `src/data/fear-greed.ts:42` 의 `label: 'United States'` 외 20개.
  16 로케일이면 320 문자열이고, 자산군 라벨(`US Stocks (S&P 500)`·`Real Estate (REITs)`)은
  언어별 검토가 필요하다. 검토 없는 대량 번역이 어색한 결과를 낳는 걸 이 세션에서 이미 봤다.

### 미해결 (원인 미확인 또는 미검증)

- `iv` `no_valid_expiries` 정확성 — Yahoo options API 가 내 반복 조회로 429. 미검증.
- `segments-refresh ✓0 ✗4` 매시간 — 10-K 파싱 커버리지(`no-total-row` 41·`no-region` 31·`no-cik` 8·`sum-mismatch`).
- 섹터 분류 이중 버킷 552/1338.
- 어색한 신규 번역: `late_mover=늦게 움직이는 종목`, `first_follower=첫 번째 팔로워`, `judge=AI 판사`.
- `/osint social 0건` 1회(20:03 UTC) — 128 사이클 중 1회, 현재 15건 정상. 일시적으로 판단, 미추적.

### 내가 프로덕션에 끼친 영향 (기록해 둠)

- 22:42–23:20 클라우드 FS 실험이 자정 보고서 `macro` 425s → 2869s(6.7×)와 겹침.
  열 duty 는 75.9% vs 70.0% 로 설명 안 됨 → 내 실험이 원인일 가능성이 높다.
  **보고서 생성 중에는 디스크·Drive 를 건드리는 실험을 하지 않는다.**
- Yahoo options API 429 — 내 반복 조회 때문.

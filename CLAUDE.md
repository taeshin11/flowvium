# FlowVium 프로젝트 규칙

## 🔴 코드 fix 후 즉시 커밋+푸시 의무 (2026-06-03 cron git-checkout wipe 사건 이후 신설)

**발생 경위:** scripts/src 의 fix 들을 커밋 안 한 채 두었더니, `run-report.bat` cron 이 매 실행마다
`git checkout origin/master -- scripts/ src/ public/ messages/ data/*.json package.json` 으로
**미커밋 tracked 변경을 silent wipe**. afternoon cron 이 name-환각 fix 등 11파일을 되돌려 CPRT="Cypress
Semiconductor" 환각이 재발했다. 로컬 커밋만으론 부족 — cron 이 *origin/master* 를 checkout 하므로 **push 필수**.

### 규칙

1. **scripts/ · src/ · public/ · messages/ · package.json · data/*.json 변경 후엔 같은 작업에서 커밋+푸시.**
   build+restart 로 라이브 반영돼도, 푸시 안 하면 다음 cron 이 origin/master 로 revert.
2. **untracked 신규 파일은 cron checkout 이 안 건드려 생존** — 단 버전관리 위해 함께 커밋 권장.
3. **민감파일 절대 커밋 금지**: `.env.local`, `.cf-tunnel-token` (gitignored 확인).

### 자동 감지 (검증체계 — "왜 best practice 안 했는지" 사전 포착)

- `node scripts/check-uncommitted-risk.mjs` — wipe 경로의 미커밋 tracked 변경 + 미푸시 ahead 커밋 감지.
- `check-stall.mjs [5] git wipe-risk` — **주기 모니터에 통합**. 매 사이클 "커밋+푸시 안 된 코드" 를 🚨 로 surface.
  → 이전엔 이 검증이 없어 silent wipe 가 났음. 이제 모니터가 best-practice 미준수를 자동 포착.

---

## 🌐 자가호스팅: 모든 LLM 번역 경로는 로컬 Ollama 우선 (2026-06-03 회사페이지 미번역 사건 이후 신설)

**발생 경위:** Vercel→자가호스팅 전환 후 cloud LLM(groq/gemini/openrouter) quota 가 소진돼 번역이
원문(영어) 그대로 반환됨. news-cascade 는 Ollama 로 고쳤지만 **공유 `/api/translate`(회사/Cascade/
Explore 페이지의 `useTranslatedText`→`<T>`)는 같은 결함 방치** — 한 곳만 고치고 나머지 점검 안 함.

### 규칙

1. **LLM 번역/생성 경로는 `localhost:11434`(Ollama) 우선, cloud 는 fallback.** 자가호스팅이라
   cloud quota 는 상시 소진 가정. 번역 소비처가 여러 곳(news-cascade, /api/translate, …)이면 **전부** 적용.
2. **새 LLM 의존 경로마다 "실제 출력이 목표언어인가" probe 동반** — `check-data-quality [E]` 처럼
   영어 문장 넣고 한글(CJK) 출력 확인. endpoint 200 ≠ 번역 성공.
3. **endpoint-alive ≠ page-rich.** 페이지가 *가용 데이터를 렌더하는지* 까지 검증. KR 회사페이지가
   priceHistory/analyst/recs/DART 필드를 fetch 하고도 안 그리던 사각지대 — audit 는 endpoint 만 봤음.

자동 감지: `node scripts/check-data-quality.mjs` [B](뉴스) + [E](/api/translate).

---

## 🚫 검증은 "가장 완전한 권위 소스"와 대조 — 하드코딩 화이트리스트 금지 (2026-06-03 CPRT="Cypress Semiconductor" 사건 이후 신설)

**발생 경위:** 보고서 portfolio 의 CPRT(Copart) 이름이 LLM 환각으로 "Cypress Semiconductor" 표시.
generate-report-local.mjs 의 name 검증이 ~60개 하드코딩 `US_NAMES_HARNESS`(테크/반도체 위주)로만 돼서
CPRT 가 거기 없어 통과. verify-report 엔 ticker↔회사명 probe 자체가 없었음. 전수조사 결과 환각 광범위
(SMCI="NVIDIA"/"SMIC", CLX="Caterpillar", MP="Morgan Stanley" 등 발행 26키 36건 + DB 23행).

### 규칙

1. **검증/override 의 ground-truth 는 항상 가능한 가장 완전한 권위 소스.** 작은 하드코딩 리스트로
   "일부만" 검증하면 나머지는 silent 통과 — 반복된 안티패턴(14/350 매칭, 60/1210 이름 등).
   - 회사명: `data/company-names.json` (companies-batch*.ts 추출 ~499) + 큐레이션 = `US_NAME_LOOKUP`.
   - 종목 풀: `data/candidate-tickers.json` (1210) — `UNIVERSE_COUNT` / `UNIVERSE_SEARCH`.
2. **새 LLM 출력 필드(name/sector/…)를 노출하면 verify-report 에 cross-check probe 를 같이 추가** —
   defect{defect_type} push → Karpathy `hallucination_history` 적재까지. probe 없는 필드 = 사각지대.
3. **권위 소스 파생물은 build 스크립트로 생성**(`npm run build:names` / `build:universe`) — 손으로 나열 금지.
   batch/cron sync 시 재생성. drift 는 audit-coverage 가 감지.

자동 감지: `npm run verify:report` 의 "ticker ↔ 회사명 일치" probe.

---

## ✅ 모든 fix 후 통합 검증 의무 (2026-05-31 사용자 비판 이후 신설)

**사용자 비판:** "다 고치고 검증할때 검증 일괄적으로 다 되게 해야지"

### 규칙

모든 fix commit / push 직전 **반드시** 통합 검증 1회 실행:

```bash
npm run verify
# = node scripts/verify-all.mjs
```

6 검증 일괄 실행 (각각 별도 spawn):
1. `audit-data-sources` — Stooq/Yahoo/SEC/FRED/CNN 외부 source 헬스
2. `audit-coverage` — DB NULL + endpoint manifest + Karpathy 학습 [10 Probe]
3. `audit-company-pages` — 1,210 종목 × 9 endpoint sample 20
4. `check-static-fallbacks` — 정적 데이터 폴백 (실시간 위장 차단)
5. `check-cron-cost` — Vercel cron 비용 폭증
6. `verify-latest-report` — 최신 보고서 sector/52w/MA/fact-check

### 결과 분기

| 종합 결과 | 의미 |
|---|---|
| ✅ pass (모두) | commit/push OK |
| ⚠️ warn 있음 | 경고만 — push 진행 가능, 다음 cycle 추적 |
| ❌ fail 있음 | **critical 결함 — fix 후 재실행** |

verify-all.mjs 의 exit code 1 = 적어도 하나 fail. CI/cron pre-flight 에 통합 권장.

### 빠른 단일 검증

```bash
npm run verify:report         # 최신 보고서만
npm run verify:coverage       # DB Probe만 (10개)
npm run verify:company        # 1,210 × 9 endpoint
```

### 부분 fix 후에도 "전체 검증" 의무

특정 dimension 만 fix 했어도 verify-all 실행 — 다른 dimension 의 회귀 자동 detect.
예: company-news fix → audit-coverage 의 [10] Probe 가 회귀 catch 가능.

### 자동화 — git pre-push hook (2026-05-31 신설)

수동 의무를 잊지 않도록 git push 시 자동 실행:

```bash
npm run setup:hooks
# = bash scripts/install-hooks.sh
# → scripts/git-hooks/* → .git/hooks/ 복사
```

push 시 자동:
1. `npm run verify` 실행
2. critical fail 시 push **차단** (exit code 1)
3. 우회: `git push --no-verify` (긴급 시만)

### cron 후 자동 verify (2026-05-31 신설)

`generate-report-local.mjs` 가 보고서 발간 직후 자동:
1. `verifyReport(file)` 실행
2. 결함 → `hallucination_history` 적재 (F26 Karpathy source)
3. 결과 → `reports/verify/verify-{ts}.json` 저장 (학습 추세 trail)
4. 다음 보고서 prompt 에 anti-pattern inject

cron 후 사용자가 보고싶으면:
```bash
ls -t reports/verify/ | head -5     # 최근 5건 검증 결과
cat reports/verify/verify-{ts}.json # 결함 상세
```

---

## 🔒 FEATURES.md + METRICS.md 유지 의무 (필수)

이 저장소에 UI 기능 또는 백엔드 엔드포인트를 **추가·수정·삭제**할 때마다 **반드시** 루트의 두 파일을 같은 작업에서 업데이트한다:

1. **`FEATURES.md`** — 기능·UI 카탈로그 (페이지/탭/컴포넌트 단위)
2. **`METRICS.md`** — 개별 수치·지표 체크리스트 (데이터 포인트 단위, 상태 추적)

### 적용 범위 (트리거 목록)

| 변경 사항 | FEATURES.md | METRICS.md |
|----------|-------------|------------|
| 새 페이지 추가 | 새 섹션 생성 | 새 섹션 + 지표별 행 추가 |
| 새 탭 추가 | 탭 서브섹션 | 탭 하위 행 추가 |
| 새 카드·위젯·모달 | 불릿 추가 | 표시 수치 행 추가 |
| 새 지표·수치 표시 | 해당 불릿 수정 | **행 추가 (번호 이어서)** |
| 지표 상태 변경 (missing→live 등) | 해당 불릿 갱신 | **배지 변경** |
| 기존 기능 제거 | 해당 불릿/섹션 삭제 | 해당 행 삭제 + 요약 통계 |
| 🔒 잠금 해제 | 🔒 배지 제거 | 🔒 → ✅/💾 배지 변경 |
| 데이터 소스 교체 | API 테이블 수정 | 소스 컬럼 수정 |
| 새 API 라우트 | 섹션 18 행 추가 | — |
| API 라우트 삭제 | 해당 행 삭제 | 연관 지표 상태 재평가 |
| 새 크론 잡 | 자동화 크론 행 추가 | 관련 지표 주기 갱신 |
| 캐시 TTL 변경 | TTL 컬럼 수정 | 주기 컬럼 수정 |
| 새 공유 컴포넌트 | 섹션 17 행 추가 | — |

### 상태 배지 (METRICS.md)

- ✅ live — 요청 시점 계산 또는 5분 이하 캐시
- 💾 cached — Redis 캐시 (4~26h)
- 🔄 cron — Vercel 크론 주기 갱신
- 📋 static — 하드코딩
- ⛔ missing — 미구현
- 🔒 locked — 유료 API 대기
- ⚠️ buggy — 정상 작동 의심

### 워크플로
1. 코드 수정
2. `FEATURES.md` + `METRICS.md` 해당 섹션 **즉시** 수정
3. 코드 변경과 **같은 작업**에서 처리 (별도 작업으로 미루기 금지)

### 누락 시
- 다음 세션 시작 시 감사 후 역추적 수정
- 코드 기준으로 두 md 파일을 맞춤 (code는 진실의 원천)

---

## 🚨 정적 데이터 폴백 금지 규칙 (필수 — 2026-05-03 institutionalSignals 사건 이후 신설)

**발생 경위:** `institutionalSignals` (Q4 2025 13F 하드코딩) 가 Redis miss 폴백으로 사용되어
`/signals`, `/short`, `/latest-updates`, `daily-brief` 등 여러 페이지에서 몇 달째 stale 데이터가
"실시간"처럼 표시됨. verify-metrics 가 `source` 필드 없이는 정적/라이브를 구분할 수 없어 자동 감지 실패.

### 규칙

**`src/app/api/` 또는 `src/lib/` 에서 `@/data/` 경로의 배열/객체를 값으로 import 할 때마다 아래 3가지를 반드시 같은 작업에서 수행한다:**

#### 1. 응답에 `source` 메타데이터 필드 포함
```typescript
// ❌ 금지
return NextResponse.json({ entries: liveData ?? staticFallback });

// ✅ 필수
const dataSource = liveData ? 'live' : 'static';
return NextResponse.json({ entries: liveData ?? staticFallback, source: dataSource });
```

#### 2. verify-metrics 에 probe 추가
`src/app/api/cron/verify-metrics/route.ts` 에 해당 엔드포인트의 `source` 필드를 체크하는 probe 추가:
```typescript
// source='static' → error (Redis 크론 미실행 감지)
items.push({
  key: 'accuracy.xxx.source',
  status: source === 'live' ? 'ok' : 'error',
  value: `source=${source}`,
});
```

#### 3. 폴백 허용 여부 명시적 결정
| 폴백 데이터 성격 | 처리 방법 |
|---|---|
| 시계열 시장 데이터 (가격, 포지션, 뉴스) | **빈 배열 `[]` 반환** — 절대 정적 사용 금지 |
| 구조/설정 데이터 (색상, 섹터명, 공급망 관계) | 정적 사용 허용 — `source: 'static'` 명시 |
| 과거 역사 기록 (cascade 사례, 이벤트 로그) | 정적 사용 허용 — `source: 'static'` 명시 |

### 자동 감지

```bash
node scripts/check-static-fallbacks.mjs
```

`src/app/api/` 및 `src/lib/` 에서 `@/data/` 값 import를 찾아 `source` 필드 누락 여부를 보고함.
새 API route 작성 후 이 스크립트로 검증 권장.

### 같은 파일 내 파생 필드 하드코딩 금지 (2026-05-05 credit-balance 사건 이후 신설)

**발생 경위:** `credit-balance/route.ts` 의 `const DATA` 배열 안에 `histPercentile`, `riskLevel`, `changeYoY` 가 리터럴로 박혀 있었으나 `check-static-fallbacks.mjs` 가 `@/data/` import 만 감지해 3번 검토에서도 놓쳤음.

**금지 패턴 예시:**
```typescript
// ❌ 금지 — 파생값 하드코딩
const DATA: CountryCreditData[] = [
  { id: 'us', gdpRatio: 123.4, histPercentile: 78, riskLevel: 'high', changeYoY: -9.2 }
]
```

**규칙:** `const DATA`/`STATIC_*`/`FALLBACK_*` 배열 내부에 퍼센타일·등급·파생통계 값을 리터럴로 쓰지 않는다. 반드시 런타임에 계산하거나 Redis/외부 소스에서 가져온다.

| 필드 유형 | 처리 방법 |
|---|---|
| `histPercentile`, `percentile`, `rank` | 런타임 계산 필수 (`historical` 배열 기반) |
| `riskLevel`, `riskScore`, `signal`, `stance` | Redis 기반 또는 계산식 필수 |
| `changeYoY`, `changeQoQ`, `averageReturn` | 시계열 차분 계산 필수 |
| `id`, `name`, `color`, `sector` (구조 메타) | 정적 허용 |

**감지:** `node scripts/check-static-fallbacks.mjs` — Pattern B (ERROR) 가 잡아냄

---

## 🚨 새 API 라우트 / 외부 API 통합 시 의무 (2026-05-29 DART 404 사건 이후 신설)

**발생 경위:** `src/app/api/company-kr/[ticker]` 가 commit `bc46fca` 이후 **계속 100% 404**. DART `company.json` 은 `stock_code` 파라미터를 지원하지 않고 `corp_code` 필수인데, 그 사실을 한 번도 production curl 로 검증 안 했음. audit-coverage 도 endpoint status 분포를 안 봐서 못 잡았고, 보고서마다 portfolio 에 KR ticker 가 있어도 snapshot 자체가 안 일어남.

### 규칙 — 새 외부 API 라우트 또는 외부 API 호출 추가 시 반드시 같은 작업에서

1. **production (또는 dev) 에 한 번 curl** + 응답 첫 100자를 commit message 에 인용:
   ```bash
   curl -s "https://flowvium.net/api/{new-route}" | head -c 200
   ```
   commit message 본문 안에 응답 샘플을 붙여 stored evidence 화.

2. **외부 API 직접 호출도 마찬가지** — 새 외부 endpoint (DART/SEC/FRED/Yahoo 등) 사용 시 `curl '{외부URL}'` 1회 직접 호출로 파라미터 / 응답 구조 검증.

3. **응답 본문에 `error` 필드가 있는지 확인** — HTTP 200 이어도 body 가 `{"error": "..."}` 면 silent failure. `audit-coverage.mjs` 의 Probe [3b] 가 사후에 잡지만, 사전 1회 확인 필수.

### 자동 감지

```bash
node scripts/audit-coverage.mjs
```
- Probe [3b]: endpoint_snapshots 의 4XX/5XX 비율 50%+ 또는 200 OK 인데 body 에 `"error"` 필드 → ❌
- Probe [3c]: portfolio ticker 가 N 개인데 company-* snapshot < N → ❌ (snapshot-endpoints 옵션 점검)

---

## 🔄 cron / batch 의무 — git 최신 코드 동기화 (2026-05-29 신설)

**발생 경위:** 2026-05-29 morning 보고서 (07:08 KST) 가 같은 날 09:20 KST commit 보다 빨라서, 신규 24-endpoint + portfolioTickers 로직이 적용 안 됨. `run-report.bat` 가 `git pull` 없이 마지막 로컬 코드로 실행한 결과 한 사이클 lag 발생.

### 규칙

- `scripts/run-report.bat` 또는 다른 batch / cron 의 첫 단계는 **항상** `git fetch + 코드 파일 selective checkout`:
  ```bat
  git fetch --quiet origin master
  git checkout --quiet origin/master -- scripts/ src/ public/ messages/ data/*.json package.json
  ```
- `git reset --hard` 는 절대 금지 — `data/flowvium.db`, `logs/`, `reports/` 등 로컬 runtime 산출물 소실.
- batch 신설 시 첫 줄에 sync 단계 의무.

---

## 📋 사용자 명시 list 검증 의무 (2026-05-29 "왜 자꾸 빠뜨리니" 사건 이후 신설)

**발생 경위:** 사용자가 "가격, 기술, 거시, 기본, 구루, 회전, 미시" 7개 카테고리를 나열했는데
매수 룰 파일에 "가격(price)" 카테고리가 누락된 채로 진행. 매도 룰 (sell-rules-tuned.json) 추가
직후 매수 룰 대칭 확인 안 했고, 자신이 만든 요약표에 "가격" 컬럼이 빠진 것도 발견 못함.

### 규칙

사용자가 **명시적으로 N개 항목을 나열**(",", "/", "·" 또는 번호 매기기)한 경우:

1. **즉시 checklist 화** — 답변 작성 전 사용자가 나열한 항목을 그대로 받아쓰고 진행.
2. **작업 후 self grep 검증** — 결과물 (코드/문서/데이터) 에 N개 항목 모두 들어갔는지 grep:
   ```bash
   for cat in price technical fundamental guru macro micro rotation; do
     echo -n "$cat: "; grep -c "\"category\":\\s*\"$cat\"" data/buy-rules-tuned.json
   done
   ```
3. **count 불일치 시 즉시 fix 후 표 재작성** — 표가 잘못된 채로 사용자에게 제출 금지.
4. **자동 감지**: `node scripts/audit-coverage.mjs` 의 Probe [5] 가 buy/sell rule 카테고리
   대칭을 매 audit 마다 확인 — 한쪽 누락 시 ❌.

### 적용 트리거 (예시)

- "X, Y, Z 다 고려해서" → checklist [X, Y, Z]
- "P0/P1/P2 다 처리" → checklist [P0, P1, P2]
- "이 6가지 …" → 6개 모두 grep 검증
- "가격, 기술, 거시, 기본, 구루, 회전, 미시" → 7개 카테고리 grep

---

## 🔬 신규 코드 1회 실행 smoke test 의무 (2026-05-29 sectorPe TypeError 사건 이후 신설)

**발생 경위:** `data/buy-rules-tuned.json` + `buildBuyCandidates()` push 후 `node --check` 만
수행 → 5/29 오후 cron 에서 `(sectorPe ?? []).map is not a function` runtime TypeError → 보고서 누락.
`getSectorSummary()` 가 string 인데 신규 코드가 array 라고 잘못 가정.

### 규칙

다음 변경 후엔 반드시 **`node script.mjs` 1회 실제 실행** (timeout 60초, throw 발생 여부 확인):

| 변경 영역 | smoke test 명령 |
|---|---|
| `scripts/generate-report-local.mjs` (신규 단계 추가/수정) | `timeout 60 node scripts/generate-report-local.mjs --model=qwen3:8b 2>&1 \| grep -E "TypeError\|FATAL\|\[1\."` |
| `scripts/lib/db.mjs` 스키마 변경 | `node -e "import('./scripts/lib/db.mjs').then(m=>{m.openDb();console.log('schema OK')})"` |
| 새 외부 API helper (Promise.all 에 추가된 fetch) | `node -e "import('./scripts/...').then(m=>m.newFn().then(r=>console.log(r)))"` |

`node --check` 는 syntax 만 검사 — runtime TypeError / undefined 호출 / 빈 응답 처리 못 잡음.

### Main entry 의 `.catch(console.error)` 금지

`generateViaOllama().catch(console.error)` 처럼 throw 를 console 로만 흘리면 batch 가
`exit code = 0` 으로 인식 → cron 이 [SUCCESS] 로 오기록. **반드시 `process.exit(1)`** 호출:

```js
const onFatal = (e) => { console.error('[FATAL]', e?.stack ?? e?.message); process.exit(1); };
generateViaOllama().catch(onFatal);
```

---

## 🎯 LLM portfolio 출력 안전망 4중 의무 (2026-05-29 NVDA $288 + 056100 환각 사건 이후 신설)

**발생 경위:** 5/29 afternoon 보고서 NVDA entryZone $288-297 (실가 $214, +34% gap → NE 확정),
056100~130.KS 4 종목이 LLM 환각으로 존재하지 않는 ticker (Naver 빈 응답) → 그대로 적재.
17 portfolio 중 6 개만 진입 가능, 11 개는 NE 확정 위험. portfolioOutcomes 30% hit rate 가
LLM 환각으로 인위적으로 낮아지는 구조.

### 규칙 — portfolio 후처리에 4중 안전망

LLM 의 portfolio JSON 을 받은 뒤 `saveRecommendations` 직전까지 다음 4단계 모두 통과:

1. **Ticker 풀 cross-check** (`postProcessPortfolio`):
   - KR 6자리 → `candidate-tickers.json` 의 `.KS`/`.KQ` 정확 lookup. 둘 다 없으면 reject.
   - 잘못된 suffix (.KS↔.KQ) 발견 시 자동 swap.

2. **livePrices 검증**:
   - `livePrices.get(ticker)?.price` 가 falsy 또는 0 이면 portfolio 에서 제외.
   - 가격 없는 ticker 는 entryZone calibration 불가 → NE 확정 차단.

3. **`validateEntryZones` cutoff**:
   - entryZone 이 실가 대비 ±15% 이상 이탈 시 환각으로 판정 (기존 ±50% → ±15% 강화).
   - stop / target 도 ±5%/+2~100% 범위 검사.

4. **`ENTRY_CALIBRATION` 양쪽 환각 catch**:
   - `Math.abs(anchor/base - 1) > 0.05` — anchor 가 base 보다 위 또는 아래 5% 이탈 모두 catch
     (기존 `anchor < base * 0.98` 은 위쪽 환각 미감지).

### 자동 감지 (audit Probe)

| Probe | 검사 | 임계값 |
|---|---|---|
| [7] | recommendations.entry_low~entry_high mid vs price_at_gen gap | ±10% 초과 비율 >10% → ❌ |
| [8] | recommendations.ticker (KR) ∈ candidate-tickers.json 풀 | 풀 외 ticker 1건이라도 → ❌ |

`node scripts/audit-coverage.mjs` 매 push 전 권장.

### KR portfolio cap

- US 6 + KR 6 = 총 12 가 목표.
- LLM 이 KR 11+ 출력 시 `dedupedPortfolio` 후처리에서 강제 slice (US/KR 별도 6 cap).

---

## 🗂️ 기타 프로젝트 관습

- i18n: 모든 UI 문자열은 `messages/*.json`에 넣고 하드코딩 금지
- 16개 언어 동시 업데이트 (ko/en/ja/zh-CN/zh-TW/es/fr/de/pt/ru/ar/hi/id/th/tr/vi)
- Redis 쓰기: 직접 `redis.set` 금지, `loggedRedisSet` 사용
- 외부 fetch: 가능하면 `loggedFetch` 사용 (자동 REDACT + 타이밍)
- 유료 API 탭 락 메시지: "사용자에게 API 키 입력 요구 금지" — "월 $200 후원 목표 도달 시 오픈" 형식만 사용
- `research_history/YYYY-MM-DD_*.txt`에 모든 작업 마일스톤 기록

---

## 🧠 로컬 LLM 본격 운용 가이드

> **⚠️ 2026-06-17 정정 — 실제 하드웨어는 RTX 4090 24GB.** 아래 "RTX 4050 6GB" 가이드는 stale.
> 현재 운용: **WSL Ubuntu 24.04 + vLLM(:8000)** 가 `Qwen3-30B-A3B-Instruct-2507-AWQ`(MoE, ~16.7GB, GPU_UTIL=0.93,
> MAX_MODEL_LEN=52480) 를 GPU 전용 구동. 설정: WSL `/opt/vllm/model.conf` + `/opt/vllm/serve.sh`,
> Windows 스케줄러 `FlowVium-vLLM` 가 로그온 시 기동. `SERVED_NAMES="flowvium-local qwen3:8b"` 로
> 구코드의 `qwen3:8b` 참조도 vLLM 으로 흡수. **`VLLM_URL` 환경변수는 미설정** — generate-report 가
> 기본 `localhost:8000` 으로 직결. 모델 교체는 model.conf 의 MODEL/MAX_MODEL_LEN/EXTRA_ARGS 수정 후
> `schtasks /run /tn FlowVium-vLLM`. 24GB 헤드룸이 크므로 6GB 시절의 q3/offload 고민은 불필요.
> 재부팅·런처 종료 시 vLLM 동반 사망 가능 → `session-spotcheck` + `pm2-watchdog` 와 별개로
> `:8000` 헬스를 복구 스크립트가 확인. (구 Ollama 경로는 fallback 으로만 잔존.)

목적: 로컬 우선, cloud LLM 폴백.

<details><summary>이하 RTX 4050 6GB 시절 가이드 (역사적 참고 — 현재 미적용)</summary>

### Stage 1 — Ollama 환경변수 (적용 완료)

```powershell
setx OLLAMA_KV_CACHE_TYPE q8_0       # KV cache 50% 절감
setx OLLAMA_FLASH_ATTENTION 1        # FA2 활성화 (속도+메모리)
# Ollama 재시작 (시스템 트레이 → Quit Ollama → 재실행)
```

### Stage 2 — 14B 모델 운용

**옵션 A: Ollama 14B Q3 (즉시, 무료)**
```bash
ollama pull qwen2.5:14b-instruct-q3_K_M    # ~7.3 GB
node scripts/generate-report-local.mjs --model=qwen2.5:14b-instruct-q3_K_M
```
주의: 7.3 GB 라 GPU + CPU offload 발생 → 8B 보다 느릴 수 있음. 품질 ↑.

**옵션 B: TabbyAPI + EXL2 (본격, 1시간 구축)**
```powershell
.\scripts\setup-tabbyapi.ps1
# huggingface-cli download turboderp/Qwen2.5-14B-Instruct-exl2 --revision 3.5bpw ...
.\.tabbyapi\start.bat
setx VLLM_URL http://localhost:5000/v1
# 이후 ai-providers.ts 의 callVLLM 이 자동 활용 (Vercel + 로컬 generator 양쪽)
```
EXL2 3.5bpw = ~6 GB, GPU only, GGUF Q4 동급 quality + 속도 2-3배.

### 우선순위 순서 (로컬 우선)

```
ai-providers.ts:  vLLM (VLLM_URL) → GROQ → Qwen(OpenRouter) → Gemini → Claude → fallback
generate-report-local.mjs: vLLM (VLLM_URL) → Ollama → fail
```

`VLLM_URL` 미설정 시 vLLM step skip — 기존 Ollama-only 동작 유지.

### 결함 추적

`harnessAudit` 메타필드(→ `reports.audit_json`) + `harness_*` 결함의 `hallucination_history` 적재로
환각 카운트의 **시간적** 추세는 추적된다 (`check-stall` [4] median 트렌드).

> **✅ 2026-06-17 구현 — 모델별(per-model) 결함률 추적.** `reports.model` 컬럼(runtimeModel = 실제
> 모델명, 예 Qwen3-30B-A3B) + `getModelDefectRates(days)` (hallucination_history ⋈ reports.model,
> harness_* 제외). 기존 DB 는 openDb 마이그레이션이 ALTER + source 백필(과거 행도 귀속). 단일 모델
> 프로덕션이어도 **지금부터 baseline 누적** → 2번째 모델 도입 시 즉시 A/B 비교.
> *(이전에 "단일 모델이라 정당한 미루기"로 미뤘으나, 저비용 작업을 회피한 게으른 미루기였음 — 사용자
> 지적으로 정정. baseline 은 지금 시작해야 전환 시점에 비교 데이터가 존재하므로 오히려 지금이 적기.)*
> 측정: `node -e "import('./scripts/lib/db.mjs').then(m=>console.table(m.getModelDefectRates(30)))"`

</details>

---

## 💸 Vercel 빌드 시간 절감 규칙 (필수 — 2026-04-24 사건 이후 신설)

**발생 경위:** 2026-04-24 하루 master push 139건 × 평균 빌드 ~97초 = **3시간 46분 빌드 시간 누적**.
이 중 다수가 `research_history/`, `*.md` 만 변경한 docs-only 커밋이라 빌드 자체가 낭비.

### 규칙

1. **로컬에서 commit 여러 개 누적 후 1번 push** — 매 commit마다 push 금지 (push 1회 = build 1회).
2. **docs-only 커밋은 자동 skip** — `vercel.json`의 `ignoreCommand: bash scripts/vercel-should-build.sh` 가
   다음 경로만 변경된 push 시 빌드를 스킵한다:
   - `research_history/`, `reports/`, `logs/`, `.claude/`, `*.md`
3. **새 docs 경로 추가 시 `scripts/vercel-should-build.sh` 의 exclude 목록 갱신**.
4. **`scripts/check-cron-cost.mjs` 도 같이 통과해야 함** — cron 비용 폭증 방지 (Vercel 과금 사건 후 신설).

### 자동 검증

```bash
# docs-only 변경인지 확인
bash scripts/vercel-should-build.sh
# exit 0 = skip (docs-only) / exit 1 = build (code changed)
```

---

## 🔄 `/loop` 검증 프로토콜 (필수)

`/loop` 실행 중 "verify-metrics / 값 정합성 검증 / live test" 류의 지시가 있으면
**아래 5단계를 전부** 수행한다. 이 프로토콜 없이 "검증 완료" 라고 쓰면 안 된다.

### 1. Drift check (기존 rule)
- 최근 5 커밋 훑기 → 같은 영역 3+ iter 연속 / primary metric 3+ iter 정체 /
  "나중에" 3+ deferred / 인프라 블로커 2+ retry-only 중 하나라도 해당되면 drift,
  이번 iter 영역 이동 또는 공식 포기.

### 2. Primary outcome 선언 (≤20자, 기존 rule)
- "폴리싱", "리팩터", "미들웨어 추가" 처럼 cheap tactical 들리면 재고.

### 3. ⚠️ 외부 실값 대조 (MANDATORY — 2026-04-22 CNN F&G stale 사건 이후 신설)

"endpoint alive" 와 "value accurate" 는 다르다. 이번 iter 가 건드린 수치 또는
primary outcome 영역의 **최소 1개 숫자를 외부 공식 소스와 직접 비교**한다:

| 수치 유형 | 공식 소스 | 비교 방법 |
|----------|----------|----------|
| F&G 점수 | `https://production.dataviz.cnn.io/index/fearandgreed/graphdata` | `fear_and_greed.score` 반올림 vs 우리 US score |
| FRED 지표 | `https://fred.stlouisfed.org/graph/fredgraph.csv?id={SERIES}` | 마지막 non-`.` 값 vs 우리 응답 |
| 주가 | `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}` | 최근 close vs 우리 응답 |
| CME FedWatch | `https://www.cmegroup.com/.../cme-fedwatch-tool.html` | 페이지 텍스트 grep vs 우리 응답 |

**로그 필수 형태:**
```
[accuracy probe] metric=fg.us source=CNN direct_value=68 our_value=70 delta=2 tolerance=3 → OK/DEGRADED/ERROR
```

숫자 나란히 기록 없이 "값 정합성 OK" 라고 쓰면 규칙 위반. 자동화는
`/api/cron/verify-metrics` 의 `group: 'accuracy'` 섹션이 대신하므로 매 iter
그걸 먼저 fetch 해서 요약하고 시작해도 된다.

### 4. UI 실제 렌더 확인 (user-facing outcome 일 때)

curl API probe 만으로 "live test" 종료 금지. 사용자가 보는 형태로 검증:
- `curl https://flowvium.vercel.app/{locale}/{page}` 로 HTML 수신
- 관련 텍스트 grep (i18n 렌더, 데이터 주입 확인)
- 차트/인터랙션은 **"미검증"** 으로 명시 (브라우저 없이 불가)

### 5. 캐시 계층 감사 (새 fetch 추가 시 MANDATORY)

Next.js 15 App Router 의 `fetch()` 기본값은 **`force-cache`** — 옵션 누락 시
외부 응답이 module 수명 내내 stale 됨. 새 fetch 추가 또는 수정 시 반드시:

- 실시간 값: `cache: 'no-store'` 명시
- 의도된 캐시: `next: { revalidate: N }` 명시
- 옵션 없이 bare `fetch()` 는 **리뷰 리젝트**

감사 대상 3 계층:
1. Redis (`@upstash/redis`)
2. 모듈 메모리 (`@/lib/memory-cache`)
3. **Next.js fetch layer** ← 맹점, 코드에 명시 안 됨

### 6. 산출물 / Negative result / 빈 iter (기존 rule 3~5 유지)

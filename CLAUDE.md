# FlowVium 프로젝트 규칙

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

## 🗂️ 기타 프로젝트 관습

- i18n: 모든 UI 문자열은 `messages/*.json`에 넣고 하드코딩 금지
- 16개 언어 동시 업데이트 (ko/en/ja/zh-CN/zh-TW/es/fr/de/pt/ru/ar/hi/id/th/tr/vi)
- Redis 쓰기: 직접 `redis.set` 금지, `loggedRedisSet` 사용
- 외부 fetch: 가능하면 `loggedFetch` 사용 (자동 REDACT + 타이밍)
- 유료 API 탭 락 메시지: "사용자에게 API 키 입력 요구 금지" — "월 $200 후원 목표 도달 시 오픈" 형식만 사용
- `research_history/YYYY-MM-DD_*.txt`에 모든 작업 마일스톤 기록

---

## 🧠 로컬 LLM 본격 운용 가이드 (RTX 4050 6GB VRAM 환경)

목적: 로컬 우선, cloud LLM 폴백. 6GB VRAM 한계에서 최대 quality.

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

`harnessAudit` 메타필드 + `harness_fixes_applied` 로그로 모델별 결함률 비교 가능.
14B 도입 후 `krNameMismatch`, `rationaleDedup` 등 카운트가 줄면 모델 효과 검증된 것.

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

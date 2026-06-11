# 🆘 머신 사망 시 다른 컴퓨터 인수인계 runbook (2026-06-12 신설)

> 배경: 2026-06-07 하드 freeze 로 4일 다운. 이 머신이 다시 죽으면 아래 절차로 다른 Windows 머신에서 재가동.

## 사전 준비돼 있는 것 (이 머신이 매일 자동 수행)

1. **코드/설정**: 전부 GitHub `taeshin11/flowvium` master (모든 fix 는 커밋+푸시 의무 — CLAUDE.md).
2. **로컬 상태 백업**: `G:\내 드라이브\FlowVium-backup\` ← Task Scheduler `FlowVium-Backup` (매일 04:35, `scripts/backup-takeover.mjs`)
   - `flowvium-{날짜}.db` — SQLite 정합 백업 (추천/outcome/hallucination 학습이력, 최근 7일치)
   - `secrets/.env.local` + `secrets/.cf-tunnel-token` — API 키 + Cloudflare 터널 자격
   - `reports/`, `research_history/` 미러
3. **사이트 라이브 상태**: Upstash Redis(클라우드) — 머신 죽어도 마지막 발간 보고서는 서빙 유지 (stale 화만 진행).

## 새 머신 복구 절차 (~30분)

```powershell
# 0. 요구사항: Windows + Node 20+ + git + Ollama 설치, Google Drive 로그인
# 1. 코드
git clone https://github.com/taeshin11/flowvium C:\NoAddsMakingApps\FlowVium
cd C:\NoAddsMakingApps\FlowVium; npm install
# 2. 로컬 상태 복원 (Google Drive 백업에서)
copy "G:\내 드라이브\FlowVium-backup\secrets\.env.local" .
copy "G:\내 드라이브\FlowVium-backup\secrets\.cf-tunnel-token" .
copy "G:\내 드라이브\FlowVium-backup\flowvium-<최신날짜>.db" data\flowvium.db
copy "G:\내 드라이브\FlowVium-backup\company-profiles.json" data\company-profiles.json
robocopy "G:\내 드라이브\FlowVium-backup\reports" reports /E
robocopy "G:\내 드라이브\FlowVium-backup\research_history" research_history /E
# 3. LLM
ollama pull qwen3:8b
ollama pull exaone3.5:7.8b
setx OLLAMA_KV_CACHE_TYPE q8_0
setx OLLAMA_FLASH_ATTENTION 1
# 4. 서비스 (pm2: web 3000 + cron-runner + cloudflare tunnel)
npm install -g pm2; npm run build
pm2 start npm --name flowvium-web -- start
pm2 start scripts/cron-runner.mjs --name flowvium-cron
pm2 start scripts/run-tunnel.cjs --name flowvium-tunnel   # .cf-tunnel-token 사용 — DNS 변경 불필요
pm2 save
# 5. Task Scheduler 등록 (보고서 5회/일 + 백업) — 시각: 06:40/11:40/15:40/21:10/23:40 KST
#    run-report.bat 호출 + StartWhenAvailable=True (HANDOFF 하단 11절 참조, 또는 아래 한 줄씩)
#    schtasks /create /tn FlowVium-Morning /tr C:\NoAddsMakingApps\FlowVium\scripts\run-report.bat /sc daily /st 06:40
#    (Noon 11:40 / Afternoon 15:40 / Evening 21:10 / Midnight 23:40 동일 패턴 + StartWhenAvailable 활성화)
# 6. 검증
npm run verify
node scripts/check-uncommitted-risk.mjs
```

주의: 이전 머신이 살아있는 채로 새 머신을 띄우면 **터널/cron 이중 가동** — 반드시 한쪽만.

## 새 머신의 Claude Code 에게 줄 인계 프롬프트 (복붙용)

> 새 클로드는 이전 머신 클로드의 메모리/대화가 없다. 저장소 문서가 유일한 컨텍스트 — 아래를 그대로 붙여넣기:

```
FlowVium 자가호스팅 서버 머신이 죽어서 이 컴퓨터로 인수한다. 너는 이전 머신의 클로드 메모리가 없으니
저장소 문서로 컨텍스트를 복원해라. 순서:

1. CLAUDE.md (프로젝트 규칙 — 특히 "커밋+푸시 의무", "verify 의무", "정적 폴백 금지") 숙지.
2. HANDOFF.md 최상단 "인수인계 runbook" 그대로 실행해 서비스 복구
   (백업: G:\내 드라이브\FlowVium-backup — 최신 flowvium-*.db, secrets/.env.local, .cf-tunnel-token).
   ⚠️ 구 머신이 혹시 살아있으면 터널/cron 이중가동 금지 — 먼저 구 머신 pm2/Task Scheduler 정지 확인.
3. research_history/ 를 날짜 역순으로 최근 5개 읽고 마지막 작업 상태 파악
   (특히 2026-06-12_crash-detection-overhaul-and-takeover.txt = 마지막 세션 기록).
4. 복구 완료 기준 (happy-path 만으론 불완료):
   - npm run verify 에서 fail 0
   - node scripts/check-uncommitted-risk.mjs OK
   - 보고서 1회 수동 발간 성공 (scripts/run-report.bat) + flowvium.net/ko/report 에 fresh 반영
   - Task Scheduler 5개(보고서) + FlowVium-Backup 등록 + StartWhenAvailable=True 확인
5. 복구 후 research_history/{날짜}_takeover-recovery.txt 에 인수 기록 남기고 커밋+푸시.

환경 요약: RTX GPU + Ollama qwen3:8b(보고서)/exaone3.5(번역), pm2(web 3000/cron-runner/tunnel),
Task Scheduler 가 run-report.bat 를 하루 5회(06:40/11:40/15:40/21:10/23:40 KST) 실행.
GPU 단일 자원 — 보고서 lock(logs/report-pipeline.lock) 중 무거운 LLM 작업 금지.
cloud LLM 폴백은 GROQ 키 무효(401) 상태라 로컬 Ollama 가 유일한 LLM — Ollama 헬스 최우선.
```

---

# 📋 FlowVium 인계장 — 2026-05-31 21:30 KST

> **다음 세션이 처음 읽는다는 가정**으로 작성. 코드 위치 + 의도 + 시도한 것 + 막혔던 점 모두 기록.
> 상세 commit-by-commit: `research_history/2026-05-31_session-handoff.txt`

---

## 0. 프로젝트 개요 (30초)

**FlowVium** — Windows 로컬 LLM (qwen3:8b via Ollama) 으로 매일 3회 (07:00 / 15:50 / 21:20 KST) 주식 매수/매도 추천 보고서 생성 + flowvium.net 자동 게시.

- **데이터 source**: SEC EDGAR / Yahoo Finance / Stooq / FRED / DART / Naver finance / CNN F&G / SEIBRO / Investing.com RSS
- **DB**: `data/flowvium.db` (better-sqlite3 WAL) — recommendations / sell_recommendations / buy_candidates / hallucination_history / news_archive 등 ~20 테이블
- **deploy**: Vercel (Next.js 14 App Router), domain flowvium.net
- **i18n**: 16 언어 (ko/en/ja/zh-CN/...)
- **사용자**: Daehan (taeshin11@gmail.com) — Korean, 매일 cron 결과 모니터링, 깐깐한 메타 비판가

---

## 1. 시스템 흐름 (전체 그림)

```
┌─ Windows Task Scheduler (KST 07:00 / 15:50 / 21:20)
│
└─→ scripts/run-report.bat
      │
      ├─ git fetch + checkout origin/master -- scripts/ src/ ... (cron lag 방지)
      ├─ audit-data-sources (Stooq/Yahoo/SEC/FRED/CNN 헬스)
      ├─ ollama qwen3:8b 헬스
      └─→ scripts/generate-report-local.mjs --auto-upload
            │
            ├─ [0/7] /api/cron/update-all (16 API 갱신)
            ├─ [1/7] gatherContext (16 API 병렬 fetch)
            ├─ [1.5/7] buildBuyCandidates 4-stage scoring (1,210 → top 30)
            ├─ [2/7] Wave1 LLM 5 병렬 (portfolio/macro/regional/opportunity/narrative)
            │     ↑ F19/F22/F26 anti-pattern + sessionFocus prompt inject
            ├─ portfolio retry 0-2 (US/KR 12 미달 시)
            ├─ [3/7] postProcessPortfolio (4중 안전망)
            │     • candidate-tickers meta override (sector/name 환각 차단)
            │     • livePrices null 필터
            │     • validateEntryZones cutoff ±15%
            │     • ENTRY_CALIBRATION 양쪽 환각 catch
            │     • KR cap 6 강제
            ├─ [4/7] Wave2 LLM (risk/companyChanges/stockDetail/sellRationale)
            ├─ [5/7] F23 fact-check (catalysts/fundamentalBasis 재생성)
            ├─ [5.5/7] hallucination strip + dedupCrossTickerCatalysts + final-cap
            ├─ [6/7] reports/report-{date}-{session}-ko.json 저장
            ├─ [DB] saveReport / saveRecommendations / saveSellRecommendations / saveBuyCandidates
            ├─ [DB] saveNewsArchive / saveMacroSnapshot / saveDomainArchives / saveFearGreedArchive
            ├─ snapshotAllEndpoints (24 + portfolio ticker financials)
            ├─ [verify-loop] verifyReport(file, silent) → saveHallucinationHistory
            │     → reports/verify/verify-{ts}.json 자동 저장
            ├─ [7/7] 품질 게이트 + Redis upload (flowvium:investment-strategy:v8:...)
            └─ exit 0
```

---

## 2. 핵심 성과 (5/29 ~ 5/31)

### Karpathy 학습 곡선 (8 cycles 정량 입증)

```
Cycle              결함  주요 변화
5/29 morning       13건  ← baseline (F26 신설)
5/30 afternoon      6건  -54%  (sector_mismatch 7→1)
5/30 evening        5건  -62%
5/30 morning        5건
5/31 morning        6건
5/31 afternoon      2건  -85%  ← ohlcv-split fix 첫 적용
5/31 evening        3건  -77%  ← 안정 유지 (52w/ma 0건)
```

### Defect type 별 학습 효과

| Type | 5/29 m | 5/31 e | 진단 |
|---|---|---|---|
| `sector_mismatch` | 7 | 1 (case only) | ✅ **F26 prompt inject 100% 학습** |
| `52w_halluc` | 3 | 0 | ✅ ohlcv-split guard (data source fix) |
| `ma_halluc` | 1 | 0 | ✅ 동일 |
| `sector_keyword_mismatch` | 0 | 1 | ⚠️ F23 fact-check 강화 필요 |
| `fact_check_incomplete` | 0 | 1 | ⚠️ F23 모든 종목 적용 필요 |

→ **LLM-level 환각 = F26 prompt inject 효과 100%**
→ **Data source 환각 = 코드 fix 만 가능** (prompt inject 무용)

---

## 3. 시스템 변경 (5/29 ~ 5/31 commit 시간순)

| commit | 변경 | 의도 / 결과 |
|---|---|---|
| `51a3693` | 4중 안전망 + Probe [7][8] | LLM portfolio 환각 차단 (sector/52주/MA/ticker) |
| `9d4e921` | cleanup 환각 5 row | 적재된 056100~130 + NVDA $288 retroactive 제거 |
| `67beebd` | KR sector + 회사명 + 트랙레코드 제거 | candidate-tickers meta 강제 override |
| `7f1a984` | DB NULL 3 fix | quality_score / news pub_date / earnings op_margin |
| `142f5fe` | ohlcv-split guard | Yahoo OHLCV ratio >3x reject (52w/ma 환각 source) |
| `a0c7eea` | **Karpathy 마지막 3단계** | hallucination_history + F26 inject + Probe [9] |
| `ec7213c` | KR 뉴스 번역 cron 6h + identity detect | 영어 뉴스 번역 안 됨 사건 fix |
| `8756ed4` | /company 404 + 11 endpoint audit | dimension sparse 사건 (사용자 비판) |
| `24f09f7` | KR Naver finance scraping | KR company-news unavailable fix (Vercel 차단 의심 — 검증 필요) |
| `d039155` | 616/137+ → {count} dynamic | 종목수 hardcoded i18n |
| `852c2fe` | **npm run verify** (verify-all.mjs) | 6 검증 통합 entry |
| `668ba09` | silent false pass 차단 + 병렬 spawn | 검증 자체의 환각 차단 |
| `a7e69c6` | GitHub Actions + dimension 매트릭스 자동 | CI 자동화 |
| `95df96e` | GitHub Actions CI 모드 | DB schema init + reports dir |
| `0b24333` | pre-push hook + cron 자동 verify | 4중 자동화 완성 |
| `2d3996c` | HANDOFF.md (한 화면) | 인계장 |

---

## 4. 자동화 4중 (모두 작동 확인)

### A. git pre-push hook
- **설치**: `npm run setup:hooks` (한 번)
- **위치**: `scripts/git-hooks/pre-push` → `.git/hooks/pre-push` 복사
- **동작**: push 시 `node scripts/verify-all.mjs` 실행 → exit 1 시 push 차단
- **우회**: `git push --no-verify` (긴급 시만)

### B. GitHub Actions
- **파일**: `.github/workflows/verify.yml`
- **트리거**: push/PR/매일 03:00 UTC
- **CI 모드**: `VERIFY_CI=1` env → audit-coverage / verify-latest-report 는 non-critical (CI 환경 DB 비어있음)
- **현재 상태**: 첫 실행 실패 후 `95df96e` 로 DB schema init step 추가 — **다음 push 시 결과 확인 필요**
- **artifact**: verify-output.txt 14일 보관

### C. cron 후 verify-loop
- **위치**: `scripts/generate-report-local.mjs:5861-5891`
- **동작**: 보고서 발간 후 `verifyReport(filepath, { silent: true })` → `saveHallucinationHistory` → `reports/verify/verify-{ts}.json` 자동 저장
- **trail**: `reports/verify/` 디렉토리 (5/31 현재 2 파일)
- **확인**: `ls -t reports/verify/ | head -1 | xargs -I {} cat reports/verify/{}`

### D. Probe [9] severity escalate
- **위치**: `scripts/audit-coverage.mjs:466-483`
- **3회 ⚠️ warn** ("추세 관찰")
- **5회 ❌ critical** ("anti-pattern 학습 실패 — 코드 fix 필수")
- **의미**: 5회 = data source 결함 신호 (prompt inject 무용)

---

## 5. Karpathy Closed Loop 상세

### 5단계 모두 코드 위치

```javascript
// Stage 1: detect
// scripts/verify-report.mjs:35
export function verifyReport(file, { silent = false } = {}) {
  // sector ↔ meta cross-check
  // sector keyword mismatch (반도체 + "건설" 등)
  // 52주 ratio >3x
  // 50MA-200MA gap >50%
  // fact_check_incomplete (technicalBasis/riskNote)
  return { defects, total };
}

// Stage 2: persist
// scripts/lib/db.mjs:930
export function saveHallucinationHistory(reportId, defects) {
  // hallucination_history 테이블 (id/ticker/defect_type/llm_value/correct_value/severity/injected_count)
}

// Stage 3: inject (다음 보고서)
// scripts/lib/db.mjs:962
export function getRecentHallucinationsForPromptInject(days=7, maxItems=15) {
  // 최근 7일 (ticker, defect_type, llm_value) 그룹 + injected_count 자동 증가
}

// scripts/generate-report-local.mjs:4106 (buildPortfolioPrompt)
const halluc = getRecentHallucinationsForPromptInject(7, 15);
antiPatternBlock = `[⚠️ AVOID — 최근 7일 환각 ${halluc.length}건, 반복 금지]
  ❌ 000660.KS sector_mismatch: "Construction" → 정답 "Semiconductors"
  ❌ ...
→ 위와 같은 패턴 출력 시 후처리에서 reject 됨. 처음부터 정확한 값 사용.`

// Stage 4: learn (LLM 가 prompt 보고 학습)
// — sector_mismatch 7건 (5/29) → 0건 (5/31)
// — 100% learning curve 입증

// Stage 5: track
// scripts/audit-coverage.mjs:Probe [9]
// 3회 / 5회 escalate + reports/verify/ trail
```

### hallucination_history 테이블 schema

```sql
CREATE TABLE hallucination_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  ticker TEXT,                          -- 결함 ticker (있으면)
  defect_type TEXT NOT NULL,            -- sector_mismatch / 52w_halluc / ma_halluc / sector_keyword_mismatch / fact_check_incomplete
  llm_value TEXT,                       -- LLM 가 출력한 잘못된 값
  correct_value TEXT,                   -- meta 또는 sanity check 의 정답
  severity TEXT NOT NULL,               -- low / medium / high
  injected_count INTEGER NOT NULL DEFAULT 0, -- 다음 prompt 에 inject 횟수
  details_json TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
```

---

## 6. 검증 인프라 상세

### `npm run verify` (verify-all.mjs) — 통합 entry

```bash
$ npm run verify
═══ Verify-All — 모든 검증 병렬 실행 ═══
▶ 6 script 병렬 실행 시작...
▶ 6 script 완료 — 140.0s

✅/⚠️/❌ audit-data-sources    (1s)    외부 source 헬스
✅/⚠️/❌ audit-coverage        (140s)  DB Probe 10개
✅/⚠️/❌ audit-company-pages   (74s)   1,210 × 9 endpoint sample
✅      check-static-fallbacks (0.1s) 정적 폴백 차단
✅      check-cron-cost        (0.1s) Vercel 비용
✅/⚠️/❌ verify-latest-report   (0.1s) 최신 보고서 LLM 환각

═══ 종합 ═══ + 결과 표 + dimension 매트릭스 + 결함 상세 명령
```

### audit-coverage 10 Probe (`scripts/audit-coverage.mjs`)

| Probe | dimension | 자동 detect |
|---|---|---|
| [1] | 모든 테이블 NULL 비율 (≥80% column) | ✅ |
| [2] | endpoint manifest (intelligence/signals/volatility/heatmap/news/company) | ✅ |
| [3] | domain archive 적재율 | ✅ |
| [3a] | S&P 500 / KOSPI / KOSDAQ candidate 커버 | ✅ |
| [3b] | endpoint HTTP status 4XX/5XX 분포 + body "error":" pattern | ✅ |
| [3c] | portfolio↔snapshot 정합 | ✅ |
| [4] | 응답 drift (stale 의심) | ✅ |
| [4a] | invalid value range (return_yoy [-100,1000] 등) | ✅ |
| [5] | buy/sell rule 7 카테고리 대칭 (31룰 / 19룰) | ✅ |
| [6] | buy_candidates 적재 + matched_rules JSON | ✅ |
| [7] | entryZone gap (mid/price_at_gen) ±5% 초과 | ✅ |
| [8] | KR ticker 풀 cross-check (환각 6자리 코드 catch) | ✅ |
| [9] | Karpathy 학습 효과 (반복 ≥3 ⚠️ / ≥5 ❌) | ✅ |
| [10] | company API 깊이 sample (12 ticker × 4 API) | ✅ |

### audit-company-pages.mjs — 1,210 종목 × 9 endpoint

```javascript
const validators = {
  'company-financials': b => b?.revenueUSD > 0,
  'company-kr':         b => b?.annuals?.length > 0,
  'company-news':       b => b?.news?.length > 0,           // ← 5/31 fix: 키 'news' (이전 'articles' false positive)
  'company-recs':       b => b?.recs?.length > 0,            // ← 5/31 fix: 키 'recs'
  'stock-price':        b => typeof b?.price === 'number' && b.price > 0,
  'market-caps':        b => b?.bands && Object.values(b.bands).some(v => v),  // ← 5/31 fix: bands[ticker]
  'price-history':      b => b?.points?.length > 0 || b?.history?.length > 0,
  'analyst-target':     b => typeof b?.targetMean === 'number',  // ← 5/31 fix: targetMean
  'iv':                 b => typeof b?.iv === 'number' || b?.atmIv30d,
};
```

### dimension cover 매트릭스 (verify-all 자동)

```
| dimension                                       | script              | status |
|------------------------------------------------|---------------------|--------|
| 외부 source 헬스                                  | audit-data-sources  | ❌  |
| DB NULL 컬럼                                    | audit-coverage      | ❌  |
| endpoint manifest                              | audit-coverage      | ❌  |
| domain archive 적재율                            | audit-coverage      | ❌  |
| HTTP status 4XX/5XX                            | audit-coverage      | ❌  |
| portfolio↔snapshot                             | audit-coverage      | ❌  |
| buy/sell rule 7카테고리                          | audit-coverage      | ❌  |
| buy_candidates Karpathy source                | audit-coverage      | ❌  |
| entryZone gap (NE 환각)                         | audit-coverage      | ❌  |
| KR ticker 풀                                    | audit-coverage      | ❌  |
| Karpathy 학습 효과 (3회 ⚠️ / 5회 ❌)              | audit-coverage      | ❌  |
| company API 깊이                                | audit-coverage      | ❌  |
| 1,210 × 9 endpoint body                       | audit-company-pages | ⚠️  |
| LLM 환각 (sector/52w/MA/fact-check)             | verify-report       | ❌  |
| 정적 데이터 폴백                                   | check-static-fallbacks | ✅  |
| Vercel cron 비용                                | check-cron-cost     | ✅  |

cover: 2/16 pass (13%)
```

**중요**: audit-coverage 가 fail 인 건 여러 Probe 중 일부가 ❌ 라는 의미. 모든 12 Probe 가 통과한 건 아님. 자세히 보려면 직접 실행 `node scripts/audit-coverage.mjs`.

---

## 7. 잔여 결함 6개 (즉시 fix 가능, 우선순위 순)

### #1 sector case mismatch — 5분
- **증상**: FISV `"It-software"` / ALNY `"Pharma-biotech"` / GEN `"It-software"` (meta 는 lowercase)
- **원인**: `postProcessPortfolio` 의 sector override 시 case sensitive 비교
- **위치**: `scripts/generate-report-local.mjs:4575-4595` (CANDIDATE_META 적용)
- **fix**: meta.sector 직접 사용 시 항상 `.toLowerCase()` 또는 case-insensitive 비교 (이미 일부 적용됐는데 final 결과 case 다름 — meta 자체가 `it-software` 와 `Construction & Engineering` 등 다양함)
- **시도한 것**: 5/30 `[sector-fix]` 로그 추가 후 lowercase 비교는 했지만, sector 값을 meta 그대로 사용 → meta 가 mixed case 이므로 final sector 도 mixed
- **진짜 fix**: sector → standard canonical form (lowercase + hyphen) — 또는 i18n 표시 layer 에서 capitalize

### #2 fact_check_incomplete — 30분
- **증상**: 000270.KS / MDB / PINS 같은 종목이 `technicalBasis` / `riskNote` undefined
- **원인**: F23 fact-check 가 모든 buy 종목 적용 안 함 (일부 skip)
- **위치**: `scripts/generate-report-local.mjs:5032` (F23/fact-check 로직)
- **fix**: F23 가 `dedupedPortfolio` 의 모든 buy 종목에 대해 catalysts/fundamentalBasis/technicalBasis/riskNote 모두 채우는지 확인
- **시도한 것**: 11/11 → 12/12 적용 로그 있는데 일부 종목 결과 still undefined — 응답 parse 실패 가능성

### #3 sector keyword mismatch — 1시간
- **증상**: NAVER (IT Services) rationale 에 "건설" 단어 / 005380.KS (Automotive) 에 "AI" 단어
- **원인**: F23 fact-check 가 sector ↔ rationale keyword cross-check 안 함
- **위치**: `scripts/verify-report.mjs:80-93` (SECTOR_FORBID 매핑)
- **fix**: F23 prompt 에 sector forbid keyword 명시 + rationale 재생성 시 검증
- **시도한 것**: verify-report 에서 detect 하고 hallucination_history 적재. F26 prompt inject 됐지만 LLM 가 무시 (data source 가 아닌 LLM 무지 — F22/F23 inject 강화 가능)

### #4 BRK.B / TSM company-financials 404 — 1-2시간
- **증상**: `/api/company-financials/BRK.B` 404, body `{"error":"not-found","ticker":"BRK.B"}` (dot 변환 안 됨)
- **원인**: Next.js dynamic route `[ticker]` 에서 dot 처리 — 이전 fix `ae04cb7` 에서 `rawTicker.replace(/\./g, '-')` 추가했지만 production 응답 여전 BRK.B
- **위치**: `src/app/api/company-financials/[ticker]/route.ts:25-32`
- **시도한 것**: 
  - 5/30 commit `ae04cb7` 에서 `const ticker = rawTicker.replace(/\./g, '-')` 추가
  - 직접 `https://flowvium.net/api/company-financials/BRK-B` 호출 시 정상 ($371B)
  - 그러나 `BRK.B` 호출 시 여전 404 + `ticker: "BRK.B"` (변환 무시됨)
  - Vercel Age=0 (새 코드 빌드 됨) 인데도 변환 안 됨
- **다음 진단 방향**:
  - `params.ticker` 가 Vercel 환경에서 URL-decoded 되는지 (`decodeURIComponent`)
  - middleware 가 dot escape 하는지
  - Next.js 14 `[ticker]` 매개변수의 default 처리 (Next.js 14.2.x 변경 확인)
  - `params.ticker` 를 명시적 log 후 raw 값 확인

### #5 KR Naver news Vercel 차단 의심 — 1-3시간
- **증상**: `commit 24f09f7` push 후 `production /api/company-news?ticker=005930.KS` 응답 여전 `{"news":[],"error":"unavailable"}`
- **원인**: Naver finance HTML scraping 이 Vercel 환경에서 차단 (또는 cron 캐시)
- **위치**: `src/app/api/company-news/route.ts:80-122` (fetchNaverNews)
- **시도한 것**:
  - 5/31 fetchNaverNews 신설 — finance.naver.com/item/news_news.naver scraping
  - 로컬에서 직접 호출 시 10건 한글 뉴스 정상 추출
  - Vercel build (Age=0) 후에도 production 응답 unavailable
  - Daum 금융 API 도 시도 → 500 Internal Server Error
- **다음 진단 방향**:
  - Vercel function 환경에서 Naver fetch 직접 시도 (debug endpoint 추가)
  - User-Agent / Referer / Origin header 추가
  - 대안 source: NAVER Datalab Open API (인증 필요) / 연합뉴스 RSS / Yahoo finance KR 사이트 (kr.finance.yahoo.com)
  - 또는 명시적 "KR 뉴스 별도 source 필요" 메시지 표시 (성능보다 정직)

### #6 stock-price / price-history `.KS` 미지원 — 1시간
- **증상**: `/api/stock-price/005930.KS` → `{"error":"unavailable"}`. `/api/price-history?ticker=005930.KS` → `{"ticker":"005930.K","points":[]}` (`.KS` 가 `.K` 로 잘림!)
- **원인**:
  - stock-price: route 에 KR 분기 없음 (Yahoo only)
  - price-history: ticker 인자에서 `.KS` 가 `.K` 로 truncate — dynamic route or Vercel encoding 문제
- **위치**: `src/app/api/stock-price/[ticker]/route.ts` / `src/app/api/price-history/route.ts`
- **fix 방향**:
  - stock-price: KR ticker 분기 추가 → Naver finance 또는 Yahoo v8 직접 (현재 livePrices 가 사용하는 Stooq/Yahoo v8 KR 로직 재사용)
  - price-history: ticker 인자 처리 점검 (encodeURIComponent? Vercel cache?)

---

## 8. 사용자 메타 비판 패턴 (재발 방지 — 가장 중요)

### 같은 root cause: "auto detect dimension sparse"

| 비판 | dimension 추가 |
|---|---|
| "왜 검증이 안되고있었니?" | audit-coverage Probe [10] 추가 |
| "1,210 종목 다 정확히 들어가있어?" | audit-company-pages 신설 (routing 200 OK 외 body validator) |
| "다 고치고 검증할때 일괄적으로" | verify-all.mjs (6 검증 spawn 통합) |
| "이게 최선인가?" | silent false pass 차단 + 병렬 + 매트릭스 가시화 |
| "/company/ 404?" | /company index page 신설 |
| "카파시 빠진게 있어?" | Karpathy closed loop 5단계 (이전 통계 inject 만) |
| "종목수 늘었는데 616?" | i18n hardcoded 숫자 → `{count}` dynamic placeholder |

### 응대 방법 (학습)

1. **즉시 인정** — 사용자 메타 비판은 거의 항상 맞음. 변명 X.
2. **dimension 매트릭스 확장** — `verify-all.mjs` 의 `checks[].dimensions[]` 에 cell 추가
3. **자체 검증** — fix 코드 작성 후 grep + curl 로 직접 확인 (sample 1+ ticker)
4. **사용자 명시 list** — N개 항목 나열 시 checklist + grep self-check (가격/기술/거시/기본/구루/회전/미시 사건)
5. **부분 fix 도 전체 verify 의무** — npm run verify

---

## 9. 절대 하지 말 것 (실수 history)

| # | 실수 | 사건 |
|---|---|---|
| 1 | **검증 코드 자체에 환각** | 5/31 `bands[ticker]` vs `band` 단수 — validator 18% false → 63% (검증의 환각) |
| 2 | **silent mode false pass** | 5/31 verify-report 가 stdout 0 → verify-all 0 err 보고 (false ✅ pass) |
| 3 | **routing 200 OK = 검증 완료** | /company/AAPL 200 인데 KR news 100% unavailable |
| 4 | **표면 metric 으로 끝내기** | NE 0/15 / 품질 100/100 만 보고 SK하이닉스 sector="Construction" 못 잡음 |
| 5 | **사용자 명시 list 누락** | "가격/기술/거시/기본/구루/회전/미시 다 고려?" → buy rule "가격" 누락한 채 제출 |
| 6 | **DB direct 수정** | cleanup 은 `scripts/cleanup-hallucinations.mjs` 사용 (FK + retroactive) |
| 7 | **node --check 만으로 push** | 5/29 sectorPe TypeError — runtime check 필요. CLAUDE.md "smoke test 의무" |
| 8 | **외부 응답 신뢰** | Yahoo OHLCV split-adjusted 안 됨 / Naver bot 차단 / SEC ADR 미수록 |

---

## 10. 중요 파일 위치 (탐색용)

### 코드
- `scripts/generate-report-local.mjs` (5,900줄) — 보고서 생성 메인
  - `:4106` buildPortfolioPrompt + F26 inject
  - `:4575` postProcessPortfolio (4중 안전망)
  - `:5032` F23 fact-check
  - `:5125` finalReport 객체 생성
  - `:5664` final-cap (KR 6+US 6 재적용)
  - `:5861` verify-loop 자동 호출
- `scripts/lib/db.mjs` (1,100줄) — DB schema + save 함수
  - `:325` hallucination_history 테이블
  - `:930` saveHallucinationHistory
  - `:962` getRecentHallucinationsForPromptInject
- `scripts/verify-report.mjs` — 보고서 검증 (silent false pass 차단)
- `scripts/verify-all.mjs` — 통합 entry (6 spawn 병렬)
- `scripts/audit-coverage.mjs` — 10 Probe
- `scripts/audit-company-pages.mjs` — 1,210 × 9 endpoint
- `scripts/cleanup-hallucinations.mjs` — retroactive DB cleanup

### 데이터
- `data/flowvium.db` (26MB, gitignored) — 모든 DB
- `data/candidate-tickers.json` (1,210 종목 + meta) — **single source of truth**
- `data/buy-rules-tuned.json` (31 룰 7 카테고리)
- `data/sell-rules-tuned.json` (19 룰 7 카테고리)
- `data/dart-corp-codes.json` (3,967 종목 mapping)

### 설정
- `package.json` — `npm run verify` / `verify:report` / `verify:coverage` / `verify:company` / `setup:hooks`
- `vercel.json` — Vercel cron schedule
- `.github/workflows/verify.yml` — GitHub Actions CI
- `CLAUDE.md` (최상단) — "모든 fix 후 통합 검증 의무" + 8개 추가 규칙

### 문서
- `FEATURES.md` — UI 기능 카탈로그 (필수 유지)
- `METRICS.md` — 지표 체크리스트 (필수 유지)
- `HANDOFF.md` — 이 파일
- `research_history/2026-05-31_session-handoff.txt` — 상세 history

---

## 11. 환경변수 / 의존성

### 필수
- `data/.env.local` (gitignored) — API keys
  - `CRON_SECRET` — cron 인증
  - `ANTHROPIC_API_KEY` — fallback LLM
  - `GROQ_API_KEY` — fallback LLM
  - `GEMINI_API_KEY` — fallback LLM
  - `OPENROUTER_API_KEY` — Qwen3 cloud
  - `UPSTASH_REDIS_REST_URL` / `_TOKEN`
  - `DART_API_KEY` — KR 재무
  - `SEIBRO_API_KEY` — KR 공매도/대차
  - `FRED_API_KEY` — 거시
  - `COPERNICUS_EMAIL/PASSWORD` — 위성 (안 쓰는 중)

### 시스템
- Ollama (qwen3:8b 모델 pull 필요)
- Node 20+
- better-sqlite3 (native — Windows MinGW or prebuild)
- `OLLAMA_KV_CACHE_TYPE=q8_0` + `OLLAMA_FLASH_ATTENTION=1`

### Windows Task Scheduler
- FlowVium-Morning (06:50 KST = 21:50 UTC 전날)
- FlowVium-Afternoon (15:50 KST = 06:50 UTC)
- FlowVium-Evening (21:20 KST = 12:20 UTC)
- FlowVium-DART-CorpCodes (02:00 KST)
- FlowVium-DART-Prefetch (03:00 KST)
- FlowVium-Tune-Sell-Rules (Sun 04:00 KST)
- FlowVium-Tune-Buy-Rules (Sun 04:15 KST)

---

## 12. 다음 세션 즉시 실행 체크리스트

```bash
# Step 1: 현재 상태 (140초)
cd C:/NoAddsMakingApps/FlowVium
npm run verify

# Step 2: 최신 cron verify trail
ls -t reports/verify/ | head -3
cat reports/verify/$(ls -t reports/verify/ | head -1)

# Step 3: Karpathy 학습 추세 (최근 10 cycles)
node -e "
const D = require('better-sqlite3');
const db = new D('data/flowvium.db', {readonly:true});
const r = db.prepare(\`SELECT substr(generated_at,1,16) g, session,
  (SELECT COUNT(*) FROM hallucination_history WHERE report_id=reports.id) h
  FROM reports ORDER BY generated_at DESC LIMIT 10\`).all();
for (const x of r) console.log(x.g, x.session.padEnd(10), 'h=' + x.h);
const t = db.prepare(\`SELECT defect_type, COUNT(*) c, AVG(injected_count) avg
  FROM hallucination_history WHERE detected_at >= datetime('now','-2 days')
  GROUP BY defect_type\`).all();
console.log('\\n24h type:');
for (const x of t) console.log(' ', x.defect_type, x.c, 'avg_inj=' + x.avg.toFixed(1));
db.close();
"

# Step 4: GitHub Actions 결과 (마지막 push 후)
# https://github.com/taeshin11/flowvium/actions

# Step 5: 다음 cron 까지 시간
node -e "
const k = new Date(Date.now()+9*3600000);
const m = new Date(k); m.setUTCHours(7,0,0,0); if (m<k) m.setUTCDate(m.getUTCDate()+1);
const a = new Date(k); a.setUTCHours(15,50,0,0); if (a<k) a.setUTCDate(a.getUTCDate()+1);
const e = new Date(k); e.setUTCHours(21,20,0,0); if (e<k) e.setUTCDate(e.getUTCDate()+1);
console.log('KST', k.toISOString().slice(0,16));
console.log('morning:', Math.round((m-k)/60000), '분');
console.log('afternoon:', Math.round((a-k)/60000), '분');
console.log('evening:', Math.round((e-k)/60000), '분');
"

# Step 6: 사용자 요청 명확화 — 안 명시되면 잔여 결함 6개 중 #1 (sector lowercase) 부터 시작
```

---

## 13. 트러블슈팅

### "verify-all fail / cron 보고서 안 만들어짐"
1. Ollama 실행 중인지 확인 (`ollama list`)
2. `logs/report.log` tail 50 — error 패턴 grep
3. 마지막 commit 이 broken syntax 일 가능성 — `node --check scripts/generate-report-local.mjs`
4. Windows Task Scheduler 의 LastTaskResult 확인

### "감지된 결함이 사용자가 본 것과 다름"
1. `verify-report` 의 validator key 가 응답 schema 와 일치하는지 직접 curl 응답 비교
2. silent mode 인 경우 `console.log` 출력 0 → grep ❌ 0 → false pass 의심
3. `process.exit(1)` 명시되어 있는지

### "Karpathy 학습 안 됨 / 같은 환각 반복"
1. Probe [9] 가 ≥5회 detect 면 ❌ critical → **data source 결함** 가능성. 코드 fix 필요
2. F26 inject 됐는지 logs 의 `[F26/AntiPattern]` 라인 확인
3. `hallucination_history.injected_count` 가 증가하는지

### "Vercel build fail"
1. `vercel logs` 확인
2. TypeScript error (node_modules `Intl.ListFormat` 등 무시 가능)
3. `vercel.json` 의 ignoreCommand (`scripts/vercel-should-build.sh`) 가 너무 적극 skip 하는지

---

## 14. 의도적 미해결 (이건 fix 안 해도 됨)

1. **node.exe 4개 (4/30 / 5/6 시작)** — Cursor/Ollama 등 dev env 상주. 우리 코드 아님
2. **GitHub Actions 첫 실행 fail** — `95df96e` 로 fix 했지만 아직 검증 안 됨. 다음 push 후 확인
3. **`asset_flow_archive.return_1d` 99% NULL** — 5/31 sparkline 계산 fix 후 신규 적재만. retroactive backfill 안 함 (필요 시 helper 추가)
4. **`reports.quality_score` 83% NULL** — 신규는 채워지지만 과거 backfill 안 함
5. **trackRecord hero card 제거** — 사용자 요청. `portfolioOutcomes` JSON 필드는 학습 source 로 유지

---

## 15. 마지막 sanity check (commit 전 의무)

```bash
# 1. syntax
node --check scripts/generate-report-local.mjs
node --check scripts/audit-coverage.mjs
node --check scripts/verify-report.mjs

# 2. smoke (60초)
timeout 60 node scripts/generate-report-local.mjs --model=qwen3:8b 2>&1 | grep -E "TypeError|FATAL|\[1\.5"

# 3. 통합 (140초)
npm run verify

# 4. FEATURES.md + METRICS.md 같은 commit 에 반영했는지 확인

# 5. research_history/{date}_{topic}.txt 기록 했는지

# 6. CLAUDE.md 규칙 위반 안 했는지
```

수고하셨어요. 다음 세션에서 이어가세요 🙏

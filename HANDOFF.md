# 📋 인계장 — FlowVium (2026-05-31 21:30 KST)

> 다음 세션이 즉시 읽고 시작할 수 있는 한 화면 인계.
> 상세 history: `research_history/2026-05-31_session-handoff.txt`

---

## 🎯 핵심 상태 (3줄)

1. **Karpathy closed loop 완성** — 5/29 13건 → 5/31 evening 3건 (-77%, 8 cycles 입증)
2. **자동화 4중 완성** — git pre-push hook / GitHub Actions / cron verify-loop / Probe [9] escalate
3. **잔여 결함 6개** — 모두 minor + 즉시 fix 가능

---

## ⚡ 즉시 실행 명령 (다음 세션)

```bash
# 1. 현재 상태 점검 (140s, 6 검증 병렬)
npm run verify

# 2. 최신 cron verify trail
ls -t reports/verify/ | head -1 | xargs -I {} cat reports/verify/{}

# 3. Karpathy 학습 추세 (8 cycles)
node -e "const D=require('better-sqlite3');const db=new D('data/flowvium.db',{readonly:true});const r=db.prepare(\`SELECT substr(generated_at,1,16) g, session, (SELECT COUNT(*) FROM hallucination_history WHERE report_id=reports.id) h FROM reports ORDER BY generated_at DESC LIMIT 8\`).all();for(const x of r)console.log(x.g,x.session,x.h);db.close();"

# 4. 다음 cron 시각 (07:00 / 15:50 / 21:20 KST)
node -e "console.log(new Date(Date.now()+9*3600000).toISOString().slice(0,16))"
```

---

## 🚨 잔여 결함 (우선순위 순)

| # | 결함 | 위치 | 추정 소요 |
|---|---|---|---|
| 1 | **sector case mismatch** (FISV "It-software" / ALNY "Pharma-biotech") | `postProcessPortfolio` 에서 sector `.toLowerCase()` 강제 | 5분 |
| 2 | **F23 fact_check_incomplete** (000270.KS 2회 반복) | F23 가 모든 buy 종목 적용 (현재 일부 skip) | 30분 |
| 3 | **sector keyword mismatch** (NAVER rationale "건설") | F23 가 sector ↔ rationale keyword cross-check | 1시간 |
| 4 | **BRK.B / TSM company-financials 404** | Next.js dot route escape 진단 (이전 `ae04cb7` fix 후에도 여전) | 1-2시간 |
| 5 | **KR Naver news Vercel 환경 차단 의심** | commit `24f09f7` 후 production 검증 + 대안 source | 1-3시간 |
| 6 | **stock-price / price-history `.KS` 미지원** | route 에 KR ticker 분기 추가 | 1시간 |

---

## 🤖 자동화 4중 (모두 작동 중)

```
1. git pre-push hook       (npm run setup:hooks 후) — push 시 verify 차단
2. GitHub Actions          (.github/workflows/verify.yml) — push/PR/매일 03:00 UTC
3. cron 후 verify-loop     (generate-report-local.mjs) — reports/verify/verify-{ts}.json
4. Probe [9] escalate      (3회 ⚠️ / 5회 ❌ critical)
```

---

## 📊 verify-all 마지막 결과 (5/31 22:14)

```
✅ pass 2  / ⚠️ warn 1  / ❌ fail 3  / cover 2/16 dimensions
총 140s (병렬)
```

| Script | Status | Detail |
|---|---|---|
| audit-data-sources | ❌ | Stooq/Yahoo v7/CNN F&G fail |
| audit-coverage | ❌ | DB NULL 잔여 + BRK.B 404 + portfolio↔snapshot |
| verify-latest-report | ❌ | 5/31 evening 3건 (모두 minor) |
| audit-company-pages | ⚠️ | KR stock-price/price-history 50% |
| check-static-fallbacks | ✅ | |
| check-cron-cost | ✅ | |

---

## 📝 사용자 메타 비판 패턴 (재발 방지)

**모든 비판이 같은 root cause** = "auto detect dimension sparse"

| # | 비판 | dimension 확장 |
|---|---|---|
| 1 | "왜 검증이 안되고있었니?" | audit-coverage Probe [10] 추가 |
| 2 | "1210 종목 다 정확히?" | audit-company-pages 신설 (body validator) |
| 3 | "일괄 검증 해야지" | verify-all.mjs (6 검증 spawn) |
| 4 | "이게 최선?" | silent false pass 차단 + 병렬 + 매트릭스 |
| 5 | "/company/ 404?" | /company index page 신설 |
| 6 | "카파시 빠진게 있어?" | Karpathy 5단계 closed loop |

→ **새 feature 추가 시 verify-all `checks[].dimensions[]` cell 추가 의무** (CLAUDE.md 최상단)

---

## 🔑 중요 파일 위치

| 파일 | 역할 |
|---|---|
| `scripts/verify-all.mjs` | 통합 검증 entry — 6 spawn + 매트릭스 |
| `scripts/verify-report.mjs` | 최신 보고서 결함 detect (silent false pass 차단) |
| `scripts/audit-coverage.mjs` | DB 10 Probe (NULL / manifest / Karpathy) |
| `scripts/audit-company-pages.mjs` | 1,210 종목 × 9 endpoint body |
| `scripts/lib/db.mjs` | hallucination_history 테이블 + saveHallucinationHistory |
| `scripts/generate-report-local.mjs:5861-5891` | cron verify-loop (보고서 발간 후 자동) |
| `.github/workflows/verify.yml` | CI 자동 |
| `CLAUDE.md` 최상단 | "모든 fix 후 통합 검증 의무" + 8개 추가 규칙 |
| `data/candidate-tickers.json` | 1,210 종목 풀 (single source of truth) |

---

## ⚠️ 절대 하지 말 것

1. **검증 코드 자체에 환각** — validator response key 직접 확인 (5/31 `bands[ticker]` 사건)
2. **silent mode false pass** — `process.exit(1)` 명시 (verify-report 5/31 사건)
3. **routing 200 OK = 검증 완료** — body 데이터까지 봐야 함 (1,210 종목 사건)
4. **사용자 명시 list 누락** — N개 나열 시 checklist + grep self-check (가격/기술/거시/기본/구루/회전/미시 사건)
5. **DB direct 수정** — cleanup script 사용 (`scripts/cleanup-hallucinations.mjs`)
6. **표면 metric 으로 끝내기** — sector/52w/MA fact-check 도 봐야 함

---

## 📞 막히면

1. `CLAUDE.md` 최상단 8개 의무 규칙 읽기
2. `research_history/` 최근 5개 grep
3. `data/candidate-tickers.json` meta — 1,210 종목 정확한 sector/name source
4. `hallucination_history` 테이블 — 과거 환각 패턴 (반복 금지)

수고하셨어요 🙏

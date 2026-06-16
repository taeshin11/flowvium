# 2026-06-16 — Deep monitor (A 렌더감사 + B 정확도probe) + DB 전향적 적재

## 배경 (사용자 요구)
- "monitor때 하는 일이 뭐야? 맨날 사각지대가 있는데" → 기존 session-spotcheck 9점검은 대부분 **liveness**
  (살아있나/신선한가)였고 **correctness**(값이 맞나)는 발행시 1회(post-publish-recheck)뿐. 전체페이지·탭은
  수동 실행때만. 관찰값은 logs/*.json 덮어쓰기라 **이력 휘발** → 시간축 결함률/정확도 drift 연구 불가.
- "a,b 다 해야지. 데이터 db저장은 하니? 전향적연구가능?" → A+B 둘 다 상시화 + DB append-only 적재로
  **전향적(forward-looking) 코호트 연구** 가능하게.

## 구현
1. **DB 3테이블** (`scripts/lib/db.mjs` SCHEMA, append-only 타임스탬프):
   - `monitor_runs` — 실행 요약(pages_audited/total_flags/high_flags/probes_run/probes_error/duration).
   - `render_audit_log` — A: 페이지·탭별 detector 플래그(double_sign/won_label/cjk_bleed/…) + 스니펫.
   - `accuracy_probe_log` — B: metric별 our_value/source_value/delta/tolerance/verdict.
   - `saveMonitorObservation()` 1트랜잭션 적재 + `getLatestMonitorRun()`.
2. **`scripts/monitor-deep.mjs`** (무거운 잡, A+B):
   - A: `audit-pages.mjs --tabs` 전체 14페이지+탭 렌더감사 → page-audit.json 파싱 → DB.
   - B: 정확도 probe 4종 — fg.us(CNN 공식), yield.10y(Yahoo ^TNX), vix(Yahoo ^VIX), spy(Yahoo SPY)
     vs 우리 발행값. delta 누적이 핵심(전향적). CNN은 browser헤더 필요, FRED CSV는 봇차단→Yahoo 대체.
   - 결과 DB 적재 + logs/monitor-deep-status.json + 1줄 출력.
3. **session-spotcheck [10]** — deep 결과 surface + 6h throttle 로 detached spawn(비블로킹, hang-safe).
   lock(<15m) 로 중복 spawn 방지. high flag/probe error 만 ALERT.

## 스모크 검증 (1회 실행)
- `MONITOR-DEEP OK A렌더 21p/2flag(high 0,auth=member) / B정확도 4probe(err 0): fg.us✓ yield.10y✓ vix✓ spy✓ / DB적재✓ (153s)`
- 정확도 delta 거의 0: fg.us 41=41, 10y 4.48 vs 4.469(+0.011), vix 16.2 vs 16.17(+0.03), spy 754.83=754.83.
- **deep 모니터가 즉시 2개 실결함 검출** (기존 모니터 사각지대):
  1. `/ko` 홈 일본어 — 재확인시 0(CDN s-maxage 7200 캐시 잔상; news-cascade?locale=ko=0 JP, dropForeignTitles 정상). 전향적 관측으로 "그 시점 사용자가 본 화면" 기록됨.
  2. `/ko/intelligence?tab=fear-greed` 국가명 한자(日本/中国/台灣 등) — **지속 결함** → 아래 fix.

## 곁다리 fix — fear-greed 국가 라벨 CJK 누출
- `src/app/api/fear-greed/route.ts` COUNTRY_ETFS + `src/data/fear-greed.ts`: 한국/日本/中国/भारत/台灣 →
  Korea/Japan/China/India/Taiwan (영어 단일, 기존 US/UK/Europe/Brazil/Australia 와 일치). 라벨이 per-ticker
  Redis 캐시(flowvium:fg:v6, TTL 4h)에 저장돼 `?force=1` 로 캐시 버스트 검증: 0 CJK ✓.

## 검증/push 메모
- `npm run verify`: audit-coverage ❌ = **portfolio↔snapshot mismatch (2026-06-14 evening/afternoon 보고서,
  KR ticker POSCO/HD현대/NTAP 등 snapshot 누락)** — 2일전 과거데이터, 당일(06-16) 보고서는 정상. 내 변경
  (fear-greed 라벨/모니터 인프라)과 무관·직교. 과거 보고서 snapshot 은 당시 미캡처분이라 지금 backfill 하면
  wrong-dated(정적-as-live 금지 위반) → 비행동. 현 파이프라인은 정상.
- 미푸시시 cron `git checkout origin/master -- src/` 가 fear-greed fix 를 revert(일본어 재발) → push 필수.

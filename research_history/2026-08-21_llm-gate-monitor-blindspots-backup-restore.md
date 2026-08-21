# 2026-08-21 — 직렬 LLM 게이트 · 죽어 있던 검증 6종 · 23일 끊긴 백업 복구

> ⚠️ 이 기록 자체가 결함의 산물이다. CLAUDE.md 는 "research_history/YYYY-MM-DD_*.txt 에 모든 작업
> 마일스톤 기록" 을 규정하는데, 최신 기록이 2026-07-10 로 **42일 끊겨 있었다**.
> 사용자가 "SESSION_LOG.md 읽어가면서 작업하고 있지?" 라고 물어서야 확인했다.
> SESSION_LOG.md 는 이 저장소에 존재한 적이 없고(git 히스토리 포함), 실제 규약은 이 디렉터리다.

## 1. 보고서 섹션이 조용히 비던 근본 원인 (확증)

최근 보고서 8건 중 2건에서 `marketNarrative`·`shortSqueeze`·`topOpportunity` 가 *정확히 같이* 비었다.
셋은 Wave1 의 opportunity/narrative 산출물이다.

`:8000` 27B 는 `--prompt-concurrency 1 --decode-concurrency 1` 로 뜬다(동시 1건).
성공 런의 완료시각이 증거다 — 215.4 → 335.6 → 603.6 → 765.2 → 1667.7s (단조 증가 = 직렬).
그런데 Wave1 은 `Promise.all` 로 5건을 동시에 던졌다. 남는 4건은 서버 큐에서 굶고,
대기시간이 각자의 `AbortSignal(3600s)` 예산에서 빠져나가 천장을 넘는 순간 함께 죽었다:
`Wave1 총 소요: 3598.1s / The operation was aborted due to timeout` (4건).
대조군: 단독 호출인 `regional-retry` 는 두 번 다 성공(158.7s · 314.4s).

**수정** `scripts/lib/llm-gate.mjs` — 서버 처리량만큼만 흘려보낸다. 핵심은 대기를
`AbortSignal` 시작 *전* 으로 옮기는 것(slot 획득 후에야 `callVLLMOnce` 가 signal 을 만든다).
폭은 `llm-config.resolveLlm().concurrency` 가 `.env.local` 에서 읽는다(서버 플래그와 짝).

**검증(프로덕션 cron 경로)**
- 20:00 저녁: macro 425.8 · portfolio 938.1 · regional 168.3 · opportunity 73.9 · narrative 146.9
  → Wave1 총 1753.0s (= 개별 합과 정확히 일치, 오버헤드 0) · `opportunity=true(squeeze:3)` · `narrative=true`
- 라이브 발간본: `marketNarrative` len=5 · `shortSqueeze` len=2 · `topOpportunity` 157자 · 품질 93

## 2. 죽어 있던 검증·가드 6종

| # | 결함 | 증거 | 수정 |
|---|---|---|---|
| 1 | `check-data-quality.mjs` 파싱 불가 | 코드모드가 import 를 shebang *위* 에 삽입 → `SyntaxError`. 모니터는 `dq=DEFECT` 만 찍었다 | shebang 1행 복원 |
| 2 | `db.mjs` import 2줄이 **헤더 주석 안** | `ReferenceError: isTicker` → `saveDomainArchives` 통째 실패. 아카이브 마지막 기록이 08-21 02:17 에서 멈춤 | 주석 밖으로 이동 + 오후·저녁분 되메움 |
| 3 | `pm2` 유령 호출 | 미설치 `pm2 jlist` 를 20분마다 호출 → "배포 직후 오탐 방지" 가드가 한 번도 발동 안 함 | 포트 리스너 uptime 으로 교체 |
| 4 | `findProcesses` 자기제외가 죽은 코드 | `if (pid===process.pid && !includes(pattern))` — 앞 줄이 이미 includes 를 요구해 절대 참 불가. 내 대기 셸이 '생성기 2번째'로 집계됨 | 정규식 지원 + 실제 자기제외 |
| 5 | wipe 경고가 틀린 메커니즘 단정 | 그 checkout 은 Windows `.bat` 에만 있음. `check-stall` 은 08-20 에 고쳐졌는데 `check-uncommitted-risk` 만 남음 | `launcherWipesWorktree()` 참조 |
| 6 | 번역 캐시 히트 경로 무검증 반환 | 라이브 `/ko` 에 `금요일 경제行事일정` | 읽기측에 `hasChineseBleed` 적용 |

재발 방지: `source-placement.test.mjs`(acorn AST 로 255파일에서 '실행되지 않는 import' 검출),
`proc-match.test.mjs`, `wipe-risk-claim.test.mjs`, `news-bleed-guard.test.mjs`.

## 3. 모니터 사각지대 — 자원·백업

`check-stall` 의 검사 7종에 **메모리·스왑·열·백업이 하나도 없었다.**
이 기기는 27B(31.7GB) + 4B(5.2GB) + embed(0.69GB) = 37.6GB 를 상주시킨다(vmmap 실측).

- `[8] 자원 압력` 신설 — GPU 미사용 소스만(`vm_stat`·`sysctl`·조절기 로그). 임계값 `data/resource-thresholds.json`.
- `[9] 백업 신선도` 신설 — 아래 4절.

## 4. 🔴 23일 끊겨 있던 인수인계 백업

`HANDOFF.md` 는 "머신 사망 시" 복구 runbook 이고 그 전제가 Google Drive 일일 백업이다
(6/7 하드 freeze 4일 다운 후 신설). 그런데:

- 최신 백업 `flowvium-2026-07-29.db` — **23일 전**. Windows 기기 해체일과 같은 날 멈춤
- launchd·cron 어디에도 미등록, `FLOWVIUM_BACKUP_DIR` 미설정(→ 스크립트가 `exit(1)`)
- 그 사이 DB 는 133MB → 159MB 로 성장

**복구**: `.env.local` 에 경로 설정 + `com.spinai.flowvium-backup.plist`(매일 04:35) 등록 + 즉시 실행.

**그 과정에서 드러난 진짜 결함 2개**

1) `db.backup(dbDest)` 가 Drive 경로에 **직접** 썼다 → 12분+ 0바이트 정지(CPU 0%).
   같은 호출을 로컬 경로로 하면 144.9MB 를 **0.2초**. 원인은 대상 파일시스템이다 —
   SQLite backup API 의 잦은 소량 쓰기+fsync 를 FUSE 계열이 못 견딘다.
   → 로컬 임시본으로 뜬 뒤 완성본을 한 번에 복사(실측 복사 0.1s).

2) 보존정책 삭제(클라우드 전용 133MB `unlinkSync`)가 **시크릿·문서·미러보다 먼저** 있었다.
   이 마운트는 서버 왕복 1회가 **~9.5초**다(dehydrated `stat` 4ms vs 첫 1바이트 `read` 9,526ms).
   동기 삭제가 이벤트루프를 막아 그 뒤가 아예 실행되지 않았다(`secrets/.env.local` 이 Jul 29 그대로).
   **가장 덜 중요한 단계가 가장 중요한 단계를 막는 순서였다.**
   → 보존삭제를 맨 뒤로 + 전체 시간예산(`BACKUP_BUDGET_MS`) + 비동기 unlink 개별 상한.

## 5. 눈검증에서 나온 UI 결함

실존 라우트로 페이지 감사를 다시 돌려 잡았다(앞서 존재하지 않는 `/ko/news` 를 넘겨 404 를 '통과'로 읽었다).

- `english_leak` 13건 → **0건**. 근본은 `localizeSector` 의 게이트가 '번역 보유' 가 아니라
  '`data/sectors.ts` 카탈로그 멤버십' 이었던 것. 근거를 `messages` 로 교체.
  `CascadePage`·`NewsGapPage` 배선 + i18n 키 6종 × 16로케일 추가.
- **FOMC 배지가 `Apr 29`**(넉 달 전)를 '다음 회의' 로 표시 → `ReportPage.tsx:622` 의 `meetings[0]`.
  다른 소비처 4곳은 이미 `pickNextMeeting` 으로 옮겨갔는데 화면에서 가장 잘 보이는 곳만 남아 있었다.
  → `FOMC Sep 17 0%` (발간본 스크린샷 대조).

## 6. 미해결 (다음 세션)

- **스퀴즈 산식**: `short-interest/route.ts:171` 이 `shortRatio`·`shortChangeMonthly` 를 수집만 하고 안 쓴다.
  대체용 `squeeze-score.mjs` 는 소비처 0. 연결하면 MRNA 가 `49 · exhausted · 후보 아님` 으로 뒤집힌다
  (실측 `08-19 +177%` → 현재 고점대비 -23.5%). 투자 판정 변경이라 사용자 결정 필요.
- **팬 여력 47% 미사용**: GPU 86°C 에서 조절기가 정지시키는데 팬은 52~64%. M4 는 `thermalmonitord` 가
  SMC 를 잠가 `Ftst` 언락이 필요 — 서드파티 도구 설치는 하드웨어 권한 결정.
- **`HANDOFF.md` 전면 stale**: `C:\Flowvium`·`G:\`·Task Scheduler·pm2·`run-report.bat`·`ollama pull`.
  기기 사망 시 거의 모든 단계가 실패한다. 맥 기준 재작성 필요.
- `mlx_lm 0.31.3` = 최신인데 [#1493](https://github.com/ml-explore/mlx-lm/issues/1493)(장문 스트리밍 행) 미수정.
  [#1235](https://github.com/ml-explore/mlx-lm/issues/1235)(유휴 언로드) 도 열려 있어 27B 31.7GB 상주는 상류 한계.
- `data/flowvium.db` 159MB 가 git 추적 중(`.gitignore` 에 없음 — `db.mjs` 주석과 모순).
- GitHub PAT · Cloudflare 토큰 폐기.

## 7. 이 세션에서 내가 만든 오류 (기록용)

측정 도구 자체가 틀려 허위 결론을 낸 경우가 반복됐다. 코드보다 자[尺]를 먼저 의심할 것.

- `setGlobalDispatcher` 무효 판정 → undici 타이머 해상도(~1s) 아래(900ms/300ms)에서 측정한 착각. 실제로는 유효.
- macOS `pgrep -c` 미지원 → "생성기 0개" 허위. `timeout` 미설치 → smoke test 무실행.
- zsh: 단어분할 미수행(백업 루프 무동작), `--include=*.ts` 글롭 실패, 유니코드 정규식 파손.
- 기존 `llm-gate.test.mjs`(웹 레인용)를 존재 확인 없이 `cat >` 로 덮어씀 → 복구 후 개명.
- 치환 중 import 3줄 삭제 — `node --check` 는 통과(문법만 본다). 런타임 확인으로 발견.
- 손수 짠 주석 스캐너가 실제 코드 10줄 오탐 → acorn AST 로 교체.
- **22:42~23:20 에 느린 클라우드 FS 로 백업 실험을 돌려, 같은 시각 생성 중이던 자정 보고서의
  macro 가 425s → 2869s(6.7배)로 느려졌다.** 인과를 증명하진 못했으나 시간 상관이 명확하다.
  프로덕션 파이프라인이 도는 동안 I/O 실험을 하지 말 것.

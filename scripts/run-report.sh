#!/usr/bin/env bash
# run-report.sh — 보고서 파이프라인 래퍼 (macOS).
#
# 원본 run-report.bat 은 Windows 전용이라 맥에서 쓸 수 없다(C:\ 경로, schtasks, WMI, PowerShell).
# 동작은 보존한다: 동시실행 락 → LLM 헬스 대기 → 사전점검(치명 시 중단) → 부가 적재 → 본 생성.
# 원본이 하던 git fetch+checkout 은 옮기지 않았다(아래 주석 참조).
#
# 사용: run-report.sh --session=morning [그 밖의 인자는 generate-report-local.mjs 로 전달]
# 설정(전부 환경변수, 경로를 코드에 박지 않는다):
#   APP_DIR      기본: 이 스크립트의 상위 디렉터리
#   NODE_BIN     기본: PATH 의 node
#   LLM_HEALTH   기본: http://127.0.0.1:8000/v1/models  (포트 기동 확인용. 정상 판정은 llm-health-check.mjs 가 한다)
#   SKIP_LLM_PROBE = 1 이면 생성 프로브 생략 (긴급용. 켜면 2026-08-31 3일 정지 사건 경로가 열린다)
#   LLM_WAIT_S   기본: 900   (LLM 기동 대기 상한. 27.5GB 모델 적재가 느려서 원본 720s 보다 길게)
#   SKIP_PREFLIGHT / SKIP_INGEST  = 1 이면 해당 단계 생략
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$HERE")}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
LLM_HEALTH="${LLM_HEALTH:-http://127.0.0.1:8000/v1/models}"
LLM_WAIT_S="${LLM_WAIT_S:-900}"
LOG_DIR="${LOG_DIR:-$APP_DIR/logs}"
LOG_FILE="$LOG_DIR/report.log"
LOCK_DIR="${LOCK_DIR:-$LOG_DIR/report-pipeline.lock}"

mkdir -p "$LOG_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  log "[FATAL] node 를 찾을 수 없다 (NODE_BIN 으로 지정하라)"; exit 3
fi

# ── 0. 동시실행 락 (mkdir 은 원자적) ────────────────────────────────────────────
# 원본과 같은 규칙: 5분 미만이면 정상 실행 중으로 보고 건너뛴다. 그보다 오래됐고 실제 생성
# 프로세스가 없으면 죽은 락으로 보고 뺏는다.
# 2026-08-22: pgrep -f "generate-report-local" 을 쓰다가 is-report-running.mjs 로 바꿨다.
#   pgrep -f 는 명령줄 부분매칭이라 그 문자열이 스치기만 한 프로세스(셸 명령, grep, 에디터)에도
#   걸리고, 그러면 예약 발간이 조용히 [SKIP] 된다. 판정은 report-running.mjs 의 argv 구조 규칙
#   하나로 모은다 — 여기와 모듈이 어긋나면 그 결함이 그대로 재발한다.
# 락 파일 유무와 무관하게, 살아 있는 생성 프로세스가 있으면 무조건 건너뛴다.
# (락은 이 래퍼를 거친 실행만 남긴다. 수동으로 generate-report-local.mjs 를 직접 돌리는 경우가
#  실제로 있어서 — 이관 검증 중 그렇게 돌렸다 — 락만 믿으면 동시 2건이 떠서 LLM 큐가 엉킨다.
#  prompt-concurrency=1 환경에서 동시 2건은 서로를 굶겨 양쪽 다 실패한다.)
if "$NODE_BIN" "$APP_DIR/scripts/is-report-running.mjs" >/dev/null 2>&1; then
  log "[SKIP] 생성 프로세스가 이미 실행 중 — 이번 세션 건너뜀"; exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  age_s=$(( $(date +%s) - $(stat -f %B "$LOCK_DIR" 2>/dev/null || echo 0) ))
  if [ "$age_s" -lt 300 ]; then
    log "[SKIP] 다른 보고서 파이프라인 실행 중(락 ${age_s}s) — 이번 세션 건너뜀"; exit 0
  fi
  if "$NODE_BIN" "$APP_DIR/scripts/is-report-running.mjs" >/dev/null 2>&1; then
    log "[SKIP] 생성 프로세스 살아 있음 — 이번 세션 건너뜀"; exit 0
  fi
  log "[WARN] 죽은 락(${age_s}s) 회수"
  rmdir "$LOCK_DIR" 2>/dev/null; mkdir "$LOCK_DIR" 2>/dev/null || { log "[FATAL] 락 획득 실패"; exit 3; }
fi
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

cd "$APP_DIR"

# 원본 .bat 의 `git fetch origin master + checkout scripts/ src/ ...` 는 옮기지 않았다.
# 이 맥의 작업본에는 맥 이관 수정(undici 디스패처, 세션 단일소스, RAG 경로)이 들어 있는데
# origin/master 로 덮으면 그 수정이 전부 사라져 파이프라인이 다시 깨진다. 자동 배포를 원하면
# 맥 수정이 원격에 병합된 뒤에 별도 단계로 되살릴 것. 지금 조용히 켜면 회귀가 난다.

# ── 1. LLM 헬스 대기 ───────────────────────────────────────────────────────────
# 1-a. 포트 기동 대기. 이건 *기동* 확인일 뿐 정상 확인이 아니다 — 아래 1-b 가 진짜 판정이다.
log "[INFO] LLM 기동 대기 $LLM_HEALTH (상한 ${LLM_WAIT_S}s)"
deadline=$(( $(date +%s) + LLM_WAIT_S ))
until code=$(curl -s --max-time 8 -o /dev/null -w '%{http_code}' "$LLM_HEALTH" 2>/dev/null) && [ "$code" = "200" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    log "[ERROR] LLM 포트 무응답 (http=${code:-000}) — 중단"; exit 1
  fi
  sleep 15
done

# 1-b. 생성 프로브. 2026-08-31: 여기가 없어서 3일간 보고서가 0건이었다.
#   mlx_lm.server 는 요청마다 스레드를 띄우므로 08-28 10:44 Metal OOM 으로 생성 워커가
#   죽은 뒤에도 /v1/models 는 3일 내내 200(23ms)을 줬다. 위 1-a 만 보고 "LLM 정상" 을 찍은
#   런들은 섹션마다 3600s 를 태우고 빈 문자열을 받아 4시간+ 정지했고, 그동안 파이프라인
#   락 때문에 video·auto-warm·segments 잡까지 전부 skip 됐다. 서버 재기동 1회로 즉시 복구됐다.
#   → 게이트가 물어야 할 질문은 "포트가 살아있나" 가 아니라 "토큰이 나오나" 다.
if [ "${SKIP_LLM_PROBE:-0}" != "1" ]; then
  log "[INFO] LLM 생성 프로브 (죽어 있으면 1회 재기동)"
  if ! "$NODE_BIN" scripts/llm-health-check.mjs --repair >> "$LOG_FILE" 2>&1; then
    log "[ERROR] LLM 이 토큰을 내놓지 못한다 — 4시간 헛도는 대신 중단 (logs/report.log 의 [llm-health] 참조)"
    exit 1
  fi
fi
log "[INFO] LLM 정상 (생성 확인됨)"

# ── 2. 사전점검 (조용한 실패 방지). 종료코드 2 = 치명 → 중단 ──────────────────
if [ "${SKIP_PREFLIGHT:-0}" != "1" ]; then
  log "[INFO] 데이터 소스 사전점검"
  "$NODE_BIN" scripts/audit-data-sources.mjs >> "$LOG_FILE" 2>&1
  rc=$?
  if [ "$rc" -ge 2 ]; then log "[FATAL] 치명 데이터 소스 실패(rc=$rc) — 생성 중단"; exit 2; fi
  [ "$rc" -eq 1 ] && log "[WARN] 일부 소스 실패(rc=1) — 계속"
fi

# ── 3. 부가 적재 (비치명) ──────────────────────────────────────────────────────
if [ "${SKIP_INGEST:-0}" != "1" ]; then
  for step in "ingest-filings.mjs --limit=40" "analyze-chat-logs.mjs" "verify-chat-answers.mjs"; do
    log "[INFO] $step"
    # shellcheck disable=SC2086
    "$NODE_BIN" scripts/$step >> "$LOG_FILE" 2>&1 || log "[WARN] $step 실패 — 계속(비치명)"
  done
fi

# ── 4. 본 생성 ─────────────────────────────────────────────────────────────────
log "[INFO] 보고서 생성 시작: $*"
"$NODE_BIN" scripts/generate-report-local.mjs "$@" >> "$LOG_FILE" 2>&1
rc=$?
# 2026-08-31: 종전에는 `[ ... ] && log "[SUCCESS]" || log "[ERROR] rc=$rc"` 였다.
#   `A && B || C` 는 **B 가 실패하면 C 도 돈다.** log() 는 tee 로 끝나는데, 호출부가
#   execFileAsync(maxBuffer) 로 파이프를 닫으면 tee 가 EPIPE 로 비정상 종료한다.
#   그래서 12:26:47 로그에 이렇게 남았다:
#     [SUCCESS] 완료
#     [ERROR] 실패 rc=0      ← rc 는 0 인데 실패라고 적혀 있다
#   성공한 런이 ERROR 를 남기면 로그 기반 진단이 통째로 못 믿을 것이 된다. if/else 로 바꾼다.
if [ "$rc" -eq 0 ]; then
  log "[SUCCESS] 완료"
else
  log "[ERROR] 실패 rc=$rc"
fi
exit "$rc"

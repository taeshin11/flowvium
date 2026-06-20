#!/usr/bin/env bash
# SFT 스톨/크래시 감지 주기 모니터 (FlowVium-SFTMonitor 가 ~15min 마다 실행).
# 판정: lock ON 인데 (step 미전진 N회 연속) 또는 (GPU util 0% 지속) 또는 (학습 프로세스 死) → STALL/CRASH 알림.
# 자동복구는 하지 않음(오발 루프 위험) — 기록만. lock OFF 면 학습 종료로 보고 조용히 종료.
LOG=/mnt/d/Flowvium/logs/lora-train.log
STATUS=/mnt/d/Flowvium/logs/sft-monitor-status.json
ALERT=/mnt/d/Flowvium/logs/sft-monitor.log
LOCK=/mnt/d/Flowvium/logs/lora-training.lock
TS=$(date '+%Y-%m-%d %H:%M:%S')

if [ ! -f "$LOCK" ]; then
  echo "{\"ts\":\"$TS\",\"state\":\"idle\",\"note\":\"lock OFF — 학습 미진행\"}" > "$STATUS"
  exit 0
fi

STEP=$(tr '\r' '\n' < "$LOG" 2>/dev/null | grep -oE '[0-9]+/[0-9]+ \[[0-9:]+<' | tail -1 | cut -d/ -f1)
STEP=${STEP:-0}
UTIL=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
ALIVE=$(ps aux | grep -cE '[t]rain-unsloth|[p]ython -')
PREV_STEP=$(grep -oE '"step":[0-9]+' "$STATUS" 2>/dev/null | head -1 | cut -d: -f2)
PREV_STEP=${PREV_STEP:-0}
STALLS=$(grep -oE '"stalls":[0-9]+' "$STATUS" 2>/dev/null | head -1 | cut -d: -f2)
STALLS=${STALLS:-0}

STATE="ok"; NOTE="step $STEP, util ${UTIL}%, alive $ALIVE"
if [ "$ALIVE" -lt 1 ]; then
  STATE="crash"; NOTE="lock ON 인데 학습 프로세스 死(crash) — step $STEP 에서 중단 의심"
elif [ "$STEP" = "$PREV_STEP" ] && [ "${UTIL:-0}" -lt 5 ]; then
  STALLS=$((STALLS+1)); STATE="stall?"; NOTE="step 미전진($STEP) + util ${UTIL}% — 스톨 의심 ${STALLS}회 연속"
  [ "$STALLS" -ge 2 ] && STATE="STALL"
else
  STALLS=0
fi

echo "{\"ts\":\"$TS\",\"state\":\"$STATE\",\"step\":$STEP,\"util\":${UTIL:-0},\"alive\":$ALIVE,\"stalls\":$STALLS,\"note\":\"$NOTE\"}" > "$STATUS"
if [ "$STATE" = "STALL" ] || [ "$STATE" = "crash" ]; then
  echo "[$TS] 🚨 $STATE — $NOTE" >> "$ALERT"
fi
echo "$STATE :: $NOTE"

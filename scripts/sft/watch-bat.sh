#!/usr/bin/env bash
# Monitor the bat-driven Unsloth run (logs to lora-train.log): load -> first loss + step rate.
LOG=/mnt/d/Flowvium/logs/lora-train.log
for i in $(seq 1 28); do
  sleep 15
  UM=$(nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader | head -1)
  STEP=$(tr '\r' '\n' < "$LOG" | grep -oE '[0-9]+/543 \[[^]]*\]' | tail -1)
  LOSS=$(tr '\r' '\n' < "$LOG" | grep -oE "'loss': [0-9.]+" | tail -1)
  LAST=$(tr '\r' '\n' < "$LOG" | grep -vE '^[[:space:]]*$' | tail -1 | cut -c1-50)
  echo "[$((i*15))s] gpu=$UM step=[$STEP] ${LOSS:+$LOSS} :: $LAST"
  if [ -n "$LOSS" ]; then echo ">> LOSS 확인 — 학습 정상"; fi
  if tr '\r' '\n' < "$LOG" | grep -qiE "OutOfMemory|Traceback|Error:|not ready"; then echo ">> 에러"; break; fi
  # 2 loss 줄 잡히면 종료(ETA 산출 충분)
  [ "$(tr '\r' '\n' < "$LOG" | grep -cE "'loss':")" -ge 3 ] && { echo ">> loss 3회 — 모니터 종료"; break; }
done
echo "=== loss 추세 ==="
tr '\r' '\n' < "$LOG" | grep -oE "'loss': [0-9.]+|[0-9]+/543 \[[^]]*\]" | tail -8

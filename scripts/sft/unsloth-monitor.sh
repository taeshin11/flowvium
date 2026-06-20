#!/usr/bin/env bash
LOG=/mnt/d/Flowvium/logs/lora-isolated.log
for i in $(seq 1 28); do
  sleep 15
  UM=$(nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader | head -1)
  STEP=$(tr '\r' '\n' < "$LOG" | grep -oE '[0-9]+/[0-9]+ \[[^]]*\]' | tail -1)
  LAST=$(tr '\r' '\n' < "$LOG" | grep -vE '^[[:space:]]*$' | tail -1 | cut -c1-58)
  echo "[$((i*15))s] gpu=$UM step=[$STEP] :: $LAST"
  if tr '\r' '\n' < "$LOG" | grep -qiE "'loss':|OutOfMemory|Traceback|device not ready|Error:|not ready"; then
    echo ">> 신호"; break
  fi
done
echo "=== loss/tail ==="
tr '\r' '\n' < "$LOG" | grep -iE "'loss':" | tail -4
tr '\r' '\n' < "$LOG" | grep -vE '^[[:space:]]*$' | tail -4

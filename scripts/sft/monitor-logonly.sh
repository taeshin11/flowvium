#!/usr/bin/env bash
# Log-only monitor (NO nvidia-smi, avoid perturbing GPU during cu124/cu130 load).
LOG=/mnt/d/Flowvium/logs/lora-isolated.log
for i in $(seq 1 22); do
  sleep 15
  ALIVE=$(ps aux | grep -c '[t]rain-lora')
  LAST=$(tr '\r' '\n' < "$LOG" | grep -vE '^[[:space:]]*$' | tail -1 | cut -c1-78)
  echo "[$((i*15))s] alive=$ALIVE :: $LAST"
  if tr '\r' '\n' < "$LOG" | grep -qiE "'loss':|LoRA saved|OutOfMemory|Error|Traceback|device not ready"; then
    echo "  >> 신호 감지"; break
  fi
  [ "$ALIVE" -eq 0 ] && { echo "  >> 프로세스 종료"; break; }
done
echo "=== tail ==="
tr '\r' '\n' < "$LOG" | grep -vE '^[[:space:]]*$' | tail -6

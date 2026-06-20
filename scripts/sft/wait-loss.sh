#!/usr/bin/env bash
LOG=/mnt/d/Flowvium/logs/lora-isolated.log
for i in $(seq 1 16); do
  sleep 15
  LINE=$(tr '\r' '\n' < "$LOG" | grep -vE '^[[:space:]]*$' | tail -1 | cut -c1-95)
  echo "[$((i*15))s] $LINE"
  if tr '\r' '\n' < "$LOG" | grep -qiE "'loss':|OutOfMemory|Error|Traceback|nan"; then echo ">> 신호"; break; fi
done
echo "=== loss 라인 ==="
tr '\r' '\n' < "$LOG" | grep -iE "'loss':" | tail -5

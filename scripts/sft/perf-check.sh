#!/usr/bin/env bash
LOG=/mnt/d/Flowvium/logs/lora-isolated.log
for i in $(seq 1 20); do
  sleep 15
  UTIL=$(nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader | head -1)
  STEP=$(tr '\r' '\n' < "$LOG" | grep -oE '[0-9]+/543 \[[^]]*\]' | tail -1)
  ERR=$(tr '\r' '\n' < "$LOG" | grep -iE 'OutOfMemory|Traceback|Error' | tail -1 | cut -c1-50)
  echo "[$((i*15))s] util/mem=$UTIL step=$STEP ${ERR:+ERR:$ERR}"
  [ -n "$ERR" ] && break
done
